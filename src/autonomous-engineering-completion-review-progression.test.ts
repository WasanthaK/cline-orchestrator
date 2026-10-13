import assert from "node:assert/strict";
import test from "node:test";
import type { AutonomousEngineeringCompletionEvidenceV1 } from "./autonomous-engineering-completion-evidence.js";
import {
  AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT,
  AutonomousEngineeringCompletionReviewProgressionError,
  AutonomousEngineeringCompletionReviewProgressionService,
} from "./autonomous-engineering-completion-review-progression.js";
import type {
  AutonomousEngineeringLoopEventV1,
  AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import {
  transitionAutonomousEngineeringLoop,
} from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringLoopTransitionAdmissionV1 } from "./autonomous-engineering-loop-transition-admission.js";
import type { AutonomousEngineeringReviewDecisionV1 } from "./autonomous-engineering-review-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T17:00:00.000Z",
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

const loop: AutonomousEngineeringLoopStateV1 = {
  schemaVersion: 1,
  loopId: "99999999-9999-4999-8999-999999999999",
  createdAt: "2026-10-07T17:00:00.000Z",
  updatedAt: "2026-10-07T17:01:00.000Z",
  revision: 2,
  phase: "implementation_in_progress",
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

function evidence(status: "completed" | "failed" | "validation_failed" = "completed"): AutonomousEngineeringCompletionEvidenceV1 {
  return {
    schemaVersion: 1,
    loopId: loop.loopId,
    loopRevision: loop.revision,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    observedRunCount: 1,
    packet: {
      schemaVersion: 1,
      taskId: supervisor.taskId,
      projectId: supervisor.authority.projectId,
      workspaceId: supervisor.authority.workspaceId,
      capturedAt: "2026-10-07T17:05:00.000Z",
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
        checkpoint: {
          available: true,
          runCount: 1,
          restored: false,
          source: "orchestrator_checkpoint",
        },
        recovery: {
          runCount: 1,
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

function review(kind: "review_pass" | "review_repair" | "review_escalation"): AutonomousEngineeringReviewDecisionV1 {
  const e = evidence();
  return {
    schemaVersion: 1,
    loopId: loop.loopId,
    loopRevision: loop.revision,
    taskId: supervisor.taskId,
    observedRunCount: e.observedRunCount,
    completionCapturedAt: e.packet.capturedAt,
    reviewerResult: {
      schemaVersion: 1,
      supervisorTaskId: supervisor.supervisorTaskId,
      taskId: supervisor.taskId,
      decision: kind === "review_pass" ? "pass" : kind === "review_repair" ? "repair" : "escalate",
      summary: "reviewed",
      ...(kind === "review_repair" ? { repairInstruction: "Correct bounded issue." } : {}),
      ...(kind === "review_escalation" ? { escalationReason: "Human input required." } : {}),
      completionAuthority: "advisory_only",
    },
    decision: {
      schemaVersion: 1,
      decisionId: "77777777-7777-4777-8777-777777777777",
      createdAt: "2026-10-07T17:06:00.000Z",
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
  };
}

class Harness {
  admissions: AutonomousEngineeringLoopTransitionAdmissionV1[] = [];
  states = new Map<number, AutonomousEngineeringLoopStateV1>([[loop.revision, structuredClone(loop)]]);
  reviewerCalls = 0;
  reviewKind: "review_pass" | "review_repair" | "review_escalation" = "review_pass";

  admission = {
    admit: async (
      state: AutonomousEngineeringLoopStateV1,
      _supervisor: SupervisorTaskV1,
      event: AutonomousEngineeringLoopEventV1,
    ): Promise<AutonomousEngineeringLoopTransitionAdmissionV1> => {
      const value: AutonomousEngineeringLoopTransitionAdmissionV1 = {
        schemaVersion: 1,
        admissionId: this.admissions.length === 0
          ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        admittedAt: event.at,
        expiresAt: "2026-10-07T17:20:00.000Z",
        loopId: state.loopId,
        expectedLoopRevision: state.revision,
        event,
        taskId: supervisor.taskId,
        observedTaskStatus: "completed",
        observedRunCount: 1,
        ...(event.type === "completion_evidence_captured" || event.type === "terminal_failure"
          ? { completionCapturedAt: "2026-10-07T17:05:00.000Z" }
          : {}),
        ...(event.type === "review_pass" || event.type === "review_repair" || event.type === "human_escalation"
          ? { completionCapturedAt: "2026-10-07T17:05:00.000Z", decisionId: "77777777-7777-4777-8777-777777777777" }
          : {}),
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
      this.admissions.push(value);
      this.states.set(state.revision, structuredClone(state));
      return value;
    },
  };

  apply = {
    apply: async (admission: AutonomousEngineeringLoopTransitionAdmissionV1) => {
      const state = this.states.get(admission.expectedLoopRevision);
      assert.ok(state);
      const next = transitionAutonomousEngineeringLoop(state, admission.event);
      this.states.set(next.revision, structuredClone(next));
      return {
        state: next,
        receipt: {
          schemaVersion: 1 as const,
          admissionId: admission.admissionId,
          loopId: admission.loopId,
          priorRevision: admission.expectedLoopRevision,
          resultingRevision: next.revision,
          appliedAt: admission.admittedAt,
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
      };
    },
  };

  reviewer = {
    review: async () => {
      this.reviewerCalls += 1;
      return review(this.reviewKind);
    },
  };
}

test("M14L contract composes trusted gates and grants no new authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT.composesTransitionAdmission, true);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT.directLoopMutation, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT.legacyRepairHandoff, false);
  assert.equal(AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT.grantsReleaseAuthority, false);
});

for (const [kind, phase] of [
  ["review_pass", "succeeded"],
  ["review_repair", "repair_ready"],
  ["review_escalation", "waiting_for_human"],
] as const) {
  test(`M14L composes completed evidence through ${kind} to ${phase}`, async () => {
    const harness = new Harness();
    harness.reviewKind = kind;
    const result = await new AutonomousEngineeringCompletionReviewProgressionService(
      harness.admission,
      harness.apply,
      harness.reviewer,
    ).progress(loop, supervisor, evidence());

    assert.equal(harness.reviewerCalls, 1);
    assert.equal(harness.admissions.length, 2);
    assert.equal(harness.admissions[0].event.type, "completion_evidence_captured");
    assert.equal(result.resultingPhase, phase);
    assert.equal(result.resultingRevision, 4);
    assert.equal(result.directLoopMutation, false);
    assert.equal(result.legacyRepairHandoff, false);
    assert.equal(result.grantsReleaseAuthority, false);
  });
}

test("M14L routes durable runtime failure directly to failed without reviewer", async () => {
  const harness = new Harness();
  const result = await new AutonomousEngineeringCompletionReviewProgressionService(
    harness.admission,
    harness.apply,
    harness.reviewer,
  ).progress(loop, supervisor, evidence("validation_failed"));

  assert.equal(harness.reviewerCalls, 0);
  assert.equal(harness.admissions.length, 1);
  assert.equal(harness.admissions[0].event.type, "terminal_failure");
  assert.equal(result.resultingPhase, "failed");
  assert.equal(result.resultingRevision, 3);
  assert.equal(result.reviewDecision, undefined);
});

test("M14L rejects stale M14J loop revision before any gate call", async () => {
  const harness = new Harness();
  const stale = evidence();
  stale.loopRevision += 1;

  await assert.rejects(
    () => new AutonomousEngineeringCompletionReviewProgressionService(
      harness.admission,
      harness.apply,
      harness.reviewer,
    ).progress(loop, supervisor, stale),
    (error: unknown) =>
      error instanceof AutonomousEngineeringCompletionReviewProgressionError
      && error.code === "evidence_invalid",
  );
  assert.equal(harness.admissions.length, 0);
  assert.equal(harness.reviewerCalls, 0);
});
