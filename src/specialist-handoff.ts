import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const MAX_EVIDENCE_REFS = 20;
const MAX_WORKER_PROFILE_CHARS = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SPECIALIST_HANDOFF_LIMITS = Object.freeze({
  maxEvidenceRefs: MAX_EVIDENCE_REFS,
  maxWorkerProfileChars: MAX_WORKER_PROFILE_CHARS,
});

export type SpecialistRole = "planner" | "implementation" | "reviewer";
export type SpecialistEvidenceKind = "supervisor_decision" | "task_event" | "sentinel_incident";

export const SPECIALIST_ROLE_CONTRACT = Object.freeze({
  planner: "Produces bounded planning proposals only; grants no implementation authority.",
  implementation: "Implements only under the independently approved durable task and Safety Plan.",
  reviewer: "Consumes sanitized evidence and recommends pass, bounded repair, or human escalation only.",
} as const);

export interface SpecialistEvidenceRefV1 {
  kind: SpecialistEvidenceKind;
  evidenceId: string;
  capturedAt: string;
}

export interface SpecialistAuthorityRefV1 {
  projectId: string;
  workspaceId: string;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workspaceRegistryRevision: number;
  workerProfileId: string;
}

export interface SpecialistHandoffV1 {
  schemaVersion: 1;
  handoffId: string;
  createdAt: string;
  sequence: number;
  previousHandoffId?: string;
  supervisorTaskId: string;
  taskId: string;
  fromRole: SpecialistRole;
  toRole: SpecialistRole;
  authority: SpecialistAuthorityRefV1;
  evidence: SpecialistEvidenceRefV1[];
  constraints: {
    executionMode: "sequential_only";
    authoritySource: "approved_task_only";
    machineAuthorityGranted: false;
    writeAuthorityGranted: false;
    concurrentWorkspaceWritesAllowed: false;
  };
}

export interface CreateSpecialistHandoffInput {
  fromRole: SpecialistRole;
  toRole: SpecialistRole;
  evidence: SpecialistEvidenceRefV1[];
}

export interface SpecialistHandoffOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class SpecialistHandoffError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "handoff_invalid"
      | "transition_invalid"
      | "binding_mismatch"
      | "chain_invalid",
  ) {
    super(message);
    this.name = "SpecialistHandoffError";
  }
}

const ROLES = new Set<SpecialistRole>(["planner", "implementation", "reviewer"]);
const EVIDENCE_KINDS = new Set<SpecialistEvidenceKind>([
  "supervisor_decision",
  "task_event",
  "sentinel_incident",
]);
const ALLOWED_TRANSITIONS = new Set([
  "planner>implementation",
  "implementation>reviewer",
  "reviewer>implementation",
]);

function opaqueUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new SpecialistHandoffError(`${field} must be an opaque UUID`, "handoff_invalid");
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SpecialistHandoffError(`${field} must be a positive integer`, "handoff_invalid");
  }
  return value as number;
}

function boundedWorkerProfile(value: unknown): string {
  if (typeof value !== "string") {
    throw new SpecialistHandoffError("workerProfileId must be a string", "handoff_invalid");
  }
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0") || normalized.length > MAX_WORKER_PROFILE_CHARS) {
    throw new SpecialistHandoffError("workerProfileId is invalid", "handoff_invalid");
  }
  return normalized;
}

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new SpecialistHandoffError(`${field} must be an ISO timestamp`, "handoff_invalid");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new SpecialistHandoffError(`${field} must be an ISO timestamp`, "handoff_invalid");
  }
  return new Date(parsed).toISOString();
}

function role(value: unknown, field: string): SpecialistRole {
  if (typeof value !== "string" || !ROLES.has(value as SpecialistRole)) {
    throw new SpecialistHandoffError(`${field} is not a supported specialist role`, "handoff_invalid");
  }
  return value as SpecialistRole;
}

function assertTransition(fromRole: SpecialistRole, toRole: SpecialistRole): void {
  if (!ALLOWED_TRANSITIONS.has(`${fromRole}>${toRole}`)) {
    throw new SpecialistHandoffError(
      `Unsupported specialist transition ${fromRole} -> ${toRole}`,
      "transition_invalid",
    );
  }
}

