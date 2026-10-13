import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGuidedSetupAction, GUIDED_SETUP_ACTION_CONTRACT } from "./first-run-guided-action.js";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

function assessment(): FirstRunAssessmentV1 {
  return {
    schemaVersion: 1, assessedAt: "2026-10-12T07:00:00.000Z", status: "needs_setup",
    nodeCompatible: true, providerReady: false, workspaceReady: false,
    daemonSafe: true, daemonRunning: false,
    setupSteps: [{ code: "configure_provider", required: true }, { code: "register_workspace", required: true }],
    summaryCodes: ["provider_not_configured", "workspace_not_registered"],
    authority: "first_run_assessment_observation_only",
    readOnly: true, writesConfig: false, registersWorkspace: false, startsService: false,
    opensListener: false, performsNetworkMutation: false, usesCredentials: false, grantsAuthority: false,
  };
}

test("UX-C2 exposes no browser or independent write authority", () => {
  assert.equal(GUIDED_SETUP_ACTION_CONTRACT.browserExposure, "none");
  assert.equal(GUIDED_SETUP_ACTION_CONTRACT.clientMayExecuteWithoutHostConfirmation, false);
  assert.equal(GUIDED_SETUP_ACTION_CONTRACT.rawCredentialsInReview, false);
  assert.equal(GUIDED_SETUP_ACTION_CONTRACT.grantsReleaseAuthority, false);
});

test("UX-C2 local config setup delegates to actual create-only confirmation service", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guided-setup-"));
  try {
    const file = path.join(dir, "config.json");
    const config = { schemaVersion: 1, provider: { providerId: "ollama-openai",
      modelId: "local-model", baseUrl: "http://127.0.0.1:8080/v1", apiKeySecretRef: "TEST_KEY_REF" } };
    let confirmations = 0;
    const host = { async confirmLocalReview(review: Parameters<Parameters<typeof runGuidedSetupAction>[2]["confirmLocalReview"]>[0]) {
      confirmations++;
      assert.equal(review.action, "write_config");
      assert.equal(review.scope, "new_local_config");
      assert.equal(review.grantsAuthority, false);
      assert.doesNotMatch(JSON.stringify(review), /TEST_KEY_REF|8080|config\.json|confirmationToken|payloadDigest/);
      return true;
    } };
    const result = await runGuidedSetupAction(assessment(), { action: "write_config", targetPath: file, config }, host);
    assert.equal(result.outcome, "completed");
    assert.equal(confirmations, 1);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), config);
    await assert.rejects(runGuidedSetupAction(assessment(), { action: "write_config", targetPath: file, config }, host),
      { code: "service_failed" });
    assert.equal(confirmations, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UX-C2 cancellation leaves config and registry untouched", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guided-setup-"));
  try {
    const registry = new WorkspaceRegistry(path.join(dir, "registry.json"));
    const host = { registry, confirmLocalReview: async () => false };
    const result = await runGuidedSetupAction(assessment(),
      { action: "register_project", registration: { displayName: "Example" } }, host);
    assert.equal(result.outcome, "cancelled");
    assert.deepEqual(await registry.listProjects(), []);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UX-C2 one selected registration delegates to existing scoped service", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guided-setup-"));
  try {
    const registry = new WorkspaceRegistry(path.join(dir, "registry.json"));
    const outcome = await runGuidedSetupAction(assessment(), { action: "register_project",
      registration: { displayName: "Local project" } }, { registry, confirmLocalReview: async review => {
        assert.equal(review.action, "register_project");
        assert.equal(review.scope, "local_project");
        assert.doesNotMatch(JSON.stringify(review), /registry\.json|confirmationToken/);
        return true;
      } });
    assert.equal(outcome.outcome, "completed");
    assert.equal((await registry.listProjects()).length, 1);
    assert.equal(outcome.grantsAuthority, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UX-C2 eligibility, forged readiness and missing host confirmation fail closed", async () => {
  const command = { action: "register_project" as const, registration: { displayName: "Example" } };
  await assert.rejects(runGuidedSetupAction(assessment(), command, {} as never),
    { code: "local_confirmation_required" });
  await assert.rejects(runGuidedSetupAction({ ...assessment(), grantsAuthority: true } as never, command,
    { confirmLocalReview: async () => true }), { code: "action_not_allowed" });
  await assert.rejects(runGuidedSetupAction(assessment(), { action: "start_loopback_daemon",
    workspaceId: "11111111-1111-4111-8111-111111111111" },
    { confirmLocalReview: async () => true }), { code: "action_not_allowed" });
});

test("UX-C2 rejects expired confirmation and does not leak trusted adapter errors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guided-setup-"));
  try {
    let now = 100_000;
    const file = path.join(dir, "new.json");
    const host = { setupOptions: { now: () => now }, confirmLocalReview: async () => { now += 60_000; return true; } };
    await assert.rejects(runGuidedSetupAction(assessment(), { action: "write_config",
      targetPath: file, config: { schemaVersion: 1 } }, host), error => {
        assert.equal((error as { code: string }).code, "service_failed");
        assert.doesNotMatch(String(error), /new\.json|config|100000/);
        return true;
      });
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
