import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupervisorReviewerEvidence,
  renderSupervisorReviewerPrompt,
  runSupervisorReviewer,
  SUPERVISOR_REVIEWER_LIMITS,
  SupervisorReviewerError,
  validateSupervisorReviewerResult,
} from "./supervisor-reviewer.js";
import { createSupervisorTask } from "./supervisor-task.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  supervisor: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan: "55555555-5555-4555-8555-555555555555",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function durableTask(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "Review a bounded implementation without widening authority.",
    workspace: "/private/workspace/root-that-must-not-leak",
    status: "completed",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:10:00.000Z",
    acceptanceCriteria: ["The bounded change is correct."],
    validationCommands: ["npm test"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 3,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v3",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*", ".git/**"],
    workerProfileId: "pilot-safe",
    clineSessionId: "hub-session-secret",
    lastPrompt: "raw prompt must not leak",
    lastOutput: "worker output must not leak",
    runCount: 2,
    sessionGeneration: 2,
    recoveryCount: 1,
    validationRepairCount: 0,
    lastValidation: {
      startedAt: "2026-09-25T00:08:00.000Z",
      completedAt: "2026-09-25T00:08:02.000Z",
      durationMs: 2000,
      passed: true,
      commandsRequested: 1,
      commandsRun: 1,
      results: [{
        command: "npm test",
        startedAt: "2026-09-25T00:08:00.000Z",
        completedAt: "2026-09-25T00:08:02.000Z",
        durationMs: 2000,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        stdout: "SECRET_STDOUT_SHOULD_NOT_LEAK",
        stderr: "SECRET_STDERR_SHOULD_NOT_LEAK",
      }],
    },
    lastDiffSafety: {
      checkedAt: "2026-09-25T00:09:00.000Z",
      passed: true,
      checkpointCreatedAt: "2026-09-25T00:01:00.000Z",
      finalDiffSummary: "1 changed file inside approved scope",
      summary: {
        changedFiles: 1,
        trackedFiles: 1,
        untrackedFiles: 0,
        trackedAdditions: 2,
        trackedDeletions: 1,
      },
      changedPaths: [{ path: "src/demo.ts", status: "modified", source: "tracked" }],
      warnings: [],
      failures: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-25T00:01:00.000Z",
      available: true,
      taskId: IDS.task,
      runCount: 1,
      root: "/private/workspace/root-that-must-not-leak",
      privateRef: "refs/orchestrator/checkpoints/private",
      backupDir: "/private/workspace/.orchestrator/checkpoints/private",
    },
    ...overrides,
  } as OrchestratorTask;
}

function supervisorTask(task = durableTask()) {
  return createSupervisorTask(task, {
    idFactory: () => IDS.supervisor,
    now: () => new Date("2026-09-25T00:05:00.000Z"),
  });
}

test("reviewer evidence contains sanitized durable evidence and omits raw runtime/output details", () => {
  const task = durableTask();
  const evidence = createSupervisorReviewerEvidence(supervisorTask(task), task);

  assert.equal(evidence.validation.required, true);
  assert.equal(evidence.validation.passed, true);
  assert.equal(evidence.diffSafety.passed, true);
  assert.equal(evidence.diffSafety.changedFiles, 1);
  assert.equal(evidence.checkpoint.available, true);
  assert.equal(evidence.taskState.sessionGeneration, 2);

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("/private/workspace"), false);
  assert.equal(serialized.includes("hub-session-secret"), false);
  assert.equal(serialized.includes("raw prompt must not leak"), false);
  assert.equal(serialized.includes("worker output must not leak"), false);
  assert.equal(serialized.includes("SECRET_STDOUT_SHOULD_NOT_LEAK"), false);
  assert.equal(serialized.includes("SECRET_STDERR_SHOULD_NOT_LEAK"), false);
  assert.equal(serialized.includes("refs/orchestrator/checkpoints/private"), false);
});

test("reviewer prompt is bounded and states that pass is advisory only", () => {
  const task = durableTask();
  const prompt = renderSupervisorReviewerPrompt(
    createSupervisorReviewerEvidence(supervisorTask(task), task),
  );

  assert.ok(prompt.includes("Pass is advisory only"));
  assert.ok(prompt.includes("existing approved write scope"));
  assert.ok(prompt.includes("Use only the sanitized durable evidence"));
  assert.ok(prompt.includes("diffSafetyPassed: true"));
  assert.equal(prompt.includes("SECRET_STDOUT_SHOULD_NOT_LEAK"), false);
  assert.ok(prompt.length <= SUPERVISOR_REVIEWER_LIMITS.maxPromptChars);
});

