import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT,
  DistributedRecoveryPreexecutionCoordinator,
  DistributedRecoveryPreexecutionError,
} from "./distributed-recovery-preexecution.js";
import type { DistributedRecoveryProposalV1 } from "./distributed-recovery-proposal.js";
import type { OrchestratorTask } from "./types.js";

const proposal: DistributedRecoveryProposalV1 = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  sourceDisposition: "fresh_authority_review_required",
  sourceReason: "no_delivery_yet",
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
};

function task(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: proposal.taskId,
    goal: "Recover safely",
    workspace: "/tmp/recovery-workspace",
    status: "created",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    projectId: "55555555-5555-4555-8555-555555555555",
    workspaceId: proposal.workspaceId,
    workspaceRegistryRevision: 7,
    safetyPlanId: "66666666-6666-4666-8666-666666666666",
    safetyPolicyVersion: "policy-v7",
    safetyProfileId: "77777777-7777-4777-8777-777777777777",
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env", ".git/**"],
    workerProfileId: "worker-v1",
    validationCommands: [],
    runCount: 0,
    sessionGeneration: 0,
    ...overrides,
  };
}

test("M12Z-C contract is pre-execution evidence only", () => {
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.requiresCurrentTargetLocalTask, true);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.requiresCurrentWorkspaceSafetyBinding, true);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.requiresFreshCreatedTask, true);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.acquiresCandidate, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.acquiresDistributedFence, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.acquiresLocalWriterLease, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.createsDispatch, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.invokesAdmission, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.invokesTargetHandoff, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.invokesRuntime, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.startsCline, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT.grantsReleaseAuthority, false);
});

test("fresh target-local task produces bounded recovery pre-execution evidence", async () => {
  let calls = 0;
  const coordinator = new DistributedRecoveryPreexecutionCoordinator({
    tasks: {
      async loadCurrent(taskId, workspaceId) {
        calls += 1;
        assert.equal(taskId, proposal.taskId);
        assert.equal(workspaceId, proposal.workspaceId);
        return task();
      },
    },
    now: () => new Date("2026-10-05T11:00:00.000Z"),
  });

  const evidence = await coordinator.verify(proposal);
  assert.equal(calls, 1);
  assert.equal(evidence.proposalId, proposal.proposalId);
  assert.equal(evidence.deliveryId, proposal.deliveryId);
  assert.equal(evidence.taskId, proposal.taskId);
  assert.equal(evidence.workspaceId, proposal.workspaceId);
  assert.equal(evidence.workspaceRegistryRevision, 7);
  assert.equal(evidence.safetyProfileRevision, 4);
  assert.equal(evidence.verifiedAt, "2026-10-05T11:00:00.000Z");
  assert.equal(evidence.requiresFreshCandidateAssignment, true);
  assert.equal(evidence.requiresFreshDistributedFence, true);
  assert.equal(evidence.requiresFreshLocalWriterLease, true);
  assert.equal(evidence.grantsTaskAuthority, false);
});

test("prior runtime/session/escalation history fails closed before recovery execution", async () => {
  for (const current of [
    task({ status: "running" }),
    task({ runCount: 1 }),
    task({ sessionGeneration: 1 }),
    task({ clineSessionId: "session-1" }),
    task({ pendingEscalation: { kind: "test" } as any }),
  ]) {
    const coordinator = new DistributedRecoveryPreexecutionCoordinator({
      tasks: { async loadCurrent() { return current; } },
    });
    await assert.rejects(
      () => coordinator.verify(proposal),
      (error: unknown) => error instanceof DistributedRecoveryPreexecutionError
        && error.code === "task_not_fresh",
    );
  }
});

test("cross-bound target task fails closed", async () => {
  const coordinator = new DistributedRecoveryPreexecutionCoordinator({
    tasks: {
      async loadCurrent() {
        return task({ workspaceId: "88888888-8888-4888-8888-888888888888" });
      },
    },
  });
  await assert.rejects(
    () => coordinator.verify(proposal),
    (error: unknown) => error instanceof DistributedRecoveryPreexecutionError
      && error.code === "task_not_current",
  );
});

test("incomplete target-local Safety binding fails closed", async () => {
  const coordinator = new DistributedRecoveryPreexecutionCoordinator({
    tasks: {
      async loadCurrent() {
        return task({ safetyPlanId: undefined });
      },
    },
  });
  await assert.rejects(
    () => coordinator.verify(proposal),
    (error: unknown) => error instanceof DistributedRecoveryPreexecutionError
      && error.code === "task_not_current",
  );
});

test("proposal authority widening is rejected before target lookup", async () => {
  let calls = 0;
  const coordinator = new DistributedRecoveryPreexecutionCoordinator({
    tasks: {
      async loadCurrent() {
        calls += 1;
        return task();
      },
    },
  });
  await assert.rejects(
    () => coordinator.verify({
      ...proposal,
      grantsTaskAuthority: true,
    } as unknown as DistributedRecoveryProposalV1),
    (error: unknown) => error instanceof DistributedRecoveryPreexecutionError
      && error.code === "proposal_invalid",
  );
  assert.equal(calls, 0);
});

test("invalid pre-execution clock fails closed", async () => {
  const coordinator = new DistributedRecoveryPreexecutionCoordinator({
    tasks: { async loadCurrent() { return task(); } },
    now: () => new Date(Number.NaN),
  });
  await assert.rejects(
    () => coordinator.verify(proposal),
    (error: unknown) => error instanceof DistributedRecoveryPreexecutionError
      && error.code === "clock_invalid",
  );
});
