import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTONOMOUS_ENGINEERING_LOOP_CONTRACT,
  AutonomousEngineeringLoopError,
  FileAutonomousEngineeringLoopStore,
  createAutonomousEngineeringLoop,
  transitionAutonomousEngineeringLoop,
} from "./autonomous-engineering-loop.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const task: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T06:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement one bounded engineering goal.",
  acceptanceCriteria: ["Independent validation and diff safety pass."],
  trustedValidationCommands: ["npm test"],
  authority: {
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 3,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 4,
    workerProfileId: "default",
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: [".env*", ".git/**"],
  },
  constraints: {
    scopeExpansion: "stop_and_escalate",
    repositoryInstructionsGrantAuthority: false,
    modelShellAllowed: false,
    modelNetworkAllowed: false,
    modelMcpAllowed: false,
    modelPluginsAllowed: false,
    subagentsAllowed: false,
    agentTeamsAllowed: false,
    validationRunsExternally: true,
    completionRequiresOrchestratorValidation: true,
    completionRequiresDiffSafety: true,
  },
};

test("M14A contract is state-only and grants no execution or release authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.startsWorker, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.acquiresDistributedFence, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.performsGitDelivery, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_CONTRACT.grantsReleaseAuthority, false);

  const state = createAutonomousEngineeringLoop(task, {
    idFactory: () => "77777777-7777-4777-8777-777777777777",
    now: () => new Date("2026-10-07T06:01:00.000Z"),
    maxImplementationIterations: 3,
    maxRepairAttempts: 2,
  });

  assert.equal(state.phase, "ready");
  assert.equal(state.executable, false);
  assert.deepEqual(state.authorityBinding.allowedPathPatterns, task.authority.allowedPathPatterns);
  assert.deepEqual(state.authorityBinding.protectedPathPatterns, task.authority.protectedPathPatterns);
  assert.equal(state.grantsTaskAuthority, false);
  assert.equal(state.grantsFilesystemAuthority, false);
  assert.equal(state.grantsReleaseAuthority, false);
});

test("M14A deterministic loop transitions pass once and preserve bounded repair accounting", () => {
  let state = createAutonomousEngineeringLoop(task, {
    idFactory: () => "77777777-7777-4777-8777-777777777777",
    now: () => new Date("2026-10-07T06:01:00.000Z"),
    maxImplementationIterations: 3,
    maxRepairAttempts: 2,
  });

  state = transitionAutonomousEngineeringLoop(state, {
    type: "implementation_started",
    at: "2026-10-07T06:02:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "completion_evidence_captured",
    at: "2026-10-07T06:03:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "review_repair",
    at: "2026-10-07T06:04:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "repair_started",
    at: "2026-10-07T06:05:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "completion_evidence_captured",
    at: "2026-10-07T06:06:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "review_pass",
    at: "2026-10-07T06:07:00.000Z",
  });

  assert.equal(state.phase, "succeeded");
  assert.equal(state.stopReason, "acceptance_criteria_satisfied");
  assert.equal(state.counters.implementationIterationsStarted, 2);
  assert.equal(state.counters.repairAttemptsStarted, 1);
  assert.throws(
    () => transitionAutonomousEngineeringLoop(state, {
      type: "implementation_started",
      at: "2026-10-07T06:08:00.000Z",
    }),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopError
      && error.code === "transition_invalid",
  );
});

test("M14A repair budget exhaustion fails closed to waiting_for_human", () => {
  let state = createAutonomousEngineeringLoop(task, {
    idFactory: () => "77777777-7777-4777-8777-777777777777",
    now: () => new Date("2026-10-07T06:01:00.000Z"),
    maxImplementationIterations: 2,
    maxRepairAttempts: 1,
  });

  state = transitionAutonomousEngineeringLoop(state, { type: "implementation_started", at: "2026-10-07T06:02:00.000Z" });
  state = transitionAutonomousEngineeringLoop(state, { type: "completion_evidence_captured", at: "2026-10-07T06:03:00.000Z" });
  state = transitionAutonomousEngineeringLoop(state, { type: "review_repair", at: "2026-10-07T06:04:00.000Z" });
  state = transitionAutonomousEngineeringLoop(state, { type: "repair_started", at: "2026-10-07T06:05:00.000Z" });
  state = transitionAutonomousEngineeringLoop(state, { type: "completion_evidence_captured", at: "2026-10-07T06:06:00.000Z" });
  state = transitionAutonomousEngineeringLoop(state, { type: "review_repair", at: "2026-10-07T06:07:00.000Z" });

  assert.equal(state.phase, "waiting_for_human");
  assert.equal(state.stopReason, "autonomous_repair_budget_exhausted");
  assert.equal(state.grantsFilesystemAuthority, false);
});

test("M14A durable state survives store reconstruction and rejects stale revision replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14a-"));
  try {
    const initial = createAutonomousEngineeringLoop(task, {
      idFactory: () => "77777777-7777-4777-8777-777777777777",
      now: () => new Date("2026-10-07T06:01:00.000Z"),
      maxImplementationIterations: 3,
      maxRepairAttempts: 2,
    });
    const firstStore = new FileAutonomousEngineeringLoopStore(root);
    await firstStore.create(initial);

    const reconstructedStore = new FileAutonomousEngineeringLoopStore(root);
    const loaded = await reconstructedStore.load(initial.loopId);
    assert.deepEqual(loaded, initial);

    const next = transitionAutonomousEngineeringLoop(loaded, {
      type: "implementation_started",
      at: "2026-10-07T06:02:00.000Z",
    });
    await reconstructedStore.replaceExact(loaded.revision, next);

    const after = await new FileAutonomousEngineeringLoopStore(root).load(initial.loopId);
    assert.equal(after.revision, 2);
    assert.equal(after.phase, "implementation_in_progress");

    const staleNext = transitionAutonomousEngineeringLoop(initial, {
      type: "implementation_started",
      at: "2026-10-07T06:03:00.000Z",
    });
    await assert.rejects(
      () => reconstructedStore.replaceExact(initial.revision, staleNext),
      (error: unknown) =>
        error instanceof AutonomousEngineeringLoopError
        && error.code === "revision_conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14A rejects a widened supervisor task and impossible budget", () => {
  assert.throws(
    () => createAutonomousEngineeringLoop(
      {
        ...task,
        constraints: { ...task.constraints, modelNetworkAllowed: true as false },
      },
      { idFactory: () => "77777777-7777-4777-8777-777777777777" },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopError
      && error.code === "binding_invalid",
  );

  assert.throws(
    () => createAutonomousEngineeringLoop(task, {
      idFactory: () => "77777777-7777-4777-8777-777777777777",
      maxImplementationIterations: 1,
      maxRepairAttempts: 1,
    }),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopError
      && error.code === "budget_invalid",
  );
});
