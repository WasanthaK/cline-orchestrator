import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Installed Windows Node and product CLI arguments required");
const [node, entry] = process.argv.slice(2);
const temp = await mkdtemp(path.join(os.tmpdir(), "m19e4c-installed-"));
let completions = 0, models = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    models++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "test-local" }] }));
    return;
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    completions++;
    let request = "";
    for await (const part of req) {
      request += String(part);
      if (request.length > 2048) break;
    }
    const body = JSON.parse(request);
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 12);
    assert.equal(body.model, "test-local");
    assert.equal(body.messages.length, 1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant",
      content: "TEST_RESPONSE_DO_NOT_LOG" } }] }));
    return;
  }
  res.writeHead(404); res.end();
});
async function command(args) {
  const env = { ...process.env, LOCALAPPDATA: temp };
  for (const key of Object.keys(env))
    if (key.toUpperCase().startsWith("ORCH_")) delete env[key];
  const child = spawn(node, [entry, ...args], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  let out = "", error = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", d => { out += d; });
  child.stderr.on("data", d => { error += d; });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  return { exit, out, error };
}
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const endpoint = "http://127.0.0.1:" + server.address().port + "/v1";
  const args = ["test-local-inference", "openai-compatible", "test-local", endpoint];
  const result = await command(args);
  assert.equal(result.exit, 0, result.error);
  const receipt = JSON.parse(result.out);
  assert.equal(receipt.status, "response_observed");
  assert.equal(receipt.inferenceResponseObserved, true);
  assert.equal(receipt.modelAuthenticityVerified, false);
  assert.equal(receipt.taskStarted, false);
  assert.equal(receipt.configSaved, false);
  assert.equal(receipt.modelStarted, false);
  assert.equal(receipt.grantsAuthority, false);
  assert.equal(models, 1);
  assert.equal(completions, 1);
  // The command name is intentionally "test-local-inference". Reject only
  // actual private model/endpoint values and upstream completion text.
  assert.doesNotMatch(result.out, /TEST_RESPONSE_DO_NOT_LOG|127\\.0\\.0\\.1|"modelId"|"baseUrl"|"test-local"/);
  const missing = await command(["test-local-inference",
    "openai-compatible", "not-there", endpoint]);
  assert.equal(missing.exit, 0, missing.error);
  assert.equal(JSON.parse(missing.out).status, "metadata_not_ready");
  assert.equal(completions, 1, "Missing alias must not produce another prompt");
  const blocked = await command(["test-local-inference",
    "openai-compatible", "test-local", "http://example.com:80/v1"]);
  assert.notEqual(blocked.exit, 0);
  assert.equal(completions, 1);
  assert.deepEqual(await readdir(temp), [], "Probe must not create user state");
  console.log(JSON.stringify({
    proof: "M19E4C-installed-native-inference", mockOnly: true,
    boundedPromptVerified: true, missingAliasRejected: true,
    remoteTargetRejected: true, actualRealModelPilotPassed: false,
    configSaved: false, taskStarted: false, grantsAuthority: false,
  }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
