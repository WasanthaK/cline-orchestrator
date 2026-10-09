import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutonomousEngineeringLoop,
  transitionAutonomousEngineeringLoop,
} from "./autonomous-engineering-loop.js";
import {
  AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT,
  AutonomousEngineeringLoopTransitionAdmissionError,
  AutonomousEngineeringLoopTransitionAdmissionService,
  type AutonomousEngineeringLoopCurrentTaskBindingV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type { SupervisorDecisionV1 } from "./supervisor-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T07:00:00.000Z",
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

function current(
  status: AutonomousEngineeringLoopCurrentTaskBindingV1["status"],
  runCount: number,
): AutonomousEngineeringLoopCurrentTaskBindingV1 {
  return {
    schemaVersion: 1,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyPolicyVersion: supervisor.authority.safetyPolicyVersion,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workerProfileId: supervisor.authority.workerProfileId,
    allowedPathPatterns: [...supervisor.authority.allowedPathPatterns],
    protectedPathPatterns: [...supervisor.authority.protectedPathPatterns],
    status,
    runCount,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding",
  };
}

function packet(status: "completed" | "failed" | "validation_failed", runCount = 1): TaskCompletionPacketV1 {
  return {
    schemaVersion: 1,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    capturedAt: "2026-10-07T07:10:00.000Z",
    status,
    reviewState: "ready_for_supervisor_review",
    completionSignal: { terminal: true, finishReason: status, workerReportAvailable: false },
    independentEvidence: {
      validation: {
        available: true,
        passed: status === "completed",
        commandsRequested: 1,
        commandsRun: 1,
        source: "orchestrator_validation",
      },
      diffSafety: {
        available: true,
        passed: true,
        changedFiles: 1,
        warningCount: 0,
        failureCount: 0,
        source: "orchestrator_diff_safety",
      },
      git: { source: "orchestrator_git_snapshot" },
      checkpoint: { available: true, runCount, restored: false, source: "orchestrator_checkpoint" },
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

function decision(kind: "review_pass" | "review_repair" | "review_escalation"): SupervisorDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: "88888888-8888-4888-8888-888888888888",
    createdAt: "2026-10-07T07:11:00.000Z",
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    kind,
    provenance: "reviewer",
    summary: "bounded review",
    ...(kind === "review_repair" ? { repairInstruction: "Adjust the approved implementation." } : {}),
    ...(kind === "review_escalation" ? { escalationReason: "Human decision required." } : {}),
  };
}

function service(snapshot: AutonomousEngineeringLoopCurrentTaskBindingV1) {
  return new AutonomousEngineeringLoopTransitionAdmissionService(
    { async revalidateCurrent() { return structuredClone(snapshot); } },
    {
      idFactory: () => "77777777-7777-4777-8777-777777777777",
      now: () => new Date("2026-10-07T07:12:00.000Z"),
    },
  );
}

test("M14B contract is evidence-only and grants no execution authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.mutatesLoopState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.mutatesTaskState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT.grantsReleaseAuthority, false);
});

test("M14B admits a bounded initial implementation transition without mutating state", async () => {
  const loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
  });
  const admission = await service(current("created", 0)).admit(
    loop,
    supervisor,
    { type: "implementation_started", at: "2026-10-07T07:13:00.000Z" },
  );

  assert.equal(admission.expectedLoopRevision, 1);
  assert.equal(admission.observedRunCount, 0);
  assert.equal(admission.executable, false);
  assert.equal(admission.mutatesLoopState, false);
  assert.equal(loop.phase, "ready");
});

test("M14B requires current independent completion evidence and exact run count", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T07:02:00.000Z",
  });

  const admission = await service(current("completed", 1)).admit(
    loop,
    supervisor,
    { type: "completion_evidence_captured", at: "2026-10-07T07:13:00.000Z" },
    { completionPacket: packet("completed", 1) },
  );
  assert.equal(admission.completionCapturedAt, "2026-10-07T07:10:00.000Z");
  assert.equal(admission.grantsTaskAuthority, false);

  await assert.rejects(
    () => service(current("completed", 2)).admit(
      loop,
      supervisor,
      { type: "completion_evidence_captured", at: "2026-10-07T07:13:00.000Z" },
      { completionPacket: packet("completed", 1) },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopTransitionAdmissionError
      && error.code === "completion_evidence_invalid",
  );
});

