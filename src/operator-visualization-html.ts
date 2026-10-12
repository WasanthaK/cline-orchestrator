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
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}


function metricValue(view: OperatorVisualizationV1, source: string, value: number): string {
  const record = view.sourceNotices.find(item => item.source === source);
  return record && (!record.available || record.stale || record.errorCode)
    ? "Unknown" : String(value);
}

function sourceWarning(view: OperatorVisualizationV1, source: string): string {
  const record = view.sourceNotices.find((item) => item.source === source);
  if (!record) return "";
  const message = !record.available
    ? "Source unavailable — these rows are not a current, complete result."
    : record.stale
      ? "Source stale — verify freshness before relying on these rows."
      : record.truncated
        ? "Snapshot truncated — additional rows may exist."
        : record.errorCode
          ? "Source reported an error — verify before relying on these rows."
          : "";
  return message ? `<p class="source-warning" role="note">${escapeHtml(message)}</p>` : "";
}

function sourceEmpty(view: OperatorVisualizationV1, source: string, normal: string): string {
  const record = view.sourceNotices.find((item) => item.source === source);
  if (record?.available === false) return "Source unavailable; no current results can be confirmed.";
  if (record?.stale) return "Source stale; an empty snapshot does not confirm there are no records.";
  if (record?.errorCode) return "Source error; an empty snapshot does not confirm there are no records.";
  if (record?.truncated) return "Source truncated; an empty snapshot does not confirm there are no records.";
  return normal;
}

