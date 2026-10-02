import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { listRegisteredWorkspaceIncidents } from "./sentinel-query.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]) {
  await execFile("git", args, { cwd, windowsHide: true });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-sentinel-query-"));
  await git(root, "init");
  await git(root, "config", "user.email", "ci@example.test");
  await git(root, "config", "user.name", "CI Test");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");

  const registryRoot = await mkdtemp(path.join(os.tmpdir(), "orchestrator-sentinel-registry-"));
  const registry = new WorkspaceRegistry(path.join(registryRoot, "registry.json"));
  const project = await registry.registerProject("Sentinel Query Test");
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Sentinel Query Workspace",
    root,
    safetyProfile: {
      policyVersion: "sentinel-test-v1",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*", ".git/**"],
      validationCommands: ["npm test"],
      workerProfileId: "safe-worker",
      maxChangedFiles: 10,
    },
  });

  const taskId = "22222222-2222-4222-8222-222222222222";
  const store = new TaskStore(root);
  await store.save({
    id: taskId,
    goal: "sentinel query test",
    workspace: root,
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  } as OrchestratorTask);
  return { root, registryRoot, registry, workspace, taskId, store };
}

test("registered workspace incident query refreshes durable events and returns sanitized bounded views", async () => {
  const { root, registryRoot, registry, workspace, taskId, store } = await fixture();
  try {
    await store.appendEvent(taskId, "validation_failed", {
      status: "validation_failed",
      message: `Validation failed in ${root} with api_key=do-not-leak`,
    });

    const incidents = await listRegisteredWorkspaceIncidents(registry, workspace.workspaceId, {
      limit: 10,
    });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.kind, "validation_failure");
    assert.equal(incidents[0]?.status, "open");

    const serialized = JSON.stringify(incidents);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes("do-not-leak"), false);
    assert.equal(serialized.includes("canonicalRoot"), false);
    assert.equal(serialized.includes("workspaceRoot"), false);

    const second = await listRegisteredWorkspaceIncidents(registry, workspace.workspaceId, {
      limit: 10,
    });
    assert.equal(second[0]?.occurrenceCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});

test("registered workspace incident query rejects non-opaque workspace identifiers", async () => {
  const { root, registryRoot, registry } = await fixture();
  try {
    await assert.rejects(
      listRegisteredWorkspaceIncidents(registry, "../../workspace"),
      /opaque UUID/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});
