import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Installed Windows Node and CLI entry required");
const [node, entry] = process.argv.slice(2);
const directory = await mkdtemp(path.join(os.tmpdir(), "m19c3-status-"));
const local = path.join(directory, "localdata");
await mkdir(local);
const env = { ...process.env, LOCALAPPDATA: local };
for (const key of Object.keys(env))
  if (key.toUpperCase().startsWith("ORCH_")) delete env[key];
const server = createServer((req, res) => {
  if (req.url !== "/v1/models") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "readiness-test" }] }));
});

async function status() {
  const child = spawn(node, [entry, "readiness-desktop"], {
    env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", x => { stdout += x; });
  child.stderr.on("data", x => { stderr += x; });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exit, 0, stderr);
  assert.ok(stdout.length < 8192);
  const result = JSON.parse(stdout);
  assert.equal(result.command, "readiness-desktop");
  assert.equal(result.grantsAuthority, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.setupCompleteIsTaskAuthority, false);
  assert.deepEqual(result.steps.map(s => s.id), ["model","settings","project","workspace"]);
  assert.doesNotMatch(stdout, /readiness-test|localdata|\/v1\/models|apiKey|Bearer/);
  return result;
}
try {
  const fresh = await status();
  assert.equal(fresh.status, "needs_setup");
  assert.deepEqual(fresh.steps.map(x => x.state), ["needed","needed","needed","needed"]);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const directoryForConfig = path.join(local, "ClineOrchestrator");
  await mkdir(directoryForConfig);
  const configFile = path.join(directoryForConfig, "config.json");
  await writeFile(configFile, JSON.stringify({
    schemaVersion: 1, provider: {
      providerId: "openai-compatible", modelId: "readiness-test",
      baseUrl: "http://127.0.0.1:" + port + "/v1",
    }, runtime: { autoApproveCommands: false, autoApproveEdits: false },
    daemon: { host: "127.0.0.1" },
  }));
  const before = await readFile(configFile, "utf8");
  const connected = await status();
  assert.deepEqual(connected.steps.map(x => x.state), ["ready","ready","needed","needed"]);
  assert.equal(connected.status, "needs_setup");
  assert.equal(await readFile(configFile, "utf8"), before);

  await new Promise(resolve => server.close(resolve));
  const offline = await status();
  assert.equal(offline.status, "attention");
  assert.equal(offline.steps[0].state, "attention");
  assert.equal(offline.steps[1].state, "ready");
  assert.equal(await readFile(configFile, "utf8"), before);

  await writeFile(configFile, "SENTINEL_INVALID_CONFIG");
  const invalid = await status();
  assert.equal(invalid.status, "attention");
  assert.equal(invalid.steps[1].state, "attention");
  assert.equal(await readFile(configFile, "utf8"), "SENTINEL_INVALID_CONFIG");
  console.log(JSON.stringify({
    proof: "M19C3-installed-native-readiness",
    freshInstall: true, connectedLocalModel: true,
    disconnectedFailsClosed: true, invalidConfigPreserved: true,
    launchesTask: false, grantsAuthority: false,
  }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
