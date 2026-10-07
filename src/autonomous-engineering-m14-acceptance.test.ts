import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAutonomousEngineeringLoop,
  FileAutonomousEngineeringLoopStore,
  transitionAutonomousEngineeringLoop,
  type AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import {
  AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT,
  AutonomousEngineeringStepController,
  AutonomousEngineeringStepControllerError,
} from "./autonomous-engineering-step-controller.js";
import type { AutonomousEngineeringCompletionReviewProgressionResultV1 } from "./autonomous-engineering-completion-review-progression.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T21:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement one bounded goal.",
  acceptanceCriteria: ["Independent validation and diff safety pass."],
  trustedValidationCommands: ["npm test"],
  authority: {
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 7,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 9,
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
        expiresAt: "2026-10-07T22:00:00.000Z",
        authority: "coordination_only",
      };
    },
    async validateCurrent() {},
    async release() {},
  } as WriterLeaseSession;
}

function packet(loop: AutonomousEngineeringLoopStateV1, runCount: number) {
  return {
    schemaVersion: 1 as const,
    loopId: loop.loopId,
    loopRevision: loop.revision,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    observedRunCount: runCount,
    packet: {
      schemaVersion: 1 as const,
      taskId: supervisor.taskId,
      projectId: supervisor.authority.projectId,
      workspaceId: supervisor.authority.workspaceId,
      capturedAt: new Date(Date.parse("2026-10-07T21:10:00.000Z") + loop.revision * 1000).toISOString(),
      status: "completed" as const,
      reviewState: "ready_for_supervisor_review" as const,
      completionSignal: {
        terminal: true as const,
        finishReason: "completed",
        workerReportAvailable: false,
      },
      independentEvidence: {
        validation: {
          available: true,
          passed: true,
          commandsRequested: 1,
          commandsRun: 1,
          source: "orchestrator_validation" as const,
        },
        diffSafety: {
          available: true,
          passed: true,
          changedFiles: 1,
          warningCount: 0,
          failureCount: 0,
          source: "orchestrator_diff_safety" as const,
        },
        git: { source: "orchestrator_git_snapshot" as const },
        checkpoint: {
          available: true,
          runCount,
          restored: false,
          source: "orchestrator_checkpoint" as const,
        },
        recovery: {
          runCount,
          sessionGeneration: runCount,
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
}

async function replace(
  store: FileAutonomousEngineeringLoopStore,
  before: AutonomousEngineeringLoopStateV1,
  after: AutonomousEngineeringLoopStateV1,
) {
  await store.replaceExact(before.revision, after);
  return after;
}

function progressionResult(
  before: AutonomousEngineeringLoopStateV1,
  after: AutonomousEngineeringLoopStateV1,
  repair: boolean,
): AutonomousEngineeringCompletionReviewProgressionResultV1 {
  const decisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  return {
    schemaVersion: 1,
    loopId: before.loopId,
    startingRevision: before.revision,
    resultingRevision: after.revision,
    resultingPhase: after.phase,
    completionAdmission: {} as any,
    completionApplyReceipt: {} as any,
    ...(repair
      ? {
          reviewDecision: {
            schemaVersion: 1,
            loopId: before.loopId,
            loopRevision: before.revision,
            taskId: supervisor.taskId,
            observedRunCount: before.counters.implementationIterationsStarted,
            completionCapturedAt: "2026-10-07T21:10:00.000Z",
            reviewerResult: {
              schemaVersion: 1,
              supervisorTaskId: supervisor.supervisorTaskId,
              taskId: supervisor.taskId,
              decision: "repair",
              summary: "bounded repair required",
              repairInstruction: "Correct only the bounded defect.",
              completionAuthority: "advisory_only",
            },
            decision: {
              schemaVersion: 1,
              decisionId,
              createdAt: "2026-10-07T21:11:00.000Z",
              supervisorTaskId: supervisor.supervisorTaskId,
              taskId: supervisor.taskId,
              safetyPlanId: supervisor.authority.safetyPlanId,
              safetyProfileId: supervisor.authority.safetyProfileId,
              safetyProfileRevision: supervisor.authority.safetyProfileRevision,
              workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
              kind: "review_repair",
              provenance: "reviewer",
              summary: "bounded repair required",
              repairInstruction: "Correct only the bounded defect.",
            },
            authority: "autonomous_engineering_review_decision_evidence_only",
            queuesRepair: false,
            mutatesLoopState: false,
            grantsTaskAuthority: false,
            grantsFilesystemAuthority: false,
            grantsSafetyPlanAuthority: false,
            grantsWriterLeaseAuthority: false,
            grantsCredentialAuthority: false,
            grantsReleaseAuthority: false,
          },
          reviewAdmission: {
            admissionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            decisionId,
            event: { type: "review_repair", at: "2026-10-07T21:11:00.000Z" },
          } as any,
          reviewApplyReceipt: {
            admissionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            priorRevision: after.revision - 1,
            resultingRevision: after.revision,
          } as any,
        }
      : {}),
    authority: "autonomous_engineering_completion_review_progression_composition",
    directLoopMutation: false,
    legacyRepairHandoff: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function controllerFor(
  store: FileAutonomousEngineeringLoopStore,
  reviewPlan: Array<"repair" | "pass">,
  runCounter: { value: number },
) {
  const completion = {
    capture: async (loop: AutonomousEngineeringLoopStateV1) => packet(loop, runCounter.value),
  };

  const initialLaunch = {
    launch: async (loop: AutonomousEngineeringLoopStateV1) => {
      const next = transitionAutonomousEngineeringLoop(loop, {
        type: "implementation_started",
        at: "2026-10-07T21:01:00.000Z",
      });
      await replace(store, loop, next);
      runCounter.value = 1;
      return {
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        executionRevision: next.revision,
        authority: "autonomous_engineering_initial_cycle_launch_composition",
        acquiresWriterLease: false,
        directLoopMutation: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      } as any;
    },
  };

  const progression = {
    progress: async (loop: AutonomousEngineeringLoopStateV1) => {
      const awaiting = transitionAutonomousEngineeringLoop(loop, {
        type: "completion_evidence_captured",
        at: "2026-10-07T21:10:00.000Z",
      });
      await replace(store, loop, awaiting);

      const decision = reviewPlan.shift() ?? "pass";
      const final = transitionAutonomousEngineeringLoop(awaiting, {
        type: decision === "repair" ? "review_repair" : "review_pass",
        at: decision === "repair" ? "2026-10-07T21:11:00.000Z" : "2026-10-07T21:21:00.000Z",
      });
      await replace(store, awaiting, final);
      return progressionResult(loop, final, decision === "repair");
    },
  };

  const repairLaunch = {
    launch: async (
      loop: AutonomousEngineeringLoopStateV1,
      _supervisor: SupervisorTaskV1,
      progression: AutonomousEngineeringCompletionReviewProgressionResultV1,
    ) => {
      assert.equal(progression.resultingRevision, loop.revision);
      assert.equal(progression.resultingPhase, "repair_ready");
      const next = transitionAutonomousEngineeringLoop(loop, {
        type: "repair_started",
        at: "2026-10-07T21:12:00.000Z",
      });
      await replace(store, loop, next);
      runCounter.value += 1;
      return {
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        executionRevision: next.revision,
        repairDecisionId: progression.reviewDecision!.decision.decisionId,
        authority: "autonomous_engineering_repair_cycle_launch_composition",
        acquiresWriterLease: false,
        directLoopMutation: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      } as any;
    },
  };

  const review = {
    review: async (_supervisor: SupervisorTaskV1, evidence: ReturnType<typeof packet>) => ({
      schemaVersion: 1,
      loopId: evidence.loopId,
      loopRevision: evidence.loopRevision,
      taskId: supervisor.taskId,
      observedRunCount: evidence.observedRunCount,
      completionCapturedAt: evidence.packet.capturedAt,
      reviewerResult: {
        schemaVersion: 1,
        supervisorTaskId: supervisor.supervisorTaskId,
        taskId: supervisor.taskId,
        decision: "pass",
        summary: "pass",
        completionAuthority: "advisory_only",
      },
      decision: {
        schemaVersion: 1,
        decisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        createdAt: "2026-10-07T21:22:00.000Z",
        supervisorTaskId: supervisor.supervisorTaskId,
        taskId: supervisor.taskId,
        safetyPlanId: supervisor.authority.safetyPlanId,
        safetyProfileId: supervisor.authority.safetyProfileId,
        safetyProfileRevision: supervisor.authority.safetyProfileRevision,
        workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
        kind: "review_pass",
        provenance: "reviewer",
        summary: "pass",
      },
      authority: "autonomous_engineering_review_decision_evidence_only",
      queuesRepair: false,
      mutatesLoopState: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    } as any),
  };

  const admission = {
    admit: async (loop: AutonomousEngineeringLoopStateV1, _s: SupervisorTaskV1, event: any) => ({
      schemaVersion: 1,
      admissionId: "12121212-1212-4121-8121-121212121212",
      admittedAt: event.at,
      expiresAt: "2026-10-07T22:00:00.000Z",
      loopId: loop.loopId,
      expectedLoopRevision: loop.revision,
      event,
      taskId: supervisor.taskId,
      observedTaskStatus: "completed",
      observedRunCount: runCounter.value,
      completionCapturedAt: "2026-10-07T21:20:00.000Z",
      decisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
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
    } as any),
  };

  const apply = {
    apply: async (admission: any) => {
      const current = await store.load(admission.loopId);
      assert.equal(current.revision, admission.expectedLoopRevision);
      const next = transitionAutonomousEngineeringLoop(current, admission.event);
      await replace(store, current, next);
      return {
        state: next,
        receipt: {
          schemaVersion: 1,
          admissionId: admission.admissionId,
          loopId: admission.loopId,
          priorRevision: current.revision,
          resultingRevision: next.revision,
          appliedAt: admission.admittedAt,
          authority: "autonomous_loop_transition_apply_state_only",
          mutatesTaskState: false,
          startsWorker: false,
          grantsTaskAuthority: false,
          grantsFilesystemAuthority: false,
          grantsSafetyPlanAuthority: false,
          grantsWriterLeaseAuthority: false,
          grantsCredentialAuthority: false,
          grantsReleaseAuthority: false,
        },
      } as any;
    },
  };

  return new AutonomousEngineeringStepController(
    completion as any,
    progression as any,
    initialLaunch as any,
    repairLaunch as any,
    review as any,
    admission as any,
    apply as any,
  );
}

test("M14P acceptance: restart-safe bounded repair cycle reaches succeeded with no release authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14p-"));
  try {
    const store = new FileAutonomousEngineeringLoopStore(root);
    const created = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T21:00:00.000Z"),
      maxImplementationIterations: 3,
      maxRepairAttempts: 1,
    });
    await store.create(created);
    const runCounter = { value: 0 };
    const reviewPlan: Array<"repair" | "pass"> = ["repair", "pass"];

    let state = await store.load(created.loopId);
    let result = await controllerFor(store, reviewPlan, runCounter).step(
      state,
      supervisor,
      { lease: lease() },
    );
    assert.equal(result.action, "initial_launch");
    assert.equal(result.grantsReleaseAuthority, false);

    // Reconstruct controller/store-facing orchestration after each durable step.
    state = await new FileAutonomousEngineeringLoopStore(root).load(created.loopId);
    result = await controllerFor(
      new FileAutonomousEngineeringLoopStore(root),
      reviewPlan,
      runCounter,
    ).step(state, supervisor);
    assert.equal(result.action, "completion_review_progression");
    assert.equal(result.resultingPhase, "repair_ready");
    const repairProgression = result.progression!;

    state = await new FileAutonomousEngineeringLoopStore(root).load(created.loopId);
    result = await controllerFor(
      new FileAutonomousEngineeringLoopStore(root),
      reviewPlan,
      runCounter,
    ).step(state, supervisor, {
      lease: lease(),
      repairProgression,
    });
    assert.equal(result.action, "repair_launch");

    state = await new FileAutonomousEngineeringLoopStore(root).load(created.loopId);
    result = await controllerFor(
      new FileAutonomousEngineeringLoopStore(root),
      reviewPlan,
      runCounter,
    ).step(state, supervisor);
    assert.equal(result.resultingPhase, "succeeded");
    assert.equal(result.terminal, true);
    assert.equal(result.grantsReleaseAuthority, false);

    const terminal = await new FileAutonomousEngineeringLoopStore(root).load(created.loopId);
    assert.equal(terminal.phase, "succeeded");
    assert.equal(terminal.stopReason, "acceptance_criteria_satisfied");
    assert.equal(terminal.counters.implementationIterationsStarted, 2);
    assert.equal(terminal.counters.repairAttemptsStarted, 1);
    assert.equal(terminal.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14P acceptance: awaiting_review survives restart and resumes only trusted review transition", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14p-review-"));
  try {
    const store = new FileAutonomousEngineeringLoopStore(root);
    let state = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T21:00:00.000Z"),
      maxImplementationIterations: 2,
      maxRepairAttempts: 1,
    });
    await store.create(state);
    state = transitionAutonomousEngineeringLoop(state, {
      type: "implementation_started",
      at: "2026-10-07T21:01:00.000Z",
    });
    await store.replaceExact(1, state);
    const awaiting = transitionAutonomousEngineeringLoop(state, {
      type: "completion_evidence_captured",
      at: "2026-10-07T21:10:00.000Z",
    });
    await store.replaceExact(2, awaiting);

    const runCounter = { value: 1 };
    const reconstructed = new FileAutonomousEngineeringLoopStore(root);
    const loaded = await reconstructed.load(awaiting.loopId);
    const result = await controllerFor(reconstructed, [], runCounter).step(
      loaded,
      supervisor,
    );

    assert.equal(result.action, "awaiting_review_resume");
    assert.equal(result.resultingPhase, "succeeded");
    assert.equal(result.grantsReleaseAuthority, false);
    const final = await reconstructed.load(awaiting.loopId);
    assert.equal(final.phase, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14P acceptance: repair budget exhaustion deterministically stops for human", () => {
  let state = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T21:00:00.000Z"),
    maxImplementationIterations: 1,
    maxRepairAttempts: 0,
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "implementation_started",
    at: "2026-10-07T21:01:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "completion_evidence_captured",
    at: "2026-10-07T21:10:00.000Z",
  });
  state = transitionAutonomousEngineeringLoop(state, {
    type: "review_repair",
    at: "2026-10-07T21:11:00.000Z",
  });

  assert.equal(state.phase, "waiting_for_human");
  assert.equal(state.stopReason, "autonomous_repair_budget_exhausted");
  assert.equal(state.grantsReleaseAuthority, false);
});

