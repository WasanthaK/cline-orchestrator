import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { evaluateDiffSafety } from "./diff-safety.js";
import { createGitRollbackCheckpoint } from "./git-checkpoint.js";
import type { DiffSafetyPolicy } from "./diff-safety-config.js";

const execFile = promisify(execFileCallback);
const limits = { maxUntrackedFiles: 100, maxUntrackedBytes: 10 * 1024 * 1024 };
const policy: DiffSafetyPolicy = {
  maxChangedFiles: 10,
  protectedPatterns: [".env", ".env.*", "**/.env", "**/.env.*", "**/secrets/**"],
  warningPatterns: [".github/workflows/**", "infra/**"],
};

async function git(cwd: string, ...args: string[]) {
  return await execFile("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function withRepo<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-diff-"));
  try {
    await git(root, "init");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "Test User");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "baseline");
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function checkpoint(root: string) {
  const value = await createGitRollbackCheckpoint(root, "task", 1, limits);
  assert.equal(value.available, true, value.error);
  return value;
}

test("diff safety passes an in-scope tracked edit and summarizes it", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n");
    const result = await evaluateDiffSafety(root, before, policy, ["src/**"]);
    assert.equal(result.passed, true);
    assert.equal(result.summary.changedFiles, 1);
    assert.equal(result.changedPaths[0]?.path, "src/app.ts");
    assert.match(result.finalDiffSummary, /1 changed path/);
  });
});

test("protected path changes are hard failures", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await writeFile(path.join(root, ".env"), "SECRET=value\n");
    const result = await evaluateDiffSafety(root, before, policy, ["**"]);
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((item) => item.code === "protected_path" && item.path === ".env"));
  });
});

test("unexpected changed paths fail when task scope is configured", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await writeFile(path.join(root, "README.md"), "unexpected\n");
    const result = await evaluateDiffSafety(root, before, policy, ["src/**"]);
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((item) => item.code === "unexpected_path"));
  });
});

test("deployment-sensitive path is a warning rather than a hard failure", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\n");
    const result = await evaluateDiffSafety(root, before, policy, [".github/**"]);
    assert.equal(result.passed, true);
    assert.ok(result.warnings.some((item) => item.code === "deployment_sensitive_path"));
  });
});

test("branch or HEAD movement is a hard failure", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await git(root, "checkout", "-b", "unexpected-branch");
    const result = await evaluateDiffSafety(root, before, policy, ["src/**"]);
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((item) => item.code === "branch_moved"));
  });
});

test("excessive diff threshold is enforced", async () => {
  await withRepo(async (root) => {
    const before = await checkpoint(root);
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n");
    await writeFile(path.join(root, "src", "extra.ts"), "export {};\n");
    const result = await evaluateDiffSafety(root, before, { ...policy, maxChangedFiles: 1 }, ["src/**"]);
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((item) => item.code === "excessive_diff"));
  });
});

test("dirty pre-run tracked state is excluded from task diff", async () => {
  await withRepo(async (root) => {
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 9;\n");
    const before = await checkpoint(root);
    await writeFile(path.join(root, "src", "new.ts"), "export const created = true;\n");
    const result = await evaluateDiffSafety(root, before, policy, ["src/**"]);
    assert.equal(result.passed, true);
    assert.deepEqual(result.changedPaths.map((item) => item.path), ["src/new.ts"]);
  });
});
