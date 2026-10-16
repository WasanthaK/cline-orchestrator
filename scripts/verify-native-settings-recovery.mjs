import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4) throw new Error("Windows installed CLI required");
const [node, entry] = process.argv.slice(2);
const root = await mkdtemp(path.join(os.tmpdir(), "m19d3a-installed-"));
const home = path.join(root, "local");
const directory = path.join(home, "ClineOrchestrator");
await mkdir(directory, { recursive: true });
const env = { ...process.env, LOCALAPPDATA: home };
for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("ORCH_")) delete env[key];
async function run() {
  const child = spawn(node, [entry, "recovery-desktop"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", x => { out += x; }); child.stderr.on("data", x => { err += x; });
  const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(exit, 0, err);
  assert.ok(out.length < 8192);
  const result = JSON.parse(out);
  assert.equal(result.command, "recovery-desktop");
  assert.equal(result.readOnly, true);
  assert.equal(result.restorationAvailable, false);
  assert.equal(result.grantsAuthority, false);
  assert.doesNotMatch(out, /apiKey|config\.json|ClineOrchestrator|localdata/);
  return result;
}
try {
  assert.equal((await run()).status, "unavailable");
  const current = JSON.stringify({
    schemaVersion: 1,
    provider: { providerId: "openai-compatible", modelId: "model", baseUrl: "http://127.0.0.1:8080/v1" },
    runtime: { autoApproveCommands: false, autoApproveEdits: false },
    daemon: { host: "127.0.0.1" },
  });
  const target = path.join(directory, "config.json");
  await writeFile(target, current);
  assert.equal((await run()).status, "no_previous_version");
  const hash = crypto.createHash("sha256").update(current).digest("hex");
  const backup = path.join(directory, "config.previous-" + hash + ".json");
  await writeFile(backup, current);
  const verified = await run();
  assert.equal(verified.status, "verified_versions");
  assert.equal(verified.verifiedCount, 1);
  await writeFile(backup, current + "CORRUPT");
  assert.equal((await run()).status, "needs_attention");
  assert.equal(await readFile(target, "utf8"), current);
  console.log(JSON.stringify({ proof: "M19D3A-installed-recovery-observation",
    verified: true, tamperingRejected: true, noRestoration: true, grantsAuthority: false }));
} finally { await rm(root, { recursive: true, force: true }); }
