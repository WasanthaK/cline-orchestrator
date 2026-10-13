import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import { taskStatusGroup, safeTaskHref, TASK_STATUS_GROUPS } from "./operator-task-groups.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function badge(value: string): string {
  const tone = ["completed", "succeeded", "active"].includes(value) ? "success"
    : ["failed", "critical", "rolled_back", "blocked"].includes(value) ? "danger"
    : ["warning", "waiting_for_human", "expiring", "budget_blocked"].includes(value) ? "warning" : "neutral";
  return `<span class="badge" data-tone="${tone}">${escapeHtml(value)}</span>`;
}

function empty(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function table(headers: string[], rows: string[][], emptyMessage: string, label: string): string {
  if (rows.length === 0) return empty(emptyMessage);
  return `<div class="table-wrap" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}


function metricValue(view: OperatorVisualizationV1, source: string, value: number): string {
  const record = view.sourceNotices.find(item => item.source === source);
  return record && (!record.available || record.stale || record.truncated || record.errorCode)
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
    "No operator attention items.", "Operator attention records",
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
      ? "No active workspace writers." : "Writer source not connected or unverified; activity unknown.", "Active writer records",
  );

  const tasks = table(
    ["Task", "Project", "Workspace", "Status", "Runs", "Recoveries", "Validation", "Diff safety", "Updated"],
    view.taskBoard.map((task) => [
      safeTaskHref(task.taskId) ? `<a href="${safeTaskHref(task.taskId)}"><code>${escapeHtml(task.taskId)}</code></a>` : `<code>${escapeHtml(task.taskId)}</code>`,
      `<code>${escapeHtml(task.projectId)}</code>`,
      `<code>${escapeHtml(task.workspaceId)}</code>`,
      badge(task.status),
      escapeHtml(task.runCount),
      escapeHtml(task.recoveryCount),
      task.validationPassed === undefined ? "Not available" : task.validationPassed ? "Passed" : "Failed",
      task.diffSafetyPassed === undefined ? "Not available" : task.diffSafetyPassed ? "Passed" : "Failed",
      escapeHtml(task.updatedAt),
    ]),
    sourceEmpty(view, "tasks", "No tasks in the current bounded snapshot."), "Task records",
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
    sourceEmpty(view, "workflows", "No workflows in the current bounded snapshot."), "Workflow records",
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
    sourceEmpty(view, "incidents", "No incidents in the current bounded snapshot."), "Incident records",
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
      : "Specialist handoff source not connected or unverified; activity unknown.", "Specialist handoff records",
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
    view.header.staleSources > 0 || view.header.unavailableSources > 0 ? "Source quality is uncertain; review source counts and freshness." : "All dashboard sources are current and available.", "Data source quality records",
  );

  const cards = [
    ["Active tasks", metricValue(view, "tasks", view.header.activeTasks)],
    ["Waiting for human", metricValue(view, "tasks", view.header.waitingForHuman)],
    ["Active workflows", metricValue(view, "workflows", view.header.activeWorkflows)],
    ["Active writers", view.supplementalFeedAvailability?.writers === true ? view.header.activeWriters : "Unknown"],
    ["Open incidents", metricValue(view, "incidents", view.header.openIncidents)],
  ].map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");



  // Status distribution describes this snapshot's bounded task rows ONLY.
  // It is not a live measurement, all-time success rate, or reconstructed history.
  const categories = [
    { label: "Completed", color: "#169b72", statuses: ["completed"] },
    { label: "In progress", color: "#5775da", statuses: ["created", "running", "waiting", "validating", "repairing", "safety_checking"] },
    { label: "Needs review", color: "#ce9239", statuses: ["waiting_for_human"] },
    { label: "Failed", color: "#cf4c68", statuses: ["failed", "validation_failed"] },
    { label: "Rolled back", color: "#9159b3", statuses: ["rolled_back"] },
    { label: "Stalled", color: "#c37832", statuses: ["stalled"] },
    { label: "Stopped", color: "#78879f", statuses: ["aborted"] },
  ] as const;
  const groups = categories.map(category => ({
    ...category,
    count: view.taskBoard.filter(task => (category.statuses as readonly string[]).includes(task.status)).length,
  }));
  const otherCount = view.taskBoard.length - groups.reduce((sum, group) => sum + group.count, 0);
  const segments = [...groups, { label: "Other", color: "#8392a9", count: otherCount }];
  const taskSampleSize = view.taskBoard.length;
  const tasksMeta = view.sourceNotices.find(notice => notice.source === "tasks");
  const sampleIsIncomplete = Boolean(tasksMeta && (!tasksMeta.available || tasksMeta.stale || tasksMeta.truncated || tasksMeta.errorCode));
  const circumference = 2 * Math.PI * 52;
  let usedLength = 0;
  const arcs = taskSampleSize === 0 ? "" : segments.filter(group => group.count > 0).map(group => {
    const length = group.count / taskSampleSize * circumference;
    const slug = TASK_STATUS_GROUPS.find(g => g.label === group.label)?.slug ?? "other";
    const html = `<a href="/viewer/status/${slug}" aria-label="${group.label}: ${group.count} tasks"><circle cx="88" cy="88" r="52" fill="none" stroke="${group.color}" stroke-width="17" stroke-dasharray="${length.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${(-usedLength).toFixed(2)}" transform="rotate(-90 88 88)"></circle></a>`;
    usedLength += length;
    return html;
  }).join("");
  const workMeter = `<div class="meter-layout">
    <svg class="meter" viewBox="0 0 176 176" role="img" aria-labelledby="work-meter-title work-meter-description">
      <title id="work-meter-title">Task status distribution in the observed sample</title>
      <desc id="work-meter-description">${escapeHtml(segments.filter(group => group.count > 0).map(group => group.label + ": " + group.count).join(", ") || "No sampled tasks")}</desc>
      <circle cx="88" cy="88" r="52" fill="none" stroke="#e7ecf6" stroke-width="17"></circle>
      ${arcs}
      <text x="88" y="86" text-anchor="middle" class="meter-total">${escapeHtml(taskSampleSize)}</text>
      <text x="88" y="104" text-anchor="middle" class="meter-caption">sampled tasks</text>
    </svg>
    <div class="meter-legend" aria-label="Task status counts">${segments.filter(group => group.count > 0).map(group =>
      `<a class="legend-row" href="/viewer/status/${TASK_STATUS_GROUPS.find(g => g.label === group.label)?.slug ?? "other"}"><span class="legend-dot" style="background:${group.color}" aria-hidden="true"></span><span>${escapeHtml(group.label)}</span><strong>${escapeHtml(group.count)}</strong></a>`
    ).join("") || `<p class="minor">No task status breakdown is available.</p>`}</div>
  </div>
  <p class="sample-note">${escapeHtml(sampleIsIncomplete ? "Incomplete or stale sample — results are not a complete current view." : "This is a bounded sample, not an all-time success rate or full historical count.")}</p>`;

  const recentTaskSample = view.taskBoard.slice(0, 5);
  const taskPreview = recentTaskSample.length === 0
    ? empty(sourceEmpty(view, "tasks", "No tasks in the current bounded snapshot."))
    : `<ul class="activity-list">${recentTaskSample.map(task =>
        `<li class="activity-row"><span class="activity-rail" aria-hidden="true"></span><div class="activity-copy"><span class="activity-primary">Task ${safeTaskHref(task.taskId) ? `<a href="${safeTaskHref(task.taskId)}">…${escapeHtml(task.taskId.slice(-8))}</a>` : `<code>…${escapeHtml(task.taskId.slice(-8))}</code>`}</span><span class="activity-secondary">Project <code>${escapeHtml(task.projectId)}</code> · ${escapeHtml(task.updatedAt)}</span></div>${badge(task.status)}</li>`
      ).join("")}</ul>`;
  const taskAttention = view.taskBoard.filter(task =>
    task.waitingForHuman || ["failed", "validation_failed", "stalled"].includes(task.status)).slice(0, 4);
  const taskAttentionUnknown = sampleIsIncomplete || taskSampleSize === 0 && Boolean(tasksMeta?.available === false);
  const attentionPreview = taskAttention.length > 0
    ? `<ul class="activity-list">${taskAttention.map(task =>
        `<li class="activity-row"><span class="activity-rail" aria-hidden="true"></span><div class="activity-copy"><span class="activity-primary">${escapeHtml(task.waitingForHuman ? "Needs human review" : task.status === "stalled" ? "Stalled work" : "Task failed")} <code title="${escapeHtml(task.taskId)}">…${escapeHtml(task.taskId.slice(-8))}</code></span><span class="activity-secondary">Project <code>${escapeHtml(task.projectId)}</code></span></div>${badge(task.status)}</li>`
      ).join("")}</ul>`
    : empty(taskAttentionUnknown ? "Attention status cannot be confirmed from this task source." : "No failed, stalled or review-waiting work observed in this bounded sample.");
  const sourceConcerns = view.sourceNotices.filter(notice =>
    !notice.available || notice.stale || notice.truncated || Boolean(notice.errorCode)).length;
  const healthTone = view.header.health === "healthy" ? "healthy"
    : view.header.health === "critical" ? "critical"
    : view.header.health === "attention" ? "attention" : "unknown";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cline Orchestrator — Read-only Operator View</title>
<style>
:root{font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--navy:#111e3a;--navy-soft:#22375a;--canvas:#f4f6fb;--surface:#fff;--ink:#1c2741;--muted:#60718e;--line:#e1e7f1;--accent:#4d6bda;--accent-soft:#edf1ff;--warn:#a66212;--warn-bg:#fff6e7;--danger:#a52f49;--safe:#166e56;color-scheme:light}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--canvas);color:var(--ink);min-width:0}
a{color:inherit}
a:focus-visible,.table-wrap:focus-visible{outline:3px solid #729cff;outline-offset:3px}
.skip{position:absolute;top:-100px;left:12px;padding:12px;background:white;color:#162647;border:2px solid currentColor;z-index:20;border-radius:8px}
.skip:focus{top:12px}
.shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1920px;margin:0 auto}
.sidebar{background:linear-gradient(160deg,#142446,#101a32 74%);color:#e8eeff;display:flex;flex-direction:column;min-height:100vh;position:sticky;top:0;height:100vh;overflow-y:auto;overflow-x:hidden}
.header{padding:33px 23px 29px;border-bottom:1px solid rgba(224,234,255,.12)}
.brand{display:flex;gap:13px;align-items:center}
.brand-mark{width:43px;height:43px;display:grid;place-items:center;flex-shrink:0;border-radius:13px;background:linear-gradient(150deg,#82a5ff,#5269d6);color:#fff;font-size:.86rem;font-weight:900;letter-spacing:-.09em;box-shadow:0 8px 22px rgba(9,18,47,.34)}
.header h1{font-size:1.04rem;letter-spacing:-.025em;line-height:1.2;margin:3px 0 0;font-weight:720}
.eyebrow{font-size:.69rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;margin:0}
.header .eyebrow{color:#a9b9de}
.header .subtitle{color:#9cadd3;font-size:.8rem;margin:17px 0 0}
.contents{padding:27px 15px 18px;flex:1}
.contents h2{color:#92a5ce;font-size:.67rem;font-weight:800;letter-spacing:.15em;text-transform:uppercase;margin:0 12px 13px}
.contents ul{padding:0;margin:0;list-style:none;display:grid;gap:4px}
.contents a{display:flex;align-items:center;gap:12px;min-height:42px;padding:10px 12px;border-radius:10px;text-decoration:none;font-size:.9rem;font-weight:550;color:#c4d0eb}
.contents a:hover,.contents a:focus-visible{background:rgba(137,160,222,.14);color:white}
.contents a[href="#overview"]{background:rgba(125,153,252,.19);color:#fff;box-shadow:inset 3px 0 #90acff}
.nav-number{font-size:.69rem;color:#92a6da;font-weight:750;min-width:21px;letter-spacing:.03em}
.sidebar-footer{margin:15px;padding:17px;border-radius:14px;background:rgba(153,179,255,.08);border:1px solid rgba(171,191,248,.15)}
.sidebar-footer strong{display:block;color:#e8eeff;font-size:.81rem;letter-spacing:.035em}
.sidebar-footer p{color:#9eafd4;font-size:.79rem;line-height:1.5;margin:7px 0 0}
.content{padding:0 clamp(20px,3.4vw,56px) 52px;min-width:0}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.topbar-label{display:flex;gap:9px;align-items:center}
.local-dot{width:8px;height:8px;border-radius:50%;background:#6078a5;box-shadow:0 0 0 4px #e2e8f6}
.mode-pill{border:1px solid #d6dfff;border-radius:999px;background:#edf2ff;color:#3856a9;padding:6px 11px;text-transform:none;letter-spacing:0;font-weight:750;white-space:nowrap}
section{margin:28px 0 37px;scroll-margin-top:22px}
section:target{border-left:3px solid #5576df;padding-left:15px}
.section-head{display:flex;justify-content:space-between;align-items:end;gap:20px;margin:0 0 18px}
.section-head .eyebrow{color:#5976c6;margin-bottom:7px}
section h2{font-size:clamp(1.3rem,2vw,1.8rem);letter-spacing:-.04em;line-height:1.15;margin:0 0 6px;color:var(--ink);font-weight:780}
.section-intro{margin:0;color:var(--muted);font-size:.9rem;max-width:770px}
.capture{max-width:290px;text-align:right;font-size:.78rem;color:var(--muted)}
.capture strong{display:block;color:#334462;font-size:.79rem;letter-spacing:.01em}
.hero{background:radial-gradient(circle at 86% 14%,rgba(130,165,250,.36),transparent 36%),linear-gradient(135deg,#182a58,#293f89 68%,#3858ad);color:white;border-radius:22px;padding:clamp(21px,2.5vw,37px);display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.52fr);gap:22px;box-shadow:0 14px 29px rgba(30,49,99,.13);min-width:0}
.hero .eyebrow{color:#becbff}
.hero h3{font-size:clamp(1.75rem,3vw,2.65rem);line-height:1.08;margin:11px 0 12px;letter-spacing:-.055em}
.hero p{font-size:.89rem;line-height:1.65;color:#d6e0ff;max-width:600px;margin:0}
.hero-status{display:inline-flex;gap:9px;align-items:center;padding:6px 11px;border:1px solid rgba(255,255,255,.27);border-radius:99px;color:#fff;font-size:.79rem;font-weight:750;background:rgba(255,255,255,.10)}
.hero-status .status-light{background:#ffc66d;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 3px rgba(255,198,109,.15)}
.hero-status.healthy .status-light{background:#86e7c7}
.hero-status.critical .status-light{background:#ff839c}
.hero-stats{display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:10px}
.hero-stat{border:1px solid rgba(221,234,255,.24);background:rgba(255,255,255,.095);border-radius:13px;padding:15px 16px}
.hero-stat span{font-size:.72rem;color:#cbd6ff;display:block}
.hero-stat strong{font-size:1.75rem;letter-spacing:-.05em;display:block;margin-top:4px;color:#fff}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:17px 0 0}
.card{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:19px 18px 17px;box-shadow:0 3px 9px rgba(22,42,87,.03);position:relative;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(#99b0ee,#dae4ff)}
.card span{font-size:.8rem;color:var(--muted);font-weight:650;display:block}
.card strong{font-size:clamp(1.4rem,2.1vw,2rem);display:block;line-height:1.25;margin-top:12px;color:#253657;letter-spacing:-.045em;overflow-wrap:anywhere}
.card strong:not(:first-child){min-height:36px}
.card:has(strong) .metric-decoration{display:none}
.snapshot-notice{margin:18px 0 0;padding:13px 15px;background:#eef2fc;color:#435a87;border:1px solid #dbe3f6;border-left:3px solid #8097da;border-radius:10px;font-size:.82rem}
.overview-lower{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(245px,.8fr);gap:15px;margin:19px 0 0}
.preview-panel{background:#fff;border:1px solid var(--line);border-radius:16px;min-width:0;overflow:hidden}
.preview-head{padding:17px 20px 12px;display:flex;justify-content:space-between;gap:14px;align-items:center}
.preview-head h3{font-size:1rem;margin:0;color:#273959;letter-spacing:-.02em}
.preview-head a{font-size:.78rem;font-weight:730;text-decoration:none;color:#405fba;white-space:nowrap}
.preview-head a:hover{text-decoration:underline}
.preview-caption{margin:0 20px 13px;color:var(--muted);font-size:.78rem}
.activity-list,.source-list{list-style:none;padding:0;margin:0}
.activity-row{padding:12px 18px;border-top:1px solid #edf0f6;display:flex;align-items:center;gap:12px;min-width:0}
.activity-rail{width:8px;height:8px;border-radius:50%;background:#879bcb;flex-shrink:0}
.activity-copy{min-width:0;flex:1;display:grid;gap:3px}
.activity-primary{font-size:.82rem;font-weight:700;display:flex;gap:8px;align-items:center;min-width:0}
.activity-primary code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;max-width:250px}
.activity-secondary{font-size:.74rem;color:var(--muted);overflow-wrap:anywhere}
.activity-row .badge{flex-shrink:0}
.source-list{padding:0 17px 12px}
.source-list li{display:flex;align-items:center;gap:12px;padding:11px 3px;border-top:1px solid #edf0f6}
.source-mark{width:9px;height:9px;border-radius:50%;background:#d3a253;box-shadow:0 0 0 4px #fff3dd}
.source-list li div{display:grid;gap:1px}
.source-list strong{font-size:.82rem;color:#263957}
.source-list small{font-size:.75rem;color:var(--muted)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 20px;box-shadow:0 3px 10px rgba(24,46,93,.03)}
.panel .table-wrap{margin-top:7px}
.panel .empty{margin:0}
.section-hdr{display:flex;justify-content:space-between;align-items:end;gap:16px;margin:0 0 13px}
.section-hdr h2{margin:0}
.section-hdr p{margin:5px 0 0;color:var(--muted);font-size:.82rem}
.section-index{font-size:.73rem;font-weight:800;color:#7b8bad;letter-spacing:.1em}
.table-wrap{overflow-x:auto;max-width:100%;border:1px solid #e6ebf3;border-radius:11px}
table{border-collapse:collapse;width:100%;min-width:720px}
th,td{text-align:left;padding:13px 14px;border-bottom:1px solid #edf0f6;vertical-align:middle;font-size:.79rem}
th{background:#f8faff;font-size:.7rem;font-weight:800;color:#61718f;text-transform:uppercase;letter-spacing:.045em;white-space:nowrap}
td{color:#3e4e69}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:#f7f9ff}
.badge{display:inline-block;padding:3px 9px;background:#eef1f9;border:1px solid #dae2ef;border-radius:999px;color:#4e6080;font-size:.73rem;font-weight:750;overflow-wrap:anywhere;max-width:190px}
.badge[data-tone="success"]{background:#e6f8ef;border-color:#c2ebd7;color:#196b4a}
.badge[data-tone="danger"]{background:#ffecef;border-color:#f7ced7;color:#a52f49}
.badge[data-tone="warning"]{background:#fff4e3;border-color:#f4dfba;color:#93601d}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem;color:#35539a;overflow-wrap:anywhere}
.empty{background:#f8faff;color:#60718e;border:1px dashed #dce3f0;border-radius:11px;padding:23px;margin:0;font-size:.85rem}
.source-warning{background:var(--warn-bg);color:#845318;border:1px solid #f2e0ba;border-radius:10px;padding:12px 15px;margin:0 0 12px;font-size:.8rem;font-weight:650}
.minor,.footer{color:var(--muted)}
.footer{margin:29px 0;font-size:.78rem;line-height:1.7}
@media(max-width:1180px){.shell{grid-template-columns:218px minmax(0,1fr)}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{grid-template-columns:minmax(0,1fr) minmax(175px,.52fr)}}
@media(max-width:800px){.shell{display:block}.sidebar{position:static;height:auto;min-height:0;overflow:visible}.header{padding:17px 20px 8px;border:0}.header .subtitle{display:none}.contents{padding:4px 12px 12px}.contents h2{display:none}.contents ul{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:5px;scrollbar-width:thin}.contents a{white-space:nowrap;min-height:38px;padding:8px 11px;font-size:.79rem}.sidebar-footer{display:none}.content{padding:0 18px 36px}.topbar{padding:15px 0}.hero{grid-template-columns:1fr}.hero-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-lower{grid-template-columns:1fr}.capture{text-align:left}}
@media(max-width:480px){.content{padding:0 12px 25px}.topbar{gap:8px;font-size:.69rem}.mode-pill{font-size:.69rem;padding:5px 8px}.section-head{display:block}.capture{margin:9px 0 0}.cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{padding:14px 12px}.card strong{font-size:1.4rem}.hero{padding:21px 17px;border-radius:16px}.hero h3{font-size:1.9rem}.hero-stat{padding:11px}.panel{padding:15px 12px}.activity-row{gap:8px;padding:12px}.activity-secondary{font-size:.69rem}table{min-width:620px}.nav-number{display:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{.shell{display:block}.sidebar{display:none}.content{padding:0}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cards{grid-template-columns:repeat(4,1fr)}.table-wrap{overflow:visible}table{min-width:0;font-size:.7rem}}
/* UX-1 operator-first information hierarchy: source pulse, outcomes, attention, then work. */
.pulse-banner{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 20px;border-radius:15px;background:#fff;border:1px solid #dce4f4;box-shadow:0 3px 10px rgba(19,38,78,.03)}
.pulse-left{display:flex;align-items:center;gap:14px;min-width:0}
.pulse-left strong{font-size:.98rem;color:#243754}
.pulse-left p{font-size:.8rem;color:#627494;margin:2px 0 0}
.status-light{flex-shrink:0;width:12px;height:12px;background:#daaa55;border-radius:50%;box-shadow:0 0 0 5px #fff2de}
.status-light.healthy{background:#2d9b75;box-shadow:0 0 0 5px #e7f7ef}
.status-light.critical{background:#d65370;box-shadow:0 0 0 5px #ffecef}
.status-light.attention{background:#d79b43;box-shadow:0 0 0 5px #fff4e2}
.pulse-link{white-space:nowrap;text-decoration:none;font-weight:750;font-size:.83rem;color:#405fba}
.pulse-link:hover{text-decoration:underline}
.cards{grid-template-columns:repeat(5,minmax(0,1fr));margin:13px 0 0}
.card{padding:14px 16px;box-shadow:none}
.card strong{font-size:1.45rem;margin-top:6px;min-height:0}
.decision-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:15px;margin:15px 0}
.meter-layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:4px;align-items:center;padding:0 16px}
.meter{width:100%;height:auto;max-height:200px}
.meter-total{font-size:28px;font-weight:800;fill:#223657}
.meter-caption{font-size:11px;fill:#7485a2}
.meter-legend{display:grid;gap:11px;padding:6px 14px 6px 0}
.legend-row{display:grid;grid-template-columns:12px minmax(0,1fr) 24px;align-items:center;gap:9px;font-size:.82rem;color:#445574}
.legend-row strong{text-align:right;color:#243754;font-variant-numeric:tabular-nums}
.legend-dot{width:10px;height:10px;border-radius:4px}
.sample-note{font-size:.74rem;color:#71819d;line-height:1.5;margin:0 18px 19px}
.attention-panel .activity-row{padding:13px 17px}
.attention-source-footer{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:13px 20px;background:#fff9ef;border-top:1px solid #f3e8d5;font-size:.79rem;color:#7a5a29}
.attention-source-footer a{white-space:nowrap;color:#8f5c1d;text-decoration:underline}
.recent-panel{margin:0}
.recent-panel .activity-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.recent-panel .activity-row{border-right:1px solid #edf0f6}
.snapshot-notice{margin:15px 0 0}
@media(max-width:1200px){.cards{grid-template-columns:repeat(3,minmax(0,1fr))}.meter-layout{grid-template-columns:150px minmax(0,1fr)}}
@media(max-width:1050px){.decision-grid{grid-template-columns:1fr}.meter-layout{grid-template-columns:200px minmax(0,1fr)}}
@media(max-width:800px){.decision-grid{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.pulse-banner{padding:14px 16px}}
.legend-row{text-decoration:none;border-radius:8px;padding:3px 5px}.legend-row:hover,.legend-row:focus-visible{background:#eef2fb}.meter a:focus-visible circle{stroke-width:23px}.activity-primary a{color:#395cb9;font-weight:750}
@media(max-width:480px){.pulse-banner{display:block}.pulse-link{display:inline-block;margin:11px 0 0 26px}.meter-layout{grid-template-columns:145px minmax(0,1fr);padding:0 7px}.meter-legend{gap:7px;padding:0 7px 0 0}.legend-row{font-size:.72rem;grid-template-columns:10px minmax(0,1fr) 22px;gap:5px}.sample-note{margin:0 13px 15px}.recent-panel .activity-list{grid-template-columns:1fr}.card{padding:12px}.card strong{font-size:1.25rem}}

</style>
</head>
<body>
<a class="skip" href="#main-content">Skip to dashboard</a>
<div class="shell">
<aside class="sidebar" aria-label="Console navigation">
<header class="header">
<div class="brand"><span class="brand-mark" aria-hidden="true">CO</span><div><p class="eyebrow">OPERATOR WORKSPACE</p><h1>Cline Orchestrator</h1></div></div>
<p class="subtitle">A clear view of orchestrated work, without execution authority.</p>
</header>
<nav class="contents" aria-label="Dashboard sections">
<h2>Workspace</h2>
<ul>
<li><a href="#overview"><span class="nav-number" aria-hidden="true">01</span>Overview</a></li>
<li><a href="#attention"><span class="nav-number" aria-hidden="true">02</span>Attention</a></li>
<li><a href="#tasks"><span class="nav-number" aria-hidden="true">03</span>Tasks</a></li>
<li><a href="#writers"><span class="nav-number" aria-hidden="true">04</span>Active writers</a></li>
<li><a href="#workflows"><span class="nav-number" aria-hidden="true">05</span>Workflows</a></li>
<li><a href="#incidents"><span class="nav-number" aria-hidden="true">06</span>Incidents</a></li>
<li><a href="#handoffs"><span class="nav-number" aria-hidden="true">07</span>Specialist handoffs</a></li>
<li><a href="#sources"><span class="nav-number" aria-hidden="true">08</span>Data quality</a></li>
</ul>
</nav>
<div class="sidebar-footer"><strong>VIEW-ONLY SESSION</strong><p>No task, agent, credential, service or release actions are available here.</p></div>
</aside>
<main id="main-content" class="content" tabindex="-1">
<div class="topbar"><span class="topbar-label"><span class="local-dot" aria-hidden="true"></span>Local operator console</span><span class="mode-pill">Read-only snapshot</span></div>
<section id="overview" aria-labelledby="overview-heading">
<div class="section-head"><div><p class="eyebrow">Your workspace at a glance</p><h2 id="overview-heading">Overview</h2><p class="section-intro">The work, decisions and source coverage that matter right now.</p></div><div class="capture"><strong>Snapshot captured</strong><time datetime="${escapeHtml(view.generatedAt)}">${escapeHtml(view.generatedAt)}</time></div></div>
<div class="pulse-banner" role="status" aria-label="Snapshot health: ${escapeHtml(view.header.health)}">
<div class="pulse-left"><span class="status-light ${healthTone}" aria-hidden="true"></span><div><strong>${escapeHtml(view.header.health === "healthy" ? "Observed sources healthy" : view.header.health === "attention" ? "Some work needs attention" : view.header.health === "critical" ? "Critical observations detected" : "System visibility incomplete")}</strong><p>${escapeHtml(view.header.unavailableSources)} unavailable · ${escapeHtml(view.header.staleSources)} stale · ${escapeHtml(sourceConcerns)} sources with notices · Health: ${escapeHtml(view.header.health)}</p></div></div>
<a href="#sources" class="pulse-link">See source status →</a>
</div>
<div class="cards">${cards}</div>
<div class="decision-grid">
<div class="preview-panel outcomes-panel">
<div class="preview-head"><h3>Work outcomes</h3><a href="#tasks">See task records →</a></div>
<p class="preview-caption">How the ${escapeHtml(taskSampleSize)} visible task records are distributed by status.</p>
${workMeter}
</div>
<div class="preview-panel attention-panel">
<div class="preview-head"><h3>Needs attention</h3><a href="#attention">See all notices →</a></div>
<p class="preview-caption">Review-waiting, failed and stalled records from the bounded task sample.</p>
${attentionPreview}
<div class="attention-source-footer"><span>${escapeHtml(sourceConcerns)} sources need a closer look</span><a href="#sources">Review coverage →</a></div>
</div>
</div>
<div class="preview-panel recent-panel">
<div class="preview-head"><h3>Recent work</h3><a href="#tasks">See all shown tasks →</a></div>
<p class="preview-caption">Latest five rows in the current task snapshot, not a chronological audit trail.</p>
${taskPreview}</div>
<p class="snapshot-notice">Counts are from a bounded, manually refreshed snapshot, not a live guarantee. Up to 100 tasks may be returned, and missing monitoring feeds are not shown as zeros. Refresh this page to capture a new bounded snapshot. Sign-in sessions expire after 10 minutes; historical rows are not a complete audit trail.</p>
</section>
<section id="attention" aria-labelledby="attention-heading"><div class="section-hdr"><div><h2 id="attention-heading">Attention</h2><p>Items identified from the currently available sanitized evidence.</p></div><span class="section-index">02 / 08</span></div><div class="panel">${attention}</div></section>
<section id="tasks" aria-labelledby="tasks-heading"><div class="section-hdr"><div><h2 id="tasks-heading">Tasks</h2><p>Bounded task records and independent validation indicators.</p></div><span class="section-index">03 / 08</span></div><div class="panel">${sourceWarning(view, "tasks")}${tasks}</div></section>
<section id="writers" aria-labelledby="writers-heading"><div class="section-hdr"><div><h2 id="writers-heading">Active writers</h2><p>Writer leases indicate coordination, not agent/model health or permission to execute.</p></div><span class="section-index">04 / 08</span></div><div class="panel">${writers}</div></section>
<section id="workflows" aria-labelledby="workflows-heading"><div class="section-hdr"><div><h2 id="workflows-heading">Workflows</h2><p>Source status is shown explicitly; disconnected workflows cannot be considered idle.</p></div><span class="section-index">05 / 08</span></div><div class="panel">${sourceWarning(view, "workflows")}${workflows}</div></section>
<section id="incidents" aria-labelledby="incidents-heading"><div class="section-hdr"><div><h2 id="incidents-heading">Incidents</h2><p>Only current evidence is shown; missing incident feeds do not mean there are no incidents.</p></div><span class="section-index">06 / 08</span></div><div class="panel">${sourceWarning(view, "incidents")}${incidents}</div></section>
<section id="handoffs" aria-labelledby="handoffs-heading"><div class="section-hdr"><div><h2 id="handoffs-heading">Specialist handoffs</h2><p>A bounded timeline is not an audit log; disconnected sources cannot confirm no activity.</p></div><span class="section-index">07 / 08</span></div><div class="panel">${handoffs}</div></section>
<section id="sources" aria-labelledby="sources-heading"><div class="section-hdr"><div><h2 id="sources-heading">Data quality and source notices</h2><p>Freshness, availability, truncation and source errors remain visible.</p></div><span class="section-index">08 / 08</span></div><div class="panel">${sources}</div></section>
<p class="footer">Read-only operator dashboard · Snapshot generated ${escapeHtml(view.generatedAt)} · No actions available. Section links stay inside this document. No machine, task, credential, installation, Git or release controls are exposed.</p>
</main>
</div>
</body>
</html>`;
}
