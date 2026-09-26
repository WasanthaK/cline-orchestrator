import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { SafetyPlanError, SafetyPlanService } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
import { TaskStore } from "./state.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]) {
  await execFile("git", args, { cwd, windowsHide: true });
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-safe-start-root-"));
  await git(root, "init");
  await git(root, "config", "user.email", "ci@example.test");
  await git(root, "config", "user.name", "CI Test");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");

  const registryPath = path.join(await mkdtemp(path.join(os.tmpdir(), "orch-safe-start-registry-")), "registry.json");
  const registry = new WorkspaceRegistry(registryPath);
  const project = await registry.registerProject("Safe Project");
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Safe Workspace",
    root,
    safetyProfile: {
      policyVersion: "policy-v1",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*", ".git/**"],
      validationCommands: ["npm test"],
      workerProfileId: "safe-worker-v1",
      maxChangedFiles: 20,
    },
  });
  return { root, registry, project, workspace };
}

test("approved task start persists only server-side plan authority", async () => {
  const { root, registry, project, workspace } = await setup();
  const plans = new SafetyPlanService(registry);
  const preview = await plans.preview({
    workspaceId: workspace.workspaceId,
    goal: "Update the source safely",
    requestedScope: ["src/**"],
  });

  const started = await startApprovedTask(plans, preview.planToken);
  assert.equal(started.workspaceRoot, root);
  assert.equal(started.task.projectId, project.projectId);
  assert.equal(started.task.workspaceId, workspace.workspaceId);
  assert.equal(started.task.workspaceRegistryRevision, 1);
  assert.equal(started.task.safetyPolicyVersion, "policy-v1");
  assert.equal(started.task.workerProfileId, "safe-worker-v1");
  assert.deepEqual(started.task.expectedChangedPaths, ["src/**"]);
  assert.deepEqual(started.task.approvedAllowedPathPatterns, ["src/**"]);
  assert.deepEqual(started.task.approvedProtectedPathPatterns, [".env*", ".git/**"]);

  const reloaded = await new TaskStore(root).load(started.task.id);
  assert.equal(reloaded.safetyPlanId, started.task.safetyPlanId);
  assert.equal(reloaded.workspaceId, workspace.workspaceId);
  assert.deepEqual(reloaded.approvedAllowedPathPatterns, ["src/**"]);

  const raw = await readFile(path.join(root, ".orchestrator", "tasks", `${started.task.id}.json`), "utf8");
  assert.equal(raw.includes(preview.planToken), false, "opaque plan token must not enter durable task state");
});

test("approved task start cannot replay a consumed plan token", async () => {
  const { registry, workspace } = await setup();
  const plans = new SafetyPlanService(registry);
  const preview = await plans.preview({ workspaceId: workspace.workspaceId, goal: "One task only" });

  await startApprovedTask(plans, preview.planToken);
  await assert.rejects(
    startApprovedTask(plans, preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_replayed",
  );
});
