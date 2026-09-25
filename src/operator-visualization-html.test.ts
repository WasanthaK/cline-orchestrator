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
    "<a ",
    "href=",
    "onclick=",
    "onload=",
    "fetch(",
    "websocket",
    "command:",
    "vscode.postmessage",
    "acquirevs codeapi",
    "acquirevscodeapi",
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test("renderer rejects a view that advertises any action capability", () => {
  const unsafe = view() as OperatorVisualizationV1 & { actions: unknown[] };
  unsafe.actions = [{ type: "write" }];
  assert.throws(
    () => renderOperatorVisualizationHtml(unsafe),
    /read-only action-free views only/,
  );
});

test("renderer output is deterministic for the same sanitized view", () => {
  const input = view();
  assert.equal(renderOperatorVisualizationHtml(input), renderOperatorVisualizationHtml(input));
});
