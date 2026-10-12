import type { GuidedSetupViewV1 } from "./first-run-guided-view.js";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Standalone passive renderer: no browser API, links, form or actions. */
export function renderGuidedSetupHtml(view: GuidedSetupViewV1): string {
  if (view.schemaVersion !== 1 || view.readOnly !== true || view.grantsAuthority !== false
    || !Array.isArray(view.actions) || view.actions.length !== 0
    || !Array.isArray(view.gates) || view.gates.length !== 5
    || !Array.isArray(view.steps) || view.steps.length > 32) {
    throw new Error("guided setup HTML requires an authority-free bounded view");
  }
  const gates = view.gates.map((item) =>
    `<li><strong>${esc(item.title)}</strong> — ${esc(item.state.replaceAll("_", " "))}<p>${esc(item.detail)}</p></li>`).join("");
  const steps = view.steps.length
    ? `<ol>${view.steps.map((item) =>
        `<li><strong>${esc(item.title)}</strong> (${item.required ? "required" : "optional"})<p>${esc(item.description)}</p></li>`).join("")}</ol>`
    : "<p>No setup steps reported in this snapshot.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'">
<title>First-run setup — Cline Orchestrator</title>
<style>:root{font:16px/1.5 system-ui;color-scheme:light dark}body{margin:0;padding:20px;color:CanvasText;background:Canvas}main{max-width:900px;margin:auto}h1{line-height:1.2}h2{margin-top:26px}li{padding:8px 0}li p{margin:3px 0;opacity:.82}.note{padding:12px;border:1px solid currentColor;border-radius:8px}*:focus-visible{outline:3px solid Highlight}@media(max-width:540px){body{padding:12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}</style>
</head><body><main><h1>First-run readiness</h1>
<p>Assessment: <strong>${esc(view.status)}</strong> · ${esc(view.assessedAt)}</p>
<p class="note" role="note">Read-only checklist. Nothing is configured, registered, started or approved by viewing this page. A ready assessment is not production release authorization.</p>
<section aria-labelledby="gates"><h2 id="gates">Readiness checks</h2><ul>${gates}</ul></section>
<section aria-labelledby="steps"><h2 id="steps">Next steps</h2>${steps}</section>
</main></body></html>`;
}
