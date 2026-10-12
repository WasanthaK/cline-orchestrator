import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportOfflineSetupView } from "./offline-setup-view-export.js";
import { routeProductCli, runProductCli } from "./product-cli.js";
import { assessFirstRun } from "./first-run-assessment.js";

function assessment() {
  return assessFirstRun({
    runtime: { schemaVersion: 1, nodeVersion: "v22.15.0", platform: "linux", architecture: "x64", authority: "first_run_runtime_observation", grantsAuthority: false },
    provider: { schemaVersion: 1, configured: false, preflightSupported: true, authority: "first_run_provider_observation", grantsAuthority: false },
    workspace: { schemaVersion: 1, registered: false, safetyProfileConfigured: false, validationCommandsConfigured: false, authority: "first_run_workspace_observation", grantsAuthority: false },
    daemon: { schemaVersion: 1, hostClass: "loopback", port: 4317, running: false, authority: "first_run_daemon_observation", grantsAuthority: false },
  });
}

test("UX-E2a offline snapshot is standalone, inert and contains no raw private fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orch-view-"));
  try {
    const file = path.join(dir, "review.html");
    const poisonedAssessment = { ...assessment(), privateCredential: "SECRET_PRIVATE_CANARY" };
    const receipt = await exportOfflineSetupView(poisonedAssessment, file);
    assert.equal(receipt.created, true);
    assert.equal(receipt.opensListener, false);
    assert.equal(receipt.grantsAuthority, false);
    const html = await readFile(file, "utf8");
    assert.match(html, /Read-only checklist/);
    assert.match(html, /connect-src 'none'/);
    assert.doesNotMatch(html, /SECRET_PRIVATE_CANARY|<script|<form|<button|<input|<iframe|fetch\(/i);
    await assert.rejects(exportOfflineSetupView(assessment(), file), { code: "output_exists" });
    assert.deepEqual(await readdir(dir), ["review.html"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UX-E2a never replaces operator-owned HTML or a symlink", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orch-view-"));
  try {
    const other = path.join(dir, "other.html");
    await writeFile(other, "preserve");
    const link = path.join(dir, "link.html");
    await symlink(other, link);
    await assert.rejects(exportOfflineSetupView(assessment(), link), { code: "output_exists" });
    assert.equal(await readFile(other, "utf8"), "preserve");
    await assert.rejects(exportOfflineSetupView(assessment(), path.join(dir, "bad.json")), { code: "output_invalid" });
    await assert.rejects(exportOfflineSetupView(assessment(), path.join(dir, "missing", "new.html")), { code: "output_invalid" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UX-E2a CLI routes one read-only diagnosis and safe export without daemon start", async () => {
  assert.deepEqual(routeProductCli(["setup-view", "./workspace", "./view.html"]),
    { kind: "setup_view", workspace: "./workspace", outputFile: "./view.html" });
  assert.deepEqual(routeProductCli(["--config", "choice.json", "setup-view", "./workspace", "./view.html"]),
    { kind: "setup_view", workspace: "./workspace", outputFile: "./view.html", configPath: "choice.json" });
  assert.throws(() => routeProductCli(["setup-view", "one"]), { code: "usage_invalid" });
  const dir = await mkdtemp(path.join(os.tmpdir(), "orch-view-"));
  try {
    let calls = 0;
    await runProductCli(["setup-view", dir, path.join(dir, "view.html")], {
      env: {}, runtime: { nodeVersion: "v22.15.0", platform: "linux", architecture: "x64" },
      findWorkspace: async () => ({ schemaVersion: 1, registered: false,
        safetyProfileConfigured: false, validationCommandsConfigured: false,
        authority: "first_run_workspace_observation", grantsAuthority: false }),
      fetchJson: async () => { calls++; return { ok: false, status: 0 }; },
      dispatchLegacy: async () => { assert.fail("must not start daemon"); },
    });
    assert.ok(calls > 0);
    assert.match(await readFile(path.join(dir, "view.html"), "utf8"), /First-run readiness/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
