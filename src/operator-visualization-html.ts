import type { OperatorVisualizationV1 } from "./operator-visualization.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function badge(value: string): string {
  return `<span class="badge">${escapeHtml(value)}</span>`;
}

function empty(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function table(headers: string[], rows: string[][], emptyMessage: string): string {
  if (rows.length === 0) return empty(emptyMessage);
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/**
 * Renders only the sanitized OperatorVisualizationV1 into passive HTML. There are
 * deliberately no scripts, forms, buttons, command URIs, navigation links, remote
 * assets or mutation hooks. This is suitable for a browser response or a VS Code
 * webview whose host supplies the already-sanitized view model.
 */
export function renderOperatorVisualizationHtml(view: OperatorVisualizationV1): string {
  if (view.readOnly !== true || view.actions.length !== 0) {
    throw new Error("operator renderer accepts read-only action-free views only");
  }

  const attention = table(
    ["Severity", "Kind", "Code", "ID", "Workspace", "Time"],
    view.attention.map((item) => [
      badge(item.severity),
      escapeHtml(item.kind),
      escapeHtml(item.code),
      `<code>${escapeHtml(item.id)}</code>`,
      item.workspaceId ? `<code>${escapeHtml(item.workspaceId)}</code>` : "—",
      item.at ? escapeHtml(item.at) : "—",
    ]),
    "No operator attention items.",
  );

  const writers = table(
    ["Workspace", "Task", "Lease state", "Acquired", "Expires"],
    view.activeWriters.map((writer) => [
      `<code>${escapeHtml(writer.workspaceId)}</code>`,
      `<code>${escapeHtml(writer.taskId)}</code>`,
      badge(writer.leaseState),
      escapeHtml(writer.acquiredAt),
      escapeHtml(writer.expiresAt),
    ]),
    "No active workspace writers.",
  );

  const tasks = table(
    ["Task", "Workspace", "Status", "Runs", "Recoveries", "Validation", "Diff safety", "Updated"],
    view.taskBoard.map((task) => [
      `<code>${escapeHtml(task.taskId)}</code>`,
      `<code>${escapeHtml(task.workspaceId)}</code>`,
      badge(task.status),
      escapeHtml(task.runCount),
      escapeHtml(task.recoveryCount),
      task.validationPassed === undefined ? "—" : escapeHtml(task.validationPassed),
      task.diffSafetyPassed === undefined ? "—" : escapeHtml(task.diffSafetyPassed),
      escapeHtml(task.updatedAt),
    ]),
    "No tasks in the current bounded snapshot.",
  );

  const workflows = table(
    ["Workflow", "Status", "Completed", "Active", "Waiting", "Budget reason", "Incidents", "Generated"],
    view.workflows.map((workflow) => [
      `<code>${escapeHtml(workflow.workflowId)}</code>`,
      badge(workflow.status),
      `${escapeHtml(workflow.completedNodes)}/${escapeHtml(workflow.totalNodes)}`,
      escapeHtml(workflow.activeNodes),
      escapeHtml(workflow.waitingForHuman),
      workflow.latestBudgetDeniedReason ? escapeHtml(workflow.latestBudgetDeniedReason) : "—",
      `${escapeHtml(workflow.openIncidents)} open / ${escapeHtml(workflow.criticalIncidents)} critical`,
      escapeHtml(workflow.generatedAt),
    ]),
    "No workflows in the current bounded snapshot.",
  );

  const incidents = table(
    ["Incident", "Workspace", "Kind", "Severity", "Status", "Occurrences", "Human action", "Last seen"],
    view.incidents.map((incident) => [
      `<code>${escapeHtml(incident.incidentId)}</code>`,
      `<code>${escapeHtml(incident.workspaceId)}</code>`,
      escapeHtml(incident.kind),
      badge(incident.severity),
      badge(incident.status),
      escapeHtml(incident.occurrenceCount),
      escapeHtml(incident.humanActionRequired),
      escapeHtml(incident.lastSeenAt),
    ]),
    "No incidents in the current bounded snapshot.",
  );

  const handoffs = table(
    ["Handoff", "Task", "Workspace", "Transition", "Sequence", "Evidence", "Created"],
    view.specialistTimeline.map((handoff) => [
      `<code>${escapeHtml(handoff.handoffId)}</code>`,
      `<code>${escapeHtml(handoff.taskId)}</code>`,
      `<code>${escapeHtml(handoff.workspaceId)}</code>`,
      `${escapeHtml(handoff.fromRole)} → ${escapeHtml(handoff.toRole)}`,
      escapeHtml(handoff.sequence),
      escapeHtml(handoff.evidenceCount),
      escapeHtml(handoff.createdAt),
    ]),
    "No specialist handoffs in the current bounded snapshot.",
  );

  const sources = table(
    ["Source", "Available", "Stale", "Truncated", "Error"],
    view.sourceNotices.map((notice) => [
      escapeHtml(notice.source),
      escapeHtml(notice.available),
      escapeHtml(notice.stale),
      escapeHtml(notice.truncated),
      notice.errorCode ? escapeHtml(notice.errorCode) : "—",
    ]),
    "All dashboard sources are current and available.",
  );

  const cards = [
    ["Health", view.header.health],
    ["Active tasks", view.header.activeTasks],
    ["Active workflows", view.header.activeWorkflows],
    ["Active writers", view.header.activeWriters],
    ["Open incidents", view.header.openIncidents],
    ["Waiting for human", view.header.waitingForHuman],
    ["Stale sources", view.header.staleSources],
    ["Unavailable sources", view.header.unavailableSources],
  ].map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cline Orchestrator — Read-only Operator View</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}body{margin:0;padding:20px;line-height:1.4}main{max-width:1440px;margin:0 auto}h1{margin:0 0 4px}h2{margin:28px 0 10px}.subtitle,.empty{opacity:.72}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.card{border:1px solid currentColor;border-radius:8px;padding:12px;opacity:.9}.card span{display:block;font-size:.8rem;opacity:.7}.card strong{font-size:1.35rem}.table-wrap{overflow:auto;border:1px solid currentColor;border-radius:8px}table{border-collapse:collapse;width:100%;min-width:720px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent);vertical-align:top}th{font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;opacity:.72}.badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.78rem}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.83rem}.footer{margin-top:28px;font-size:.8rem;opacity:.65}
</style>
</head>
<body>
<main>
<h1>Cline Orchestrator</h1>
<p class="subtitle">Read-only operator view · generated ${escapeHtml(view.generatedAt)}</p>
<div class="cards">${cards}</div>
<section><h2>Attention</h2>${attention}</section>
<section><h2>Active writers</h2>${writers}</section>
<section><h2>Tasks</h2>${tasks}</section>
<section><h2>Workflows</h2>${workflows}</section>
<section><h2>Incidents</h2>${incidents}</section>
<section><h2>Specialist handoffs</h2>${handoffs}</section>
<section><h2>Source notices</h2>${sources}</section>
<p class="footer">This surface is intentionally passive. It exposes no orchestration actions or machine-control capability.</p>
</main>
</body>
</html>`;
}