test("M14B admits only trusted matching reviewer decisions after completion evidence", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T07:02:00.000Z",
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "completion_evidence_captured",
    at: "2026-10-07T07:10:30.000Z",
  });

  const admission = await service(current("completed", 1)).admit(
    loop,
    supervisor,
    { type: "review_repair", at: "2026-10-07T07:13:00.000Z" },
    { completionPacket: packet("completed", 1), decision: decision("review_repair") },
  );
  assert.equal(admission.decisionId, "88888888-8888-4888-8888-888888888888");
  assert.equal(admission.authority, "autonomous_loop_transition_admission_only");
  assert.equal(admission.grantsFilesystemAuthority, false);

  await assert.rejects(
    () => service(current("completed", 1)).admit(
      loop,
      supervisor,
      { type: "review_pass", at: "2026-10-07T07:13:00.000Z" },
      { completionPacket: packet("completed", 1), decision: decision("review_repair") },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopTransitionAdmissionError
      && error.code === "decision_invalid",
  );
});

test("M14B fails closed on authority drift and on non-passing success evidence", async () => {
  const loop0 = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
  });
  const drift = current("created", 0);
  drift.safetyProfileRevision += 1;

  await assert.rejects(
    () => service(drift).admit(
      loop0,
      supervisor,
      { type: "implementation_started", at: "2026-10-07T07:13:00.000Z" },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopTransitionAdmissionError
      && error.code === "binding_stale",
  );

  const running = transitionAutonomousEngineeringLoop(loop0, {
    type: "implementation_started",
    at: "2026-10-07T07:02:00.000Z",
  });
  const bad = packet("completed", 1);
  bad.independentEvidence.validation.passed = false;

  await assert.rejects(
    () => service(current("completed", 1)).admit(
      running,
      supervisor,
      { type: "completion_evidence_captured", at: "2026-10-07T07:13:00.000Z" },
      { completionPacket: bad },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopTransitionAdmissionError
      && error.code === "completion_evidence_invalid",
  );
});

test("M14B admits reviewer escalation only with exact trusted reason", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "implementation_started", at: "2026-10-07T07:02:00.000Z" });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "completion_evidence_captured", at: "2026-10-07T07:10:30.000Z" });

  const admission = await service(current("completed", 1)).admit(
    loop,
    supervisor,
    { type: "human_escalation", at: "2026-10-07T07:13:00.000Z", reason: "Human decision required." },
    { completionPacket: packet("completed", 1), decision: decision("review_escalation") },
  );
  assert.equal(admission.decisionId, "88888888-8888-4888-8888-888888888888");
  assert.equal(admission.grantsReleaseAuthority, false);
});


test("M14B admits repair start from reviewed completed task only with exact repair decision provenance", async () => {
  let state = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T07:01:00.000Z"),
    maxImplementationIterations: 3,
    maxRepairAttempts: 2,
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "implementation_started",
    at: "2026-10-07T07:02:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "completion_evidence_captured",
    at: "2026-10-07T07:10:30.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "review_repair",
    at: "2026-10-07T07:11:00.000Z",
  });

  const repair = decision("review_repair");
  const admitted = await service(current("completed", 1)).admit(
    state,
    supervisor,
    { type: "repair_started", at: "2026-10-07T07:13:00.000Z" },
    { decision: repair },
  );

  assert.equal(admitted.observedTaskStatus, "completed");
  assert.equal(admitted.decisionId, repair.decisionId);

  await assert.rejects(
    () => service(current("completed", 1)).admit(
      state,
      supervisor,
      { type: "repair_started", at: "2026-10-07T07:13:00.000Z" },
    ),
    (error: unknown) =>
      error instanceof AutonomousEngineeringLoopTransitionAdmissionError
      && error.code === "decision_invalid",
  );
});