function evidenceRefs(values: unknown): SpecialistEvidenceRefV1[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_EVIDENCE_REFS) {
    throw new SpecialistHandoffError(
      `evidence must contain between 1 and ${MAX_EVIDENCE_REFS} references`,
      "handoff_invalid",
    );
  }
  const seen = new Set<string>();
  return values.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SpecialistHandoffError(`evidence[${index}] must be an object`, "handoff_invalid");
    }
    const item = raw as Record<string, unknown>;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "capturedAt,evidenceId,kind") {
      throw new SpecialistHandoffError(
        `evidence[${index}] contains unsupported fields`,
        "handoff_invalid",
      );
    }
    if (typeof item.kind !== "string" || !EVIDENCE_KINDS.has(item.kind as SpecialistEvidenceKind)) {
      throw new SpecialistHandoffError(`evidence[${index}].kind is invalid`, "handoff_invalid");
    }
    const evidenceId = opaqueUuid(item.evidenceId, `evidence[${index}].evidenceId`);
    const dedupe = `${item.kind}:${evidenceId}`;
    if (seen.has(dedupe)) {
      throw new SpecialistHandoffError(`evidence[${index}] is duplicated`, "handoff_invalid");
    }
    seen.add(dedupe);
    return {
      kind: item.kind as SpecialistEvidenceKind,
      evidenceId,
      capturedAt: isoTimestamp(item.capturedAt, `evidence[${index}].capturedAt`),
    };
  });
}

function authorityFromSupervisor(supervisor: SupervisorTaskV1): SpecialistAuthorityRefV1 {
  return {
    projectId: opaqueUuid(supervisor.authority.projectId, "projectId"),
    workspaceId: opaqueUuid(supervisor.authority.workspaceId, "workspaceId"),
    safetyPlanId: opaqueUuid(supervisor.authority.safetyPlanId, "safetyPlanId"),
    safetyProfileId: opaqueUuid(supervisor.authority.safetyProfileId, "safetyProfileId"),
    safetyProfileRevision: positiveInteger(
      supervisor.authority.safetyProfileRevision,
      "safetyProfileRevision",
    ),
    workspaceRegistryRevision: positiveInteger(
      supervisor.authority.workspaceRegistryRevision,
      "workspaceRegistryRevision",
    ),
    workerProfileId: boundedWorkerProfile(supervisor.authority.workerProfileId),
  };
}

function bindingKey(handoff: SpecialistHandoffV1): string {
  return JSON.stringify({
    supervisorTaskId: handoff.supervisorTaskId,
    taskId: handoff.taskId,
    authority: handoff.authority,
  });
}

function supervisorBindingKey(supervisor: SupervisorTaskV1): string {
  return JSON.stringify({
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    authority: authorityFromSupervisor(supervisor),
  });
}

function assertPreviousMatchesSupervisor(
  supervisor: SupervisorTaskV1,
  previous: SpecialistHandoffV1,
): void {
  if (bindingKey(previous) !== supervisorBindingKey(supervisor)) {
    throw new SpecialistHandoffError(
      "Previous handoff does not match the current approved supervisor/task binding",
      "binding_mismatch",
    );
  }
}

/**
 * Creates a provenance-only specialist handoff. The handoff carries opaque
 * authority references so stale/cross-task chains can be rejected, but it
 * explicitly grants no machine or write authority. Implementation still has to
 * execute through the independently approved durable task/Safety Plan boundary.
 */
