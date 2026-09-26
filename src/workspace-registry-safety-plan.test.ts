import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { bindTaskToSafetyPlan, SafetyPlanError, SafetyPlanService, SafetyPlanStore } from "./safety-plan.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceRegistry, WorkspaceRegistryError } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]) {
  await execFile("git", args, { cwd, windowsHide: true });
}

async function makeRepo(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await git(root, "init");
  await git(root, "config", "user.email", "ci@example.test");
  await git(root, "config", "user.name", "CI Test");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  return root;
}

function profile() {
  return {
    policyVersion: "policy-v1",
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: [".env*", ".git/**"],
    validationCommands: ["npm test"],
    workerProfileId: "safe-worker-v1",
    maxChangedFiles: 25,
  };
}

async function configuredRegistry(root: string) {
  const registryFile = path.join(await mkdtemp(path.join(os.tmpdir(), "orch-registry-")), "registry.json");
  const registry = new WorkspaceRegistry(registryFile);
  const project = await registry.registerProject("Example Project");
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Example Workspace",
    root,
    safetyProfile: profile(),
  });
  return { registry, project, workspace };
}

test("registry canonicalizes roots, exposes opaque discovery IDs, and rejects aliases", async () => {
  const root = await makeRepo("orch-registry-root-");
  const { registry, project, workspace } = await configuredRegistry(root);

  assert.equal(workspace.projectId, project.projectId);
  assert.equal(path.resolve(workspace.canonicalRoot), path.resolve(root));
  assert.notEqual(workspace.workspaceId, root);

  const discovered = await registry.listWorkspaces();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0]?.workspaceId, workspace.workspaceId);
  assert.equal(discovered[0]?.rootAlias, path.basename(root));
  assert.equal("canonicalRoot" in (discovered[0] ?? {}), false);

  const alias = path.join(path.dirname(root), `${path.basename(root)}-alias`);
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Alias",
      root: alias,
      safetyProfile: profile(),
    }),
    (error: unknown) => error instanceof WorkspaceRegistryError && error.code === "duplicate_root",
  );
});

test("registry rejects a filesystem root", async () => {
  const registryFile = path.join(await mkdtemp(path.join(os.tmpdir(), "orch-registry-")), "registry.json");
  const registry = new WorkspaceRegistry(registryFile);
  const project = await registry.registerProject("Unsafe");
  const filesystemRoot = path.parse(process.cwd()).root;

  await assert.rejects(
    registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Unsafe Root",
      root: filesystemRoot,
      safetyProfile: profile(),
    }),
    (error: unknown) => error instanceof WorkspaceRegistryError && error.code === "unsafe_root",
  );
});

test("Safety Preview is read-only and plan consumption is single-use", async () => {
  const root = await makeRepo("orch-plan-replay-");
  const { registry, workspace } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry, new SafetyPlanStore(), { ttlMs: 60_000 });

  const preview = await service.preview({
    workspaceId: workspace.workspaceId,
    goal: "Change the sample source",
    requestedScope: ["src/**"],
  });

  assert.equal(preview.workspaceId, workspace.workspaceId);
  assert.equal(preview.policyVersion, "policy-v1");
  assert.equal(preview.allowedPathPatterns[0], "src/**");
  assert.ok(preview.planToken.length >= 43);

  const consumed = await service.consumeForTask(preview.planToken);
  assert.equal(consumed.binding.workspaceId, workspace.workspaceId);
  assert.equal(consumed.binding.workspaceRegistryRevision, 1);

  await assert.rejects(
    service.consumeForTask(preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_replayed",
  );
});

test("expired plan tokens fail closed", async () => {
  const root = await makeRepo("orch-plan-expiry-");
  const { registry, workspace } = await configuredRegistry(root);
  let now = new Date("2026-09-22T00:00:00.000Z");
  const service = new SafetyPlanService(registry, new SafetyPlanStore(), {
    ttlMs: 1_000,
    now: () => now,
  });
  const preview = await service.preview({ workspaceId: workspace.workspaceId, goal: "Edit source" });
  now = new Date("2026-09-22T00:00:02.000Z");

  await assert.rejects(
    service.consumeForTask(preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_expired",
  );
});

test("registry safety-profile revision invalidates an existing plan", async () => {
  const root = await makeRepo("orch-plan-registry-stale-");
  const { registry, workspace } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry);
  const preview = await service.preview({ workspaceId: workspace.workspaceId, goal: "Edit source" });

  await registry.updateSafetyProfile(workspace.workspaceId, {
    ...profile(),
    policyVersion: "policy-v2",
  });

  await assert.rejects(
    service.consumeForTask(preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_stale",
  );
});

test("Git dirty-state change invalidates an existing plan", async () => {
  const root = await makeRepo("orch-plan-dirty-stale-");
  const { registry, workspace } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry);
  const preview = await service.preview({ workspaceId: workspace.workspaceId, goal: "Edit source" });

  await writeFile(path.join(root, "src", "index.ts"), "export const value = 2;\n", "utf8");

  await assert.rejects(
    service.consumeForTask(preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_stale",
  );
});

test("Git HEAD change invalidates an existing plan", async () => {
  const root = await makeRepo("orch-plan-head-stale-");
  const { registry, workspace } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry);
  const preview = await service.preview({ workspaceId: workspace.workspaceId, goal: "Edit source" });

  await writeFile(path.join(root, "src", "second.ts"), "export const second = true;\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "move head");

  await assert.rejects(
    service.consumeForTask(preview.planToken),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "plan_stale",
  );
});

test("requested scope cannot broaden registered authority", async () => {
  const root = await makeRepo("orch-plan-scope-");
  const { registry, workspace } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry);

  await assert.rejects(
    service.preview({
      workspaceId: workspace.workspaceId,
      goal: "Edit outside scope",
      requestedScope: ["deploy/**"],
    }),
    (error: unknown) => error instanceof SafetyPlanError && error.code === "scope_invalid",
  );
});

test("consumed safety identity can be persisted on the durable task", async () => {
  const root = await makeRepo("orch-plan-binding-");
  const { registry, workspace, project } = await configuredRegistry(root);
  const service = new SafetyPlanService(registry);
  const preview = await service.preview({ workspaceId: workspace.workspaceId, goal: "Edit source" });
  const consumed = await service.consumeForTask(preview.planToken);
  const now = new Date().toISOString();
  const task: OrchestratorTask = {
    id: "task-1",
    goal: consumed.plan.goal,
    workspace: consumed.workspace.canonicalRoot,
    status: "created",
    createdAt: now,
    updatedAt: now,
  };

  const bound = bindTaskToSafetyPlan(task, consumed.binding);
  assert.equal(bound.projectId, project.projectId);
  assert.equal(bound.workspaceId, workspace.workspaceId);
  assert.equal(bound.safetyPlanId, consumed.plan.planId);
  assert.deepEqual(bound.approvedAllowedPathPatterns, ["src/**"]);
  assert.equal(bound.workerProfileId, "safe-worker-v1");
});
