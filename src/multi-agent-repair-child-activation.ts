import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentRepairChildPreparationV1 } from "./multi-agent-repair-child-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "repair_child_activation_evidence_only" as const,
  requiresFreshSchedulerOwnedLease: true as const,
  requiresFreshParentBinding: true as const,
  requiresFreshRepairChildIdentity: true as const,
  priorChildLeaseReuseAllowed: false as const,
  priorChildRuntimeReuseAllowed: false as const,
  priorChildSessionReuseAllowed: false as const,
  priorChildCheckpointReuseAllowed: false as const,
  acquiresWriterLease: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  distributedExecutionAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRepairChildRuntimeInputV1 {
  schemaVersion: 1;
  repairChildTaskId: string;
  priorChildTaskId: string;
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
  repairInstruction: string;
  repairAttempt: number;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  coordinationMode: "parallel_disjoint" | "serialized";
  authority: "repair_child_runtime_input_only";
  runtimeStartAuthorized: false;
  priorChildResumeAllowed: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentRepairChildActivationEvidenceV1 {
  schemaVersion: 1;
  preparationId: string;
  repairChildTaskId: string;
  priorChildTaskId: string;
  parentTaskId: string;
  workspaceId: string;
  leaseId: string;
  fenceToken: string;
  ownerInstanceId: string;
  activatedAt: string;
  authority: "repair_child_activation_evidence_only";
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentRepairChildActivationContext {
  evidence: MultiAgentRepairChildActivationEvidenceV1;
  runtimeInput: MultiAgentRepairChildRuntimeInputV1;
  lease: WriterLeaseSession;
}

export interface MultiAgentRepairChildActivationOptions {
  now?: () => Date;
}

export class MultiAgentRepairChildActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "parent_not_current"
      | "parent_not_executable"
      | "lease_invalid"
      | "lease_identity_changed"
      | "prior_child_reuse"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentRepairChildActivationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertPreparation(value: MultiAgentRepairChildPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || value.requiresFreshParentBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.priorChildResumeAllowed !== false
    || value.priorChildMutationAllowed !== false
    || value.repairChildTaskId === value.priorChildTaskId
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildActivationError(
      "durable repair-child preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertCurrentParent(
  preparation: MultiAgentRepairChildPreparationV1,
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
    throw new MultiAgentRepairChildActivationError(
      "current parent task/Safety binding no longer matches repair-child preparation",
      "parent_not_current",
    );
  }

  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentRepairChildActivationError(
      "current parent state does not permit repair-child activation",
      "parent_not_executable",
    );
  }
}

type LeaseIdentity = {
  leaseId: string;
  fenceToken: string;
  taskId: string;
  workspaceId: string;
  ownerInstanceId: string;
};

function bindFreshLease(
  preparation: MultiAgentRepairChildPreparationV1,
  lease: WriterLeaseSession,
): LeaseIdentity {
  if (
    lease.signal.aborted
    || lease.taskId !== preparation.repairChildTaskId
    || lease.workspaceId !== preparation.workspaceId
  ) {
    throw new MultiAgentRepairChildActivationError(
      "fresh local writer lease is not bound to the exact repair child/workspace",
      "lease_invalid",
    );
  }
  if (lease.taskId === preparation.priorChildTaskId) {
    throw new MultiAgentRepairChildActivationError(
      "prior child writer lease cannot authorize repair-child activation",
      "prior_child_reuse",
    );
  }

  const claim = lease.currentClaim();
  if (
    claim.authority !== "coordination_only"
    || claim.taskId !== preparation.repairChildTaskId
    || claim.workspaceId !== preparation.workspaceId
    || claim.ownerInstanceId !== lease.ownerInstanceId
  ) {
    throw new MultiAgentRepairChildActivationError(
      "repair-child writer lease claim is cross-bound",
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

function sameLeaseIdentity(expected: LeaseIdentity, lease: WriterLeaseSession): boolean {
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

export class MultiAgentRepairChildActivationCoordinator {
  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly options: MultiAgentRepairChildActivationOptions = {},
  ) {}

  async activate(
    preparationInput: MultiAgentRepairChildPreparationV1,
    lease: WriterLeaseSession,
  ): Promise<MultiAgentRepairChildActivationContext> {
    assertPreparation(preparationInput);
    const preparation = structuredClone(preparationInput);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(preparation.parentTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildActivationError(
        "current parent execution binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(preparation, current);

    const bound = bindFreshLease(preparation, lease);
    try {
      await lease.validateCurrent();
    } catch (error) {
      throw new MultiAgentRepairChildActivationError(
        "fresh repair-child writer lease is no longer current",
        "lease_invalid",
        { cause: error },
      );
    }
    if (!sameLeaseIdentity(bound, lease)) {
      throw new MultiAgentRepairChildActivationError(
        "repair-child writer lease identity changed during activation",
        "lease_identity_changed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new MultiAgentRepairChildActivationError(
        "repair-child activation clock is invalid",
        "clock_invalid",
      );
    }

    const runtimeInput: MultiAgentRepairChildRuntimeInputV1 = Object.freeze({
      schemaVersion: 1,
      repairChildTaskId: preparation.repairChildTaskId,
      priorChildTaskId: preparation.priorChildTaskId,
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
      repairInstruction: preparation.repairInstruction,
      repairAttempt: preparation.repairAttempt,
      acceptanceCriteria: [...preparation.acceptanceCriteria],
      trustedValidationCommands: [...preparation.trustedValidationCommands],
      allowedPathPatterns: [...preparation.allowedPathPatterns],
      protectedPathPatterns: [...preparation.protectedPathPatterns],
      coordinationMode: preparation.coordinationMode,
      authority: "repair_child_runtime_input_only",
      runtimeStartAuthorized: false,
      priorChildResumeAllowed: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });

    const evidence: MultiAgentRepairChildActivationEvidenceV1 = Object.freeze({
      schemaVersion: 1,
      preparationId: preparation.preparationId,
      repairChildTaskId: preparation.repairChildTaskId,
      priorChildTaskId: preparation.priorChildTaskId,
      parentTaskId: preparation.parentTaskId,
      workspaceId: preparation.workspaceId,
      leaseId: bound.leaseId,
      fenceToken: bound.fenceToken,
      ownerInstanceId: bound.ownerInstanceId,
      activatedAt: now.toISOString(),
      authority: "repair_child_activation_evidence_only",
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
