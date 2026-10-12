import assert from "node:assert/strict";
import test from "node:test";
import { createTaskCompletionPacket } from "./task-completion-packet.js";
import { buildTaskReviewProjection } from "./task-review-projection.js";
import type { OrchestratorTask } from "./types.js";

function packet(status: OrchestratorTask["status"] = "completed") {
  const task: OrchestratorTask = {
    id: "task-1", workspace: "/private/workspace", goal: "sensitive objective",
    status, createdAt: "2026-10-12T01:00:00.000Z", updatedAt: "2026-10-12T02:00:00.000Z",
    lastOutput: "PRIVATE_WORKER_TESTIMONY Bearer very-private-token",
    lastValidation: { startedAt: "2026-10-12T01:20:00.000Z",
      completedAt: "2026-10-12T01:21:00.000Z", durationMs: 60_000,
      passed: false, commandsRequested: 1, commandsRun: 1, results: [] },
    lastDiffSafety: {
      checkedAt: "2026-10-12T01:21:10.000Z", passed: true,
      checkpointCreatedAt: "2026-10-12T01:05:00.000Z",
      finalDiffSummary: "SECRET_DIFF_PATH",
      summary: { changedFiles: 2, trackedFiles: 2, untrackedFiles: 0, trackedAdditions: 2, trackedDeletions: 0 },
      changedPaths: [], warnings: [], failures: [],
    },
  };
  return createTaskCompletionPacket(task,
    { taskId: task.id, projectId: "project-1", workspaceId: "workspace-1" },
    { workspaceRoot: "/private/workspace" });
}

test("UX-D1 uses independent validation and diff evidence, never worker success claims", () => {
  const output = buildTaskReviewProjection(packet());
  assert.equal(output.readOnly, true);
  assert.deepEqual(output.actions, []);
  assert.equal(output.grantsAuthority, false);
  assert.equal(output.disposition, "inspection_required");
  assert.equal(output.evidence.validation.state, "failed");
  assert.equal(output.evidence.diffSafety.state, "passed");
  assert.equal(output.workerTestimony.available, true);
  assert.equal(output.workerTestimony.reportExposed, false);
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /PRIVATE_WORKER_TESTIMONY|SECRET_DIFF_PATH|very-private-token|private\/workspace|finishReason|branch|head|report":/);
});

test("UX-D1 active, aborted and evidence-unavailable states are distinguished", () => {
  assert.equal(buildTaskReviewProjection(packet("running")).disposition, "in_progress");
  assert.equal(buildTaskReviewProjection(packet("aborted")).disposition, "closed_without_completion_review");
  const missing = packet();
  missing.independentEvidence.validation = { available: false, source: "orchestrator_validation" };
  missing.independentEvidence.diffSafety = { available: false, source: "orchestrator_diff_safety" };
  const output = buildTaskReviewProjection(missing);
  assert.equal(output.evidence.validation.state, "unavailable");
  assert.equal(output.evidence.diffSafety.state, "unavailable");
  assert.equal(output.disposition, "inspection_required");
});

test("UX-D1 rejects forged source, inconsistent terminal and contradictory independent evidence", () => {
  const badSource = packet();
  badSource.independentEvidence.validation.source = "untrusted" as never;
  assert.throws(() => buildTaskReviewProjection(badSource));
  const badTerminal = packet();
  badTerminal.completionSignal.terminal = false;
  assert.throws(() => buildTaskReviewProjection(badTerminal));
  const missingState = packet();
  missingState.independentEvidence.validation.available = false;
  assert.throws(() => buildTaskReviewProjection(missingState));
  const falsePass = packet();
  falsePass.independentEvidence.diffSafety.failureCount = 2;
  assert.throws(() => buildTaskReviewProjection(falsePass));
  const falseRunCount = packet();
  falseRunCount.independentEvidence.recovery.runCount = -1;
  assert.throws(() => buildTaskReviewProjection(falseRunCount));
});
