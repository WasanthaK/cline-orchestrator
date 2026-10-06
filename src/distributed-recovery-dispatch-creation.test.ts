import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedRecoveryDispatchCreationCoordinator,
  DistributedRecoveryDispatchCreationError,
  DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT,
} from "./distributed-recovery-dispatch-creation.js";
import type { DistributedRecoveryReacquisitionPreparationEvidenceV1 } from "./distributed-recovery-reacquisition-preparation.js";
import {
  DistributedFenceAuthority,
  ReferenceLinearizableFenceBackend,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const now = new Date("2026-10-05T13:00:00.000Z");

const assignment: DistributedWriterCandidateAssignmentV1 = {
  schemaVersion: 1,
  assignmentId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  machineId: "44444444-4444-4444-8444-444444444444",
  machineRegistrationId: "55555555-5555-4555-8555-555555555555",
  machineRegistrationRevision: 2,
  placementId: "66666666-6666-4666-8666-666666666666",
  placementRevision: 4,
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

function lease(): WriterLeaseSession {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: assignment.workspaceId,
    stateRevision: 1,
    leaseId: "77777777-7777-4777-8777-777777777777",
    fenceToken: "88888888-8888-4888-8888-888888888888",
    taskId: assignment.taskId,
    ownerInstanceId: "99999999-9999-4999-8999-999999999999",
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    authority: "coordination_only",
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

async function fixture(): Promise<{
  authority: DistributedFenceAuthority;
  fence: DistributedFenceClaimV1;
  preparation: DistributedRecoveryReacquisitionPreparationEvidenceV1;
  leaseSession: WriterLeaseSession;
}> {
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    { async assertCandidateCurrent() {} },
    { now: () => new Date(now), idFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  );
  const fence = await authority.acquire({ assignment, ttlMs: 30_000 });
  const leaseSession = lease();
  const localClaim = leaseSession.currentClaim();
  const preparation: DistributedRecoveryReacquisitionPreparationEvidenceV1 = {
    schemaVersion: 1,
    proposalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    deliveryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    taskId: assignment.taskId,
    workspaceId: assignment.workspaceId,
    machineId: assignment.machineId,
    machineRegistrationId: assignment.machineRegistrationId,
    machineRegistrationRevision: assignment.machineRegistrationRevision,
    placementId: assignment.placementId,
    placementRevision: assignment.placementRevision,
    candidateAssignmentId: assignment.assignmentId,
    fenceId: fence.fenceId,
    fenceGeneration: fence.generation,
    localLeaseId: localClaim.leaseId,
    localFenceToken: localClaim.fenceToken,
    preparedAt: now.toISOString(),
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
  };
  return { authority, fence, preparation, leaseSession };
}

test("M12Z-E contract creates only a fresh authority-free dispatch", () => {
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.createsFreshDispatch, true);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.requiresImmediateCandidateRevalidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.requiresImmediateFenceRevalidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.requiresImmediateLocalLeaseRevalidation, true);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.consumesAdmission, false);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.invokesRuntime, false);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.startsCline, false);
  assert.equal(DISTRIBUTED_RECOVERY_DISPATCH_CREATION_CONTRACT.grantsTaskAuthority, false);
});

test("exact still-current prepared authority set creates a brand-new dispatch", async () => {
  const { authority, fence, preparation, leaseSession } = await fixture();
  const coordinator = new DistributedRecoveryDispatchCreationCoordinator({
    candidateValidator: { async assertCandidateCurrent() {} },
    fenceAuthority: authority,
    lease: leaseSession,
    dispatchTtlMs: 5_000,
    now: () => new Date(now),
    idFactory: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });

  const dispatch = await coordinator.create(preparation, assignment, fence);
  assert.equal(dispatch.dispatchId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(dispatch.taskId, preparation.taskId);
  assert.equal(dispatch.workspaceId, preparation.workspaceId);
  assert.equal(dispatch.machineId, preparation.machineId);
  assert.equal(dispatch.candidateAssignmentId, preparation.candidateAssignmentId);
  assert.equal(dispatch.fenceId, preparation.fenceId);
  assert.equal(dispatch.fenceGeneration, preparation.fenceGeneration);
  assert.equal(dispatch.authority, "execution_request_only");
  assert.equal(dispatch.grantsTaskAuthority, false);
});

test("different candidate from prepared evidence is rejected before freshness checks", async () => {
  const { authority, fence, preparation, leaseSession } = await fixture();
  let checks = 0;
  const coordinator = new DistributedRecoveryDispatchCreationCoordinator({
    candidateValidator: { async assertCandidateCurrent() { checks += 1; } },
    fenceAuthority: authority,
    lease: leaseSession,
    dispatchTtlMs: 5_000,
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.create(
      preparation,
      { ...assignment, assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      fence,
    ),
    (error: unknown) => error instanceof DistributedRecoveryDispatchCreationError
      && error.code === "binding_mismatch",
  );
  assert.equal(checks, 0);
});

test("stale candidate blocks recovery dispatch creation", async () => {
  const { authority, fence, preparation, leaseSession } = await fixture();
  const coordinator = new DistributedRecoveryDispatchCreationCoordinator({
    candidateValidator: { async assertCandidateCurrent() { throw new Error("stale"); } },
    fenceAuthority: authority,
    lease: leaseSession,
    dispatchTtlMs: 5_000,
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.create(preparation, assignment, fence),
    (error: unknown) => error instanceof DistributedRecoveryDispatchCreationError
      && error.code === "candidate_not_current",
  );
});

test("stale fence blocks recovery dispatch creation", async () => {
  const { authority, fence, preparation, leaseSession } = await fixture();
  await authority.revoke(fence);
  const coordinator = new DistributedRecoveryDispatchCreationCoordinator({
    candidateValidator: { async assertCandidateCurrent() {} },
    fenceAuthority: authority,
    lease: leaseSession,
    dispatchTtlMs: 5_000,
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.create(preparation, assignment, fence),
    (error: unknown) => error instanceof DistributedRecoveryDispatchCreationError
      && error.code === "fence_not_current",
  );
});

test("changed local lease identity blocks recovery dispatch creation", async () => {
  const { authority, fence, preparation } = await fixture();
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: assignment.workspaceId,
    stateRevision: 1,
    leaseId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    fenceToken: "12121212-1212-4121-8121-121212121212",
    taskId: assignment.taskId,
    ownerInstanceId: "99999999-9999-4999-8999-999999999999",
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    authority: "coordination_only",
  };
  const controller = new AbortController();
  const changedLease: WriterLeaseSession = {
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
    signal: controller.signal,
    currentClaim: () => structuredClone(claim),
    validateCurrent: async () => undefined,
  };
  const coordinator = new DistributedRecoveryDispatchCreationCoordinator({
    candidateValidator: { async assertCandidateCurrent() {} },
    fenceAuthority: authority,
    lease: changedLease,
    dispatchTtlMs: 5_000,
    now: () => new Date(now),
  });

  await assert.rejects(
    () => coordinator.create(preparation, assignment, fence),
    (error: unknown) => error instanceof DistributedRecoveryDispatchCreationError
      && error.code === "binding_mismatch",
  );
});
