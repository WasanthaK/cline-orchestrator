import assert from "node:assert/strict";
import test from "node:test";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import {
  AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT,
  AutonomousEngineeringStepController,
  AutonomousEngineeringStepControllerError,
} from "./autonomous-engineering-step-controller.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T20:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement bounded goal.",
  acceptanceCriteria: ["Tests pass."],
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

function loop(phase: AutonomousEngineeringLoopStateV1["phase"], revision = 1): AutonomousEngineeringLoopStateV1 {
  return {
    schemaVersion: 1,
    loopId: "99999999-9999-4999-8999-999999999999",
    createdAt: "2026-10-07T20:00:00.000Z",
    updatedAt: "2026-10-07T20:00:00.000Z",
    revision,
    phase,
    authorityBinding: {
      supervisorTaskId: supervisor.supervisorTaskId,
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
    },
    budget: { maxImplementationIterations: 4, maxRepairAttempts: 2 },
    counters: {
      implementationIterationsStarted: phase === "ready" ? 0 : 1,
      repairAttemptsStarted: phase === "repair_ready" ? 0 : 0,
    },
    ...(phase === "succeeded" ? { stopReason: "acceptance_criteria_satisfied" } : {}),
    ...(phase === "failed" ? { stopReason: "runtime_failed" } : {}),
    ...(phase === "waiting_for_human" ? { stopReason: "human_required" } : {}),
    authority: "autonomous_engineering_loop_state_only",
    executable: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function lease(): WriterLeaseSession {
  return {
    taskId: supervisor.taskId,
    workspaceId: supervisor.authority.workspaceId,
    ownerInstanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    signal: new AbortController().signal,
    currentClaim() {
      return {
        schemaVersion: 1,
        workspaceId: supervisor.authority.workspaceId,
        stateRevision: 1,
        leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        fenceToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        taskId: supervisor.taskId,
        ownerInstanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expiresAt: "2026-10-07T20:30:00.000Z",
        authority: "coordination_only",
      };
    },
    async validateCurrent() {},
    async release() {},
  } as WriterLeaseSession;
}

const evidence = {
  schemaVersion: 1 as const,
  loopId: "99999999-9999-4999-8999-999999999999",
  loopRevision: 2,
  taskId: supervisor.taskId,
  projectId: supervisor.authority.projectId,
  workspaceId: supervisor.authority.workspaceId,
  observedRunCount: 1,
  packet: {
    schemaVersion: 1 as const,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    capturedAt: "2026-10-07T20:10:00.000Z",
    status: "completed" as const,
    reviewState: "ready_for_supervisor_review" as const,
    completionSignal: { terminal: true as const, finishReason: "completed", workerReportAvailable: false },
    independentEvidence: {
      validation: { available: true, passed: true, commandsRequested: 1, commandsRun: 1, source: "orchestrator_validation" as const },
      diffSafety: { available: true, passed: true, changedFiles: 1, warningCount: 0, failureCount: 0, source: "orchestrator_diff_safety" as const },
      git: { source: "orchestrator_git_snapshot" as const },
      checkpoint: { available: true, runCount: 1, restored: false, source: "orchestrator_checkpoint" as const },
      recovery: {
        runCount: 1,
        sessionGeneration: 1,
        recoveryCount: 0,
        contextRotationCount: 0,
        contextHandoffCount: 0,
        retryCount: 0,
        stallCount: 0,
        source: "orchestrator_runtime_state" as const,
      },
    },
  },
  authority: "autonomous_engineering_completion_evidence_only" as const,
  invokesReviewer: false as const,
  mutatesLoopState: false as const,
  mutatesTaskState: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
};

function controller(overrides: Record<string, unknown> = {}) {
  const completion = {
    capture: async (state: AutonomousEngineeringLoopStateV1) => ({
      ...structuredClone(evidence),
      loopRevision: state.revision,
    }),
  };
  const progression = {
    progress: async (state: AutonomousEngineeringLoopStateV1) => ({
      schemaVersion: 1 as const,
      loopId: state.loopId,
      startingRevision: state.revision,
      resultingRevision: state.revision + 2,
      resultingPhase: "repair_ready" as const,
      completionAdmission: {} as any,
      completionApplyReceipt: {} as any,
      reviewDecision: {} as any,
      reviewAdmission: {} as any,
      reviewApplyReceipt: {} as any,
      authority: "autonomous_engineering_completion_review_progression_composition" as const,
      directLoopMutation: false as const,
      legacyRepairHandoff: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };
  const initialLaunch = {
    launch: async (state: AutonomousEngineeringLoopStateV1) => ({
      schemaVersion: 1 as const,
      loopId: state.loopId,
      startingRevision: state.revision,
      executionRevision: state.revision + 1,
      implementationStartAdmission: {} as any,
      implementationStartApplyReceipt: {} as any,
      intent: {} as any,
      executionAdmissionReceipt: {} as any,
      preparation: {} as any,
      activation: {} as any,
      runtimeResult: {} as any,
      authority: "autonomous_engineering_initial_cycle_launch_composition" as const,
      acquiresWriterLease: false as const,
      directLoopMutation: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };
  const repairLaunch = {
    launch: async (state: AutonomousEngineeringLoopStateV1) => ({
      schemaVersion: 1 as const,
      loopId: state.loopId,
      startingRevision: state.revision,
      executionRevision: state.revision + 1,
      repairDecisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      repairStartAdmission: {} as any,
      repairStartApplyReceipt: {} as any,
      intent: {} as any,
      executionAdmissionReceipt: {} as any,
      preparation: {} as any,
      activation: {} as any,
      runtimeResult: {} as any,
      authority: "autonomous_engineering_repair_cycle_launch_composition" as const,
      acquiresWriterLease: false as const,
      directLoopMutation: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };
  const review = {
    review: async (_supervisor: SupervisorTaskV1, e: typeof evidence) => ({
      schemaVersion: 1 as const,
      loopId: e.loopId,
      loopRevision: e.loopRevision,
      taskId: supervisor.taskId,
      observedRunCount: e.observedRunCount,
      completionCapturedAt: e.packet.capturedAt,
      reviewerResult: {
        schemaVersion: 1 as const,
        supervisorTaskId: supervisor.supervisorTaskId,
        taskId: supervisor.taskId,
        decision: "pass" as const,
        summary: "pass",
        completionAuthority: "advisory_only" as const,
      },
      decision: {
        schemaVersion: 1 as const,
        decisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        createdAt: "2026-10-07T20:11:00.000Z",
        supervisorTaskId: supervisor.supervisorTaskId,
        taskId: supervisor.taskId,
        safetyPlanId: supervisor.authority.safetyPlanId,
        safetyProfileId: supervisor.authority.safetyProfileId,
        safetyProfileRevision: supervisor.authority.safetyProfileRevision,
        workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
        kind: "review_pass" as const,
        provenance: "reviewer" as const,
        summary: "pass",
      },
      authority: "autonomous_engineering_review_decision_evidence_only" as const,
      queuesRepair: false as const,
      mutatesLoopState: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };
  const admission = {
    admit: async (state: AutonomousEngineeringLoopStateV1, _s: SupervisorTaskV1, event: any) => ({
      schemaVersion: 1 as const,
      admissionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      admittedAt: event.at,
      expiresAt: "2026-10-07T20:30:00.000Z",
      loopId: state.loopId,
      expectedLoopRevision: state.revision,
      event,
      taskId: supervisor.taskId,
      observedTaskStatus: "completed" as const,
      observedRunCount: 1,
      completionCapturedAt: "2026-10-07T20:10:00.000Z",
      decisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      authority: "autonomous_loop_transition_admission_only" as const,
      executable: false as const,
      mutatesLoopState: false as const,
      mutatesTaskState: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };
  const apply = {
    apply: async (a: any) => ({
      state: { ...loop("succeeded", a.expectedLoopRevision + 1), stopReason: "acceptance_criteria_satisfied" },
      receipt: {
        schemaVersion: 1 as const,
        admissionId: a.admissionId,
        loopId: a.loopId,
        priorRevision: a.expectedLoopRevision,
        resultingRevision: a.expectedLoopRevision + 1,
        appliedAt: a.admittedAt,
        authority: "autonomous_loop_transition_apply_state_only" as const,
        mutatesTaskState: false as const,
        startsWorker: false as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsWriterLeaseAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      },
    }),
  };

  return new AutonomousEngineeringStepController(
    (overrides.completion as any) ?? completion,
    (overrides.progression as any) ?? progression,
    (overrides.initialLaunch as any) ?? initialLaunch,
    (overrides.repairLaunch as any) ?? repairLaunch,
    (overrides.review as any) ?? review,
    (overrides.admission as any) ?? admission,
    (overrides.apply as any) ?? apply,
  );
}

test("M14O contract is phase-aware composition only", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.onePhaseStepPerCall, true);
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.restartSafeAwaitingReview, true);
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.grantsReleaseAuthority, false);
});

test("M14O ready requires supplied lease and delegates only to M14N", async () => {
  await assert.rejects(
    () => controller().step(loop("ready"), supervisor),
    (error: unknown) =>
      error instanceof AutonomousEngineeringStepControllerError
      && error.code === "lease_required",
  );

  const result = await controller().step(loop("ready"), supervisor, { lease: lease() });
  assert.equal(result.action, "initial_launch");
  assert.equal(result.resultingPhase, "implementation_in_progress");
  assert.equal(result.resultingRevision, 2);
});

test("M14O implementation phase captures fresh evidence then delegates to M14L", async () => {
  const result = await controller().step(loop("implementation_in_progress", 2), supervisor);
  assert.equal(result.action, "completion_review_progression");
  assert.equal(result.resultingPhase, "repair_ready");
  assert.equal(result.resultingRevision, 4);
});

test("M14O awaiting_review resumes reviewer transition without replaying completion admission", async () => {
  let admissionCalls = 0;
  const baseAdmission = {
    admit: async (...args: any[]) => {
      admissionCalls += 1;
      return await (controller() as any).admission?.admit?.(...args);
    },
  };
  // Use explicit admission/apply fakes to count the single review admission.
  const admission = {
    admit: async (state: AutonomousEngineeringLoopStateV1, _s: SupervisorTaskV1, event: any) => {
      admissionCalls += 1;
      assert.equal(event.type, "review_pass");
      return {
        schemaVersion: 1 as const,
        admissionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        admittedAt: event.at,
        expiresAt: "2026-10-07T20:30:00.000Z",
        loopId: state.loopId,
        expectedLoopRevision: state.revision,
        event,
        taskId: supervisor.taskId,
        observedTaskStatus: "completed" as const,
        observedRunCount: 1,
        completionCapturedAt: "2026-10-07T20:10:00.000Z",
        decisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        authority: "autonomous_loop_transition_admission_only" as const,
        executable: false as const,
        mutatesLoopState: false as const,
        mutatesTaskState: false as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsWriterLeaseAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      };
    },
  };
  const apply = {
    apply: async (a: any) => ({
      state: { ...loop("succeeded", a.expectedLoopRevision + 1), stopReason: "acceptance_criteria_satisfied" },
      receipt: {
        schemaVersion: 1 as const,
        admissionId: a.admissionId,
        loopId: a.loopId,
        priorRevision: a.expectedLoopRevision,
        resultingRevision: a.expectedLoopRevision + 1,
        appliedAt: a.admittedAt,
        authority: "autonomous_loop_transition_apply_state_only" as const,
        mutatesTaskState: false as const,
        startsWorker: false as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsWriterLeaseAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      },
    }),
  };

  const result = await controller({ admission, apply }).step(loop("awaiting_review", 3), supervisor);
  assert.equal(admissionCalls, 1);
  assert.equal(result.action, "awaiting_review_resume");
  assert.equal(result.resultingPhase, "succeeded");
  assert.equal(result.resultingRevision, 4);
});

test("M14O repair_ready requires exact prior progression and supplied lease", async () => {
  await assert.rejects(
    () => controller().step(loop("repair_ready", 4), supervisor, { lease: lease() }),
    (error: unknown) =>
      error instanceof AutonomousEngineeringStepControllerError
      && error.code === "repair_provenance_required",
  );

  const fakeProgression = {
    schemaVersion: 1,
    loopId: "99999999-9999-4999-8999-999999999999",
    startingRevision: 2,
    resultingRevision: 4,
    resultingPhase: "repair_ready",
  } as any;
  const result = await controller().step(loop("repair_ready", 4), supervisor, {
    lease: lease(),
    repairProgression: fakeProgression,
  });
  assert.equal(result.action, "repair_launch");
  assert.equal(result.resultingPhase, "implementation_in_progress");
  assert.equal(result.resultingRevision, 5);
});

test("M14O terminal phases are no-op and require no lease", async () => {
  const result = await controller().step(loop("succeeded", 6), supervisor);
  assert.equal(result.action, "terminal_noop");
  assert.equal(result.terminal, true);
  assert.equal(result.resultingRevision, 6);
  assert.equal(result.grantsReleaseAuthority, false);
});
