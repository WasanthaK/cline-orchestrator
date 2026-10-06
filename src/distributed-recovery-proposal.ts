import {
  type DistributedTakeoverRecoveryDecisionV1,
} from "./distributed-takeover-recovery.js";

export const DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  acceptedDisposition: "fresh_authority_review_required" as const,
  proposalStartsWork: false as const,
  proposalAcquiresCandidate: false as const,
  proposalAcquiresFence: false as const,
  proposalAcquiresLocalWriterLease: false as const,
  proposalCreatesDispatch: false as const,
  proposalInvokesAdmission: false as const,
  proposalInvokesTargetHandoff: false as const,
  proposalInvokesRuntime: false as const,
  proposalAllowsAutomaticRetry: false as const,
  proposalAllowsAutomaticRequeue: false as const,
  requiresFreshControllerSelection: true as const,
  requiresFreshCandidateAssignment: true as const,
  requiresFreshDistributedFence: true as const,
  requiresFreshLocalWriterLease: true as const,
  requiresFreshDispatch: true as const,
  requiresFreshAdmission: true as const,
  requiresTargetLocalAuthorityReentry: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedRecoveryProposalV1 {
  schemaVersion: 1;
  proposalId: string;
  deliveryId: string;
  taskId: string;
  workspaceId: string;
  sourceDisposition: "fresh_authority_review_required";
  sourceReason: "admitted_without_runtime_history" | "no_delivery_yet";
  requiresFreshControllerSelection: true;
  requiresFreshCandidateAssignment: true;
  requiresFreshDistributedFence: true;
  requiresFreshLocalWriterLease: true;
  requiresFreshDispatch: true;
  requiresFreshAdmission: true;
  requiresTargetLocalAuthorityReentry: true;
  automaticTakeoverAllowed: false;
  automaticWorkRetryAllowed: false;
  automaticWorkRequeueAllowed: false;
  authority: "recovery_proposal_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DistributedRecoveryProposalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "decision_not_proposable"
      | "proposal_id_invalid",
  ) {
    super(message);
    this.name = "DistributedRecoveryProposalError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDistributedRecoveryProposal(
  decision: DistributedTakeoverRecoveryDecisionV1,
  options: { proposalId: string },
): DistributedRecoveryProposalV1 {
  if (
    decision.disposition !== "fresh_authority_review_required"
    || (
      decision.reason !== "admitted_without_runtime_history"
      && decision.reason !== "no_delivery_yet"
    )
  ) {
    throw new DistributedRecoveryProposalError(
      "only a fresh-authority recovery decision may produce a recovery proposal",
      "decision_not_proposable",
    );
  }
  if (!UUID.test(options.proposalId)) {
    throw new DistributedRecoveryProposalError(
      "proposalId must be an opaque UUID",
      "proposal_id_invalid",
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    proposalId: options.proposalId,
    deliveryId: decision.deliveryId,
    taskId: decision.taskId,
    workspaceId: decision.workspaceId,
    sourceDisposition: "fresh_authority_review_required",
    sourceReason: decision.reason,
    requiresFreshControllerSelection: true,
    requiresFreshCandidateAssignment: true,
    requiresFreshDistributedFence: true,
    requiresFreshLocalWriterLease: true,
    requiresFreshDispatch: true,
    requiresFreshAdmission: true,
    requiresTargetLocalAuthorityReentry: true,
    automaticTakeoverAllowed: false,
    automaticWorkRetryAllowed: false,
    automaticWorkRequeueAllowed: false,
    authority: "recovery_proposal_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
