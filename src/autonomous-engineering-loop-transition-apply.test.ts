import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAutonomousEngineeringLoop,
  FileAutonomousEngineeringLoopStore,
} from "./autonomous-engineering-loop.js";
import {
  AutonomousEngineeringLoopTransitionApplyError,
  AutonomousEngineeringLoopTransitionApplyService,
  AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT,
} from "./autonomous-engineering-loop-transition-apply.js";
import type { AutonomousEngineeringLoopTransitionAdmissionV1 } from "./autonomous-engineering-loop-transition-admission.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T08:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement one bounded engineering goal.",
  acceptanceCriteria: ["Independent evidence passes."],
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

function admission(
  expectedLoopRevision: number,
  expiresAt = "2026-10-07T08:10:00.000Z",
): AutonomousEngineeringLoopTransitionAdmissionV1 {
  return {
    schemaVersion: 1,
    admissionId: "77777777-7777-4777-8777-777777777777",
    admittedAt: "2026-10-07T08:02:00.000Z",
    expiresAt,
    loopId: "99999999-9999-4999-8999-999999999999",
    expectedLoopRevision,
    event: { type: "implementation_started", at: "2026-10-07T08:03:00.000Z" },
    taskId: supervisor.taskId,
    observedTaskStatus: "created",
    observedRunCount: 0,
    authority: "autonomous_loop_transition_admission_only",
    executable: false,
    mutatesLoopState: false,
    mutatesTaskState: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

test("M14C contract mutates only durable loop state", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.mutatesLoopState, true);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.mutatesTaskState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT.grantsReleaseAuthority, false);
});

test("M14C applies one fresh admission to the exact durable loop revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14c-"));
  try {
    const state = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T08:01:00.000Z"),
    });
    await new FileAutonomousEngineeringLoopStore(root).create(state);

    const result = await new AutonomousEngineeringLoopTransitionApplyService(root, {
      now: () => new Date("2026-10-07T08:04:00.000Z"),
    }).apply(admission(1));

    assert.equal(result.state.phase, "implementation_in_progress");
    assert.equal(result.state.revision, 2);
    assert.equal(result.receipt.priorRevision, 1);
    assert.equal(result.receipt.resultingRevision, 2);
    assert.equal(result.receipt.mutatesTaskState, false);
    assert.equal(result.receipt.grantsReleaseAuthority, false);

    const durable = await new FileAutonomousEngineeringLoopStore(root).load(state.loopId);
    assert.deepEqual(durable, result.state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14C admission replay fails closed across service reconstruction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14c-replay-"));
  try {
    const state = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T08:01:00.000Z"),
    });
    await new FileAutonomousEngineeringLoopStore(root).create(state);

    await new AutonomousEngineeringLoopTransitionApplyService(root, {
      now: () => new Date("2026-10-07T08:04:00.000Z"),
    }).apply(admission(1));

    await assert.rejects(
      () => new AutonomousEngineeringLoopTransitionApplyService(root, {
        now: () => new Date("2026-10-07T08:05:00.000Z"),
      }).apply(admission(1)),
      (error: unknown) =>
        error instanceof AutonomousEngineeringLoopTransitionApplyError
        && error.code === "admission_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14C rejects expired and stale-revision admissions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14c-stale-"));
  try {
    const state = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T08:01:00.000Z"),
    });
    await new FileAutonomousEngineeringLoopStore(root).create(state);

    await assert.rejects(
      () => new AutonomousEngineeringLoopTransitionApplyService(root, {
        now: () => new Date("2026-10-07T08:11:00.000Z"),
      }).apply(admission(1, "2026-10-07T08:10:00.000Z")),
      (error: unknown) =>
        error instanceof AutonomousEngineeringLoopTransitionApplyError
        && error.code === "admission_expired",
    );

    const current = await new FileAutonomousEngineeringLoopStore(root).load(state.loopId);
    assert.equal(current.revision, 1);

    const wrongRevision = admission(2);
    wrongRevision.admissionId = "88888888-8888-4888-8888-888888888888";
    await assert.rejects(
      () => new AutonomousEngineeringLoopTransitionApplyService(root, {
        now: () => new Date("2026-10-07T08:04:00.000Z"),
      }).apply(wrongRevision),
      (error: unknown) =>
        error instanceof AutonomousEngineeringLoopTransitionApplyError
        && error.code === "revision_conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