test("reviewer may recommend pass only when required durable evidence passes", () => {
  const task = durableTask();
  const evidence = createSupervisorReviewerEvidence(supervisorTask(task), task);
  const result = validateSupervisorReviewerResult(evidence, {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    decision: "pass",
    summary: "Configured validation and diff safety passed.",
    completionAuthority: "advisory_only",
  });

  assert.equal(result.decision, "pass");
  assert.equal(result.completionAuthority, "advisory_only");

  for (const badTask of [
    durableTask({ lastValidation: { ...task.lastValidation!, passed: false } }),
    durableTask({ lastDiffSafety: { ...task.lastDiffSafety!, passed: false } }),
    durableTask({ lastDiffSafety: undefined }),
    durableTask({ pendingEscalation: {
      escalationId: "77777777-7777-4777-8777-777777777777",
      taskId: IDS.task,
      requestedAt: "2026-09-25T00:09:30.000Z",
      reason: "scope expansion",
      actionKind: "edit",
      actionFingerprint: "fingerprint",
      status: "pending",
      reversible: true,
    } }),
  ]) {
    const badEvidence = createSupervisorReviewerEvidence(supervisorTask(badTask), badTask);
    assert.throws(
      () => validateSupervisorReviewerResult(badEvidence, {
        schemaVersion: 1,
        supervisorTaskId: IDS.supervisor,
        taskId: IDS.task,
        decision: "pass",
        summary: "pass",
        completionAuthority: "advisory_only",
      }),
      (error: unknown) =>
        error instanceof SupervisorReviewerError && error.code === "evidence_insufficient",
    );
  }
});

test("reviewer repair and escalation results are bounded and mutually exclusive", () => {
  const task = durableTask();
  const evidence = createSupervisorReviewerEvidence(supervisorTask(task), task);

  const repair = validateSupervisorReviewerResult(evidence, {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    decision: "repair",
    summary: "One bounded correction is required.",
    repairInstruction: "Adjust the implementation inside the existing approved scope, then rerun external validation.",
    completionAuthority: "advisory_only",
  });
  assert.equal(repair.decision, "repair");
  assert.ok(repair.repairInstruction);

  const escalate = validateSupervisorReviewerResult(evidence, {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    decision: "escalate",
    summary: "Human judgment is required.",
    escalationReason: "The requested behavior appears to require authority outside the current envelope.",
    completionAuthority: "advisory_only",
  });
  assert.equal(escalate.decision, "escalate");
  assert.ok(escalate.escalationReason);

  assert.throws(
    () => validateSupervisorReviewerResult(evidence, {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      decision: "repair",
      summary: "invalid",
      repairInstruction: "repair",
      escalationReason: "also escalate",
      completionAuthority: "advisory_only",
    }),
    (error: unknown) =>
      error instanceof SupervisorReviewerError && error.code === "result_invalid",
  );
});

test("reviewer rejects authority-bearing fields, cross-task output, and self-completion authority", () => {
  const task = durableTask();
  const evidence = createSupervisorReviewerEvidence(supervisorTask(task), task);

  for (const [field, value] of [
    ["allowedPathPatterns", ["../outside/**"]],
    ["validationCommands", ["rm -rf /"]],
    ["modelShellAllowed", true],
    ["workerProfileId", "unsafe"],
    ["completed", true],
  ] as const) {
    assert.throws(
      () => validateSupervisorReviewerResult(evidence, {
        schemaVersion: 1,
        supervisorTaskId: IDS.supervisor,
        taskId: IDS.task,
        decision: "repair",
        summary: "invalid",
        repairInstruction: "bounded repair",
        completionAuthority: "advisory_only",
        [field]: value,
      }),
      (error: unknown) =>
        error instanceof SupervisorReviewerError && error.code === "result_invalid",
      field,
    );
  }

  assert.throws(
    () => validateSupervisorReviewerResult(evidence, {
      schemaVersion: 1,
      supervisorTaskId: "77777777-7777-4777-8777-777777777777",
      taskId: IDS.task,
      decision: "pass",
      summary: "invalid",
      completionAuthority: "advisory_only",
    }),
    (error: unknown) =>
      error instanceof SupervisorReviewerError && error.code === "task_mismatch",
  );

  assert.throws(
    () => validateSupervisorReviewerResult(evidence, {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      decision: "pass",
      summary: "invalid",
      completionAuthority: "authoritative",
    }),
    (error: unknown) =>
      error instanceof SupervisorReviewerError && error.code === "result_invalid",
  );
});

test("reviewer execution seam validates model output and fails closed on provider failure", async () => {
  const task = durableTask();
  const evidence = createSupervisorReviewerEvidence(supervisorTask(task), task);
  let requestSeen: unknown;

  const result = await runSupervisorReviewer(evidence, {
    async review(request) {
      requestSeen = request;
      return {
        schemaVersion: 1,
        supervisorTaskId: request.supervisorTaskId,
        taskId: request.taskId,
        decision: "pass",
        summary: "Evidence passes.",
        completionAuthority: "advisory_only",
      };
    },
  });
  assert.equal(result.decision, "pass");
  const serialized = JSON.stringify(requestSeen);
  assert.equal(serialized.includes("/private/workspace"), false);
  assert.equal(serialized.includes("SECRET_STDOUT_SHOULD_NOT_LEAK"), false);

  await assert.rejects(
    runSupervisorReviewer(evidence, {
      async review() {
        throw new Error("provider unavailable");
      },
    }),
    (error: unknown) =>
      error instanceof SupervisorReviewerError && error.code === "reviewer_failed",
  );
});
