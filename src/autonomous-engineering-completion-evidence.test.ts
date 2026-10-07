import assert from "node:assert/strict";
import test from "node:test";
import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import {
  AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT,
  AutonomousEngineeringCompletionEvidenceError,
  AutonomousEngineeringCompletionEvidenceService,
} from "./autonomous-engineering-completion-evidence.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const loop: AutonomousEngineeringLoopStateV1 = {
  schemaVersion: 1,
  loopId: "99999999-9999-4999-8999-999999999999",
  createdAt: "2026-10-07T15:00:00.000Z",
  updatedAt: "2026-10-07T15:01:00.000Z",
  revision: 2,
  phase: "implementation_in_progress",
  authorityBinding: {
    supervisorTaskId: "11111111-1111-4111-8111-111111111111",
    taskId: "22222222-2222-4222-8222-222222222222",
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
  budget: { maxImplementationIterations: 4, maxRepairAttempts: 2 },
  counters: { implementationIterationsStarted: 1, repairAttemptsStarted: 0 },
  authority: "autonomous_engineering_loop_state_only",
  executable: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function current(
  status: AutonomousEngineeringLoopCurrentTaskBindingV1["status"] = "completed",
  runCount = 1,
): AutonomousEngineeringLoopCurrentTaskBindingV1 {
  return {
    schemaVersion: 1,
    taskId: loop.authorityBinding.taskId,
    projectId: loop.authorityBinding.projectId,
    workspaceId: loop.authorityBinding.workspaceId,
    workspaceRegistryRevision: loop.authorityBinding.workspaceRegistryRevision,
    safetyPlanId: loop.authorityBinding.safetyPlanId,
    safetyPolicyVersion: loop.authorityBinding.safetyPolicyVersion,
    safetyProfileId: loop.authorityBinding.safetyProfileId,
    safetyProfileRevision: loop.authorityBinding.safetyProfileRevision,
    workerProfileId: loop.authorityBinding.workerProfileId,
    allowedPathPatterns: [...loop.authorityBinding.allowedPathPatterns],
    protectedPathPatterns: [...loop.authorityBinding.protectedPathPatterns],
    status,
    runCount,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding",
  };
}

function packet(
  status: "completed" | "failed" | "validation_failed" = "completed",
  runCount = 1,
): TaskCompletionPacketV1 {
  return {
    schemaVersion: 1,
    taskId: loop.authorityBinding.taskId,
    projectId: loop.authorityBinding.projectId,
    workspaceId: loop.authorityBinding.workspaceId,
    capturedAt: "2026-10-07T15:05:00.000Z",
    status,
    reviewState: "ready_for_supervisor_review",
    completionSignal: {
      terminal: true,
      finishReason: status,
      workerReportAvailable: false,
    },
    independentEvidence: {
      validation: {
        available: true,
        passed: status === "completed",
        commandsRequested: 1,
        commandsRun: 1,
        completedAt: "2026-10-07T15:04:30.000Z",
        source: "orchestrator_validation",
      },
      diffSafety: {
        available: true,
        passed: true,
        changedFiles: 1,
        warningCount: 0,
        failureCount: 0,
        checkedAt: "2026-10-07T15:04:40.000Z",
        source: "orchestrator_diff_safety",
      },
      git: {
        source: "orchestrator_git_snapshot",
      },
      checkpoint: {
        available: true,
        createdAt: "2026-10-07T15:02:00.000Z",
        runCount,
        restored: false,
        source: "orchestrator_checkpoint",
      },
      recovery: {
        runCount,
        sessionGeneration: 1,
        recoveryCount: 0,
        contextRotationCount: 0,
        contextHandoffCount: 0,
        retryCount: 0,
        stallCount: 0,
        source: "orchestrator_runtime_state",
      },
    },
  };
}

function fakeMachine(value: TaskCompletionPacketV1): MachineOrchestratorService {
  // getTaskCompletionPacket is imported by the SUT and requires concrete machine
  // methods. This structural fake returns the same validated identity and exposes
  // a canonical-root TaskStore path only in integration; focused M14J tests instead
  // monkey-patch via a minimal subclass boundary below.
  return {
    getTask: async () => ({
      taskId: value.taskId,
      projectId: value.projectId,
      workspaceId: value.workspaceId,
    }),
    registry: {
      resolveVerifiedWorkspace: async () => {
        throw new Error("focused test must inject packet capture");
      },
    },
  } as unknown as MachineOrchestratorService;
}

test("M14J contract is evidence-only and invokes no reviewer", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT.invokesReviewer, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT.mutatesLoopState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT.grantsReleaseAuthority, false);
});

