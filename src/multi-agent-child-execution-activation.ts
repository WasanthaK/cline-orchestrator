import type {
  MultiAgentChildExecutionPreparationV1,
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_execution_activation_evidence_only" as const,
  requiresFreshSchedulerOwnedLease: true as const,
  requiresFreshParentBinding: true as const,
  acquiresWriterLease: false as const,
  createsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
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

export interface MultiAgentChildRuntimeInputV1 {
  schemaVersion: 1;
  childTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  objective: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  coordinationMode: "parallel_disjoint" | "serialized";
  authority: "child_runtime_input_only";
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentChildExecutionActivationEvidenceV1 {
  schemaVersion: 1;
  preparationId: string;
  childTaskId: string;
  parentTaskId: string;
  workspaceId: string;
  leaseId: string;
  fenceToken: string;
  ownerInstanceId: string;
  activatedAt: string;
  authority: "child_execution_activation_evidence_only";
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentChildExecutionActivationContext {
  evidence: MultiAgentChildExecutionActivationEvidenceV1;
  runtimeInput: MultiAgentChildRuntimeInputV1;
  lease: WriterLeaseSession;
}

export interface MultiAgentChildExecutionActivationOptions {
  now?: () => Date;
}

export class MultiAgentChildExecutionActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "parent_not_current"
      | "parent_not_executable"
      | "lease_invalid"
      | "lease_identity_changed"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentChildExecutionActivationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertPreparation(value: MultiAgentChildExecutionPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_execution_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || value.requiresFreshParentBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionActivationError(
      "durable child execution preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertCurrentParent(
  preparation: MultiAgentChildExecutionPreparationV1,
  current: MultiAgentParentExecutionBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_execution_binding"
    || current.taskId !== preparation.parentTaskId
    || current.projectId !== preparation.projectId
    || current.workspaceId !== preparation.workspaceId
    || current.workspaceRegistryRevision !== preparation.workspaceRegistryRevision
    || current.safetyPlanId !== preparation.safetyPlanId
    || current.safetyPolicyVersion !== preparation.safetyPolicyVersion
    || current.safetyProfileId !== preparation.safetyProfileId
    || current.safetyProfileRevision !== preparation.safetyProfileRevision
    || current.workerProfileId !== preparation.workerProfileId
    || !preparation.allowedPathPatterns.every((pattern) =>
      current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, preparation.protectedPathPatterns)
    || !sameStrings(current.trustedValidationCommands, preparation.trustedValidationCommands)
  ) {
    throw new MultiAgentChildExecutionActivationError(
      "current parent task/Safety binding no longer matches the durable child preparation",
      "parent_not_current",
    );
  }

  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentChildExecutionActivationError(
      "current parent state does not permit child execution activation",
      "parent_not_executable",
    );
  }
}

type BoundLeaseIdentity = {
  leaseId: string;
  fenceToken: string;
  taskId: string;
  workspaceId: string;
  ownerInstanceId: string;
};

function currentLeaseIdentity(
  preparation: MultiAgentChildExecutionPreparationV1,
  lease: WriterLeaseSession,
): BoundLeaseIdentity {
  if (
    lease.signal.aborted
    || lease.taskId !== preparation.childTaskId
    || lease.workspaceId !== preparation.workspaceId
  ) {
    throw new MultiAgentChildExecutionActivationError(
      "fresh local writer lease is not bound to the exact child/workspace",
      "lease_invalid",
    );
  }

  const claim = lease.currentClaim();
  if (
    claim.authority !== "coordination_only"
    || claim.taskId !== preparation.childTaskId
    || claim.workspaceId !== preparation.workspaceId
    || claim.ownerInstanceId !== lease.ownerInstanceId
  ) {
    throw new MultiAgentChildExecutionActivationError(
      "fresh local writer lease claim does not match the child/workspace/owner binding",
      "lease_invalid",
    );
  }
  return {
    leaseId: claim.leaseId,
    fenceToken: claim.fenceToken,
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
  };
}

function sameLeaseIdentity(
  expected: BoundLeaseIdentity,
  lease: WriterLeaseSession,
): boolean {
  const claim = lease.currentClaim();
  return !lease.signal.aborted
    && claim.authority === "coordination_only"
    && claim.leaseId === expected.leaseId
    && claim.fenceToken === expected.fenceToken
    && claim.taskId === expected.taskId
    && claim.workspaceId === expected.workspaceId
    && claim.ownerInstanceId === expected.ownerInstanceId
    && lease.ownerInstanceId === expected.ownerInstanceId;
}

export class MultiAgentChildExecutionActivationCoordinator {
  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly options: MultiAgentChildExecutionActivationOptions = {},
  ) {}

  async activate(
    preparationInput: MultiAgentChildExecutionPreparationV1,
    lease: WriterLeaseSession,
  ): Promise<MultiAgentChildExecutionActivationContext> {
    assertPreparation(preparationInput);
    const preparation = structuredClone(preparationInput);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(preparation.parentTaskId);
    } catch (error) {
      throw new MultiAgentChildExecutionActivationError(
        "current parent execution binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(preparation, current);

    const boundLease = currentLeaseIdentity(preparation, lease);
    try {
      await lease.validateCurrent();
    } catch (error) {
      throw new MultiAgentChildExecutionActivationError(
        "fresh local writer lease is no longer current",
        "lease_invalid",
        { cause: error },
      );
    }
    if (!sameLeaseIdentity(boundLease, lease)) {
      throw new MultiAgentChildExecutionActivationError(
        "local writer lease identity changed during child activation",
        "lease_identity_changed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new MultiAgentChildExecutionActivationError(
        "child execution activation clock is invalid",
        "clock_invalid",
      );
    }

    const runtimeInput: MultiAgentChildRuntimeInputV1 = Object.freeze({
      schemaVersion: 1,
      childTaskId: preparation.childTaskId,
      parentTaskId: preparation.parentTaskId,
      projectId: preparation.projectId,
      workspaceId: preparation.workspaceId,
      workspaceRegistryRevision: preparation.workspaceRegistryRevision,
      safetyPlanId: preparation.safetyPlanId,
      safetyPolicyVersion: preparation.safetyPolicyVersion,
      safetyProfileId: preparation.safetyProfileId,
      safetyProfileRevision: preparation.safetyProfileRevision,
      workerProfileId: preparation.workerProfileId,
      objective: preparation.objective,
      acceptanceCriteria: [...preparation.acceptanceCriteria],
      trustedValidationCommands: [...preparation.trustedValidationCommands],
      allowedPathPatterns: [...preparation.allowedPathPatterns],
      protectedPathPatterns: [...preparation.protectedPathPatterns],
      coordinationMode: preparation.coordinationMode,
      authority: "child_runtime_input_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });

    const evidence: MultiAgentChildExecutionActivationEvidenceV1 = Object.freeze({
      schemaVersion: 1,
      preparationId: preparation.preparationId,
      childTaskId: preparation.childTaskId,
      parentTaskId: preparation.parentTaskId,
      workspaceId: preparation.workspaceId,
      leaseId: boundLease.leaseId,
      fenceToken: boundLease.fenceToken,
      ownerInstanceId: boundLease.ownerInstanceId,
      activatedAt: now.toISOString(),
      authority: "child_execution_activation_evidence_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });

    return { evidence, runtimeInput, lease };
  }
}
