import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// M19D4: actual installed Node/product CLI observation, not a mock or host
// development run. All file/model resources are disposable and user-local.
if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Installed Windows Node and product CLI arguments required");
const [node, entry] = process.argv.slice(2);
const root = await mkdtemp(path.join(os.tmpdir(), "m19d4-installed-"));
const local = path.join(root, "local");
await mkdir(local);
const env = { ...process.env, LOCALAPPDATA: local };
for (const key of Object.keys(env))
  if (key.toUpperCase().startsWith("ORCH_")) delete env[key];

const server = createServer((req, res) => {
  if (req.url !== "/v1/models") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "ops-test-model" }] }));
});

async function observe() {
  const child = spawn(node, [entry, "operations-desktop"], {
    env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 45_000,
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  assert.equal(exit, 0, stderr);
  assert.ok(stdout.length > 0 && stdout.length < 8192);
  const record = JSON.parse(stdout);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.command, "operations-desktop");
  assert.equal(record.readOnly, true);
  assert.equal(record.grantsAuthority, false);
  assert.equal(record.viewerRequiredForTaskDrilldown, true);
  assert.equal(record.additionalSources, "not_connected");
  assert.equal(record.history.scope, "bounded_current_sample");
  assert.deepEqual(record.setup.steps.map(item => item.id),
    ["model", "settings", "project", "workspace"]);
  const history = record.history;
  if (history.state === "available") {
    assert.ok(Number.isSafeInteger(history.counts.sampled));
    assert.ok(history.counts.sampled >= 0 && history.counts.sampled < 100);
    for (const name of ["active", "needsAttention", "completed"]) {
      assert.ok(Number.isSafeInteger(history.counts[name]));
      assert.ok(history.counts[name] >= 0 && history.counts[name] <= history.counts.sampled);
    }
  } else {
    assert.ok(["incomplete", "unavailable"].includes(history.state));
    assert.deepEqual(history.counts,
      { sampled: null, active: null, needsAttention: null, completed: null });
  }
  assert.doesNotMatch(stdout, /ops-test-model|local[\\/]ClineOrchestrator|Bearer |apiKey|apiKeySecretRef|taskId|workspaceId|workerProfileId|providerId|modelId/);
  return record;
}

try {
  const fresh = await observe();
  assert.equal(fresh.setup.steps[0].state, "needed");
  assert.equal(fresh.setup.steps[1].state, "needed");

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const configured = path.join(local, "ClineOrchestrator");
  await mkdir(configured);
  const file = path.join(configured, "config.json");
  const original = JSON.stringify({
    schemaVersion: 1,
    provider: { providerId: "openai-compatible", modelId: "ops-test-model",
      baseUrl: "http://127.0.0.1:" + server.address().port + "/v1" },
    runtime: { autoApproveEdits: false, autoApproveCommands: false },
    daemon: { host: "127.0.0.1" },
  });
  await writeFile(file, original);
  const connected = await observe();
  assert.equal(connected.setup.steps[0].state, "ready");
  assert.equal(connected.setup.steps[1].state, "ready");
  assert.equal(await readFile(file, "utf8"), original);

  await new Promise(resolve => server.close(resolve));
  const offline = await observe();
  assert.equal(offline.setup.steps[0].state, "attention");
  assert.equal(offline.setup.steps[1].state, "ready");
  assert.equal(await readFile(file, "utf8"), original);

  await writeFile(file, "M19D4_CORRUPT_SETTINGS_SENTINEL");
  const corrupted = await observe();
  assert.equal(corrupted.setup.steps[1].state, "attention");
  assert.equal(await readFile(file, "utf8"), "M19D4_CORRUPT_SETTINGS_SENTINEL");

  console.log(JSON.stringify({
    proof: "M19D4-installed-operations",
    freshStatus: true, connectedLocalModel: true, offlineUnknownHealth: true,
    corruptedSettingsFailClosed: true, boundedTaskEvidence: true,
    configNeverMutatedByObservation: true,
    taskStarted: false, grantsAuthority: false,
  }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
