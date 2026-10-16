import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Windows installed Node and CLI entry required");
const [node, entry] = process.argv.slice(2);
const root = await mkdtemp(path.join(os.tmpdir(), "m19d2-installed-"));
const home = path.join(root, "localdata");
const directory = path.join(home, "ClineOrchestrator");
await mkdir(directory, { recursive: true });
const target = path.join(directory, "config.json");
const env = { ...process.env, LOCALAPPDATA: home };
for (const key of Object.keys(env))
  if (key.toUpperCase().startsWith("ORCH_")) delete env[key];

const server = createServer((req, res) => {
  if (req.url !== "/v1/models") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "after" }] }));
});
async function run(args, reply) {
  const child = spawn(node, [entry, ...args], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "", sent = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", value => {
    output += value;
    if (!sent && reply !== undefined && output.includes("\n")) {
      sent = true;
      const review = JSON.parse(output.split("\n")[0]);
      assert.equal(review.kind, "settings-revision-review");
      assert.equal(review.requiresExactReply, "UPDATE CONFIG");
      assert.equal(review.grantsAuthority, false);
      child.stdin.end(reply + "\n");
    }
  });
  child.stderr.on("data", value => { error += value; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  return { code, output, error, sent };
}
try {
  const missing = await run(["settings-desktop"]);
  assert.equal(JSON.parse(missing.output).status, "missing");
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = "http://127.0.0.1:" + server.address().port + "/v1";
  const original = JSON.stringify({
    schemaVersion: 1,
    provider: { providerId: "openai-compatible", modelId: "before", baseUrl },
    runtime: { autoApproveEdits: false, autoApproveCommands: false, maxIterations: 6 },
    daemon: { host: "127.0.0.1" },
  });
  await writeFile(target, original);
  const inspect = JSON.parse((await run(["settings-desktop"])).output);
  assert.equal(inspect.status, "configured");
  assert.match(inspect.revision, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(inspect), /config.json|localdata|apiKey/);
  const args = ["update-settings-desktop", inspect.revision,
    "openai-compatible", "after", baseUrl];
  const declined = await run(args, "CANCEL");
  assert.equal(declined.code, 0, declined.error);
  assert.equal(await readFile(target, "utf8"), original);
  const updated = await run(args, "UPDATE CONFIG");
  assert.equal(updated.code, 0, updated.error);
  assert.equal(JSON.parse(updated.output.trim().split("\n").at(-1)).outcome, "updated");
  assert.equal(JSON.parse(await readFile(target, "utf8")).provider.modelId, "after");
  assert.equal(JSON.parse(await readFile(target, "utf8")).runtime.maxIterations, 6);
  assert.equal(await readFile(path.join(directory,
    "config.previous-" + inspect.revision + ".json"), "utf8"), original);
  const stale = await run(args, "UPDATE CONFIG");
  assert.notEqual(stale.code, 0);
  assert.equal(stale.sent, false);
  assert.equal((await readdir(directory)).length, 2);
  console.log(JSON.stringify({ proof: "M19D2-installed-provider-revision",
    cancellation: true, previousVersionPreserved: true,
    staleDenied: true, startsTask: false, grantsAuthority: false }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
