import assert from "node:assert/strict";
import test from "node:test";
import { createTaskCompletionPacket } from "./task-completion-packet.js";
import { buildTaskReviewProjection } from "./task-review-projection.js";
import { renderTaskReviewHtml } from "./task-review-html.js";
import type { OrchestratorTask } from "./types.js";

function view(status: OrchestratorTask["status"] = "completed") {
  const task: OrchestratorTask = {
    id: "task-1", workspace: "/private/location", goal: "PRIVATE_GOAL",
    status, createdAt: "2026-10-12T01:00:00.000Z", updatedAt: "2026-10-12T02:00:00.000Z",
    lastOutput: "SECRET_WORKER_REPORT <img src=x onerror=alert(1)>",
    lastValidation: {
      startedAt: "2026-10-12T01:10:00.000Z",
      completedAt: "2026-10-12T01:11:00.000Z", durationMs: 60000,
      passed: false, commandsRequested: 2, commandsRun: 2, results: [],
    },
    lastDiffSafety: {
      checkedAt: "2026-10-12T01:12:00.000Z", passed: true,
      checkpointCreatedAt: "2026-10-12T01:05:00.000Z", finalDiffSummary: "PRIVATE_DIFF_TEXT",
      summary: { changedFiles: 2, trackedFiles: 2, untrackedFiles: 0, trackedAdditions: 2, trackedDeletions: 0 },
      changedPaths: [], warnings: [], failures: [],
    },
  };
  return buildTaskReviewProjection(createTaskCompletionPacket(task,
    { taskId: task.id, projectId: "project-1", workspaceId: "workspace-1" },
    { workspaceRoot: "/private/location" }));
}

test("UX-D2 never represents completed worker claims as independent approval", () => {
  const html = renderTaskReviewHtml(view());
  assert.match(html, /Inspection required — not approved/);
  assert.match(html, /Failed — independently checked/);
  assert.match(html, /Passed — independently checked/);
  assert.match(html, /Independent evidence is not a supervisor decision/);
  assert.match(html, /untrusted worker testimony and is not shown/);
  assert.doesNotMatch(html, /SECRET_WORKER_REPORT|PRIVATE_DIFF_TEXT|PRIVATE_GOAL|private\/location|onerror=alert/);
});

test("UX-D2 remains passive with strictly local skip link and restrictive CSP", () => {
  const html = renderTaskReviewHtml(view());
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /<main id="task-review-main" tabindex="-1">/);
  assert.match(html, /href="#task-review-main"/);
  for (const forbidden of [
    "<script", "<form", "<button", "<input", "<select", "<textarea", "<iframe",
    "onclick=", "onload=", "fetch(", "websocket", "vscode.postmessage", "command:", "http://", "https://",
  ]) assert.equal(html.toLowerCase().includes(forbidden), false, forbidden);
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(anchors, ["#task-review-main"]);
});

test("UX-D2 reports unavailable evidence as unknown rather than success", () => {
  const projected = view();
  const partial = {
    ...projected, evidence: {
      ...projected.evidence,
      validation: { source: "orchestrator_validation" as const, state: "unavailable" as const },
      diffSafety: { source: "orchestrator_diff_safety" as const, state: "unavailable" as const },
    },
  };
  const html = renderTaskReviewHtml(partial);
  assert.match(html, /Unavailable — not verified/);
  assert.match(html, /Missing evidence is not success/);
  assert.doesNotMatch(html, /Passed — independently checked/);
});

test("UX-D2 task and review states are distinct", () => {
  assert.match(renderTaskReviewHtml(view("running")), /Task is still in progress/);
  assert.match(renderTaskReviewHtml(view("aborted")), /Task closed without completion review/);
});

test("UX-D2 rejects forged authority, actions, contradictory state and invalid provenance", () => {
  const input = view();
  const overrides: unknown[] = [
    { ...input, grantsAuthority: true },
    { ...input, actions: [{ action: "approve" }] },
    { ...input, disposition: "approved" },
    { ...input, taskStatus: "unknown" },
    { ...input, workerTestimony: { ...input.workerTestimony, reportExposed: true } },
    { ...input, evidence: { ...input.evidence, validation: { ...input.evidence.validation, source: "worker" } } },
    { ...input, evidence: { ...input.evidence, diffSafety: { ...input.evidence.diffSafety, state: "passed", failures: 5 } } },
    { ...input, evidence: { ...input.evidence, recovery: { ...input.evidence.recovery, runs: -1 } } },
  ];
  for (const bad of overrides) assert.throws(() => renderTaskReviewHtml(bad as typeof input));
});

test("UX-D2 escapes all rendered task identifiers", () => {
  const input = view();
  const forged = { ...input, taskId: "<script>alert(1)</script>" };
  assert.throws(() => renderTaskReviewHtml(forged));
  assert.equal(renderTaskReviewHtml(input), renderTaskReviewHtml(input));
});
