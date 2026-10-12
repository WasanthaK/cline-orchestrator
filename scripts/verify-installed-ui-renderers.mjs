import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

/**
 * E1 acceptance executes *installed* built JavaScript in a disposable
 * consumer child process, not the repository source/tsx tests.
 * No HTTP listener, service installation, workspace, browser or secrets.
 */
const modulePath = process.argv[2];
assert.ok(typeof modulePath === "string" && path.isAbsolute(modulePath),
  "An absolute installed package path is required");
const load = async (file) =>
  import(pathToFileURL(path.join(modulePath, "dist", file)).href);

const { renderOperatorVisualizationHtml } = await load("operator-visualization-html.js");
const { renderGuidedSetupHtml } = await load("first-run-guided-html.js");
const { renderTaskReviewHtml } = await load("task-review-html.js");

const stamp = "2026-10-12T07:00:00.000Z";
const SENTINEL = "M18E_PRIVATE_WORKER_CANARY_DO_NOT_RENDER";
const operator = renderOperatorVisualizationHtml({
  schemaVersion: 1, generatedAt: stamp, readOnly: true, actions: [],
  header: {
    health: "unknown", activeTasks: 0, activeWorkflows: 0, openIncidents: 0,
    waitingForHuman: 0, activeWriters: 0, staleSources: 1, unavailableSources: 1,
  },
  sourceNotices: [{ source: "tasks", available: false, stale: true, truncated: false }],
  attention: [], taskBoard: [], workflows: [], incidents: [],
  specialistTimeline: [], activeWriters: [],
  truncation: { handoffs: false, writers: false, attention: false, sourceNotices: false },
  rawWorkerOutput: SENTINEL,
});
const setup = renderGuidedSetupHtml({
  schemaVersion: 1, assessedAt: stamp, status: "needs_setup",
  readOnly: true, actions: [], grantsAuthority: false,
  gates: [
    { id: "runtime", title: "Runtime", state: "ready", detail: "Runtime compatible" },
    { id: "provider", title: "Provider", state: "needs_attention", detail: "Preflight needed" },
    { id: "workspace", title: "Workspace", state: "needs_attention", detail: "Registration needed" },
    { id: "local_daemon", title: "Local daemon", state: "not_assessed", detail: "No startup performed" },
    { id: "production", title: "Production", state: "not_assessed", detail: "No release approval" },
  ],
  steps: [{ code: "configure_provider", title: "Configure provider",
    description: "Explicit local confirmation required", required: true }],
  rawCredential: SENTINEL,
});
const review = renderTaskReviewHtml({
  schemaVersion: 1, authority: "trusted_completion_packet_projection_only",
  readOnly: true, actions: [], grantsAuthority: false,
  taskId: "task-1", projectId: "project-1", workspaceId: "workspace-1",
  capturedAt: stamp, taskStatus: "completed", disposition: "inspection_required",
  workerTestimony: { available: true, trust: "untrusted_worker_claims", reportExposed: false },
  evidence: {
    validation: { source: "orchestrator_validation", state: "unavailable" },
    diffSafety: { source: "orchestrator_diff_safety", state: "unavailable" },
    git: { source: "orchestrator_git_snapshot", beforeAvailable: false, afterAvailable: false },
    checkpoint: { source: "orchestrator_checkpoint", available: false, restored: false },
    recovery: { source: "orchestrator_runtime_state", runs: 1, recoveries: 0, retries: 0, stalls: 0 },
  },
  caution: "independent_evidence_not_supervisor_decision",
  workerNarrative: SENTINEL,
});

for (const [name, html] of [["operator", operator], ["setup", setup], ["review", review]]) {
  assert.match(html, /<!doctype html>/i, name);
  assert.match(html, /default-src 'none'/, name);
  assert.match(html, /script-src 'none'/, name);
  assert.match(html, /connect-src 'none'/, name);
  assert.match(html, /form-action 'none'/, name);
  assert.doesNotMatch(html, /<script\b|<form\b|<button\b|<input\b|<iframe\b|onload=|onclick=|<link\b|<img\b/i, name);
  assert.ok(!html.includes(SENTINEL), name + " leaked private canary");
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(anchors.every(anchor => /^#[a-z-]+$/.test(anchor)), name + " contains external navigation");
}
assert.match(operator, /Source unavailable/);
assert.match(setup, /Read-only checklist/);
assert.match(review, /Inspection required — not approved/);
assert.match(review, /Missing evidence is not success/);

assert.throws(() => renderOperatorVisualizationHtml({
  schemaVersion: 1, readOnly: false, actions: [],
}));
assert.throws(() => renderGuidedSetupHtml({
  schemaVersion: 1, readOnly: true, grantsAuthority: false, actions: ["write"], gates: [], steps: [],
}));
assert.throws(() => renderTaskReviewHtml({
  schemaVersion: 1, readOnly: true, grantsAuthority: true, actions: [],
}));

console.log(JSON.stringify({
  slice: "M18E-UX-E1",
  platform: process.platform,
  installedRendererImports: ["operator", "setup", "review"],
  staticRenderingPassed: true,
  noClientMutationSurface: true,
  canaryNotRendered: true,
  missingEvidenceFailClosed: true,
  browserLaunched: false,
  listenerStarted: false,
  serviceInstalled: false,
  productionReleaseAuthorized: false,
}));
