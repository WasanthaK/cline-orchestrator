import assert from "node:assert/strict";
import test from "node:test";
import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { AutonomousEngineeringCompletionEvidenceV1 } from "./autonomous-engineering-completion-evidence.js";
import {
  AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT,
  AutonomousEngineeringReviewDecisionError,
  AutonomousEngineeringReviewDecisionService,
} from "./autonomous-engineering-review-decision.js";
import type { SupervisorDecisionV1 } from "./supervisor-decision.js";
import type { SupervisorReviewerModel } from "./supervisor-reviewer.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { OrchestratorTask } from "./types.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T16:00:00.000Z",
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

function task(runCount = 2): OrchestratorTask {
  return {
    id: supervisor.taskId,
    goal: supervisor.objective,
    workspace: "/redacted",
    status: "completed",
    createdAt: "2026-10-07T16:00:00.000Z",
    updatedAt: "2026-10-07T16:05:00.000Z",
    acceptanceCriteria: [...supervisor.acceptanceCriteria],
    validationCommands: [...supervisor.trustedValidationCommands],
    runCount,
    sessionGeneration: 1,
    validationRepairCount: 0,
    finishReason: "completed",
    lastRunCheckpoint: {
      createdAt: "2026-10-07T16:02:00.000Z",
      available: true,
      taskId: supervisor.taskId,
      runCount,
    },
    lastValidation: {
      startedAt: "2026-10-07T16:04:00.000Z",
      completedAt: "2026-10-07T16:04:30.000Z",
      durationMs: 30000,
      passed: true,
      commandsRequested: 1,
      commandsRun: 1,
      results: [],
    },
    lastDiffSafety: {
      checkedAt: "2026-10-07T16:04:40.000Z",
      passed: true,
      finalDiffSummary: "1 file changed",
      summary: {
        changedFiles: 1,
        trackedFiles: 1,
        untrackedFiles: 0,
        trackedAdditions: 1,
        trackedDeletions: 0,
      },
      changedPaths: [],
      warnings: [],
      failures: [],
    },
  };
}

function evidence(runCount = 2): AutonomousEngineeringCompletionEvidenceV1 {
  return {
    schemaVersion: 1,
    loopId: "99999999-9999-4999-8999-999999999999",
    loopRevision: 3,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    observedRunCount: runCount,
    packet: {
      schemaVersion: 1,
      taskId: supervisor.taskId,
      projectId: supervisor.authority.projectId,
      workspaceId: supervisor.authority.workspaceId,
      capturedAt: "2026-10-07T16:05:00.000Z",
      status: "completed",
      reviewState: "ready_for_supervisor_review",
      completionSignal: { terminal: true, finishReason: "completed", workerReportAvailable: false },
      independentEvidence: {
        validation: {
          available: true,
          passed: true,
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
        checkpoint: {
          available: true,
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
    },
    authority: "autonomous_engineering_completion_evidence_only",
    invokesReviewer: false,
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

function decision(kind: "review_pass" | "review_repair" | "review_escalation"): SupervisorDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-10-07T16:06:00.000Z",
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    kind,
    provenance: "reviewer",
    summary: "reviewed",
    ...(kind === "review_repair" ? { repairInstruction: "Correct bounded issue." } : {}),
    ...(kind === "review_escalation" ? { escalationReason: "Human input required." } : {}),
  };
}

const fakeMachine = {} as MachineOrchestratorService;

test("M14K contract emits decision evidence only and never queues repair", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT.queuesRepair, false);
  assert.equal(AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT.mutatesLoopState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT.grantsReleaseAuthority, false);
});

for (const [modelDecision, decisionKind] of [
  ["pass", "review_pass"],
  ["repair", "review_repair"],
  ["escalate", "review_escalation"],
] as const) {
  test(`M14K admits trusted ${modelDecision} reviewer result without handoff`, async () => {
    const model: SupervisorReviewerModel = {
      async review() {
        return {
          schemaVersion: 1,
          supervisorTaskId: supervisor.supervisorTaskId,
          taskId: supervisor.taskId,
          decision: modelDecision,
          summary: "reviewed",
          ...(modelDecision === "repair" ? { repairInstruction: "Correct bounded issue." } : {}),
          ...(modelDecision === "escalate" ? { escalationReason: "Human input required." } : {}),
          completionAuthority: "advisory_only",
        };
      },
    };

    let admitted = false;
    const result = await new AutonomousEngineeringReviewDecisionService(
      fakeMachine,
      model,
      async () => ({ workspaceRoot: "/redacted", task: task() }),
      async (_root, _supervisor, reviewerResult) => {
        admitted = true;
        assert.equal(reviewerResult.decision, modelDecision);
        return decision(decisionKind);
      },
    ).review(supervisor, evidence());

    assert.equal(admitted, true);
    assert.equal(result.decision.kind, decisionKind);
    assert.equal(result.queuesRepair, false);
    assert.equal(result.mutatesLoopState, false);
    assert.equal(result.grantsReleaseAuthority, false);
  });
}

test("M14K fails closed if durable run advances after M14J capture", async () => {
  const model: SupervisorReviewerModel = {
    async review() {
      throw new Error("reviewer must not run");
    },
  };
  let reviewerCalled = false;
  const guardedModel: SupervisorReviewerModel = {
    async review(request) {
      reviewerCalled = true;
      return await model.review(request);
    },
  };

  await assert.rejects(
    () => new AutonomousEngineeringReviewDecisionService(
      fakeMachine,
      guardedModel,
      async () => ({ workspaceRoot: "/redacted", task: task(3) }),
      async () => decision("review_pass"),
    ).review(supervisor, evidence(2)),
    (error: unknown) =>
      error instanceof AutonomousEngineeringReviewDecisionError
      && error.code === "task_stale",
  );
  assert.equal(reviewerCalled, false);
});

test("M14K rejects cross-bound M14J evidence before reviewer invocation", async () => {
  const bad = evidence();
  bad.packet.workspaceId = "88888888-8888-4888-8888-888888888888";
  let called = false;
  await assert.rejects(
    () => new AutonomousEngineeringReviewDecisionService(
      fakeMachine,
      { async review() { called = true; return {}; } },
      async () => ({ workspaceRoot: "/redacted", task: task() }),
      async () => decision("review_pass"),
    ).review(supervisor, bad),
    (error: unknown) =>
      error instanceof AutonomousEngineeringReviewDecisionError
      && error.code === "evidence_invalid",
  );
  assert.equal(called, false);
});
