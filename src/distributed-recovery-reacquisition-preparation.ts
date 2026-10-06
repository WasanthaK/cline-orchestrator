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
  DistributedRecoveryPreexecutionEvidenceV1,
} from "./distributed-recovery-preexecution.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresFreshCandidateValidation: true as const,
  requiresCurrentDistributedFenceValidation: true as const,
  requiresCurrentLocalWriterLeaseValidation: true as const,
  createsCandidate: false as const,
  createsDistributedFence: false as const,
  createsLocalWriterLease: false as const,
  createsDispatch: false as const,
  invokesAdmission: false as const,
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

export interface DistributedRecoveryReacquisitionPreparationEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  deliveryId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  placementId: string;
  placementRevision: number;
  candidateAssignmentId: string;
  fenceId: string;
  fenceGeneration: number;
  localLeaseId: string;
  localFenceToken: string;
  preparedAt: string;
  requiresFreshDispatch: true;
  requiresFreshAdmission: true;
  requiresTargetLocalAuthorityReentry: true;
  authority: "recovery_reacquisition_preparation_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DistributedRecoveryReacquisitionPreparationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preexecution_invalid"
      | "binding_mismatch"
      | "candidate_not_current"
      | "fence_not_current"
      | "lease_not_current"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryReacquisitionPreparationError";
  }
}

export interface DistributedRecoveryReacquisitionPreparationOptions {
  candidateValidator: {
    assertCandidateCurrent(
      assignment: DistributedWriterCandidateAssignmentV1,
      observedNow?: Date,
    ): Promise<void>;
  };
  fenceAuthority: DistributedFenceAuthority;
  lease: WriterLeaseSession;
  now?: () => Date;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedRecoveryReacquisitionPreparationError(
      "distributed recovery reacquisition preparation clock is invalid",
      "clock_invalid",
    );
  }
  return value;
}

function assertPreexecution(evidence: DistributedRecoveryPreexecutionEvidenceV1): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "recovery_preexecution_evidence_only"
    || evidence.requiresFreshControllerSelection !== true
    || evidence.requiresFreshCandidateAssignment !== true
    || evidence.requiresFreshDistributedFence !== true
    || evidence.requiresFreshLocalWriterLease !== true
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
    throw new DistributedRecoveryReacquisitionPreparationError(
      "distributed recovery pre-execution evidence is invalid",
      "preexecution_invalid",
    );
  }
}

function sameCandidateFence(
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
): boolean {
  return fence.taskId === assignment.taskId
    && fence.workspaceId === assignment.workspaceId
    && fence.machineId === assignment.machineId
    && fence.machineRegistrationId === assignment.machineRegistrationId
    && fence.machineRegistrationRevision === assignment.machineRegistrationRevision
    && fence.placementId === assignment.placementId
    && fence.placementRevision === assignment.placementRevision
    && fence.candidateAssignmentId === assignment.assignmentId;
}

export class DistributedRecoveryReacquisitionPreparationCoordinator {
  constructor(private readonly options: DistributedRecoveryReacquisitionPreparationOptions) {}

  async prepare(
    evidence: DistributedRecoveryPreexecutionEvidenceV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    fence: DistributedFenceClaimV1,
  ): Promise<DistributedRecoveryReacquisitionPreparationEvidenceV1> {
    assertPreexecution(evidence);
    try {
      assertDistributedWriterCandidateAssignment(assignment);
      assertDistributedFenceClaim(fence);
    } catch (error) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery candidate/fence evidence is invalid",
        "binding_mismatch",
        { cause: error },
      );
    }

    if (
      assignment.taskId !== evidence.taskId
      || assignment.workspaceId !== evidence.workspaceId
      || !sameCandidateFence(assignment, fence)
    ) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery candidate/fence evidence does not match the exact task/workspace binding",
        "binding_mismatch",
      );
    }

    const observedNow = currentTime(this.options.now);

    try {
      await this.options.candidateValidator.assertCandidateCurrent(assignment, observedNow);
    } catch (error) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery candidate assignment is not current",
        "candidate_not_current",
        { cause: error },
      );
    }

    try {
      await this.options.fenceAuthority.validateCurrent(fence, assignment, observedNow);
    } catch (error) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery distributed fence is not current",
        "fence_not_current",
        { cause: error },
      );
    }

    const lease = this.options.lease;
    const before = lease.currentClaim();
    if (
      lease.signal.aborted
      || lease.taskId !== evidence.taskId
      || lease.workspaceId !== evidence.workspaceId
      || before.taskId !== evidence.taskId
      || before.workspaceId !== evidence.workspaceId
      || before.ownerInstanceId !== lease.ownerInstanceId
      || before.authority !== "coordination_only"
    ) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery local writer lease does not match the exact task/workspace binding",
        "lease_not_current",
      );
    }

    try {
      await lease.validateCurrent();
    } catch (error) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery local writer lease is not current",
        "lease_not_current",
        { cause: error },
      );
    }

    const after = lease.currentClaim();
    if (
      lease.signal.aborted
      || after.leaseId !== before.leaseId
      || after.fenceToken !== before.fenceToken
      || after.taskId !== evidence.taskId
      || after.workspaceId !== evidence.workspaceId
      || after.ownerInstanceId !== lease.ownerInstanceId
    ) {
      throw new DistributedRecoveryReacquisitionPreparationError(
        "fresh recovery local writer lease identity changed during validation",
        "lease_not_current",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      proposalId: evidence.proposalId,
      deliveryId: evidence.deliveryId,
      taskId: evidence.taskId,
      workspaceId: evidence.workspaceId,
      machineId: assignment.machineId,
      machineRegistrationId: assignment.machineRegistrationId,
      machineRegistrationRevision: assignment.machineRegistrationRevision,
      placementId: assignment.placementId,
      placementRevision: assignment.placementRevision,
      candidateAssignmentId: assignment.assignmentId,
      fenceId: fence.fenceId,
      fenceGeneration: fence.generation,
      localLeaseId: after.leaseId,
      localFenceToken: after.fenceToken,
      preparedAt: observedNow.toISOString(),
      requiresFreshDispatch: true,
      requiresFreshAdmission: true,
      requiresTargetLocalAuthorityReentry: true,
      authority: "recovery_reacquisition_preparation_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
