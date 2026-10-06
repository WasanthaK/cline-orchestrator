import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_COMPLETION_REPORT_MAX_CHARS,
  createTaskCompletionPacket,
} from "./task-completion-packet.js";
import type { OrchestratorTask } from "./types.js";

const identity = {
  taskId: "task-1",
  projectId: "project-1",
  workspaceId: "workspace-1",
};

function baseTask(status: OrchestratorTask["status"] = "completed"): OrchestratorTask {
  return {
    id: identity.taskId,
    goal: "Implement the bounded change.",
    workspace: "C:\\Users\\User\\Quotes",
    status,
    createdAt: "2026-09-28T01:00:00.000Z",
    updatedAt: "2026-09-28T01:05:00.000Z",
    finishReason: status === "completed" ? "completed" : undefined,
  };
}

test("completion packet labels Cline narrative as untrusted and keeps independent evidence separate", () => {
  const task = baseTask();
  task.lastOutput = [
    "The task is complete.",
    "All tests pass.",
    "The diff is safe.",
    "Branch sprint-103-6-inspection-ui is ready.",
  ].join("\n");
  task.lastValidation = {
    startedAt: "2026-09-28T01:03:00.000Z",
    completedAt: "2026-09-28T01:04:00.000Z",
    durationMs: 60_000,
    passed: false,
    commandsRequested: 2,
    commandsRun: 2,
    results: [],
  };
  task.lastDiffSafety = {
    checkedAt: "2026-09-28T01:04:30.000Z",
    passed: true,
    checkpointCreatedAt: "2026-09-28T01:00:30.000Z",
    finalDiffSummary: "3 files changed",
    summary: {
      changedFiles: 3,
      trackedFiles: 3,
      untrackedFiles: 0,
      trackedAdditions: 30,
      trackedDeletions: 2,
    },
    changedPaths: [],
    warnings: [{ code: "deployment_sensitive_path", message: "review warning" }],
    failures: [],
  };
  task.lastRunGit = {
    before: {
      capturedAt: "2026-09-28T01:00:30.000Z",
      available: true,
      branch: "sprint-103-6-inspection-ui",
      head: "aaaaaaaa",
      dirty: false,
      changedFiles: 0,
      statusLines: ["M SECRET_FILE_SHOULD_NOT_ESCAPE"],
    },
    after: {
      capturedAt: "2026-09-28T01:04:45.000Z",
      available: true,
      branch: "sprint-103-6-inspection-ui",
      head: "bbbbbbbb",
      dirty: true,
      changedFiles: 3,
      statusLines: ["M PRIVATE_DETAIL_SHOULD_NOT_ESCAPE"],
    },
  };
  task.lastRunCheckpoint = {
    createdAt: "2026-09-28T01:00:30.000Z",
    available: true,
    taskId: task.id,
    runCount: 1,
  };
  task.runCount = 2;
  task.sessionGeneration = 3;
  task.recoveryCount = 1;
  task.contextRotationCount = 2;
  task.contextHandoffCount = 2;
  task.retryCount = 1;
  task.stallCount = 1;

  const packet = createTaskCompletionPacket(task, identity, {
    workspaceRoot: task.workspace,
  });

  assert.equal(packet.reviewState, "ready_for_supervisor_review");
  assert.equal(packet.completionSignal.terminal, true);
  assert.equal(packet.workerCompletion?.trust, "untrusted_worker_claims");
  assert.match(packet.workerCompletion?.report ?? "", /All tests pass/);

  // Worker claims do not overwrite independently captured evidence.
  assert.equal(packet.independentEvidence.validation.available, true);
  assert.equal(packet.independentEvidence.validation.passed, false);
  assert.equal(packet.independentEvidence.diffSafety.passed, true);
  assert.equal(packet.independentEvidence.diffSafety.changedFiles, 3);
  assert.equal(packet.independentEvidence.diffSafety.warningCount, 1);
  assert.equal(packet.independentEvidence.git.before?.head, "aaaaaaaa");
  assert.equal(packet.independentEvidence.git.after?.head, "bbbbbbbb");
  assert.equal(packet.independentEvidence.checkpoint.available, true);
  assert.deepEqual(packet.independentEvidence.recovery, {
    runCount: 2,
    sessionGeneration: 3,
    recoveryCount: 1,
    contextRotationCount: 2,
    contextHandoffCount: 2,
    retryCount: 1,
    stallCount: 1,
    source: "orchestrator_runtime_state",
  });

  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /SECRET_FILE_SHOULD_NOT_ESCAPE/);
  assert.doesNotMatch(serialized, /PRIVATE_DETAIL_SHOULD_NOT_ESCAPE/);
});

test("completion packet redacts local workspace, session ids and obvious secret material", () => {
  const task = baseTask();
  task.clineSessionId = "cline-session-sensitive-123";
  task.lastRecoveredFromSessionId = "cline-session-old-456";
  task.lastOutput = [
    "Worked in C:\\Users\\User\\Quotes and C:/Users/User/Quotes.",
    "session cline-session-sensitive-123 recovered from cline-session-old-456",
    "Bearer abc.def-123",
    "api_key=super-secret-value",
    "password:do-not-expose",
  ].join("\n");

  const packet = createTaskCompletionPacket(task, identity, {
    workspaceRoot: "C:\\Users\\User\\Quotes",
  });
  const report = packet.workerCompletion?.report ?? "";

  assert.match(report, /\[REDACTED\]/);
  assert.doesNotMatch(report, /C:\\Users\\User\\Quotes/i);
  assert.doesNotMatch(report, /C:\/Users\/User\/Quotes/i);
  assert.doesNotMatch(report, /cline-session-sensitive-123/i);
  assert.doesNotMatch(report, /cline-session-old-456/i);
  assert.doesNotMatch(report, /abc\.def-123/i);
  assert.doesNotMatch(report, /super-secret-value/i);
  assert.doesNotMatch(report, /do-not-expose/i);
});

test("completion packet bounds model-facing Cline report while retaining local provenance", () => {
  const task = baseTask();
  task.lastOutput = "R".repeat(TASK_COMPLETION_REPORT_MAX_CHARS + 500);

  const packet = createTaskCompletionPacket(task, identity);

  assert.equal(packet.workerCompletion?.report.length, TASK_COMPLETION_REPORT_MAX_CHARS);
  assert.equal(packet.workerCompletion?.truncated, true);
  assert.equal(packet.workerCompletion?.rawReportPreservedLocally, true);
});

test("completion packet review state distinguishes active work from reviewable and closed tasks", () => {
  const active = createTaskCompletionPacket(baseTask("running"), identity);
  assert.equal(active.reviewState, "worker_in_progress");
  assert.equal(active.completionSignal.terminal, false);

  const failed = baseTask("validation_failed");
  failed.finishReason = "validation_failed";
  const reviewable = createTaskCompletionPacket(failed, identity);
  assert.equal(reviewable.reviewState, "ready_for_supervisor_review");

  const aborted = baseTask("aborted");
  aborted.finishReason = "aborted";
  const closed = createTaskCompletionPacket(aborted, identity);
  assert.equal(closed.reviewState, "closed_without_completion_review");
});

test("completion packet rejects a mismatched task identity", () => {
  assert.throws(
    () => createTaskCompletionPacket(baseTask(), { ...identity, taskId: "other-task" }),
    /identity does not match task id/,
  );
});
