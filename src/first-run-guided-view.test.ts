import assert from "node:assert/strict";
import test from "node:test";
import { buildGuidedSetupView } from "./first-run-guided-view.js";
import { renderGuidedSetupHtml } from "./first-run-guided-html.js";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";

function assessment(): FirstRunAssessmentV1 {
  return {
    schemaVersion: 1, assessedAt: "2026-10-12T07:00:00.000Z", status: "needs_setup",
    nodeCompatible: true, providerReady: false, workspaceReady: false, daemonSafe: true,
    daemonRunning: false, setupSteps: [
      { code: "configure_provider", required: true },
      { code: "register_workspace", required: true },
      { code: "start_daemon", required: false },
    ], summaryCodes: ["provider_not_configured", "workspace_not_registered"],
    authority: "first_run_assessment_observation_only", readOnly: true,
    writesConfig: false, registersWorkspace: false, startsService: false, opensListener: false,
    performsNetworkMutation: false, usesCredentials: false, grantsAuthority: false,
  };
}

test("UX-C1 composes bounded setup guidance without carrying provider credentials or endpoints", () => {
  const model = buildGuidedSetupView(assessment());
  assert.equal(model.readOnly, true);
  assert.deepEqual(model.actions, []);
  assert.equal(model.grantsAuthority, false);
  assert.deepEqual(model.steps.map(x => x.code), ["configure_provider", "register_workspace", "start_daemon"]);
  assert.equal(model.gates.find(x => x.id === "provider")?.state, "needs_attention");
  const html = renderGuidedSetupHtml(model);
  assert.match(html, /First-run readiness/);
  assert.match(html, /Read-only checklist/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script|<form|<button|<input|<a |href=|fetch\(|onclick=|websocket/i);
});

test("UX-C1 rejects authority-widened or inconsistent readiness evidence", () => {
  assert.throws(() => buildGuidedSetupView({ ...assessment(), grantsAuthority: true } as unknown as FirstRunAssessmentV1));
  assert.throws(() => buildGuidedSetupView({ ...assessment(), status: "ready" }));
  assert.throws(() => buildGuidedSetupView({ ...assessment(), setupSteps: [{ code: "configure_provider", required: true }, { code: "configure_provider", required: true }] }));
  assert.throws(() => buildGuidedSetupView({ ...assessment(), setupSteps: [{ code: "untrusted" as "configure_provider", required: true }] }));
  assert.throws(() => renderGuidedSetupHtml({ ...buildGuidedSetupView(assessment()), actions: [{ action: "install" }] } as unknown as ReturnType<typeof buildGuidedSetupView>));
});

test("UX-C1 displays unknown production readiness without claiming green", () => {
  const model = buildGuidedSetupView(assessment());
  assert.equal(model.gates.find(x => x.id === "production")?.state, "not_assessed");
  assert.equal(model.gates.find(x => x.id === "local_daemon")?.state, "not_assessed");
  assert.doesNotMatch(renderGuidedSetupHtml(model), /production approved/i);
});

test("UX-C1 output omits injected private fields and remains escaped", () => {
  const a = { ...assessment(), rawKey: "CANARY_PRIVATE_CREDENTIAL", daemonUrl: "http://secret-host" };
  const model = buildGuidedSetupView(a);
  const html = renderGuidedSetupHtml(model);
  assert.doesNotMatch(html, /CANARY_PRIVATE_CREDENTIAL|secret-host/);
  const changed = { ...model, gates: model.gates.map(x => x.id === "provider" ? { ...x, title: "<img src=x onerror=alert(1)>" } : x) };
  const escaped = renderGuidedSetupHtml(changed);
  assert.ok(escaped.includes("&lt;img"));
  assert.doesNotMatch(escaped, /<img/);
});