export function createSpecialistHandoff(
  supervisor: SupervisorTaskV1,
  input: CreateSpecialistHandoffInput,
  previous?: SpecialistHandoffV1,
  options: SpecialistHandoffOptions = {},
): SpecialistHandoffV1 {
  if (supervisor.schemaVersion !== 1) {
    throw new SpecialistHandoffError("Unsupported supervisor task schema", "binding_mismatch");
  }
  const fromRole = role(input.fromRole, "fromRole");
  const toRole = role(input.toRole, "toRole");
  assertTransition(fromRole, toRole);

  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  let sequence = 1;
  let previousHandoffId: string | undefined;
  if (previous) {
    assertStoredHandoff(previous);
    assertPreviousMatchesSupervisor(supervisor, previous);
    if (previous.toRole !== fromRole) {
      throw new SpecialistHandoffError(
        `Handoff chain must continue from previous target role ${previous.toRole}`,
        "chain_invalid",
      );
    }
    if (Date.parse(createdAt) < Date.parse(previous.createdAt)) {
      throw new SpecialistHandoffError(
        "Handoff timestamp cannot precede the previous handoff",
        "chain_invalid",
      );
    }
    sequence = previous.sequence + 1;
    previousHandoffId = previous.handoffId;
  }

  return {
    schemaVersion: 1,
    handoffId: opaqueUuid(
      (options.idFactory ?? (() => crypto.randomUUID()))(),
      "handoffId",
    ),
    createdAt,
    sequence,
    ...(previousHandoffId ? { previousHandoffId } : {}),
    supervisorTaskId: opaqueUuid(supervisor.supervisorTaskId, "supervisorTaskId"),
    taskId: opaqueUuid(supervisor.taskId, "taskId"),
    fromRole,
    toRole,
    authority: authorityFromSupervisor(supervisor),
    evidence: evidenceRefs(input.evidence),
    constraints: {
      executionMode: "sequential_only",
      authoritySource: "approved_task_only",
      machineAuthorityGranted: false,
      writeAuthorityGranted: false,
      concurrentWorkspaceWritesAllowed: false,
    },
  };
}

function assertStoredAuthority(value: unknown): SpecialistAuthorityRefV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SpecialistHandoffError("Stored handoff authority is invalid", "handoff_invalid");
  }
  const authority = value as Record<string, unknown>;
  const keys = Object.keys(authority).sort().join(",");
  if (keys !== "projectId,safetyPlanId,safetyProfileId,safetyProfileRevision,workerProfileId,workspaceId,workspaceRegistryRevision") {
    throw new SpecialistHandoffError("Stored handoff authority contains unsupported fields", "handoff_invalid");
  }
  return {
    projectId: opaqueUuid(authority.projectId, "authority.projectId"),
    workspaceId: opaqueUuid(authority.workspaceId, "authority.workspaceId"),
    safetyPlanId: opaqueUuid(authority.safetyPlanId, "authority.safetyPlanId"),
    safetyProfileId: opaqueUuid(authority.safetyProfileId, "authority.safetyProfileId"),
    safetyProfileRevision: positiveInteger(authority.safetyProfileRevision, "authority.safetyProfileRevision"),
    workspaceRegistryRevision: positiveInteger(authority.workspaceRegistryRevision, "authority.workspaceRegistryRevision"),
    workerProfileId: boundedWorkerProfile(authority.workerProfileId),
  };
}

