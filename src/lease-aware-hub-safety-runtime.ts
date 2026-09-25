import type { DurableSafetyBinding } from "./safety-plan.js";
import {
  assertOwnerTargetedHubSafetyBoundary,
  createHubSafetySessionContributions,
  durableSafetyBindingFromTask,
  HubSafetyConfigurationError,
  type HubSafetySessionContributions,
} from "./hub-safety-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export interface LeaseAwareWriterAuthorityV1 extends DurableSafetyBinding {
  schemaVersion: 1;
  taskId: string;
  ownerInstanceId: string;
}

/**
 * Trusted authority source for the future live-writer adapter.
 *
 * Implementations must derive the returned snapshot from current durable task,
 * Safety Plan and registered workspace/profile evidence. Returning the originally
 * admitted task object is not sufficient: registry/profile/Safety Plan drift must
 * be reflected here and therefore fail the write guard.
 */
export interface LeaseAwareWriterAuthorityProvider {
  revalidateCurrent(taskId: string): Promise<LeaseAwareWriterAuthorityV1>;
}

export type LeaseAwareWriterSafetyCode =
  | "binding_invalid"
  | "authority_revalidation_failed"
  | "authority_stale"
  | "lease_aborted"
  | "lease_identity_changed"
  | "lease_invalid";

export class LeaseAwareWriterSafetyError extends Error {
  constructor(
    message: string,
    public readonly code: LeaseAwareWriterSafetyCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LeaseAwareWriterSafetyError";
  }
}

export interface LeaseAwareHubSafetyOptions {
  lease: WriterLeaseSession;
  authorityProvider: LeaseAwareWriterAuthorityProvider;
}

type BoundLeaseIdentity = {
  leaseId: string;
  fenceToken: string;
  taskId: string;
  workspaceId: string;
  ownerInstanceId: string;
};

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameAuthority(
  expected: LeaseAwareWriterAuthorityV1,
  current: LeaseAwareWriterAuthorityV1,
): boolean {
  return current.schemaVersion === 1
    && current.taskId === expected.taskId
    && current.projectId === expected.projectId
    && current.workspaceId === expected.workspaceId
    && current.workspaceRegistryRevision === expected.workspaceRegistryRevision
    && current.safetyPlanId === expected.safetyPlanId
    && current.policyVersion === expected.policyVersion
    && current.safetyProfileId === expected.safetyProfileId
    && current.safetyProfileRevision === expected.safetyProfileRevision
    && current.workerProfileId === expected.workerProfileId
    && current.ownerInstanceId === expected.ownerInstanceId
    && sameStrings(current.allowedPathPatterns, expected.allowedPathPatterns)
    && sameStrings(current.protectedPathPatterns, expected.protectedPathPatterns);
}

function claimIdentity(claim: WorkspaceWriterClaimV1): BoundLeaseIdentity {
  return {
    leaseId: claim.leaseId,
    fenceToken: claim.fenceToken,
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
  };
}

function sameLeaseIdentity(expected: BoundLeaseIdentity, current: WorkspaceWriterClaimV1): boolean {
  return current.authority === "coordination_only"
    && current.leaseId === expected.leaseId
    && current.fenceToken === expected.fenceToken
    && current.taskId === expected.taskId
    && current.workspaceId === expected.workspaceId
    && current.ownerInstanceId === expected.ownerInstanceId;
}

export function leaseAwareWriterAuthorityFromTask(
  task: OrchestratorTask,
  ownerInstanceId: string,
): LeaseAwareWriterAuthorityV1 {
  if (typeof ownerInstanceId !== "string" || !ownerInstanceId.trim()) {
    throw new LeaseAwareWriterSafetyError("Writer owner identity is missing", "binding_invalid");
  }
  const binding = durableSafetyBindingFromTask(task);
  return {
    schemaVersion: 1,
    taskId: task.id,
    ownerInstanceId: ownerInstanceId.trim(),
    ...binding,
  };
}

function assertInitialLeaseBinding(
  expected: LeaseAwareWriterAuthorityV1,
  lease: WriterLeaseSession,
): BoundLeaseIdentity {
  if (lease.signal.aborted) {
    throw new LeaseAwareWriterSafetyError("Writer lease is already aborted", "lease_aborted");
  }
  const claim = lease.currentClaim();
  if (
    lease.taskId !== expected.taskId
    || lease.workspaceId !== expected.workspaceId
    || lease.ownerInstanceId !== expected.ownerInstanceId
    || claim.taskId !== expected.taskId
    || claim.workspaceId !== expected.workspaceId
    || claim.ownerInstanceId !== expected.ownerInstanceId
    || claim.authority !== "coordination_only"
  ) {
    throw new LeaseAwareWriterSafetyError(
      "Writer lease identity does not match the approved task/workspace/owner binding",
      "binding_invalid",
    );
  }
  return claimIdentity(claim);
}

