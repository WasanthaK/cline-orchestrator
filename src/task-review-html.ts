import type {
  ReviewEvidenceState,
  TaskReviewDisposition,
  TaskReviewProjectionV1,
} from "./task-review-projection.js";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const ACTIVE = new Set([
  "created", "running", "waiting", "waiting_for_human", "stalled",
  "validating", "repairing", "safety_checking",
]);
const REVIEWABLE = new Set(["completed", "validation_failed", "failed"]);
const CLOSED = new Set(["aborted", "rolled_back"]);
const EVIDENCE_STATES = new Set(["passed", "failed", "unavailable"]);

const PASSIVE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && ISO_TIME.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function optionalTime(value: unknown): boolean {
  return value === undefined || validTime(value);
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= 1_000_000_000;
}

function optionalCount(value: unknown): boolean {
  return value === undefined || validCount(value);
}

function validState(value: unknown): value is ReviewEvidenceState {
  return typeof value === "string" && EVIDENCE_STATES.has(value);
}

function expectedDisposition(status: string): TaskReviewDisposition | undefined {
  if (ACTIVE.has(status)) return "in_progress";
  if (REVIEWABLE.has(status)) return "inspection_required";
  if (CLOSED.has(status)) return "closed_without_completion_review";
  return undefined;
}

function fail(): never {
  throw new Error("passive review page requires consistent authority-free evidence");
}

function validate(view: TaskReviewProjectionV1): void {
  if (!view || view.schemaVersion !== 1
    || view.authority !== "trusted_completion_packet_projection_only"
    || view.readOnly !== true || view.grantsAuthority !== false
    || !Array.isArray(view.actions) || view.actions.length !== 0
    || typeof view.taskId !== "string" || !SAFE_ID.test(view.taskId)
    || typeof view.projectId !== "string" || !SAFE_ID.test(view.projectId)
    || typeof view.workspaceId !== "string" || !SAFE_ID.test(view.workspaceId)
    || !validTime(view.capturedAt)
    || expectedDisposition(view.taskStatus) !== view.disposition
    || !view.workerTestimony
    || typeof view.workerTestimony.available !== "boolean"
    || view.workerTestimony.trust !== "untrusted_worker_claims"
    || view.workerTestimony.reportExposed !== false
    || view.caution !== "independent_evidence_not_supervisor_decision"
    || !view.evidence) fail();
  const { validation, diffSafety, git, checkpoint, recovery } = view.evidence;
  if (!validation || validation.source !== "orchestrator_validation"
    || !validState(validation.state)
    || !optionalCount(validation.commandsRequested)
    || !optionalCount(validation.commandsRun)
    || !optionalTime(validation.completedAt)
    || (validation.state === "unavailable" && (
      validation.commandsRequested !== undefined || validation.commandsRun !== undefined
      || validation.completedAt !== undefined
    ))
    || (validation.commandsRequested !== undefined && validation.commandsRun !== undefined
      && validation.commandsRun > validation.commandsRequested)
    || !diffSafety || diffSafety.source !== "orchestrator_diff_safety"
    || !validState(diffSafety.state)
    || !optionalCount(diffSafety.changedFiles)
    || !optionalCount(diffSafety.warnings)
    || !optionalCount(diffSafety.failures)
    || !optionalTime(diffSafety.checkedAt)
    || (diffSafety.state === "unavailable" && (
      diffSafety.changedFiles !== undefined || diffSafety.warnings !== undefined
      || diffSafety.failures !== undefined || diffSafety.checkedAt !== undefined
    ))
    || (diffSafety.state === "passed" && (diffSafety.failures ?? 0) !== 0)
    || !git || git.source !== "orchestrator_git_snapshot"
    || typeof git.beforeAvailable !== "boolean" || typeof git.afterAvailable !== "boolean"
    || !checkpoint || checkpoint.source !== "orchestrator_checkpoint"
    || typeof checkpoint.available !== "boolean" || typeof checkpoint.restored !== "boolean"
    || !optionalCount(checkpoint.runCount)
    || (checkpoint.restored && !checkpoint.available)
    || (!checkpoint.available && checkpoint.runCount !== undefined)
    || !recovery || recovery.source !== "orchestrator_runtime_state"
    || !validCount(recovery.runs) || !validCount(recovery.recoveries)
    || !validCount(recovery.retries) || !validCount(recovery.stalls)) fail();
}

function row(label: string, value: string): string {
  return '<div class="metric"><dt>' + escapeHtml(label)
    + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
}

function show(value: number | undefined): string {
  return value === undefined ? "Not recorded" : String(value);
}

function evidenceLabel(state: ReviewEvidenceState): string {
  switch (state) {
    case "passed": return "Passed — independently checked";
    case "failed": return "Failed — independently checked";
    case "unavailable": return "Unavailable — not verified";
  }
}

function section(id: string, title: string, contents: string): string {
  return '<section id="' + id + '" aria-labelledby="' + id
    + '-heading"><h2 id="' + id + '-heading">' + escapeHtml(title)
    + '</h2>' + contents + '</section>';
}

