import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import { taskGroup, tasksInGroup, safeTaskHref, taskStatusGroup } from "./operator-task-groups.js";

type Task = OperatorVisualizationV1["taskBoard"][number];
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function evidence(v: boolean | undefined): string {
  return v === undefined ? "Not available" : v ? "Passed" : "Failed";
}
const style = ':root{font:15px/1.6 system-ui;color-scheme:light;background:#f4f6fb;color:#243754}*{box-sizing:border-box}body{margin:0}.layout{max-width:1120px;margin:auto;padding:28px 20px}.top{background:#142446;color:white;padding:22px;border-radius:14px}.top a{color:#dbe5ff}a{color:#3d5cae}a:focus-visible,.scroll:focus-visible{outline:3px solid #6d8bff;outline-offset:3px}section{background:white;border:1px solid #e1e7f1;border-radius:14px;padding:22px;margin:17px 0}h1{font-size:1.7rem}h2{font-size:1.1rem}.minor{color:#61718e}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:13px}dt{color:#61718e;font-size:.82rem}dd{margin:4px 0;font-weight:700;overflow-wrap:anywhere}table{min-width:650px;width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e1e7f1;font-size:.83rem}.scroll{overflow-x:auto}.notice{padding:12px;background:#fff6e7;color:#765120;border-radius:9px}@media(max-width:600px){.layout{padding:12px}section{padding:14px}}';
function shell(title: string, description: string, body: string, captured: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src &#39;none&#39;; script-src &#39;none&#39;; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' — Cline Orchestrator</title><style>' + style + '</style></head><body><div class="layout"><header class="top"><a href="/viewer#overview">← Overview</a><p><strong>Cline Orchestrator · Read-only investigation</strong></p></header><main><h1>' + esc(title) + '</h1><p>' + esc(description) + '</p><p class="minor">Snapshot captured ' + esc(captured) + ' · No actions available</p>'
    + body + '</main></div></body></html>';
}
function sourceWarning(view: OperatorVisualizationV1): string {
  const n = view.sourceNotices.find(item => item.source === "tasks");
  return n && (!n.available || n.stale || n.truncated || n.errorCode)
    ? '<p class="notice">Task source is unavailable, stale or incomplete. Records shown may not represent a complete current list.</p>' : '';
}
function projectName(t: Task): string { return t.projectDisplayName ? esc(t.projectDisplayName) : esc(t.projectId); }
function workspaceName(t: Task): string { return t.workspaceDisplayName ? esc(t.workspaceDisplayName) : esc(t.workspaceId); }
function taskRow(t: Task): string {
  const href = safeTaskHref(t.taskId);
  return '<tr><td>' + (href ? '<a href="' + href + '">Task …' + esc(t.taskId.slice(-8)) + ' →</a>' : '<code>' + esc(t.taskId) + '</code>')
    + '</td><td>' + projectName(t) + '</td><td>' + esc(t.status) + '</td><td>' + esc(t.updatedAt) + '</td></tr>';
}
export function renderTaskGroupHtml(view: OperatorVisualizationV1, slug: string): string {
  const g = taskGroup(slug);
  if (!g || !view.readOnly || view.actions.length) throw new Error("invalid read-only group");
  const tasks = tasksInGroup(view.taskBoard, g.slug);
  const table = tasks.length
    ? '<div class="scroll" role="region" tabindex="0" aria-label="Filtered task records"><table><thead><tr><th>Task</th><th>Project ID</th><th>Status</th><th>Updated</th></tr></thead><tbody>' + tasks.map(taskRow).join('') + '</tbody></table></div>'
    : '<p>No matching tasks in this bounded sample. This does not establish that none exist elsewhere.</p>';
  return shell(g.label + ' tasks', tasks.length + ' matching records in this bounded snapshot', '<section><h2>' + esc(g.label) + ' tasks</h2>' + sourceWarning(view) + '<p class="minor">The filter applies to visible sanitized task records, not lifetime history.</p>' + table + '</section>', view.generatedAt);
}
export function renderTaskDetailHtml(view: OperatorVisualizationV1, id: string): string {
  if (!safeTaskHref(id) || !view.readOnly || view.actions.length) throw new Error("invalid read-only task");
  const matches = view.taskBoard.filter(t => t.taskId === id);
  if (matches.length !== 1) throw new Error("task not uniquely present in snapshot");
  const t = matches[0]!;
  const field = (name: string, value: unknown) => '<div><dt>' + esc(name) + '</dt><dd>' + esc(value) + '</dd></div>';
  const body = '<section><h2>Task summary</h2>' + sourceWarning(view) + '<dl>'
    + field('Status', t.status) + field('Project', t.projectDisplayName ?? 'Name unavailable') + field('Workspace', t.workspaceDisplayName ?? 'Name unavailable')
    + field('Last updated', t.updatedAt) + field('Run count', t.runCount)
    + field('Recovery count', t.recoveryCount) + '</dl></section>'
    + '<section><h2>Independent evidence</h2><dl>' + field('Validation', evidence(t.validationPassed))
    + field('Diff safety', evidence(t.diffSafetyPassed)) + '</dl><p class="notice">Completed does not imply independently approved or released. Worker testimony is not proof.</p></section>'
    + '<section><h2>Run-by-run history</h2><p class="minor">Not available from this sanitized dashboard reader. Run and recovery counts are aggregate evidence, not a verified timeline.</p></section>'
    + '<section><h2>Technical identifiers</h2><dl>' + field('Task ID', t.taskId) + field('Project ID', t.projectId) + field('Workspace ID', t.workspaceId) + '</dl></section>'
    + '<p><a href="/viewer/status/' + esc(taskStatusGroup(t.status)) + '">← Status-filtered tasks</a></p>';
  return shell('Task …' + t.taskId.slice(-8), 'Read-only task details and available evidence', body, view.generatedAt);
}
