import assert from "node:assert/strict";
import test from "node:test";
import { renderOperatorVisualizationHtml } from "./operator-visualization-html.js";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";

function view(): OperatorVisualizationV1 {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-25T08:30:00.000Z",
    readOnly: true,
    actions: [],
    header: {
      health: "attention",
      activeTasks: 1,
      activeWorkflows: 1,
      openIncidents: 1,
      waitingForHuman: 1,
      activeWriters: 1,
      staleSources: 1,
      unavailableSources: 0,
    },
    sourceNotices: [{
      source: "tasks",
      stale: true,
      available: true,
      truncated: false,
      errorCode: "stale_source",
    }],
    attention: [{
      kind: "task",
      severity: "warning",
      id: "task<&\"'",
      workspaceId: "workspace<&\"'",
      code: "waiting_for_human<&",
      at: "2026-09-25T08:29:00.000Z",
    }],
    taskBoard: [{
      taskId: "task<&\"'",
      projectId: "project",
      workspaceId: "workspace<&\"'",
      status: "waiting_for_human",
      updatedAt: "2026-09-25T08:29:00.000Z",
      runCount: 1,
      recoveryCount: 0,
      validationPassed: false,
      diffSafetyPassed: true,
      waitingForHuman: true,
    }],
    workflows: [{
      workflowId: "workflow<&\"'",
      status: "budget_blocked",
      final: false,
      generatedAt: "2026-09-25T08:28:00.000Z",
      totalNodes: 2,
      completedNodes: 1,
      activeNodes: 0,
      waitingForHuman: 0,
      terminalNonSuccess: 0,
      latestBudgetDeniedReason: "max_task_runs_exceeded",
      openIncidents: 1,
      criticalIncidents: 0,
    }],
    incidents: [{
      incidentId: "incident<&\"'",
      workspaceId: "workspace<&\"'",
      kind: "gateway_failure",
      severity: "warning",
      status: "open",
      firstSeenAt: "2026-09-25T08:27:00.000Z",
      lastSeenAt: "2026-09-25T08:29:00.000Z",
      occurrenceCount: 1,
      humanActionRequired: true,
      failClosed: true,
    }],
    specialistTimeline: [{
      handoffId: "handoff<&\"'",
      taskId: "task<&\"'",
      workspaceId: "workspace<&\"'",
      sequence: 1,
      createdAt: "2026-09-25T08:26:00.000Z",
      fromRole: "planner",
      toRole: "implementation",
      evidenceCount: 1,
    }],
    activeWriters: [{
      workspaceId: "workspace<&\"'",
      taskId: "task<&\"'",
      acquiredAt: "2026-09-25T08:28:00.000Z",
      expiresAt: "2026-09-25T08:31:00.000Z",
      leaseState: "active",
    }],
    truncation: {
      handoffs: false,
      writers: false,
      attention: false,
      sourceNotices: false,
    },
  };
}

test("renderer escapes dynamic content and contains a restrictive passive CSP", () => {
  const html = renderOperatorVisualizationHtml(view());

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.ok(html.includes("task&lt;&amp;&quot;&#39;"));
  assert.ok(html.includes("workspace&lt;&amp;&quot;&#39;"));
  assert.equal(html.includes("task<&\"'"), false);
});