const STYLES = [
  ":root{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color-scheme:light dark;line-height:1.5}",
  "*{box-sizing:border-box}",
  "body{margin:0;background:Canvas;color:CanvasText;padding:20px}",
  "main{max-width:1050px;margin:0 auto}",
  "h1{font-size:clamp(1.5rem,3vw,2.1rem);line-height:1.2;margin:0 0 5px}",
  "h2{font-size:1.22rem;margin:0 0 14px}",
  "section{margin:25px 0;padding:18px;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:12px}",
  ".meta{opacity:.8;margin:4px 0 16px;overflow-wrap:anywhere}",
  ".banner{border-left:4px solid currentColor;padding:12px 14px;margin:14px 0;font-weight:600}",
  ".subtle{font-weight:400;opacity:.85}",
  "dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
  ".metric{min-width:0;padding:12px;border-radius:8px;background:color-mix(in srgb,CanvasText 6%,transparent)}",
  "dt{font-size:.84rem;opacity:.83;margin-bottom:3px}",
  "dd{margin:0;font-weight:600;overflow-wrap:anywhere}",
  ".badge{border:1px solid currentColor;border-radius:999px;padding:2px 8px;display:inline-block;overflow-wrap:anywhere}",
  ".warning{padding:12px;border:1px solid currentColor;border-radius:8px}",
  ".skip{position:absolute;top:-150px;left:10px;padding:10px;background:Canvas;color:CanvasText;border:2px solid currentColor}",
  ".skip:focus{top:10px}",
  "a:focus-visible{outline:3px solid Highlight;outline-offset:3px}",
  "@media(max-width:700px){body{padding:12px}section{padding:14px}dl{grid-template-columns:1fr}}",
  "@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}",
].join("");

/**
 * UX-D2: static, action-free task review page from the bounded trusted
 * projection ONLY. There is no worker text, diff content, filesystem path,
 * approval mechanism, browser script, external asset or network call.
 */
export function renderTaskReviewHtml(view: TaskReviewProjectionV1): string {
  validate(view);
  const { validation, diffSafety, git, checkpoint, recovery } = view.evidence;
  const requiresReview = view.disposition === "inspection_required";
  const headline = view.disposition === "in_progress" ? "Task is still in progress"
    : requiresReview ? "Inspection required — not approved"
      : "Task closed without completion review";
  const incomplete = validation.state === "unavailable" || diffSafety.state === "unavailable";
  const evidence = [
    row("Validation", evidenceLabel(validation.state)),
    row("Commands requested", show(validation.commandsRequested)),
    row("Commands run", show(validation.commandsRun)),
    row("Validation completed", validation.completedAt ?? "Not recorded"),
    row("Diff safety", evidenceLabel(diffSafety.state)),
    row("Files changed", show(diffSafety.changedFiles)),
    row("Warnings", show(diffSafety.warnings)),
    row("Failures", show(diffSafety.failures)),
    row("Diff checked", diffSafety.checkedAt ?? "Not recorded"),
  ].join("");
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="' + PASSIVE_CSP + '">',
    '<meta name="referrer" content="no-referrer">',
    '<title>Cline Orchestrator — Task review evidence</title>',
    '<style>' + STYLES + '</style></head><body>',
    '<a class="skip" href="#task-review-main">Skip to task review</a>',
    '<main id="task-review-main" tabindex="-1">',
    '<header><h1>Task review evidence</h1>',
    '<p class="meta">Read-only snapshot captured ' + escapeHtml(view.capturedAt) + '</p>',
    '<p class="banner" role="status">' + escapeHtml(headline) + '</p>',
    '<p class="warning">Independent evidence is not a supervisor decision, Safety approval, permission to execute, or release authorization.</p></header>',
    section("task-identity", "Task identity", '<dl>' + [
      row("Task", view.taskId),
      row("Project", view.projectId),
      row("Workspace", view.workspaceId),
      row("Status", view.taskStatus.replaceAll("_", " ")),
      row("Review disposition", view.disposition.replaceAll("_", " ")),
    ].join("") + '</dl>'),
    section("independent-evidence", "Independent validation and diff safety",
      (incomplete ? '<p class="warning" role="note">Some independent checks are unavailable. Missing evidence is not success.</p>' : "")
      + '<dl>' + evidence + '</dl>'),
    section("git-checkpoint", "Git and checkpoint availability", '<dl>' + [
      row("Git before snapshot", git.beforeAvailable ? "Available" : "Unavailable — not verified"),
      row("Git after snapshot", git.afterAvailable ? "Available" : "Unavailable — not verified"),
      row("Checkpoint", checkpoint.available ? "Available" : "Unavailable — not verified"),
      row("Checkpoint restored", checkpoint.restored ? "Yes" : "No"),
      row("Checkpoint run", show(checkpoint.runCount)),
    ].join("") + '</dl><p class="subtle">Raw Git refs, branch names, diffs, files and checkpoint identifiers are intentionally hidden.</p>'),
    section("runtime-history", "Runtime and recovery counters", '<dl>' + [
      row("Runs", String(recovery.runs)),
      row("Recoveries", String(recovery.recoveries)),
      row("Retries", String(recovery.retries)),
      row("Stalls", String(recovery.stalls)),
    ].join("") + '</dl>'),
    section("worker-report", "Worker testimony", '<p class="warning">'
      + (view.workerTestimony.available
        ? "A Cline completion report exists, but is untrusted worker testimony and is not shown."
        : "No Cline completion report is present. This does not determine task success.")
      + '</p>'),
    '<p class="meta">This page has no approve, reject, resume, rollback, machine, credential, Git or release controls.</p>',
    '</main></body></html>',
  ].join("");
}
