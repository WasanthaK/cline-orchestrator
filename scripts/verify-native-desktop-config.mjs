import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Windows installed Node and runtime entry arguments required");
const [node, entry] = process.argv.slice(2);
const tmp = await mkdtemp(path.join(os.tmpdir(), "m19c2-installed-"));
const server = createServer((request, response) => {
  if (request.url !== "/v1/models") {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: [{ id: "test-model" }] }));
});
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const url = "http://127.0.0.1:" + port + "/v1";
  const home = path.join(tmp, "local-app-data");
  const stateDir = path.join(home, "ClineOrchestrator");
  await mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, "config.json");
  const localEnv = { ...process.env, LOCALAPPDATA: home };
  for (const key of Object.keys(localEnv))
    if (key.startsWith("ORCH_")) delete localEnv[key];

  async function run(reply) {
    const child = spawn(node, [entry, "setup-config-desktop",
      "openai-compatible", "test-model", url], {
      env: localEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "", errors = "";
    let confirmationSeen = false, status = -1;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!confirmationSeen && output.includes("\n")) {
        confirmationSeen = true;
        const preview = JSON.parse(output.split("\n")[0]);
        assert.equal(preview.kind, "config-review");
        assert.equal(preview.modelId, "test-model");
        assert.equal(preview.requiresExactReply, "CREATE CONFIG");
        assert.equal(preview.grantsAuthority, false);
        child.stdin.end(reply + "\n");
      }
    });
    child.stderr.on("data", chunk => { errors += chunk; });
    status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { status, output, errors, confirmationSeen };
  }

  const cancelled = await run("CANCEL");
  assert.equal(cancelled.status, 0, cancelled.errors);
  assert.equal(JSON.parse(cancelled.output.trim().split("\n").at(-1)).outcome, "cancelled");
  assert.deepEqual(await readdir(stateDir), []);

  const approved = await run("CREATE CONFIG");
  assert.equal(approved.status, 0, approved.errors);
  assert.equal(JSON.parse(approved.output.trim().split("\n").at(-1)).outcome, "created");
  const config = JSON.parse(await readFile(target, "utf8"));
  assert.equal(config.provider.baseUrl, url);
  assert.equal(config.provider.modelId, "test-model");
  assert.equal(config.runtime.autoApproveCommands, false);
  assert.equal(config.runtime.autoApproveEdits, false);

  const preserve = await readFile(target, "utf8");
  const blocked = await run("CREATE CONFIG");
  assert.equal(blocked.status, 1, "second create-only attempt must fail");
  assert.equal(blocked.confirmationSeen, false);
  assert.equal(await readFile(target, "utf8"), preserve);
  assert.ok(!blocked.errors.includes(home), "private path must be sanitized");
  console.log(JSON.stringify({ slice: "M19C2", localConfigCreated: true,
    declinedWithoutWrite: true, replacementRejected: true,
    userStatePreserved: true, modelLaunched: false, taskLaunched: false,
    grantsAuthority: false }));
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
}
