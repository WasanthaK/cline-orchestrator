import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4)
  throw new Error("Windows installed Node and CLI entry required");
const [node, entry] = process.argv.slice(2);
const temp = await mkdtemp(path.join(os.tmpdir(), "m19c2b2-installed-"));
const state = path.join(temp, "local-appdata");
const registryFile = path.join(state, "cline-orchestrator", "workspace-registry.json");
const workspace = path.join(temp, "disposable-workspace");
await mkdir(state, { recursive: true });
await mkdir(workspace);
const env = { ...process.env, LOCALAPPDATA: state };
for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("ORCH_")) delete env[name];

function invoke(command, args = [], input, response, expectedKind) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [entry, command, ...args], {
      env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", review, answered = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Windows native registration timed out"));
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (expectedKind && !answered && stdout.includes("\n")) {
        try {
          review = JSON.parse(stdout.split("\n")[0]);
          assert.equal(review.kind, expectedKind);
          assert.equal(review.grantsAuthority, false);
          answered = true;
          child.stdin.end(response + "\n");
        } catch (error) { child.kill(); reject(error); }
      }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, review, answered });
    });
    if (input !== undefined) {
      child.stdin.write(JSON.stringify(input) + "\n");
      if (!expectedKind) child.stdin.end();
    } else if (!expectedKind) child.stdin.end();
  });
}

try {
  const created = await invoke("setup-project-desktop", ["Disposable Project"],
    undefined, "REGISTER PROJECT", "project-review");
  assert.equal(created.status, 0, created.stderr);
  const project = JSON.parse(created.stdout.trim().split("\n").at(-1));
  assert.equal(project.outcome, "created");
  const projectId = project.projectId;

  const list = await invoke("list-projects-desktop");
  assert.equal(list.status, 0, list.stderr);
  const entries = JSON.parse(list.stdout.trim());
  assert.equal(entries.kind, "local-projects");
  assert.equal(entries.grantsAuthority, false);
  assert.equal(entries.projects.length, 1);
  assert.equal(entries.projects[0].projectId, projectId);

  const payload = {
    projectId, displayName: "Disposable Workspace", root: workspace,
    safetyProfile: {
      policyVersion: "v1", workerProfileId: "local-test",
      maxChangedFiles: 1, allowedPathPatterns: ["test/**"],
      protectedPathPatterns: ["src/**"], validationCommands: ["npm test"],
    },
  };
  const before = await readFile(registryFile, "utf8");
  const cancel = await invoke("setup-workspace-desktop", [], payload, "CANCEL", "workspace-review");
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(cancel.review.action, "register_workspace");
  assert.equal(cancel.review.destination, "local_user_workspace_registry");
  assert.equal(cancel.review.requiresExactReply, "REGISTER WORKSPACE");
  // Windows TEMP may be returned as an 8.3 alias (RUNNER~1) while the
  // registration service deliberately resolves the physical long path.
  assert.equal(cancel.review.canonicalRoot.toLowerCase(),
    (await realpath(workspace)).toLowerCase());
  assert.deepEqual(cancel.review.registration.safetyProfile, payload.safetyProfile);
  assert.equal(JSON.parse(cancel.stdout.trim().split("\n").at(-1)).outcome, "cancelled");
  assert.equal(await readFile(registryFile, "utf8"), before);

  const approve = await invoke("setup-workspace-desktop", [], payload,
    "REGISTER WORKSPACE", "workspace-review");
  assert.equal(approve.status, 0, approve.stderr);
  const receipt = JSON.parse(approve.stdout.trim().split("\n").at(-1));
  assert.equal(receipt.outcome, "registered");
  assert.equal(receipt.projectId, projectId);
  assert.match(receipt.workspaceId, /^[0-9a-f-]{36}$/);
  const document = JSON.parse(await readFile(registryFile, "utf8"));
  assert.equal(document.workspaces.length, 1);
  assert.deepEqual(document.workspaces[0].safetyProfile.allowedPathPatterns, ["test/**"]);
  assert.deepEqual(document.workspaces[0].safetyProfile.protectedPathPatterns, ["src/**"]);
  assert.deepEqual(document.workspaces[0].safetyProfile.validationCommands, ["npm test"]);
  assert.equal(document.workspaces[0].safetyProfile.maxChangedFiles, 1);

  const preserved = await readFile(registryFile, "utf8");
  const duplicate = await invoke("setup-workspace-desktop", [], payload);
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.answered, false);
  assert.equal(await readFile(registryFile, "utf8"), preserved);
  assert.equal(duplicate.stderr.includes(state), false);
  console.log(JSON.stringify({
    result: "M19C2B2", projectPicker: true, cancelledWithoutWrite: true,
    registeredWithExactSafetyReview: true, duplicateDenied: true,
    taskStarted: false, grantsAuthority: false,
  }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