export function assertStoredHandoff(value: unknown): asserts value is SpecialistHandoffV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SpecialistHandoffError("Stored handoff must be an object", "handoff_invalid");
  }
  const handoff = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "handoffId",
    "createdAt",
    "sequence",
    "previousHandoffId",
    "supervisorTaskId",
    "taskId",
    "fromRole",
    "toRole",
    "authority",
    "evidence",
    "constraints",
  ]);
  if (Object.keys(handoff).some((key) => !allowedKeys.has(key))) {
    throw new SpecialistHandoffError("Stored handoff contains unsupported fields", "handoff_invalid");
  }
  if (handoff.schemaVersion !== 1) {
    throw new SpecialistHandoffError("Stored handoff schemaVersion must be 1", "handoff_invalid");
  }
  opaqueUuid(handoff.handoffId, "handoffId");
  isoTimestamp(handoff.createdAt, "createdAt");
  positiveInteger(handoff.sequence, "sequence");
  if (handoff.previousHandoffId !== undefined) {
    opaqueUuid(handoff.previousHandoffId, "previousHandoffId");
  }
  opaqueUuid(handoff.supervisorTaskId, "supervisorTaskId");
  opaqueUuid(handoff.taskId, "taskId");
  const fromRole = role(handoff.fromRole, "fromRole");
  const toRole = role(handoff.toRole, "toRole");
  assertTransition(fromRole, toRole);
  assertStoredAuthority(handoff.authority);
  evidenceRefs(handoff.evidence);

  if (!handoff.constraints || typeof handoff.constraints !== "object" || Array.isArray(handoff.constraints)) {
    throw new SpecialistHandoffError("Stored handoff constraints are invalid", "handoff_invalid");
  }
  const constraints = handoff.constraints as Record<string, unknown>;
  const constraintKeys = Object.keys(constraints).sort().join(",");
  if (constraintKeys !== "authoritySource,concurrentWorkspaceWritesAllowed,executionMode,machineAuthorityGranted,writeAuthorityGranted") {
    throw new SpecialistHandoffError("Stored handoff constraints contain unsupported fields", "handoff_invalid");
  }
  if (
    constraints.executionMode !== "sequential_only"
    || constraints.authoritySource !== "approved_task_only"
    || constraints.machineAuthorityGranted !== false
    || constraints.writeAuthorityGranted !== false
    || constraints.concurrentWorkspaceWritesAllowed !== false
  ) {
    throw new SpecialistHandoffError(
      "Stored handoff attempts to change specialist authority constraints",
      "handoff_invalid",
    );
  }
}

function assertChain(previous: SpecialistHandoffV1, next: SpecialistHandoffV1): void {
  if (bindingKey(previous) !== bindingKey(next)) {
    throw new SpecialistHandoffError("Specialist handoff chain changed task authority binding", "binding_mismatch");
  }
  if (
    next.sequence !== previous.sequence + 1
    || next.previousHandoffId !== previous.handoffId
    || next.fromRole !== previous.toRole
    || Date.parse(next.createdAt) < Date.parse(previous.createdAt)
  ) {
    throw new SpecialistHandoffError("Specialist handoff chain is not sequential", "chain_invalid");
  }
}

export class SpecialistHandoffStore {
  constructor(private readonly workspaceRoot: string) {}

  private dir(): string {
    return path.join(this.workspaceRoot, ".orchestrator", "specialist-handoffs");
  }

  private file(taskId: string): string {
    return path.join(this.dir(), `${opaqueUuid(taskId, "taskId")}.jsonl`);
  }

  async append(handoff: SpecialistHandoffV1): Promise<void> {
    assertStoredHandoff(handoff);
    const existing = await this.list(handoff.taskId);
    const previous = existing.at(-1);
    if (!previous) {
      if (handoff.sequence !== 1 || handoff.previousHandoffId !== undefined) {
        throw new SpecialistHandoffError("First durable handoff must start at sequence 1", "chain_invalid");
      }
    } else {
      assertChain(previous, handoff);
    }
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.file(handoff.taskId), `${JSON.stringify(handoff)}\n`, "utf8");
  }

  async list(taskId: string): Promise<SpecialistHandoffV1[]> {
    const file = this.file(taskId);
    try {
      const raw = await readFile(file, "utf8");
      const items = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
        try {
          const parsed: unknown = JSON.parse(line);
          assertStoredHandoff(parsed);
          if (parsed.taskId !== taskId) {
            throw new SpecialistHandoffError("Stored handoff taskId does not match journal", "binding_mismatch");
          }
          return parsed;
        } catch (error) {
          if (error instanceof SpecialistHandoffError) throw error;
          throw new SpecialistHandoffError(
            `Stored handoff line ${index + 1} is invalid JSON`,
            "handoff_invalid",
          );
        }
      });
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (index === 0) {
          if (item.sequence !== 1 || item.previousHandoffId !== undefined) {
            throw new SpecialistHandoffError("Stored handoff journal has an invalid first item", "chain_invalid");
          }
        } else {
          assertChain(items[index - 1]!, item);
        }
      }
      return items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }
}
