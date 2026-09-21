import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { rollbackTask } from "./rollback.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string, store: TaskStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-rollback-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Rollback Test");
    await git(dir, "config", "user.email", "rollback@example.invalid");
    await writeFile(path.join(dir, "app.txt"), "base\n", "utf8");
    await git(dir, "add", "app.txt");
    await git(dir, "commit", "-m", "base");
    return await fn(dir, new TaskStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(workspace: string, id: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id,
    goal: "Modify app.txt",
    workspace,
    status: "waiting",
    createdAt: now,
    updatedAt: now,
  };
}

async function createTerminalTask(
  dir: string,
  store: TaskStore,
  id: string,
): Promise<OrchestratorTask> {
  const value = task(dir, id);
  await store.save(value);

  value.status = "running";
  value.runCount = 1;
  await store.save(value);
  assert.equal(value.lastRunCheckpoint?.available, true, value.lastRunCheckpoint?.error);

  await writeFile(path.join(dir, "app.txt"), "task-output\n", "utf8");
  await writeFile(path.join(dir, "task-created.txt"), "created\n", "utf8");

  value.status = "completed";
  value.finishReason = "completed";
  await store.save(value);
  assert.equal(value.lastRunCheckpoint?.afterFingerprint?.available, true);
  return value;
}

test("rollback service restores the pre-run workspace and records durable events", async () => {
  await withRepo(async (dir, store) => {
    const value = await createTerminalTask(dir, store, "rollback-success");
    const terminalTaskJson = await readFile(
      path.join(dir, ".orchestrator", "tasks", `${value.id}.json`),
      "utf8",
    );

    const restored = await rollbackTask(store, dir, value.id);
    assert.equal(restored.status, "rolled_back");
    assert.equal(restored.finishReason, "rolled_back");
    assert.ok(restored.lastRunCheckpoint?.restoredAt);
    assert.equal(await readFile(path.join(dir, "app.txt"), "utf8"), "base\n");
    await assert.rejects(readFile(path.join(dir, "task-created.txt"), "utf8"));

    const events = await store.events(value.id);
    const types = events.map((event) => event.type);
    assert.ok(types.includes("checkpoint_created"));
    assert.ok(types.includes("rollback_requested"));
    assert.ok(types.includes("rollback_completed"));
    assert.equal(types.includes("rollback_failed"), false);

    const currentTaskJson = await readFile(
      path.join(dir, ".orchestrator", "tasks", `${value.id}.json`),
      "utf8",
    );
    assert.notEqual(currentTaskJson, terminalTaskJson);
    assert.match(currentTaskJson, /"status": "rolled_back"/);
  });
});

test("rollback service refuses divergence and leaves task/workspace terminal state intact", async () => {
  await withRepo(async (dir, store) => {
    const value = await createTerminalTask(dir, store, "rollback-diverged");
    await writeFile(path.join(dir, "app.txt"), "newer-human-work\n", "utf8");

    await assert.rejects(
      rollbackTask(store, dir, value.id),
      /Workspace changed after the task reached its terminal state/,
    );

    assert.equal(await readFile(path.join(dir, "app.txt"), "utf8"), "newer-human-work\n");
    const persisted = await store.load(value.id);
    assert.equal(persisted.status, "completed");

    const types = (await store.events(value.id)).map((event) => event.type);
    assert.ok(types.includes("rollback_requested"));
    assert.ok(types.includes("rollback_failed"));
    assert.equal(types.includes("rollback_completed"), false);
  });
});

test("rollback service rejects nonterminal tasks and tasks with unavailable checkpoints", async () => {
  await withRepo(async (dir, store) => {
    const value = task(dir, "rollback-state-check");
    await store.save(value);
    await assert.rejects(
      rollbackTask(store, dir, value.id),
      /must be terminal before rollback/,
    );

    value.status = "failed";
    value.error = "failed before run";
    await store.save(value);
    await assert.rejects(rollbackTask(store, dir, value.id), /has no rollback checkpoint/);
  });
});
