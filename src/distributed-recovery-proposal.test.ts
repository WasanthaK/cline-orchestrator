import assert from "node:assert/strict";
import test from "node:test";
import {
  createDistributedRecoveryProposal,
  DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT,
  DistributedRecoveryProposalError,
} from "./distributed-recovery-proposal.js";
import type { DistributedTakeoverRecoveryDecisionV1 } from "./distributed-takeover-recovery.js";

const baseDecision: DistributedTakeoverRecoveryDecisionV1 = {
  schemaVersion: 1,
  deliveryId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  disposition: "fresh_authority_review_required",
  reason: "no_delivery_yet",
  targetAckAvailable: false,
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
  authority: "recovery_decision_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

test("M12Z-B proposal contract remains non-authoritative and non-executing", () => {
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalStartsWork, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalAcquiresCandidate, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalAcquiresFence, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalAcquiresLocalWriterLease, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalCreatesDispatch, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalInvokesAdmission, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalInvokesTargetHandoff, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalInvokesRuntime, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalAllowsAutomaticRetry, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.proposalAllowsAutomaticRequeue, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_RECOVERY_PROPOSAL_CONTRACT.grantsReleaseAuthority, false);
});

test("fresh-authority recovery decision produces exact bounded proposal", () => {
  const proposal = createDistributedRecoveryProposal(baseDecision, {
    proposalId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(proposal.deliveryId, baseDecision.deliveryId);
  assert.equal(proposal.taskId, baseDecision.taskId);
  assert.equal(proposal.workspaceId, baseDecision.workspaceId);
  assert.equal(proposal.sourceDisposition, "fresh_authority_review_required");
  assert.equal(proposal.sourceReason, "no_delivery_yet");
  assert.equal(proposal.requiresFreshControllerSelection, true);
  assert.equal(proposal.requiresFreshCandidateAssignment, true);
  assert.equal(proposal.requiresFreshDistributedFence, true);
  assert.equal(proposal.requiresFreshLocalWriterLease, true);
  assert.equal(proposal.requiresFreshDispatch, true);
  assert.equal(proposal.requiresFreshAdmission, true);
  assert.equal(proposal.requiresTargetLocalAuthorityReentry, true);
  assert.equal(proposal.automaticTakeoverAllowed, false);
});

test("ack-only, ambiguity, and terminal decisions cannot produce proposals", () => {
  for (const [disposition, reason] of [
    ["ack_reconciliation_only", "delivery_unconfirmed_ack_available"],
    ["manual_ambiguity_review", "delivery_unconfirmed_without_ack"],
    ["terminal_no_takeover", "terminal_task"],
  ] as const) {
    assert.throws(
      () => createDistributedRecoveryProposal(
        { ...baseDecision, disposition, reason } as DistributedTakeoverRecoveryDecisionV1,
        { proposalId: "44444444-4444-4444-8444-444444444444" },
      ),
      (error: unknown) => error instanceof DistributedRecoveryProposalError
        && error.code === "decision_not_proposable",
    );
  }
});

test("proposal id must be an opaque UUID", () => {
  assert.throws(
    () => createDistributedRecoveryProposal(baseDecision, { proposalId: "not-a-uuid" }),
    (error: unknown) => error instanceof DistributedRecoveryProposalError
      && error.code === "proposal_id_invalid",
  );
});

test("admitted-before-runtime fresh-authority decision is proposable", () => {
  const proposal = createDistributedRecoveryProposal(
    { ...baseDecision, reason: "admitted_without_runtime_history" },
    { proposalId: "55555555-5555-4555-8555-555555555555" },
  );
  assert.equal(proposal.sourceReason, "admitted_without_runtime_history");
});