test("M14P acceptance: stale supervisor authority is rejected and terminal state is a no-op", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14p-stale-"));
  try {
    const store = new FileAutonomousEngineeringLoopStore(root);
    const created = createAutonomousEngineeringLoop(supervisor, {
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      now: () => new Date("2026-10-07T21:00:00.000Z"),
    });
    await store.create(created);
    const staleSupervisor = structuredClone(supervisor);
    staleSupervisor.authority.safetyProfileRevision += 1;

    await assert.rejects(
      () => controllerFor(store, [], { value: 0 }).step(
        created,
        staleSupervisor,
        { lease: lease() },
      ),
      (error: unknown) =>
        error instanceof AutonomousEngineeringStepControllerError
        && error.code === "input_invalid",
    );

    let terminal = transitionAutonomousEngineeringLoop(created, {
      type: "implementation_started",
      at: "2026-10-07T21:01:00.000Z",
    });
    terminal = transitionAutonomousEngineeringLoop(terminal, {
      type: "terminal_failure",
      at: "2026-10-07T21:02:00.000Z",
      reason: "trusted_terminal_failure",
    });
    const result = await controllerFor(store, [], { value: 1 }).step(
      terminal,
      supervisor,
    );
    assert.equal(result.action, "terminal_noop");
    assert.equal(result.resultingRevision, terminal.revision);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14P acceptance contract still forbids release authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.grantsReleaseAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.performsGitDelivery, false);
  assert.equal(AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT.usesCredentials, false);
});