test("renderer has no interactive or executable surface", () => {
  const html = renderOperatorVisualizationHtml(view()).toLowerCase();
  for (const forbidden of [
    "<script",
    "<form",
    "<button",
    "<input",
    "<select",
    "<textarea",
    "onclick=",
    "onload=",
    "fetch(",
    "websocket",
    "command:",
    "vscode.postmessage",
    "acquirevscodeapi",
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test("renderer rejects a view that advertises any action capability", () => {
  const unsafe = {
    ...view(),
    actions: [{ type: "write" }],
  } as unknown as OperatorVisualizationV1;
  assert.throws(
    () => renderOperatorVisualizationHtml(unsafe),
    /read-only action-free views only/,
  );
});

test("renderer output is deterministic for the same sanitized view", () => {
  const input = view();
  assert.equal(renderOperatorVisualizationHtml(input), renderOperatorVisualizationHtml(input));
});


test("UX-B static section navigation is local, accessible and inert", () => {
  const html = renderOperatorVisualizationHtml(view());
  assert.match(html, /<nav class="contents" aria-label="Dashboard sections">/);
  assert.match(html, /<a class="skip" href="#main-content">Skip to dashboard<\/a>/);
  assert.match(html, /<main id="main-content" class="content" tabindex="-1">/);
  for (const section of ["overview", "attention", "writers", "tasks", "workflows", "incidents", "handoffs", "sources"]) {
    assert.ok(html.includes(`href="#${section}"`));
    assert.ok(html.includes(`<section id="${section}"`));
  }
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(anchors.length > 0);
  assert.ok(anchors.every((href) => /^#[a-z-]+$/.test(href!)));
  assert.doesNotMatch(html, /<form|<script|<button|<input|onclick=|fetch\(|<iframe/i);
  assert.match(html, /@media\(max-width:800px\)/);
  assert.match(html, /:focus-visible/);
});

test("UX-B keeps stale and unavailable empty task lists distinguishable from genuinely empty lists", () => {
  const unavailable: OperatorVisualizationV1 = {
    ...view(),
    taskBoard: [],
    sourceNotices: [{ source: "tasks", available: false, stale: true, truncated: false }],
  };
  const html = renderOperatorVisualizationHtml(unavailable);
  assert.match(html, /Source unavailable; no current results can be confirmed/);
  assert.match(html, /Source unavailable — these rows are not a current, complete result/);
  assert.doesNotMatch(html, /No tasks in the current bounded snapshot/);
  const ready: OperatorVisualizationV1 = {
    ...unavailable,
    sourceNotices: [],
    header: { ...unavailable.header, staleSources: 0, unavailableSources: 0 },
  };
  assert.match(renderOperatorVisualizationHtml(ready), /No tasks in the current bounded snapshot/);
});

test("UX-B passive dashboard escapes source error and identifiers", () => {
  const input: OperatorVisualizationV1 = {
    ...view(),
    sourceNotices: [{ source: "tasks", available: true, stale: false, truncated: false, errorCode: "<script>alert(1)</script>" }],
  };
  const html = renderOperatorVisualizationHtml(input);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /<th scope="col">/);
  assert.match(html, /No actions available/);
});

test("UX-E2c3 unknown or unconnected sources never display reassuring zero metrics", () => {
  const input: OperatorVisualizationV1 = {
    ...view(),
    header: { ...view().header, activeTasks: 0, activeWorkflows: 0, activeWriters: 0,
      openIncidents: 0, waitingForHuman: 0, health: "unknown" },
    sourceNotices: [
      { source: "tasks", available: false, stale: true, truncated: false },
      { source: "workflows", available: false, stale: true, truncated: false },
      { source: "incidents", available: false, stale: true, truncated: false },
    ],
    taskBoard: [], workflows: [], incidents: [], activeWriters: [], specialistTimeline: [],
    supplementalFeedAvailability: { writers: false, handoffs: false },
  };
  const html = renderOperatorVisualizationHtml(input);
  for (const label of ["Active tasks", "Active workflows", "Active writers", "Open incidents", "Waiting for human"]) {
    assert.ok(html.includes(`<span>${label}</span><strong>Unknown</strong>`), label);
  }
  assert.match(html, /Writer source not connected or unverified/);
  assert.match(html, /Specialist handoff source not connected or unverified/);
  assert.match(html, /Source unavailable; no current results can be confirmed/);
});

test("UX-E2c3 connected empty supplemental feeds can state none observed", () => {
  const input = { ...view(), activeWriters: [], specialistTimeline: [],
    supplementalFeedAvailability: { writers: true, handoffs: true } };
  const html = renderOperatorVisualizationHtml(input);
  assert.match(html, /No active workspace writers/);
  assert.match(html, /No specialist handoffs in the current bounded snapshot/);
});

test("Console-1 read-only task evidence and accessible tables", () => {
  const html = renderOperatorVisualizationHtml(view());
  assert.match(html, /<th scope="col">Project<\/th>/);
  assert.match(html, /Passed/);
  assert.match(html, /Failed/);
  assert.match(html, /role="region" aria-label="Task records" tabindex="0"/);
  assert.match(html, /Refresh this page to capture a new bounded snapshot/);
  assert.match(html, /not a complete audit trail/);
  assert.match(html, /not agent\/model health/);
  assert.doesNotMatch(html, /<script|<form|<button|<input|onclick=/i);
});

test("Console-2 renders a real visual console shell with bounded overview previews", () => {
  const html = renderOperatorVisualizationHtml(view());
  assert.match(html, /<aside class="sidebar" aria-label="Console navigation">/);
  assert.match(html, /<div class="hero">/);
  assert.match(html, /<div class="overview-lower">/);
  assert.match(html, /Task snapshot/);
  assert.match(html, /Source coverage/);
  assert.match(html, /Task records/);
  assert.match(html, /Project <code>project<\/code>/);
  assert.match(html, /@media\(max-width:800px\)/);
  assert.match(html, /@media\(max-width:480px\)/);
  assert.doesNotMatch(html, /<form|<script|<button|<input|onclick=/i);
});

test("Console-2 status and previews do not turn missing or truncated feeds into healthy counts", () => {
  const input: OperatorVisualizationV1 = {
    ...view(),
    header: { ...view().header, health: "unknown", activeTasks: 0, activeWorkflows: 0,
      activeWriters: 0, openIncidents: 0, waitingForHuman: 0 },
    sourceNotices: [
      { source: "tasks", available: true, stale: false, truncated: true },
      { source: "workflows", available: false, stale: true, truncated: false },
      { source: "incidents", available: false, stale: true, truncated: false },
    ],
    taskBoard: [], workflows: [], incidents: [], activeWriters: [], specialistTimeline: [],
    supplementalFeedAvailability: { writers: false, handoffs: false },
  };
  const html = renderOperatorVisualizationHtml(input);
  for (const label of ["Active tasks", "Active workflows", "Active writers", "Open incidents", "Waiting for human"]) {
    assert.ok(html.includes(`<span>${label}</span><strong>Unknown</strong>`), label);
  }
  assert.match(html, /Snapshot truncated/);
  assert.match(html, /Source coverage/);
  assert.match(html, /not a complete audit trail/);
});

test("UX-1 operator-first overview displays measured task status breakdown, not a decorative gauge", () => {
  const sample = view();
  const html = renderOperatorVisualizationHtml(sample);
  assert.match(html, /Work outcomes/);
  assert.match(html, /Task status distribution in the observed sample/);
  assert.match(html, /Needs review: 1/);
  assert.match(html, /<svg class="meter"/);
  assert.match(html, /<desc id="work-meter-description">/);
  assert.match(html, /\b1<\/text>/);
  assert.match(html, /bounded sample, not an all-time success rate/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Recent work/);
  assert.match(html, /href="#tasks"/);
  assert.match(html, /href="#sources"/);
  assert.doesNotMatch(html, /<script|<form|<button|<input|onclick=/i);
});

test("UX-1 missing task feed never draws success, failure or false empty current-state indicators", () => {
  const missing: OperatorVisualizationV1 = {
    ...view(),
    taskBoard: [],
    header: { ...view().header, health: "unknown", activeTasks: 0 },
    sourceNotices: [{ source: "tasks", stale: true, available: false, truncated: false }],
  };
  const html = renderOperatorVisualizationHtml(missing);
  assert.match(html, /Incomplete or stale sample/);
  assert.match(html, /Attention status cannot be confirmed/);
  assert.match(html, /No task status breakdown is available/);
  assert.match(html, /Source unavailable; no current results can be confirmed/);
  assert.match(html, /Health: unknown/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("UX-1 task outcome meter accounts for every sampled status, including unexpected statuses", () => {
  const sample = view();
  sample.taskBoard.push({
    ...sample.taskBoard[0]!, taskId: "other-task", status: "failed",
    waitingForHuman: false, validationPassed: undefined, diffSafetyPassed: undefined,
  });
  sample.taskBoard.push({
    ...sample.taskBoard[0]!, taskId: "completed-task", status: "completed",
    waitingForHuman: false, validationPassed: true, diffSafetyPassed: true,
  });
  const html = renderOperatorVisualizationHtml(sample);
  assert.match(html, /Needs review: 1, Completed: 1|Completed: 1, Needs review: 1/);
  assert.match(html, /Failed: 1/);
  assert.match(html, /3<\/text>/);
});
