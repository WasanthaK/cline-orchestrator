import {
  assertDistributedExecutionDispatch,
  type DistributedExecutionAdmissionReceiptV1,
  type DistributedExecutionAdmissionGateway,
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

export const DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresExactPreparedDispatchBinding: true as const,
  delegatesToExistingM12GAdmission: true as const,
  durableReplayConsumptionOccursOnlyInM12G: true as const,
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

export class DistributedRecoveryAdmissionBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "binding_mismatch"
      | "admission_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryAdmissionBridgeError";
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
    throw new DistributedRecoveryAdmissionBridgeError(
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

export class DistributedRecoveryAdmissionBridge {
  constructor(private readonly admission: DistributedExecutionAdmissionGateway) {}

  async admit(
    evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
    dispatch: DistributedExecutionDispatchV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    fence: DistributedFenceClaimV1,
  ): Promise<DistributedExecutionAdmissionReceiptV1> {
    assertPreparation(evidence);

    try {
      assertDistributedExecutionDispatch(dispatch);
      assertDistributedWriterCandidateAssignment(assignment);
      assertDistributedFenceClaim(fence);
    } catch (error) {
      throw new DistributedRecoveryAdmissionBridgeError(
        "recovery dispatch/candidate/fence evidence is invalid",
        "binding_mismatch",
        { cause: error },
      );
    }

    if (!matchesPreparedSet(evidence, dispatch, assignment, fence)) {
      throw new DistributedRecoveryAdmissionBridgeError(
        "recovery admission inputs do not match the exact prepared authority set",
        "binding_mismatch",
      );
    }

    try {
      const receipt = await this.admission.admit(dispatch, assignment, fence);
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
        throw new DistributedRecoveryAdmissionBridgeError(
          "M12G admission receipt does not match the recovery binding",
          "admission_failed",
        );
      }
      return receipt;
    } catch (error) {
      if (error instanceof DistributedRecoveryAdmissionBridgeError) throw error;
      throw new DistributedRecoveryAdmissionBridgeError(
        "fresh recovery dispatch admission failed closed",
        "admission_failed",
        { cause: error },
      );
    }
  }
}
