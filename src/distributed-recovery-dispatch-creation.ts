import {
  createDistributedExecutionDispatch,
  type DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceAuthority,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type {
  DistributedRecoveryReacquisitionPreparationEvidenceV1,
} from "./distributed-recovery-reacquisition-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  createsFreshDispatch: true as const,
  requiresSamePreparedCandidate: true as const,
  requiresSamePreparedFence: true as const,
  requiresSamePreparedLocalLease: true as const,
  requiresImmediateCandidateRevalidation: true as const,
  requiresImmediateFenceRevalidation: true as const,
  requiresImmediateLocalLeaseRevalidation: true as const,
  consumesAdmission: false as const,
  invokesTargetHandoff: false as const,
  invokesRuntime: false as const,
  startsCline: false as const,
  automaticTakeoverAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export class DistributedRecoveryDispatchCreationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "binding_mismatch"
      | "candidate_not_current"
      | "fence_not_current"
      | "lease_not_current"
      | "dispatch_creation_failed"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryDispatchCreationError";
  }
}

export interface DistributedRecoveryDispatchCreationOptions {
  candidateValidator: {
    assertCandidateCurrent(
      assignment: DistributedWriterCandidateAssignmentV1,
      observedNow?: Date,
    ): Promise<void>;
  };
  fenceAuthority: DistributedFenceAuthority;
  lease: WriterLeaseSession;
  dispatchTtlMs: number;
  now?: () => Date;
  idFactory?: () => string;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedRecoveryDispatchCreationError(
      "distributed recovery dispatch creation clock is invalid",
      "clock_invalid",
    );
  }
  return value;
}

function assertPreparation(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "recovery_reacquisition_preparation_evidence_only"
    || evidence.requiresFreshDispatch !== true
    || evidence.requiresFreshAdmission !== true
    || evidence.requiresTargetLocalAuthorityReentry !== true
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new DistributedRecoveryDispatchCreationError(
      "distributed recovery reacquisition preparation evidence is invalid",
      "preparation_invalid",
    );
  }
}

function exactPreparedBindings(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
  lease: WriterLeaseSession,
): boolean {
  const claim = lease.currentClaim();
  return assignment.taskId === evidence.taskId
    && assignment.workspaceId === evidence.workspaceId
    && assignment.machineId === evidence.machineId
    && assignment.machineRegistrationId === evidence.machineRegistrationId
    && assignment.machineRegistrationRevision === evidence.machineRegistrationRevision
    && assignment.placementId === evidence.placementId
    && assignment.placementRevision === evidence.placementRevision
    && assignment.assignmentId === evidence.candidateAssignmentId
    && fence.taskId === evidence.taskId
    && fence.workspaceId === evidence.workspaceId
    && fence.machineId === evidence.machineId
    && fence.machineRegistrationId === evidence.machineRegistrationId
    && fence.machineRegistrationRevision === evidence.machineRegistrationRevision
    && fence.placementId === evidence.placementId
    && fence.placementRevision === evidence.placementRevision
    && fence.candidateAssignmentId === evidence.candidateAssignmentId
    && fence.fenceId === evidence.fenceId
    && fence.generation === evidence.fenceGeneration
    && lease.taskId === evidence.taskId
    && lease.workspaceId === evidence.workspaceId
    && claim.taskId === evidence.taskId
    && claim.workspaceId === evidence.workspaceId
    && claim.ownerInstanceId === lease.ownerInstanceId
    && claim.leaseId === evidence.localLeaseId
    && claim.fenceToken === evidence.localFenceToken
    && claim.authority === "coordination_only"
    && !lease.signal.aborted;
}

export class DistributedRecoveryDispatchCreationCoordinator {
  constructor(private readonly options: DistributedRecoveryDispatchCreationOptions) {}

  async create(
    evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    fence: DistributedFenceClaimV1,
  ): Promise<DistributedExecutionDispatchV1> {
    assertPreparation(evidence);

    try {
      assertDistributedWriterCandidateAssignment(assignment);
      assertDistributedFenceClaim(fence);
    } catch (error) {
      throw new DistributedRecoveryDispatchCreationError(
        "fresh recovery candidate/fence evidence is invalid",
        "binding_mismatch",
        { cause: error },
      );
    }

    if (!exactPreparedBindings(evidence, assignment, fence, this.options.lease)) {
      throw new DistributedRecoveryDispatchCreationError(
        "recovery dispatch inputs do not match the exact prepared authority set",
        "binding_mismatch",
      );
    }

    const observedNow = currentTime(this.options.now);

    try {
      await this.options.candidateValidator.assertCandidateCurrent(assignment, observedNow);
    } catch (error) {
      throw new DistributedRecoveryDispatchCreationError(
        "prepared recovery candidate is no longer current",
        "candidate_not_current",
        { cause: error },
      );
    }

    try {
      await this.options.fenceAuthority.validateCurrent(fence, assignment, observedNow);
    } catch (error) {
      throw new DistributedRecoveryDispatchCreationError(
        "prepared recovery fence is no longer current",
        "fence_not_current",
        { cause: error },
      );
    }

    const before = this.options.lease.currentClaim();
    try {
      await this.options.lease.validateCurrent();
    } catch (error) {
      throw new DistributedRecoveryDispatchCreationError(
        "prepared recovery local writer lease is no longer current",
        "lease_not_current",
        { cause: error },
      );
    }
    const after = this.options.lease.currentClaim();
    if (
      this.options.lease.signal.aborted
      || before.leaseId !== after.leaseId
      || before.fenceToken !== after.fenceToken
      || after.leaseId !== evidence.localLeaseId
      || after.fenceToken !== evidence.localFenceToken
      || after.taskId !== evidence.taskId
      || after.workspaceId !== evidence.workspaceId
      || after.ownerInstanceId !== this.options.lease.ownerInstanceId
    ) {
      throw new DistributedRecoveryDispatchCreationError(
        "prepared recovery local writer lease identity changed before dispatch creation",
        "lease_not_current",
      );
    }

    try {
      const dispatch = createDistributedExecutionDispatch(
        {
          assignment,
          fence,
          ttlMs: this.options.dispatchTtlMs,
        },
        {
          now: () => new Date(observedNow),
          idFactory: this.options.idFactory,
        },
      );
      if (
        dispatch.taskId !== evidence.taskId
        || dispatch.workspaceId !== evidence.workspaceId
        || dispatch.machineId !== evidence.machineId
        || dispatch.candidateAssignmentId !== evidence.candidateAssignmentId
        || dispatch.fenceId !== evidence.fenceId
        || dispatch.fenceGeneration !== evidence.fenceGeneration
      ) {
        throw new DistributedRecoveryDispatchCreationError(
          "new recovery dispatch does not match the exact prepared authority set",
          "dispatch_creation_failed",
        );
      }
      return dispatch;
    } catch (error) {
      if (error instanceof DistributedRecoveryDispatchCreationError) throw error;
      throw new DistributedRecoveryDispatchCreationError(
        "fresh recovery dispatch could not be created",
        "dispatch_creation_failed",
        { cause: error },
      );
    }
  }
}
