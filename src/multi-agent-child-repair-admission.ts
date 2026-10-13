import crypto from "node:crypto";
import { mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultiAgentChildReviewDecisionV1 } from "./multi-agent-child-review-decision.js";
import type { MultiAgentChildReviewHandoffV1 } from "./multi-agent-child-review-handoff.js";
import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TTL_MS = 60_000;
const MAX_REPAIR_ATTEMPTS = 2;

export const MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_repair_admission_only" as const,
  maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  shortLived: true as const,
  singleUse: true as const,
  durableAttemptBudget: true as const,
  requiresReviewedTerminalChild: true as const,
  requiresCurrentParentBinding: true as const,
  startsChild: false as const,
  resumesChild: false as const,
  schedulesChild: false as const,
  createsDelegation: false as const,
  scopeExpansionAllowed: false as const,
  validationMutationAllowed: false as const,
  safetyMutationAllowed: false as const,
  workerMutationAllowed: false as const,
  distributedExecutionAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentChildRepairAdmissionPermitV1 {
  schemaVersion: 1;
  permitId: string;
  childTaskId: string;
  delegationSetId: string;
  delegationId: string;
  parentSupervisorTaskId: string;
  parentTaskId: string;
  workspaceId: string;
  repairAttempt: number;
  repairInstruction: string;
  issuedAt: string;
  expiresAt: string;
  authority: "child_repair_admission_only";
  startsChild: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentChildRepairAdmissionTicketV1 {
  permit: MultiAgentChildRepairAdmissionPermitV1;
  token: string;
}

export interface MultiAgentChildRepairAdmissionReceiptV1 {
  schemaVersion: 1;
  permitId: string;
  childTaskId: string;
  delegationSetId: string;
  delegationId: string;
  parentTaskId: string;
  repairAttempt: number;
  consumedAt: string;
  authority: "child_repair_admission_consumed_evidence_only";
  startsChild: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

interface DurableRepairAttemptV1 {
  schemaVersion: 1;
  permit: MultiAgentChildRepairAdmissionPermitV1;
  tokenHash: string;
  consumedAt?: string;
}

export interface MultiAgentChildRepairAdmissionOptions {
  ttlMs?: number;
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
}

export class MultiAgentChildRepairAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "handoff_invalid"
      | "decision_invalid"
      | "binding_mismatch"
      | "parent_not_current"
      | "parent_not_executable"
      | "repair_budget_exhausted"
      | "permit_invalid"
      | "permit_expired"
      | "permit_replayed"
      | "store_busy"
      | "store_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentChildRepairAdmissionError";
  }
}

function nowValue(now?: () => Date): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MultiAgentChildRepairAdmissionError("repair admission clock is invalid", "permit_invalid");
  }
  return value;
}

