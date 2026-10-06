import {
  assertDistributedExecutionDispatch,
  type DistributedExecutionAdmissionReceiptV1,
  type DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type {
  DistributedRecoveryReacquisitionPreparationEvidenceV1,
} from "./distributed-recovery-reacquisition-preparation.js";
import type {
  DistributedTargetRuntimeHandoffContext,
  DistributedTargetRuntimeHandoffCoordinator,
} from "./distributed-target-runtime-handoff.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresAlreadyAdmittedDispatch: true as const,
  reusesExistingM12HTargetLocalChecks: true as const,
  consumesAdmissionAgain: false as const,
  requiresExactPreparedCandidate: true as const,
  requiresExactPreparedFence: true as const,
  requiresExactPreparedLocalLease: true as const,
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

export interface DistributedRecoveryTargetHandoffOptions {
  handoff: Pick<DistributedTargetRuntimeHandoffCoordinator, "prepareAdmitted">;
  lease: WriterLeaseSession;
}

export class DistributedRecoveryTargetHandoffError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "binding_mismatch"
      | "receipt_invalid"
      | "lease_not_current"
      | "handoff_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryTargetHandoffError";
  }
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
    throw new DistributedRecoveryTargetHandoffError(
      "distributed recovery preparation evidence is invalid",
      "preparation_invalid",
    );
  }
}

function matchesPreparedSet(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  dispatch: DistributedExecutionDispatchV1,
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
): boolean {
  return dispatch.taskId === evidence.taskId
    && dispatch.workspaceId === evidence.workspaceId
    && dispatch.machineId === evidence.machineId
    && dispatch.machineRegistrationId === evidence.machineRegistrationId
    && dispatch.machineRegistrationRevision === evidence.machineRegistrationRevision
    && dispatch.placementId === evidence.placementId
    && dispatch.placementRevision === evidence.placementRevision
    && dispatch.candidateAssignmentId === evidence.candidateAssignmentId
    && dispatch.fenceId === evidence.fenceId
    && dispatch.fenceGeneration === evidence.fenceGeneration
    && assignment.taskId === evidence.taskId
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
    && fence.generation === evidence.fenceGeneration;
}

function assertReceipt(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  dispatch: DistributedExecutionDispatchV1,
  receipt: DistributedExecutionAdmissionReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.dispatchId !== dispatch.dispatchId
    || receipt.taskId !== evidence.taskId
    || receipt.workspaceId !== evidence.workspaceId
    || receipt.machineId !== evidence.machineId
    || receipt.fenceGeneration !== evidence.fenceGeneration
    || receipt.authority !== "admission_evidence_only"
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new DistributedRecoveryTargetHandoffError(
      "M12G admission receipt does not match the prepared recovery binding",
      "receipt_invalid",
    );
  }
}

function assertLease(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  lease: WriterLeaseSession,
): void {
  const claim = lease.currentClaim();
  if (
    lease.signal.aborted
    || lease.taskId !== evidence.taskId
    || lease.workspaceId !== evidence.workspaceId
    || claim.taskId !== evidence.taskId
    || claim.workspaceId !== evidence.workspaceId
    || claim.ownerInstanceId !== lease.ownerInstanceId
    || claim.leaseId !== evidence.localLeaseId
    || claim.fenceToken !== evidence.localFenceToken
    || claim.authority !== "coordination_only"
  ) {
    throw new DistributedRecoveryTargetHandoffError(
      "current local writer lease no longer matches M12Z-D recovery preparation",
      "lease_not_current",
    );
  }
}

export class DistributedRecoveryTargetHandoffCoordinator {
  constructor(private readonly options: DistributedRecoveryTargetHandoffOptions) {}

  async prepare(
    evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
    dispatch: DistributedExecutionDispatchV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    fence: DistributedFenceClaimV1,
    receipt: DistributedExecutionAdmissionReceiptV1,
  ): Promise<DistributedTargetRuntimeHandoffContext> {
    assertPreparation(evidence);

    try {
      assertDistributedExecutionDispatch(dispatch);
      assertDistributedWriterCandidateAssignment(assignment);
      assertDistributedFenceClaim(fence);
    } catch (error) {
      throw new DistributedRecoveryTargetHandoffError(
        "recovery handoff dispatch/candidate/fence evidence is invalid",
        "binding_mismatch",
        { cause: error },
      );
    }

    if (!matchesPreparedSet(evidence, dispatch, assignment, fence)) {
      throw new DistributedRecoveryTargetHandoffError(
        "recovery handoff inputs do not match the exact M12Z-D preparation binding",
        "binding_mismatch",
      );
    }
    assertReceipt(evidence, dispatch, receipt);
    assertLease(evidence, this.options.lease);

    try {
      await this.options.lease.validateCurrent();
    } catch (error) {
      throw new DistributedRecoveryTargetHandoffError(
        "recovery local writer lease is not current before M12H re-entry",
        "lease_not_current",
        { cause: error },
      );
    }
    assertLease(evidence, this.options.lease);

    try {
      const context = await this.options.handoff.prepareAdmitted(
        dispatch,
        assignment,
        fence,
        receipt,
      );
      if (
        context.evidence.dispatchId !== dispatch.dispatchId
        || context.evidence.taskId !== evidence.taskId
        || context.evidence.workspaceId !== evidence.workspaceId
        || context.evidence.machineId !== evidence.machineId
        || context.evidence.fenceGeneration !== evidence.fenceGeneration
        || context.evidence.authority !== "local_runtime_handoff_evidence_only"
      ) {
        throw new DistributedRecoveryTargetHandoffError(
          "M12H post-admission handoff context does not match the recovery binding",
          "handoff_failed",
        );
      }
      return context;
    } catch (error) {
      if (error instanceof DistributedRecoveryTargetHandoffError) throw error;
      throw new DistributedRecoveryTargetHandoffError(
        "M12H post-admission recovery handoff failed closed",
        "handoff_failed",
        { cause: error },
      );
    }
  }
}
