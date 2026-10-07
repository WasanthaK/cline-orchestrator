import crypto from "node:crypto";
import {
  FileAutonomousEngineeringLoopStore,
  type AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";
import type { AutonomousEngineeringExecutionIntentV1 } from "./autonomous-engineering-execution-intent.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TTL_MS = 60_000;

export const AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_execution_admission_only" as const,
  shortLived: true as const,
  singleUse: true as const,
  requiresExactLoopRevision: true as const,
  requiresFreshTaskSafetyBinding: true as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  mutatesTaskState: false as const,
  mutatesLoopState: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDistributedDispatch: false as const,
  performsGitDelivery: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface AutonomousEngineeringExecutionAdmissionPermitV1 {
  schemaVersion: 1;
  permitId: string;
  intentId: string;
  loopId: string;
  loopRevision: number;
  taskId: string;
  workspaceId: string;
  kind: AutonomousEngineeringExecutionIntentV1["kind"];
  issuedAt: string;
  expiresAt: string;
  authority: "autonomous_engineering_execution_admission_only";
  executable: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionAdmissionTicketV1 {
  permit: AutonomousEngineeringExecutionAdmissionPermitV1;
  token: string;
}

export interface AutonomousEngineeringExecutionAdmissionReceiptV1 {
  schemaVersion: 1;
  permitId: string;
  intentId: string;
  loopId: string;
  loopRevision: number;
  taskId: string;
  workspaceId: string;
  kind: AutonomousEngineeringExecutionIntentV1["kind"];
  consumedAt: string;
  authority: "autonomous_engineering_execution_admission_consumed_evidence_only";
  startsExecution: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionAdmissionOptions {
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
  ttlMs?: number;
}

export class AutonomousEngineeringExecutionAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "intent_invalid"
      | "loop_stale"
      | "binding_stale"
      | "permit_invalid"
      | "permit_expired"
      | "permit_replayed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringExecutionAdmissionError";
  }
}

interface StoredPermit {
  permit: AutonomousEngineeringExecutionAdmissionPermitV1;
  tokenHash: string;
  consumedAt?: string;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nowValue(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "execution admission clock is invalid",
      "permit_invalid",
    );
  }
  return value;
}

function boundedTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      `permit ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
      "permit_invalid",
    );
  }
  return ttl;
}

function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "execution admission token is invalid",
      "permit_invalid",
    );
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function assertIntent(intent: AutonomousEngineeringExecutionIntentV1): void {
  if (
    intent.schemaVersion !== 1
    || intent.authority !== "autonomous_engineering_execution_intent_only"
    || intent.executable !== false
    || !UUID.test(intent.intentId)
    || !UUID.test(intent.loopId)
    || !UUID.test(intent.taskId)
    || !UUID.test(intent.projectId)
    || !UUID.test(intent.workspaceId)
    || !UUID.test(intent.safetyPlanId)
    || !UUID.test(intent.safetyProfileId)
    || !Number.isSafeInteger(intent.loopRevision)
    || intent.loopRevision < 1
    || !Number.isSafeInteger(intent.workspaceRegistryRevision)
    || intent.workspaceRegistryRevision < 1
    || !Number.isSafeInteger(intent.safetyProfileRevision)
    || intent.safetyProfileRevision < 1
    || !["initial_implementation", "bounded_repair"].includes(intent.kind)
    || !intent.objective.trim()
    || intent.allowedPathPatterns.length === 0
    || intent.grantsTaskAuthority !== false
    || intent.grantsFilesystemAuthority !== false
    || intent.grantsSafetyPlanAuthority !== false
    || intent.grantsWriterLeaseAuthority !== false
    || intent.grantsCredentialAuthority !== false
    || intent.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "execution intent is invalid or widened",
      "intent_invalid",
    );
  }
  if (intent.kind === "bounded_repair" && (!intent.repairInstruction?.trim() || !intent.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "bounded repair intent is missing trusted repair provenance",
      "intent_invalid",
    );
  }
  if (intent.kind === "initial_implementation" && (intent.repairInstruction || intent.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "initial implementation intent contains repair provenance",
      "intent_invalid",
    );
  }
}

function assertLoop(intent: AutonomousEngineeringExecutionIntentV1, loop: AutonomousEngineeringLoopStateV1): void {
  if (
    loop.schemaVersion !== 1
    || loop.loopId !== intent.loopId
    || loop.revision !== intent.loopRevision
    || loop.phase !== "implementation_in_progress"
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.executable !== false
    || loop.authorityBinding.taskId !== intent.taskId
    || loop.authorityBinding.projectId !== intent.projectId
    || loop.authorityBinding.workspaceId !== intent.workspaceId
    || loop.authorityBinding.workspaceRegistryRevision !== intent.workspaceRegistryRevision
    || loop.authorityBinding.safetyPlanId !== intent.safetyPlanId
    || loop.authorityBinding.safetyPolicyVersion !== intent.safetyPolicyVersion
    || loop.authorityBinding.safetyProfileId !== intent.safetyProfileId
    || loop.authorityBinding.safetyProfileRevision !== intent.safetyProfileRevision
    || loop.authorityBinding.workerProfileId !== intent.workerProfileId
    || !sameStrings(loop.authorityBinding.allowedPathPatterns, intent.allowedPathPatterns)
    || !sameStrings(loop.authorityBinding.protectedPathPatterns, intent.protectedPathPatterns)
  ) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "durable loop revision no longer matches execution intent",
      "loop_stale",
    );
  }
}

function assertCurrent(
  intent: AutonomousEngineeringExecutionIntentV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_autonomous_loop_task_binding"
    || current.taskId !== intent.taskId
    || current.projectId !== intent.projectId
    || current.workspaceId !== intent.workspaceId
    || current.workspaceRegistryRevision !== intent.workspaceRegistryRevision
    || current.safetyPlanId !== intent.safetyPlanId
    || current.safetyPolicyVersion !== intent.safetyPolicyVersion
    || current.safetyProfileId !== intent.safetyProfileId
    || current.safetyProfileRevision !== intent.safetyProfileRevision
    || current.workerProfileId !== intent.workerProfileId
    || !sameStrings(current.allowedPathPatterns, intent.allowedPathPatterns)
    || !sameStrings(current.protectedPathPatterns, intent.protectedPathPatterns)
    || current.hasPendingEscalation
    || ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
  ) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "current task/Safety binding no longer permits execution admission",
      "binding_stale",
    );
  }
}

function assertPermit(permit: AutonomousEngineeringExecutionAdmissionPermitV1): void {
  if (
    permit.schemaVersion !== 1
    || permit.authority !== "autonomous_engineering_execution_admission_only"
    || permit.executable !== false
    || !UUID.test(permit.permitId)
    || !UUID.test(permit.intentId)
    || !UUID.test(permit.loopId)
    || !UUID.test(permit.taskId)
    || !UUID.test(permit.workspaceId)
    || !Number.isSafeInteger(permit.loopRevision)
    || permit.loopRevision < 1
    || !["initial_implementation", "bounded_repair"].includes(permit.kind)
    || !Number.isFinite(Date.parse(permit.issuedAt))
    || !Number.isFinite(Date.parse(permit.expiresAt))
    || Date.parse(permit.expiresAt) <= Date.parse(permit.issuedAt)
    || permit.grantsTaskAuthority !== false
    || permit.grantsFilesystemAuthority !== false
    || permit.grantsSafetyPlanAuthority !== false
    || permit.grantsWriterLeaseAuthority !== false
    || permit.grantsCredentialAuthority !== false
    || permit.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionAdmissionError(
      "execution admission permit is invalid",
      "permit_invalid",
    );
  }
}

export class AutonomousEngineeringExecutionAdmissionService {
  private readonly loops: FileAutonomousEngineeringLoopStore;
  private readonly permits = new Map<string, StoredPermit>();

  constructor(
    stateRoot: string,
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly options: AutonomousEngineeringExecutionAdmissionOptions = {},
  ) {
    this.loops = new FileAutonomousEngineeringLoopStore(stateRoot);
  }

  async issue(
    intentInput: AutonomousEngineeringExecutionIntentV1,
  ): Promise<AutonomousEngineeringExecutionAdmissionTicketV1> {
    assertIntent(intentInput);
    const intent = structuredClone(intentInput);
    const loop = await this.loops.load(intent.loopId);
    assertLoop(intent, loop);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(intent.taskId);
    } catch (error) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(intent, current);

    const now = nowValue(this.options.now);
    const permitId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(permitId)) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "permitId must be an opaque UUID",
        "permit_invalid",
      );
    }
    const token = (this.options.tokenFactory
      ?? (() => `m14e_${crypto.randomBytes(32).toString("base64url")}`))();
    const hash = tokenHash(token);
    if (this.permits.has(hash) || [...this.permits.values()].some((item) => item.permit.permitId === permitId)) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "execution admission permit identity collision",
        "permit_invalid",
      );
    }
    const ttl = boundedTtl(this.options.ttlMs);

    const permit: AutonomousEngineeringExecutionAdmissionPermitV1 = {
      schemaVersion: 1,
      permitId,
      intentId: intent.intentId,
      loopId: intent.loopId,
      loopRevision: intent.loopRevision,
      taskId: intent.taskId,
      workspaceId: intent.workspaceId,
      kind: intent.kind,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      authority: "autonomous_engineering_execution_admission_only",
      executable: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertPermit(permit);
    this.permits.set(hash, { permit: structuredClone(permit), tokenHash: hash });
    return { permit: Object.freeze(permit), token };
  }

  async consume(
    token: string,
    intentInput: AutonomousEngineeringExecutionIntentV1,
  ): Promise<AutonomousEngineeringExecutionAdmissionReceiptV1> {
    assertIntent(intentInput);
    const intent = structuredClone(intentInput);
    const hash = tokenHash(token);
    const stored = this.permits.get(hash);
    if (!stored) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "execution admission permit was not found",
        "permit_invalid",
      );
    }
    if (stored.consumedAt) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "execution admission permit was already consumed",
        "permit_replayed",
      );
    }

    const now = nowValue(this.options.now);
    if (Date.parse(stored.permit.expiresAt) <= now.getTime()) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "execution admission permit expired",
        "permit_expired",
      );
    }

    const loop = await this.loops.load(intent.loopId);
    assertLoop(intent, loop);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(intent.taskId);
    } catch (error) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "current task/Safety binding could not be revalidated at permit consumption",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(intent, current);

    const permit = stored.permit;
    if (
      permit.intentId !== intent.intentId
      || permit.loopId !== intent.loopId
      || permit.loopRevision !== intent.loopRevision
      || permit.taskId !== intent.taskId
      || permit.workspaceId !== intent.workspaceId
      || permit.kind !== intent.kind
    ) {
      throw new AutonomousEngineeringExecutionAdmissionError(
        "execution admission permit no longer matches intent/loop binding",
        "permit_invalid",
      );
    }

    stored.consumedAt = now.toISOString();
    return Object.freeze({
      schemaVersion: 1,
      permitId: permit.permitId,
      intentId: permit.intentId,
      loopId: permit.loopId,
      loopRevision: permit.loopRevision,
      taskId: permit.taskId,
      workspaceId: permit.workspaceId,
      kind: permit.kind,
      consumedAt: stored.consumedAt,
      authority: "autonomous_engineering_execution_admission_consumed_evidence_only",
      startsExecution: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
