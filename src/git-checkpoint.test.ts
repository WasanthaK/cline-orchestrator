import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  captureWorkspaceFingerprint,
  createGitRollbackCheckpoint,
  finalizeGitRollbackCheckpoint,
  restoreGitRollbackCheckpoint,
} from "./git-checkpoint.js";

const execFile = promisify(execFileCallback);
const limits = { maxUntrackedFiles: 1000, maxUntrackedBytes: 16 * 1024 * 1024 };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-checkpoint-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Checkpoint Test");
    await git(dir, "config", "user.email", "checkpoint@example.invalid");
    await writeFile(path.join(dir, "tracked.txt"), "base\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await git(dir, "commit", "-m", "base");
    await mkdir(path.join(dir, ".orchestrator"), { recursive: true });
    await writeFile(path.join(dir, ".orchestrator", "state.json"), "before-state\n", "utf8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("rollback restores staged, unstaged, and pre-existing untracked state without rewinding .orchestrator", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "tracked.txt"), "staged\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await writeFile(path.join(dir, "tracked.txt"), "unstaged\n", "utf8");
    await writeFile(path.join(dir, "preexisting.txt"), "preexisting\n", "utf8");

    let checkpoint = await createGitRollbackCheckpoint(dir, "task-1", 1, limits);
    assert.equal(checkpoint.available, true, checkpoint.error);
    assert.ok(checkpoint.stashRef);
    assert.ok(checkpoint.beforeFingerprint?.digest);

    await writeFile(path.join(dir, "tracked.txt"), "task-output\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await rm(path.join(dir, "preexisting.txt"));
    await writeFile(path.join(dir, "new-task-file.txt"), "created by task\n", "utf8");
    await writeFile(path.join(dir, ".orchestrator", "state.json"), "terminal-state\n", "utf8");

    checkpoint = await finalizeGitRollbackCheckpoint(dir, checkpoint, limits);
    assert.equal(checkpoint.available, true, checkpoint.error);
    assert.ok(checkpoint.afterFingerprint?.digest);
    assert.notEqual(checkpoint.afterFingerprint?.digest, checkpoint.beforeFingerprint?.digest);

    const restored = await restoreGitRollbackCheckpoint(dir, checkpoint, limits);
    assert.ok(restored.restoredAt);
    assert.equal(await readFile(path.join(dir, "tracked.txt"), "utf8"), "unstaged\n");
    assert.equal((await git(dir, "show", ":tracked.txt")), "staged\n");
    assert.equal(await readFile(path.join(dir, "preexisting.txt"), "utf8"), "preexisting\n");
    await assert.rejects(readFile(path.join(dir, "new-task-file.txt"), "utf8"));
    assert.equal(
      await readFile(path.join(dir, ".orchestrator", "state.json"), "utf8"),
      "terminal-state\n",
    );

    const fingerprint = await captureWorkspaceFingerprint(dir, limits);
    assert.equal(fingerprint.digest, checkpoint.beforeFingerprint?.digest);
    assert.equal((await git(dir, "stash", "list")).trim(), "");
  });
});

test("rollback refuses when the workspace diverged after terminal fingerprint", async () => {
  await withRepo(async (dir) => {
    let checkpoint = await createGitRollbackCheckpoint(dir, "task-2", 1, limits);
    assert.equal(checkpoint.available, true, checkpoint.error);

    await writeFile(path.join(dir, "tracked.txt"), "task-output\n", "utf8");
    checkpoint = await finalizeGitRollbackCheckpoint(dir, checkpoint, limits);
    assert.equal(checkpoint.available, true, checkpoint.error);

    await writeFile(path.join(dir, "tracked.txt"), "human-newer-work\n", "utf8");
    await assert.rejects(
      restoreGitRollbackCheckpoint(dir, checkpoint, limits),
      /Workspace changed after the task reached its terminal state/,
    );
    assert.equal(await readFile(path.join(dir, "tracked.txt"), "utf8"), "human-newer-work\n");
  });
});

test("clean checkpoint rollback removes task-created changes while preserving orchestrator state", async () => {
  await withRepo(async (dir) => {
    let checkpoint = await createGitRollbackCheckpoint(dir, "task-3", 1, limits);
    assert.equal(checkpoint.available, true, checkpoint.error);
    assert.equal(checkpoint.stashRef, undefined);

    await writeFile(path.join(dir, "tracked.txt"), "changed\n", "utf8");
    await writeFile(path.join(dir, "created.txt"), "created\n", "utf8");
    await writeFile(path.join(dir, ".orchestrator", "state.json"), "keep-me\n", "utf8");
    checkpoint = await finalizeGitRollbackCheckpoint(dir, checkpoint, limits);

    await restoreGitRollbackCheckpoint(dir, checkpoint, limits);
    assert.equal(await readFile(path.join(dir, "tracked.txt"), "utf8"), "base\n");
    await assert.rejects(readFile(path.join(dir, "created.txt"), "utf8"));
    assert.equal(await readFile(path.join(dir, ".orchestrator", "state.json"), "utf8"), "keep-me\n");
  });
});

test("tracked orchestrator state disables rollback checkpoint creation", async () => {
  await withRepo(async (dir) => {
    await git(dir, "add", ".orchestrator/state.json");
    await git(dir, "commit", "-m", "track orchestrator state");

    const checkpoint = await createGitRollbackCheckpoint(dir, "task-4", 1, limits);
    assert.equal(checkpoint.available, false);
    assert.match(checkpoint.error ?? "", /\.orchestrator contains tracked files/);
  });
});
