import crypto from "node:crypto";
import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentRepairChildDescriptorV1 } from "./multi-agent-repair-child.js";
import type { TaskStatus } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TTL_MS = 60_000;
const TERMINAL_CHILD_STATUSES = new Set<TaskStatus>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

export const MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "repair_child_execution_admission_only" as const,
  shortLived: true as const,
  singleUse: true as const,
  requiresCurrentParentBinding: true as const,
  requiresPriorChildStillTerminal: true as const,
  priorChildResumeAllowed: false as const,
  priorChildMutationAllowed: false as const,
  startsChild: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentPriorChildStateV1 {
  schemaVersion: 1;
  childTaskId: string;
  projectId: string;
  workspaceId: string;
  status: TaskStatus;
  authority: "prior_child_state_evidence_only";
}

export interface MultiAgentPriorChildStateProvider {
  loadCurrent(childTaskId: string): Promise<MultiAgentPriorChildStateV1>;
}

export interface MultiAgentRepairChildExecutionAdmissionPermitV1 {
  schemaVersion: 1;
  permitId: string;
  repairChildTaskId: string;
  priorChildTaskId: string;
  delegationSetId: string;
  delegationId: string;
  parentTaskId: string;
  workspaceId: string;
  repairAttempt: number;
  issuedAt: string;
  expiresAt: string;
  authority: "repair_child_execution_admission_only";
  startsChild: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentRepairChildExecutionAdmissionTicketV1 {
  permit: MultiAgentRepairChildExecutionAdmissionPermitV1;
  token: string;
}

export interface MultiAgentRepairChildExecutionAdmissionReceiptV1 {
  schemaVersion: 1;
  permitId: string;
  repairChildTaskId: string;
  priorChildTaskId: string;
  delegationSetId: string;
  delegationId: string;
  parentTaskId: string;
  workspaceId: string;
  repairAttempt: number;
  consumedAt: string;
  authority: "repair_child_execution_admission_consumed_evidence_only";
  startsChild: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentRepairChildExecutionAdmissionOptions {
  ttlMs?: number;
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
}

export class MultiAgentRepairChildExecutionAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "repair_child_invalid"
      | "parent_not_current"
      | "parent_not_executable"
      | "prior_child_not_terminal"
      | "permit_invalid"
      | "permit_expired"
      | "permit_replayed"
      | "binding_mismatch",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentRepairChildExecutionAdmissionError";
  }
}

interface StoredPermit {
  permit: MultiAgentRepairChildExecutionAdmissionPermitV1;
  tokenHash: string;
  consumedAt?: string;
}

function nowValue(now?: () => Date): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "repair-child execution admission clock is invalid",
      "permit_invalid",
    );
  }
  return value;
}

