import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* M19E4D: exercise the actual installed, bundled CLI against an isolated
 * synthetic loopback provider. No operator configuration or real task.
 */
if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Disposable installed Windows Node and CLI required");
const [node, entry] = process.argv.slice(2);
const root = await mkdtemp(path.join(os.tmpdir(), "m19e4d-installed-"));
const user = path.join(root, "user");
const dir = path.join(user, "ClineOrchestrator");
await mkdir(dir, { recursive: true });
const target = path.join(dir, "config.json");
const env = { ...process.env, LOCALAPPDATA: user };
for (const name of Object.keys(env)) {
  if (name.toUpperCase().startsWith("ORCH_")) delete env[name];
}
let probes = 0;
let modelChecks = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/v1/models" && req.method === "GET") {
    modelChecks++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "saved-test-model" }] }));
    return;
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    probes++;
    let data = "";
    for await (const chunk of req) {
      data += String(chunk);
      assert.ok(data.length <= 2048, "Only a bounded harmless prompt is allowed");
    }
    const prompt = JSON.parse(data);
    assert.equal(prompt.model, "saved-test-model");
    assert.equal(prompt.stream, false);
    assert.equal(prompt.max_tokens, 12);
    assert.equal(prompt.messages.length, 1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "M19E4D_PRIVATE_RESPONSE_SENTINEL" } }],
    }));
    return;
  }
  res.writeHead(404); res.end();
});
async function command(args) {
  const child = spawn(node, [entry, ...args], {
    env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", d => { stdout += d; });
  child.stderr.on("data", d => { stderr += d; });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  return { exit, stdout, stderr };
}
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const endpoint = "http://127.0.0.1:" + server.address().port + "/v1";
  const original = JSON.stringify({
    schemaVersion: 1,
    provider: { providerId: "openai-compatible",
      modelId: "saved-test-model", baseUrl: endpoint },
    runtime: { autoApproveCommands: false, autoApproveEdits: false },
    daemon: { host: "127.0.0.1" },
  });
  await writeFile(target, original);
  const beforeFiles = await readdir(dir);
  assert.deepEqual(beforeFiles, ["config.json"]);
  const correct = await command(["test-saved-model-desktop", sha(original)]);
  assert.equal(correct.exit, 0, correct.stderr);
  assert.ok(correct.stdout.length < 4096);
  const receipt = JSON.parse(correct.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.command, "test-saved-model-desktop");
  assert.equal(receipt.status, "response_observed");
  assert.equal(receipt.inferenceResponseObserved, true);
  assert.equal(receipt.configSaved, false);
  assert.equal(receipt.taskStarted, false);
  assert.equal(receipt.modelStarted, false);
  assert.equal(receipt.modelAuthenticityVerified, false);
  assert.equal(receipt.grantsAuthority, false);
  assert.equal(modelChecks, 1);
  assert.equal(probes, 1);
  assert.doesNotMatch(correct.stdout,
    /M19E4D_PRIVATE_RESPONSE_SENTINEL|saved-test-model|127\.0\.0\.1|apiKeySecretRef|baseUrl/);
  assert.equal(await readFile(target, "utf8"), original);
  assert.deepEqual(await readdir(dir), beforeFiles);

  const stale = await command(["test-saved-model-desktop", "a".repeat(64)]);
  assert.notEqual(stale.exit, 0);
  assert.equal(modelChecks, 1, "Stale revision must never reach provider");
  assert.equal(probes, 1);
  assert.equal(await readFile(target, "utf8"), original);

  const invalid = JSON.stringify({ ...JSON.parse(original), provider: {
    providerId: "openai-compatible", modelId: "saved-test-model",
    baseUrl: "https://example.com/v1",
  } });
  await writeFile(target, invalid);
  const remote = await command(["test-saved-model-desktop", sha(invalid)]);
  assert.notEqual(remote.exit, 0);
  assert.equal(modelChecks, 1);
  assert.equal(probes, 1);
  assert.equal(await readFile(target, "utf8"), invalid);
  assert.deepEqual(await readdir(dir), beforeFiles);
  console.log(JSON.stringify({
    proof: "M19E4D-installed-saved-model-revision",
    syntheticOnly: true, realLlamaPilotPassed: false,
    savedRevisionVerified: true, staleRefusedBeforeInference: true,
    remoteRejected: true, settingsUnchanged: true, startsTask: false,
    startsModel: false, releaseAuthorized: false, grantsAuthority: false,
  }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
