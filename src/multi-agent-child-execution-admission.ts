import crypto from "node:crypto";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TTL_MS = 60_000;

export const MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_execution_admission_only" as const,
  shortLived: true as const,
  singleUse: true as const,
  requiresCurrentParentBinding: true as const,
  requiresCurrentDelegationSetBinding: true as const,
  createsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDistributedDispatch: false as const,
  invokesDistributedAdmission: false as const,
  allowsSubdelegation: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentParentAuthoritySnapshotV1 {
  schemaVersion: 1;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  status:
    | "created"
    | "running"
    | "waiting"
    | "waiting_for_human"
    | "stalled"
    | "validating"
    | "repairing"
    | "safety_checking"
    | "completed"
    | "validation_failed"
    | "failed"
    | "aborted"
    | "rolled_back";
  hasPendingEscalation: boolean;
  authority: "current_parent_task_authority";
}

export interface MultiAgentParentAuthorityProvider {
  revalidateCurrent(parentTaskId: string): Promise<MultiAgentParentAuthoritySnapshotV1>;
}

export interface MultiAgentChildExecutionAdmissionPermitV1 {
  schemaVersion: 1;
  permitId: string;
  childTaskId: string;
  delegationSetId: string;
  delegationId: string;
  parentTaskId: string;
  workspaceId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  issuedAt: string;
  expiresAt: string;
  authority: "child_execution_admission_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentChildExecutionAdmissionTicketV1 {
  permit: MultiAgentChildExecutionAdmissionPermitV1;
  token: string;
}

export interface MultiAgentChildExecutionAdmissionOptions {
  ttlMs?: number;
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
}

export class MultiAgentChildExecutionAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "child_invalid"
      | "set_invalid"
      | "binding_mismatch"
      | "parent_not_current"
      | "parent_not_executable"
      | "permit_invalid"
      | "permit_expired"
      | "permit_replayed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentChildExecutionAdmissionError";
  }
}

interface StoredPermit {
  permit: MultiAgentChildExecutionAdmissionPermitV1;
  tokenHash: string;
  consumedAt?: string;
}

function nowValue(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MultiAgentChildExecutionAdmissionError(
      "child execution admission clock is invalid",
      "permit_invalid",
    );
  }
  return value;
}

function boundedTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new MultiAgentChildExecutionAdmissionError(
      `permit ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
      "permit_invalid",
    );
  }
  return ttl;
}

function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
    throw new MultiAgentChildExecutionAdmissionError(
      "child execution admission token is invalid",
      "permit_invalid",
    );
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertChild(child: MultiAgentChildTaskDescriptorV1): void {
  if (
    child.schemaVersion !== 1
    || child.authority !== "child_task_materialization_only"
    || child.executable !== false
    || child.requiresIndependentExecutionAdmission !== true
    || child.requiresParentBindingRevalidation !== true
    || child.allowsSubdelegation !== false
    || !UUID.test(child.childTaskId)
    || !UUID.test(child.delegationSetId)
    || !UUID.test(child.delegationId)
    || !UUID.test(child.parentTaskId)
    || child.grantsTaskAuthority !== false
    || child.grantsFilesystemAuthority !== false
    || child.grantsSafetyPlanAuthority !== false
    || child.grantsWriterLeaseAuthority !== false
    || child.grantsCredentialAuthority !== false
    || child.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionAdmissionError(
      "child task descriptor is invalid or widened",
      "child_invalid",
    );
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !UUID.test(set.delegationSetId)
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || !Array.isArray(set.delegationIds)
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsWriterLeaseAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionAdmissionError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertChildSetBinding(
  child: MultiAgentChildTaskDescriptorV1,
  set: MultiAgentDelegationSetV1,
): void {
  if (
    child.delegationSetId !== set.delegationSetId
    || child.delegationId === ""
    || !set.delegationIds.includes(child.delegationId)
    || child.coordinationMode !== set.coordinationMode
    || child.parentSupervisorTaskId !== set.parentSupervisorTaskId
    || child.parentTaskId !== set.taskId
    || child.projectId !== set.projectId
    || child.workspaceId !== set.workspaceId
    || child.workspaceRegistryRevision !== set.workspaceRegistryRevision
    || child.safetyPlanId !== set.safetyPlanId
    || child.safetyProfileId !== set.safetyProfileId
    || child.safetyProfileRevision !== set.safetyProfileRevision
    || child.workerProfileId !== set.workerProfileId
  ) {
    throw new MultiAgentChildExecutionAdmissionError(
      "child task no longer matches the validated delegation set/mode",
      "binding_mismatch",
    );
  }
}

function assertCurrentParent(
  child: MultiAgentChildTaskDescriptorV1,
  current: MultiAgentParentAuthoritySnapshotV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_task_authority"
    || current.taskId !== child.parentTaskId
    || current.projectId !== child.projectId
    || current.workspaceId !== child.workspaceId
    || current.workspaceRegistryRevision !== child.workspaceRegistryRevision
    || current.safetyPlanId !== child.safetyPlanId
    || current.safetyProfileId !== child.safetyProfileId
    || current.safetyProfileRevision !== child.safetyProfileRevision
    || current.workerProfileId !== child.workerProfileId
    || !child.allowedPathPatterns.every((pattern) => current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, child.protectedPathPatterns)
  ) {
    throw new MultiAgentChildExecutionAdmissionError(
      "current parent task/Safety binding no longer matches the child descriptor",
      "parent_not_current",
    );
  }

  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentChildExecutionAdmissionError(
      "current parent task state does not permit child execution admission",
      "parent_not_executable",
    );
  }
}

function assertPermitShape(permit: MultiAgentChildExecutionAdmissionPermitV1): void {
  if (
    permit.schemaVersion !== 1
    || permit.authority !== "child_execution_admission_only"
    || !UUID.test(permit.permitId)
    || !UUID.test(permit.childTaskId)
    || !UUID.test(permit.delegationSetId)
    || !UUID.test(permit.delegationId)
    || !UUID.test(permit.parentTaskId)
    || !UUID.test(permit.workspaceId)
    || !["parallel_disjoint", "serialized"].includes(permit.coordinationMode)
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
    throw new MultiAgentChildExecutionAdmissionError(
      "child execution admission permit is invalid",
      "permit_invalid",
    );
  }
}

export class MultiAgentChildExecutionAdmissionService {
  private readonly permits = new Map<string, StoredPermit>();

  constructor(
    private readonly parentAuthority: MultiAgentParentAuthorityProvider,
    private readonly options: MultiAgentChildExecutionAdmissionOptions = {},
  ) {}

  async issue(
    childInput: MultiAgentChildTaskDescriptorV1,
    setInput: MultiAgentDelegationSetV1,
  ): Promise<MultiAgentChildExecutionAdmissionTicketV1> {
    assertChild(childInput);
    assertSet(setInput);
    const child = structuredClone(childInput);
    const set = structuredClone(setInput);
    assertChildSetBinding(child, set);

    let current: MultiAgentParentAuthoritySnapshotV1;
    try {
      current = await this.parentAuthority.revalidateCurrent(child.parentTaskId);
    } catch (error) {
      throw new MultiAgentChildExecutionAdmissionError(
        "current parent task/Safety authority could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(child, current);

    const now = nowValue(this.options.now);
    const ttlMs = boundedTtl(this.options.ttlMs);
    const permitId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(permitId) || [...this.permits.values()].some((item) => item.permit.permitId === permitId)) {
      throw new MultiAgentChildExecutionAdmissionError(
        "permitId must be a unique opaque UUID",
        "permit_invalid",
      );
    }
    const token = (this.options.tokenFactory
      ?? (() => `mae_${crypto.randomBytes(32).toString("base64url")}`))();
    const hash = tokenHash(token);
    if (this.permits.has(hash)) {
      throw new MultiAgentChildExecutionAdmissionError(
        "child execution admission token collision",
        "permit_invalid",
      );
    }

    const permit: MultiAgentChildExecutionAdmissionPermitV1 = {
      schemaVersion: 1,
      permitId,
      childTaskId: child.childTaskId,
      delegationSetId: child.delegationSetId,
      delegationId: child.delegationId,
      parentTaskId: child.parentTaskId,
      workspaceId: child.workspaceId,
      coordinationMode: child.coordinationMode,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      authority: "child_execution_admission_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertPermitShape(permit);
    this.permits.set(hash, { permit: structuredClone(permit), tokenHash: hash });
    return { permit: Object.freeze(permit), token };
  }

  consume(
    token: string,
    child: MultiAgentChildTaskDescriptorV1,
    set: MultiAgentDelegationSetV1,
  ): MultiAgentChildExecutionAdmissionPermitV1 {
    assertChild(child);
    assertSet(set);
    assertChildSetBinding(child, set);
    const hash = tokenHash(token);
    const stored = this.permits.get(hash);
    if (!stored) {
      throw new MultiAgentChildExecutionAdmissionError(
        "child execution admission permit was not found",
        "permit_invalid",
      );
    }
    if (stored.consumedAt) {
      throw new MultiAgentChildExecutionAdmissionError(
        "child execution admission permit was already consumed",
        "permit_replayed",
      );
    }
    const now = nowValue(this.options.now);
    if (Date.parse(stored.permit.expiresAt) <= now.getTime()) {
      throw new MultiAgentChildExecutionAdmissionError(
        "child execution admission permit expired",
        "permit_expired",
      );
    }
    const permit = stored.permit;
    if (
      permit.childTaskId !== child.childTaskId
      || permit.delegationSetId !== set.delegationSetId
      || permit.delegationId !== child.delegationId
      || permit.parentTaskId !== child.parentTaskId
      || permit.workspaceId !== child.workspaceId
      || permit.coordinationMode !== set.coordinationMode
    ) {
      throw new MultiAgentChildExecutionAdmissionError(
        "child execution admission permit does not match current child/set binding",
        "binding_mismatch",
      );
    }
    stored.consumedAt = now.toISOString();
    return Object.freeze(structuredClone(permit));
  }
}