function boundedTtl(value?: number): number {
  const ttl = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new MultiAgentChildRepairAdmissionError(
      `repair permit ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
      "permit_invalid",
    );
  }
  return ttl;
}

function hashToken(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
    throw new MultiAgentChildRepairAdmissionError("repair admission token is invalid", "permit_invalid");
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function assertHandoff(value: MultiAgentChildReviewHandoffV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_review_evidence_only"
    || value.reviewState !== "ready_for_supervisor_review"
    || !["completed", "validation_failed", "failed"].includes(value.childStatus)
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildRepairAdmissionError(
      "repair admission requires a terminal reviewed child handoff",
      "handoff_invalid",
    );
  }
}

function assertDecision(value: MultiAgentChildReviewDecisionV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_review_decision_advisory_only"
    || value.decision !== "repair"
    || !value.repairInstruction?.trim()
    || value.schedulesChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildRepairAdmissionError(
      "repair admission requires a bounded advisory child repair decision",
      "decision_invalid",
    );
  }
}

function assertBindings(
  handoff: MultiAgentChildReviewHandoffV1,
  decision: MultiAgentChildReviewDecisionV1,
): void {
  if (
    decision.delegationSetId !== handoff.delegationSetId
    || decision.delegationId !== handoff.delegationId
    || decision.childTaskId !== handoff.childTaskId
    || decision.parentSupervisorTaskId !== handoff.parentSupervisorTaskId
    || decision.parentTaskId !== handoff.parentTaskId
  ) {
    throw new MultiAgentChildRepairAdmissionError(
      "repair decision does not match the reviewed child/delegation binding",
      "binding_mismatch",
    );
  }
}

function assertCurrentParent(
  handoff: MultiAgentChildReviewHandoffV1,
  current: MultiAgentParentExecutionBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_execution_binding"
    || current.taskId !== handoff.parentTaskId
    || current.projectId !== handoff.projectId
    || current.workspaceId !== handoff.workspaceId
    || !handoff.approvedWriteScope.every((pattern) => current.allowedPathPatterns.includes(pattern))
    || handoff.protectedPaths.length !== current.protectedPathPatterns.length
    || !handoff.protectedPaths.every((pattern, index) => current.protectedPathPatterns[index] === pattern)
  ) {
    throw new MultiAgentChildRepairAdmissionError(
      "current parent task/Safety binding no longer covers the reviewed child scope",
      "parent_not_current",
    );
  }
  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentChildRepairAdmissionError(
      "current parent state does not permit child repair admission",
      "parent_not_executable",
    );
  }
}

function assertPermit(value: MultiAgentChildRepairAdmissionPermitV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_repair_admission_only"
    || !UUID.test(value.permitId)
    || !UUID.test(value.childTaskId)
    || !UUID.test(value.delegationSetId)
    || !UUID.test(value.delegationId)
    || !UUID.test(value.parentSupervisorTaskId)
    || !UUID.test(value.parentTaskId)
    || !UUID.test(value.workspaceId)
    || !Number.isFinite(Date.parse(value.issuedAt))
    || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || !Number.isInteger(value.repairAttempt)
    || value.repairAttempt < 1
    || value.repairAttempt > MAX_REPAIR_ATTEMPTS
    || !value.repairInstruction.trim()
    || value.startsChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildRepairAdmissionError("repair admission permit is invalid", "permit_invalid");
  }
}

export class FileMultiAgentChildRepairAdmissionStore {
  constructor(private readonly stateRoot: string) {}

  private childDir(childTaskId: string): string {
    if (!UUID.test(childTaskId)) {
      throw new MultiAgentChildRepairAdmissionError("childTaskId must be an opaque UUID", "store_invalid");
    }
    return path.join(this.stateRoot, "multi-agent-child-repair-admissions", childTaskId);
  }

  private lockFile(childTaskId: string): string {
    return path.join(this.childDir(childTaskId), ".issue.lock");
  }

  private attemptFile(childTaskId: string, attempt: number): string {
    return path.join(this.childDir(childTaskId), `attempt-${attempt}.json`);
  }

  async reserve(
    childTaskId: string,
    build: (attempt: number) => DurableRepairAttemptV1,
  ): Promise<DurableRepairAttemptV1> {
    const dir = this.childDir(childTaskId);
    await mkdir(dir, { recursive: true });
    let lock;
    try {
      lock = await open(this.lockFile(childTaskId), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new MultiAgentChildRepairAdmissionError(
          "repair admission issuance is already in progress for this child",
          "store_busy",
        );
      }
      throw error;
    }

    try {
      const files = (await readdir(dir))
        .filter((name) => /^attempt-\d+\.json$/.test(name));
      const attempts = files
        .map((name) => Number(name.match(/^attempt-(\d+)\.json$/)?.[1]))
        .filter((value) => Number.isInteger(value));
      const next = attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
      if (next > MAX_REPAIR_ATTEMPTS) {
        throw new MultiAgentChildRepairAdmissionError(
          "bounded child repair-attempt budget is exhausted",
          "repair_budget_exhausted",
        );
      }
      const value = build(next);
      assertPermit(value.permit);
      await writeFile(this.attemptFile(childTaskId, next), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return structuredClone(value);
    } finally {
      await lock.close().catch(() => undefined);
      await rm(this.lockFile(childTaskId), { force: true }).catch(() => undefined);
    }
  }

  async consume(
    childTaskId: string,
    token: string,
    now: Date,
  ): Promise<DurableRepairAttemptV1> {
    const dir = this.childDir(childTaskId);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => /^attempt-\d+\.json$/.test(name));
    } catch (error) {
      throw new MultiAgentChildRepairAdmissionError(
        "repair admission state is unavailable",
        "store_invalid",
        { cause: error },
      );
    }
    const hash = hashToken(token);
    for (const name of files) {
      const file = path.join(dir, name);
      const parsed = JSON.parse(await readFile(file, "utf8")) as DurableRepairAttemptV1;
      if (parsed.tokenHash !== hash) continue;
      assertPermit(parsed.permit);
      if (parsed.consumedAt) {
        throw new MultiAgentChildRepairAdmissionError(
          "repair admission permit was already consumed",
          "permit_replayed",
        );
      }
      if (Date.parse(parsed.permit.expiresAt) <= now.getTime()) {
        throw new MultiAgentChildRepairAdmissionError(
          "repair admission permit expired",
          "permit_expired",
        );
      }
      parsed.consumedAt = now.toISOString();
      await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      return structuredClone(parsed);
    }
    throw new MultiAgentChildRepairAdmissionError(
      "repair admission token was not found",
      "permit_invalid",
    );
  }
}

export class MultiAgentChildRepairAdmissionService {
  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly store: FileMultiAgentChildRepairAdmissionStore,
    private readonly options: MultiAgentChildRepairAdmissionOptions = {},
  ) {}

  async issue(
    handoffInput: MultiAgentChildReviewHandoffV1,
    decisionInput: MultiAgentChildReviewDecisionV1,
  ): Promise<MultiAgentChildRepairAdmissionTicketV1> {
    assertHandoff(handoffInput);
    assertDecision(decisionInput);
    const handoff = structuredClone(handoffInput);
    const decision = structuredClone(decisionInput);
    assertBindings(handoff, decision);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(handoff.parentTaskId);
    } catch (error) {
      throw new MultiAgentChildRepairAdmissionError(
        "current parent task/Safety binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(handoff, current);

    const now = nowValue(this.options.now);
    const ttl = boundedTtl(this.options.ttlMs);
    const token = (this.options.tokenFactory
      ?? (() => `mar_${crypto.randomBytes(32).toString("base64url")}`))();
    const tokenHash = hashToken(token);

    const durable = await this.store.reserve(handoff.childTaskId, (attempt) => {
      const permitId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
      if (!UUID.test(permitId)) {
        throw new MultiAgentChildRepairAdmissionError(
          "repair permitId must be an opaque UUID",
          "permit_invalid",
        );
      }
      const permit: MultiAgentChildRepairAdmissionPermitV1 = {
        schemaVersion: 1,
        permitId,
        childTaskId: handoff.childTaskId,
        delegationSetId: handoff.delegationSetId,
        delegationId: handoff.delegationId,
        parentSupervisorTaskId: handoff.parentSupervisorTaskId,
        parentTaskId: handoff.parentTaskId,
        workspaceId: handoff.workspaceId,
        repairAttempt: attempt,
        repairInstruction: decision.repairInstruction!,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
        authority: "child_repair_admission_only",
        startsChild: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      };
      return { schemaVersion: 1, permit, tokenHash };
    });

    return { permit: Object.freeze(durable.permit), token };
  }

  async consume(
    ticketToken: string,
    handoff: MultiAgentChildReviewHandoffV1,
    decision: MultiAgentChildReviewDecisionV1,
  ): Promise<MultiAgentChildRepairAdmissionReceiptV1> {
    assertHandoff(handoff);
    assertDecision(decision);
    assertBindings(handoff, decision);
    const now = nowValue(this.options.now);
    const durable = await this.store.consume(handoff.childTaskId, ticketToken, now);
    const permit = durable.permit;
    if (
      permit.childTaskId !== handoff.childTaskId
      || permit.delegationSetId !== handoff.delegationSetId
      || permit.delegationId !== handoff.delegationId
      || permit.parentTaskId !== handoff.parentTaskId
      || permit.repairInstruction !== decision.repairInstruction
    ) {
      throw new MultiAgentChildRepairAdmissionError(
        "repair permit no longer matches the reviewed child/decision binding",
        "binding_mismatch",
      );
    }
    return Object.freeze({
      schemaVersion: 1,
      permitId: permit.permitId,
      childTaskId: permit.childTaskId,
      delegationSetId: permit.delegationSetId,
      delegationId: permit.delegationId,
      parentTaskId: permit.parentTaskId,
      repairAttempt: permit.repairAttempt,
      consumedAt: durable.consumedAt!,
      authority: "child_repair_admission_consumed_evidence_only",
      startsChild: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
