import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedRecoveryReacquisitionPreparationCoordinator,
  DistributedRecoveryReacquisitionPreparationError,
  DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT,
} from "./distributed-recovery-reacquisition-preparation.js";
import type { DistributedRecoveryPreexecutionEvidenceV1 } from "./distributed-recovery-preexecution.js";
import {
  DistributedFenceAuthority,
  ReferenceLinearizableFenceBackend,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const now = new Date("2026-10-05T12:00:00.000Z");

const preexecution: DistributedRecoveryPreexecutionEvidenceV1 = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  safetyPlanId: "66666666-6666-4666-8666-666666666666",
  workspaceRegistryRevision: 1,
  safetyProfileId: "77777777-7777-4777-8777-777777777777",
  safetyProfileRevision: 1,
  policyVersion: "policy-v1",
  workerProfileId: "worker-v1",
  verifiedAt: "2026-10-05T11:59:00.000Z",
  requiresFreshControllerSelection: true,
  requiresFreshCandidateAssignment: true,
  requiresFreshDistributedFence: true,
  requiresFreshLocalWriterLease: true,
  requiresFreshDispatch: true,
  requiresFreshAdmission: true,
  requiresTargetLocalAuthorityReentry: true,
  authority: "recovery_preexecution_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const assignment: DistributedWriterCandidateAssignmentV1 = {
  schemaVersion: 1,
  assignmentId: "88888888-8888-4888-8888-888888888888",
  taskId: preexecution.taskId,
  workspaceId: preexecution.workspaceId,
  machineId: "99999999-9999-4999-8999-999999999999",
  machineRegistrationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  machineRegistrationRevision: 3,
  placementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  placementRevision: 5,
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  authority: "coordination_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function lease(overrides: Partial<WorkspaceWriterClaimV1> = {}): WriterLeaseSession {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: preexecution.workspaceId,
    stateRevision: 1,
    leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    fenceToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    taskId: preexecution.taskId,
    ownerInstanceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    authority: "coordination_only",
    ...overrides,
  };
  const controller = new AbortController();
  return {
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
    signal: controller.signal,
    currentClaim: () => structuredClone(claim),
    validateCurrent: async () => undefined,
  };
}

async function freshFence(): Promise<{
  authority: DistributedFenceAuthority;
  claim: DistributedFenceClaimV1;
}> {
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    { async assertCandidateCurrent() {} },
    { now: () => new Date(now), idFactory: () => "ffffffff-ffff-4fff-8fff-ffffffffffff" },
  );
  const claim = await authority.acquire({ assignment, ttlMs: 30_000 });
  return { authority, claim };
}

test("M12Z-D contract remains preparation-only and non-authoritative", () => {
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.requiresFreshCandidateValidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.requiresCurrentDistributedFenceValidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.requiresCurrentLocalWriterLeaseValidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.createsCandidate, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.createsDistributedFence, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.createsLocalWriterLease, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.createsDispatch, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.invokesAdmission, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.startsCline, false);
  assert.equal(DISTRIBUTED_RECOVERY_REACQUISITION_PREPARATION_CONTRACT.grantsTaskAuthority, false);
});

test("fresh candidate, fence, and local lease produce bounded preparation evidence", async () => {
  const { authority, claim } = await freshFence();
  let candidateChecks = 0;
  const coordinator = new DistributedRecoveryReacquisitionPreparationCoordinator({
    candidateValidator: {
      async assertCandidateCurrent(candidate, observedNow) {
        candidateChecks += 1;
        assert.equal(candidate.assignmentId, assignment.assignmentId);
        assert.equal(observedNow?.toISOString(), now.toISOString());
      },
    },
    fenceAuthority: authority,
    lease: lease(),
    now: () => new Date(now),
  });

  const evidence = await coordinator.prepare(preexecution, assignment, claim);
  assert.equal(candidateChecks, 1);
  assert.equal(evidence.taskId, preexecution.taskId);
  assert.equal(evidence.workspaceId, preexecution.workspaceId);
  assert.equal(evidence.machineId, assignment.machineId);
  assert.equal(evidence.candidateAssignmentId, assignment.assignmentId);
  assert.equal(evidence.fenceId, claim.fenceId);
  assert.equal(evidence.fenceGeneration, claim.generation);
  assert.equal(evidence.requiresFreshDispatch, true);
  assert.equal(evidence.requiresFreshAdmission, true);
  assert.equal(evidence.requiresTargetLocalAuthorityReentry, true);
  assert.equal(evidence.grantsWriterLeaseAuthority, false);
});

test("cross-bound candidate fails before validators run", async () => {
  const { authority, claim } = await freshFence();
  let candidateChecks = 0;
  const coordinator = new DistributedRecoveryReacquisitionPreparationCoordinator({
    candidateValidator: { async assertCandidateCurrent() { candidateChecks += 1; } },
    fenceAuthority: authority,
    lease: lease(),
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.prepare(
      preexecution,
      { ...assignment, taskId: "12121212-1212-4121-8121-121212121212" },
      claim,
    ),
    (error: unknown) => error instanceof DistributedRecoveryReacquisitionPreparationError
      && error.code === "binding_mismatch",
  );
  assert.equal(candidateChecks, 0);
});

test("stale candidate fails closed", async () => {
  const { authority, claim } = await freshFence();
  const coordinator = new DistributedRecoveryReacquisitionPreparationCoordinator({
    candidateValidator: { async assertCandidateCurrent() { throw new Error("stale"); } },
    fenceAuthority: authority,
    lease: lease(),
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.prepare(preexecution, assignment, claim),
    (error: unknown) => error instanceof DistributedRecoveryReacquisitionPreparationError
      && error.code === "candidate_not_current",
  );
});

test("stale fence fails closed", async () => {
  const { authority, claim } = await freshFence();
  await authority.revoke(claim);
  const coordinator = new DistributedRecoveryReacquisitionPreparationCoordinator({
    candidateValidator: { async assertCandidateCurrent() {} },
    fenceAuthority: authority,
    lease: lease(),
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.prepare(preexecution, assignment, claim),
    (error: unknown) => error instanceof DistributedRecoveryReacquisitionPreparationError
      && error.code === "fence_not_current",
  );
});

test("wrong local writer lease fails closed", async () => {
  const { authority, claim } = await freshFence();
  const coordinator = new DistributedRecoveryReacquisitionPreparationCoordinator({
    candidateValidator: { async assertCandidateCurrent() {} },
    fenceAuthority: authority,
    lease: lease({ taskId: "13131313-1313-4131-8131-131313131313" }),
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.prepare(preexecution, assignment, claim),
    (error: unknown) => error instanceof DistributedRecoveryReacquisitionPreparationError
      && error.code === "lease_not_current",
  );
});