/**
 * Renders only the sanitized OperatorVisualizationV1 into passive HTML. There are
 * deliberately no scripts, forms, buttons, external navigation links, remote
 * assets or mutation hooks. Only fixed same-page section anchors are present. This is suitable for a browser response or a VS Code
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
    view.supplementalFeedAvailability?.writers === true
      ? "No active workspace writers." : "Writer source not connected or unverified; activity unknown.",
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
    sourceEmpty(view, "tasks", "No tasks in the current bounded snapshot."),
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
    sourceEmpty(view, "workflows", "No workflows in the current bounded snapshot."),
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
    sourceEmpty(view, "incidents", "No incidents in the current bounded snapshot."),
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
    view.supplementalFeedAvailability?.handoffs === true
      ? "No specialist handoffs in the current bounded snapshot."
      : "Specialist handoff source not connected or unverified; activity unknown.",
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
    view.header.staleSources > 0 || view.header.unavailableSources > 0 ? "Source quality is uncertain; review source counts and freshness." : "All dashboard sources are current and available.",
  );

  const cards = [
    ["Health", view.header.health],
    ["Active tasks", metricValue(view, "tasks", view.header.activeTasks)],
    ["Active workflows", metricValue(view, "workflows", view.header.activeWorkflows)],
    ["Active writers", view.supplementalFeedAvailability?.writers === true ? view.header.activeWriters : "Unknown"],
    ["Open incidents", metricValue(view, "incidents", view.header.openIncidents)],
    ["Waiting for human", metricValue(view, "tasks", view.header.waitingForHuman)],
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
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;line-height:1.5}
*{box-sizing:border-box}
body{margin:0;padding:0 16px 44px;background:Canvas;color:CanvasText}
a{color:inherit}
a:focus-visible{outline:3px solid Highlight;outline-offset:3px;border-radius:4px}
.skip{position:absolute;top:-100px;left:12px;padding:10px;background:Canvas;color:CanvasText;border:2px solid currentColor;z-index:10}
.skip:focus{top:12px}
.header{max-width:1512px;margin:0 auto;padding:25px 0 14px;border-bottom:1px solid color-mix(in srgb,CanvasText 22%,transparent)}
.header h1{font-size:clamp(1.5rem,2.6vw,2.25rem);line-height:1.18;margin:0}
.subtitle,.footer,.minor{opacity:.78}
.shell{max-width:1512px;margin:0 auto;display:grid;grid-template-columns:minmax(170px,215px) minmax(0,1fr);gap:24px}
.contents{align-self:start;position:sticky;top:16px;padding:18px 0;min-width:0}
.contents h2{font-size:.84rem;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}
.contents ul{list-style:none;margin:0;padding:0}
.contents a{display:block;padding:6px 9px;border-radius:6px;text-decoration:none}
.contents a:hover,.contents a:focus-visible{background:color-mix(in srgb,CanvasText 12%,transparent);text-decoration:underline}
.content{min-width:0}
section{margin:22px 0 30px;scroll-margin-top:20px}
section h2{font-size:clamp(1.1rem,1.7vw,1.4rem);margin:0 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:12px;margin:20px 0}
.card{border:1px solid color-mix(in srgb,CanvasText 30%,transparent);border-radius:12px;padding:14px;min-width:0}
.card span{display:block;font-size:.84rem;opacity:.85}
.card strong{display:block;font-size:1.6rem;overflow-wrap:anywhere}
.table-wrap{overflow-x:auto;max-width:100%;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:9px}
table{border-collapse:collapse;width:100%;min-width:720px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 15%,transparent);vertical-align:top}
th{font-size:.79rem;letter-spacing:.02em;opacity:.85}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:color-mix(in srgb,CanvasText 5%,transparent)}
.badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:1px 8px;font-size:.79rem;overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;overflow-wrap:anywhere}
.empty,.source-warning,.snapshot-notice{border-left:3px solid currentColor;padding:9px 12px;margin:10px 0}
.empty{opacity:.85}
.source-warning{font-weight:600}
.snapshot-notice{font-size:.92rem}
.footer{margin:28px 0;font-size:.86rem}
@media(max-width:800px){.shell{display:block}.contents{position:static;padding:14px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent)}.contents ul{display:flex;flex-wrap:wrap;gap:4px}.contents a{padding:8px}.header{padding-top:19px}section{margin:22px 0}}
@media(max-width:480px){body{padding:0 12px 30px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:10px}.card strong{font-size:1.3rem}table{min-width:620px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important}}
@media print{.contents{display:none}.shell{display:block}.table-wrap{overflow:visible}table{min-width:0;font-size:.76rem}.cards{grid-template-columns:repeat(4,1fr)}}
</style>
</head>
<body>
<a class="skip" href="#main-content">Skip to dashboard</a>
<header class="header">
<h1>Cline Orchestrator</h1>
<p class="subtitle">Read-only operator dashboard · Snapshot generated ${escapeHtml(view.generatedAt)} · No actions available</p>
</header>
<div class="shell">
<nav class="contents" aria-label="Dashboard sections">
<h2>Sections</h2>
<ul>
<li><a href="#overview">Overview</a></li>
<li><a href="#attention">Attention</a></li>
<li><a href="#writers">Active writers</a></li>
<li><a href="#tasks">Tasks</a></li>
<li><a href="#workflows">Workflows</a></li>
<li><a href="#incidents">Incidents</a></li>
<li><a href="#handoffs">Specialist handoffs</a></li>
<li><a href="#sources">Data quality</a></li>
</ul>
</nav>
<main id="main-content" class="content" tabindex="-1">
<section id="overview" aria-labelledby="overview-heading">
<h2 id="overview-heading">Overview</h2>
<p class="snapshot-notice" role="status">Snapshot health: <strong>${escapeHtml(view.header.health)}</strong>. ${escapeHtml(view.header.staleSources)} stale and ${escapeHtml(view.header.unavailableSources)} unavailable data sources. Counts are from the captured snapshot, not a live availability guarantee.</p>
<div class="cards">${cards}</div>
</section>
<section id="attention" aria-labelledby="attention-heading"><h2 id="attention-heading">Attention</h2>${attention}</section>
<section id="writers" aria-labelledby="writers-heading"><h2 id="writers-heading">Active writers</h2>${writers}</section>
<section id="tasks" aria-labelledby="tasks-heading"><h2 id="tasks-heading">Tasks</h2>${sourceWarning(view, "tasks")}${tasks}</section>
<section id="workflows" aria-labelledby="workflows-heading"><h2 id="workflows-heading">Workflows</h2>${sourceWarning(view, "workflows")}${workflows}</section>
<section id="incidents" aria-labelledby="incidents-heading"><h2 id="incidents-heading">Incidents</h2>${sourceWarning(view, "incidents")}${incidents}</section>
<section id="handoffs" aria-labelledby="handoffs-heading"><h2 id="handoffs-heading">Specialist handoffs</h2>${handoffs}</section>
<section id="sources" aria-labelledby="sources-heading"><h2 id="sources-heading">Data quality and source notices</h2>${sources}</section>
<p class="footer">Read-only snapshot. Section links stay inside this document. No machine, task, credential, installation, Git or release controls are exposed.</p>
</main>
</div>
</body>
</html>`;
}