function boundedTtl(value?: number): number {
  const ttl = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      `repair-child permit ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
      "permit_invalid",
    );
  }
  return ttl;
}

function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "repair-child execution admission token is invalid",
      "permit_invalid",
    );
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertRepairChild(value: MultiAgentRepairChildDescriptorV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_materialization_only"
    || value.executable !== false
    || value.requiresFreshExecutionAdmission !== true
    || value.requiresFreshParentBindingRevalidation !== true
    || value.requiresFreshWriterLease !== true
    || value.priorChildResumeAllowed !== false
    || value.priorChildMutationAllowed !== false
    || value.allowsSubdelegation !== false
    || !UUID.test(value.repairChildTaskId)
    || !UUID.test(value.priorChildTaskId)
    || value.repairChildTaskId === value.priorChildTaskId
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "repair-child descriptor is invalid or widened",
      "repair_child_invalid",
    );
  }
}

function assertCurrentParent(
  child: MultiAgentRepairChildDescriptorV1,
  current: MultiAgentParentExecutionBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_execution_binding"
    || current.taskId !== child.parentTaskId
    || current.projectId !== child.projectId
    || current.workspaceId !== child.workspaceId
    || current.workspaceRegistryRevision !== child.workspaceRegistryRevision
    || current.safetyPlanId !== child.safetyPlanId
    || current.safetyPolicyVersion !== child.safetyPolicyVersion
    || current.safetyProfileId !== child.safetyProfileId
    || current.safetyProfileRevision !== child.safetyProfileRevision
    || current.workerProfileId !== child.workerProfileId
    || !sameStrings(current.trustedValidationCommands, child.trustedValidationCommands)
    || !child.allowedPathPatterns.every((pattern) =>
      current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, child.protectedPathPatterns)
  ) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "current parent task/Safety binding no longer matches the repair child",
      "parent_not_current",
    );
  }
  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "current parent state does not permit repair-child execution admission",
      "parent_not_executable",
    );
  }
}

function assertPriorChild(
  child: MultiAgentRepairChildDescriptorV1,
  prior: MultiAgentPriorChildStateV1,
): void {
  if (
    prior.schemaVersion !== 1
    || prior.authority !== "prior_child_state_evidence_only"
    || prior.childTaskId !== child.priorChildTaskId
    || prior.projectId !== child.projectId
    || prior.workspaceId !== child.workspaceId
    || !TERMINAL_CHILD_STATUSES.has(prior.status)
  ) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "prior child is not the exact terminal task required by repair-child admission",
      "prior_child_not_terminal",
    );
  }
}

function assertPermit(value: MultiAgentRepairChildExecutionAdmissionPermitV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_execution_admission_only"
    || !UUID.test(value.permitId)
    || !UUID.test(value.repairChildTaskId)
    || !UUID.test(value.priorChildTaskId)
    || value.repairChildTaskId === value.priorChildTaskId
    || !Number.isFinite(Date.parse(value.issuedAt))
    || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || value.startsChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildExecutionAdmissionError(
      "repair-child execution admission permit is invalid",
      "permit_invalid",
    );
  }
}

export class MultiAgentRepairChildExecutionAdmissionService {
  private readonly permits = new Map<string, StoredPermit>();

  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly priorChildState: MultiAgentPriorChildStateProvider,
    private readonly options: MultiAgentRepairChildExecutionAdmissionOptions = {},
  ) {}

  async issue(
    childInput: MultiAgentRepairChildDescriptorV1,
  ): Promise<MultiAgentRepairChildExecutionAdmissionTicketV1> {
    assertRepairChild(childInput);
    const child = structuredClone(childInput);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(child.parentTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "current parent task/Safety binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(child, current);

    let prior: MultiAgentPriorChildStateV1;
    try {
      prior = await this.priorChildState.loadCurrent(child.priorChildTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "prior child state could not be revalidated",
        "prior_child_not_terminal",
        { cause: error },
      );
    }
    assertPriorChild(child, prior);

    const now = nowValue(this.options.now);
    const ttlMs = boundedTtl(this.options.ttlMs);
    const permitId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(permitId)) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child permitId must be an opaque UUID",
        "permit_invalid",
      );
    }
    const token = (this.options.tokenFactory
      ?? (() => `marl_${crypto.randomBytes(32).toString("base64url")}`))();
    const hash = tokenHash(token);
    if (this.permits.has(hash)) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child execution admission token collision",
        "permit_invalid",
      );
    }

    const permit: MultiAgentRepairChildExecutionAdmissionPermitV1 = {
      schemaVersion: 1,
      permitId,
      repairChildTaskId: child.repairChildTaskId,
      priorChildTaskId: child.priorChildTaskId,
      delegationSetId: child.delegationSetId,
      delegationId: child.delegationId,
      parentTaskId: child.parentTaskId,
      workspaceId: child.workspaceId,
      repairAttempt: child.repairAttempt,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      authority: "repair_child_execution_admission_only",
      startsChild: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertPermit(permit);
    this.permits.set(hash, {
      permit: structuredClone(permit),
      tokenHash: hash,
    });
    return { permit: Object.freeze(permit), token };
  }

  async consume(
    token: string,
    childInput: MultiAgentRepairChildDescriptorV1,
  ): Promise<MultiAgentRepairChildExecutionAdmissionReceiptV1> {
    assertRepairChild(childInput);
    const child = structuredClone(childInput);
    const hash = tokenHash(token);
    const stored = this.permits.get(hash);
    if (!stored) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child execution admission permit was not found",
        "permit_invalid",
      );
    }
    if (stored.consumedAt) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child execution admission permit was already consumed",
        "permit_replayed",
      );
    }
    const now = nowValue(this.options.now);
    if (Date.parse(stored.permit.expiresAt) <= now.getTime()) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child execution admission permit expired",
        "permit_expired",
      );
    }

    const permit = stored.permit;
    if (
      permit.repairChildTaskId !== child.repairChildTaskId
      || permit.priorChildTaskId !== child.priorChildTaskId
      || permit.delegationSetId !== child.delegationSetId
      || permit.delegationId !== child.delegationId
      || permit.parentTaskId !== child.parentTaskId
      || permit.workspaceId !== child.workspaceId
      || permit.repairAttempt !== child.repairAttempt
    ) {
      throw new MultiAgentRepairChildExecutionAdmissionError(
        "repair-child execution admission no longer matches the exact repair child",
        "binding_mismatch",
      );
    }

    stored.consumedAt = now.toISOString();
    return Object.freeze({
      schemaVersion: 1,
      permitId: permit.permitId,
      repairChildTaskId: permit.repairChildTaskId,
      priorChildTaskId: permit.priorChildTaskId,
      delegationSetId: permit.delegationSetId,
      delegationId: permit.delegationId,
      parentTaskId: permit.parentTaskId,
      workspaceId: permit.workspaceId,
      repairAttempt: permit.repairAttempt,
      consumedAt: stored.consumedAt,
      authority: "repair_child_execution_admission_consumed_evidence_only",
      startsChild: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
