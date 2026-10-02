import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]) {
  return await execFile("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function withRepo<T>(fn: (root: string, store: TaskStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-state-diff-"));
  try {
    await git(root, "init");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "Test User");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n");
    await writeFile(path.join(root, ".gitignore"), ".orchestrator/\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "baseline");
    return await fn(root, new TaskStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function task(root: string, id: string): OrchestratorTask {
  const now = new Date().toISOString();
  return { id, goal: "Make a scoped edit", workspace: root, status: "waiting", createdAt: now, updatedAt: now, expectedChangedPaths: ["src/**"] };
}

test("completed transition persists final diff policy evidence before completion", async () => {
  await withRepo(async (root, store) => {
    const value = task(root, "diff-pass");
    await store.save(value);
    value.status = "running";
    value.runCount = 1;
    await store.save(value);
    assert.equal(value.lastRunCheckpoint?.available, true, value.lastRunCheckpoint?.error);

    await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n");
    value.status = "completed";
    value.finishReason = "completed";
    await store.save(value);

    assert.equal(value.status, "completed");
    assert.equal(value.lastDiffSafety?.passed, true);
    assert.equal(value.lastDiffSafety?.summary.changedFiles, 1);
    const eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("diff_safety_started"));
    assert.ok(eventTypes.includes("diff_safety_passed"));
    assert.ok(eventTypes.includes("completed"));
  });
});

test("hard diff policy failure prevents completed state", async () => {
  await withRepo(async (root, store) => {
    const value = task(root, "diff-fail");
    value.expectedChangedPaths = ["**"];
    await store.save(value);
    value.status = "running";
    value.runCount = 1;
    await store.save(value);

    await writeFile(path.join(root, ".env"), "SECRET=value\n");
    value.status = "completed";
    value.finishReason = "completed";
    await store.save(value);

    assert.equal(value.status, "failed");
    assert.equal(value.finishReason, "diff_safety_failed");
    assert.equal(value.lastDiffSafety?.passed, false);
    assert.ok(value.lastDiffSafety?.failures.some((item) => item.code === "protected_path"));
    const eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("diff_safety_failed"));
    assert.equal(eventTypes.includes("completed"), false);
  });
});