async function revalidateAuthority(
  expected: LeaseAwareWriterAuthorityV1,
  provider: LeaseAwareWriterAuthorityProvider,
): Promise<void> {
  let current: LeaseAwareWriterAuthorityV1;
  try {
    current = await provider.revalidateCurrent(expected.taskId);
  } catch (error) {
    throw new LeaseAwareWriterSafetyError(
      "Current durable writer authority could not be revalidated",
      "authority_revalidation_failed",
      { cause: error },
    );
  }
  if (!sameAuthority(expected, current)) {
    throw new LeaseAwareWriterSafetyError(
      "Current durable writer authority no longer matches the admitted task/Safety Plan/workspace/profile/owner binding",
      "authority_stale",
    );
  }
}

/**
 * Revalidates both sources of permission immediately before invoking a write-capable
 * owner executor. Durable task/Safety Plan authority and the fenced lease are
 * independent: neither can substitute for the other.
 *
 * The lease ID/fence token are bound when the adapter is created. Normal heartbeat
 * renewal may advance claim stateRevision/expiresAt, but may not replace either
 * identity. `validateCurrent()` remains authoritative for the current durable lock
 * state and expiry.
 */
async function assertCurrentWriteBoundary(
  expected: LeaseAwareWriterAuthorityV1,
  boundLease: BoundLeaseIdentity,
  lease: WriterLeaseSession,
  provider: LeaseAwareWriterAuthorityProvider,
): Promise<void> {
  if (lease.signal.aborted) {
    throw new LeaseAwareWriterSafetyError("Writer lease was aborted before write execution", "lease_aborted");
  }

  await revalidateAuthority(expected, provider);

  if (lease.signal.aborted) {
    throw new LeaseAwareWriterSafetyError("Writer lease was aborted during authority revalidation", "lease_aborted");
  }
  if (!sameLeaseIdentity(boundLease, lease.currentClaim())) {
    throw new LeaseAwareWriterSafetyError(
      "Writer lease/fence identity changed after admission",
      "lease_identity_changed",
    );
  }

  try {
    await lease.validateCurrent();
  } catch (error) {
    throw new LeaseAwareWriterSafetyError(
      "Current fenced workspace lease is no longer valid",
      "lease_invalid",
      { cause: error },
    );
  }

  if (lease.signal.aborted) {
    throw new LeaseAwareWriterSafetyError("Writer lease was aborted before write execution", "lease_aborted");
  }
  if (!sameLeaseIdentity(boundLease, lease.currentClaim())) {
    throw new LeaseAwareWriterSafetyError(
      "Writer lease/fence identity changed during validation",
      "lease_identity_changed",
    );
  }
}

/**
 * Slice 9A trusted adapter.
 *
 * This does not enable live concurrency. It composes the already-reviewed Hub
 * owner-targeted safety contributions with an additional current-authority +
 * fenced-lease guard on write-capable executors only. Reads/search remain governed
 * by the existing Safety Plan path policy and do not require writer lease authority.
 *
 * The outer guard executes immediately before the existing `editor`/`applyPatch`
 * owner executor is invoked. That underlying executor still independently enforces
 * current approved path/action policy before the SDK filesystem mutation.
 */
export function createLeaseAwareHubSafetySessionContributions(
  task: OrchestratorTask,
  workspaceRoot: string,
  worker: WorkerConfig,
  options: LeaseAwareHubSafetyOptions,
): HubSafetySessionContributions {
  if (!options?.lease || !options?.authorityProvider) {
    throw new HubSafetyConfigurationError("Lease-aware Hub safety requires lease and authority provider");
  }

  const expected = leaseAwareWriterAuthorityFromTask(task, options.lease.ownerInstanceId);
  const boundLease = assertInitialLeaseBinding(expected, options.lease);
  const safety = createHubSafetySessionContributions(task, workspaceRoot, worker);
  const executors = safety.capabilities.toolExecutors;
  const editor = executors?.editor;
  const applyPatch = executors?.applyPatch;
  if (!executors || !editor || !applyPatch) {
    throw new HubSafetyConfigurationError("Owner-targeted Hub write executors are unavailable");
  }

  executors.editor = async (input: any, cwd: string, context: any) => {
    await assertCurrentWriteBoundary(
      expected,
      boundLease,
      options.lease,
      options.authorityProvider,
    );
    return await editor(input, cwd, context);
  };

  executors.applyPatch = async (input: any, cwd: string, context: any) => {
    await assertCurrentWriteBoundary(
      expected,
      boundLease,
      options.lease,
      options.authorityProvider,
    );
    return await applyPatch(input, cwd, context);
  };

  assertOwnerTargetedHubSafetyBoundary(safety);
  return safety;
}
