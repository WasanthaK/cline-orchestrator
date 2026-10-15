import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Installed bundled Node and CLI entry required");
const [node, entry] = process.argv.slice(2);
const localData = await mkdtemp(path.join(os.tmpdir(), "m19c2-project-"));
const registryPath = path.join(localData, "cline-orchestrator", "workspace-registry.json");
const env = { ...process.env, LOCALAPPDATA: localData };
for (const key of Object.keys(env))
  if (key.startsWith("ORCH_")) delete env[key];

async function run(name, approval, expectPreview = true) {
  const child = spawn(node, [entry, "setup-project-desktop", name], {
    env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stdout = "", stderr = "", replied = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (!replied && stdout.includes("\n")) {
      replied = true;
      const preview = JSON.parse(stdout.split("\n")[0]);
      assert.equal(preview.kind, "project-review");
      assert.equal(preview.projectName, name);
      assert.equal(preview.destination, "local_user_workspace_registry");
      assert.equal(preview.grantsAuthority, false);
      assert.equal(preview.requiresExactReply, "REGISTER PROJECT");
      child.stdin.end(approval + "\n");
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(replied, expectPreview, "Unexpected confirmation behavior");
  return { status, stdout, stderr };
}
try {
  const cancel = await run("Test Project", "CANCEL");
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(JSON.parse(cancel.stdout.trim().split("\n").at(-1)).outcome, "cancelled");
  await assert.rejects(readFile(registryPath, "utf8"), { code: "ENOENT" });

  const create = await run("Test Project", "REGISTER PROJECT");
  assert.equal(create.status, 0, create.stderr);
  const receipt = JSON.parse(create.stdout.trim().split("\n").at(-1));
  assert.equal(receipt.kind, "project-result");
  assert.equal(receipt.outcome, "created");
  assert.match(receipt.projectId, /^[0-9a-f-]{36}$/);
  assert.equal(receipt.grantsAuthority, false);
  const document = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(document.projects.length, 1);
  assert.equal(document.projects[0].projectId, receipt.projectId);
  assert.equal(document.workspaces.length, 0);

  const sentinel = await readFile(registryPath, "utf8");
  await writeFile(registryPath, "EXISTING-PRIVATE-REGISTRY");
  const malformed = await run("Another Project", "REGISTER PROJECT", false);
  assert.equal(malformed.status, 1);
  assert.equal(await readFile(registryPath, "utf8"), "EXISTING-PRIVATE-REGISTRY");
  assert.ok(!malformed.stderr.includes(localData));
  await writeFile(registryPath, sentinel);

  console.log(JSON.stringify({ result: "M19C2B1-project-acceptance",
    cancelledWithoutWrite: true, projectCreatedWithConsent: true,
    malformedRegistryPreserved: true, workspacesRegistered: 0,
    taskStarted: false, grantsAuthority: false }));
} finally {
  await rm(localData, { recursive: true, force: true });
}