test("M14J captures current successful completion packet bound to exact loop/run", async () => {
  const p = packet("completed", 2);
  const service = new AutonomousEngineeringCompletionEvidenceService(
    fakeMachine(p),
    { async revalidateCurrent() { return current("completed", 2); } },
    async (_machine, taskId) => {
      assert.equal(taskId, loop.authorityBinding.taskId);
      return structuredClone(p);
    },
  );

  const result = await service.capture(loop);
  assert.equal(result.loopRevision, 2);
  assert.equal(result.observedRunCount, 2);
  assert.equal(result.packet.status, "completed");
  assert.equal(result.packet.independentEvidence.validation.passed, true);
  assert.equal(result.invokesReviewer, false);
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M14J accepts terminal failure evidence without claiming success", async () => {
  const p = packet("validation_failed", 2);
  const service = new AutonomousEngineeringCompletionEvidenceService(
    fakeMachine(p),
    { async revalidateCurrent() { return current("validation_failed", 2); } },
    async () => structuredClone(p),
  );

  const result = await service.capture(loop);
  assert.equal(result.packet.status, "validation_failed");
  assert.equal(result.packet.independentEvidence.validation.passed, false);
  assert.equal(result.grantsTaskAuthority, false);
});

test("M14J rejects stale run-count packet and missing diff safety", async () => {
  const stale = packet("completed", 1);
  await assert.rejects(
    () => new AutonomousEngineeringCompletionEvidenceService(
      fakeMachine(stale),
      { async revalidateCurrent() { return current("completed", 2); } },
      async () => structuredClone(stale),
    ).capture(loop),
    (error: unknown) =>
      error instanceof AutonomousEngineeringCompletionEvidenceError
      && error.code === "run_stale",
  );

  const unsafe = packet("completed", 2);
  unsafe.independentEvidence.diffSafety.passed = false;
  await assert.rejects(
    () => new AutonomousEngineeringCompletionEvidenceService(
      fakeMachine(unsafe),
      { async revalidateCurrent() { return current("completed", 2); } },
      async () => structuredClone(unsafe),
    ).capture(loop),
    (error: unknown) =>
      error instanceof AutonomousEngineeringCompletionEvidenceError
      && error.code === "evidence_incomplete",
  );
});

test("M14J rejects Safety drift before packet capture", async () => {
  const p = packet("completed", 2);
  const drifted = current("completed", 2);
  drifted.safetyProfileRevision += 1;
  let captured = false;

  await assert.rejects(
    () => new AutonomousEngineeringCompletionEvidenceService(
      fakeMachine(p),
      { async revalidateCurrent() { return drifted; } },
      async () => {
        captured = true;
        return structuredClone(p);
      },
    ).capture(loop),
    (error: unknown) =>
      error instanceof AutonomousEngineeringCompletionEvidenceError
      && error.code === "binding_stale",
  );
  assert.equal(captured, false);
});

test("M14J rejects a successful terminal packet without passing validation", async () => {
  const p = packet("completed", 2);
  p.independentEvidence.validation.passed = false;

  await assert.rejects(
    () => new AutonomousEngineeringCompletionEvidenceService(
      fakeMachine(p),
      { async revalidateCurrent() { return current("completed", 2); } },
      async () => structuredClone(p),
    ).capture(loop),
    (error: unknown) =>
      error instanceof AutonomousEngineeringCompletionEvidenceError
      && error.code === "evidence_incomplete",
  );
});
