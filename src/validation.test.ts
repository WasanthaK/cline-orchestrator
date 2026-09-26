import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildValidationRepairPrompt, runValidationCommands } from "./validation.js";
import type { OrchestratorTask, ValidationRun } from "./types.js";

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-validation-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("validation runs explicit commands sequentially and passes only when all succeed", async () => {
  await withTempDir(async (workspace) => {
    const run = await runValidationCommands(
      workspace,
      [nodeCommand("process.stdout.write('one')"), nodeCommand("process.stdout.write('two')")],
      { timeoutMs: 5000, maxOutputChars: 1000 },
    );

    assert.equal(run.passed, true);
    assert.equal(run.commandsRequested, 2);
    assert.equal(run.commandsRun, 2);
    assert.equal(run.results[0].stdout, "one");
    assert.equal(run.results[1].stdout, "two");
    assert.equal(run.results[0].exitCode, 0);
    assert.equal(run.results[1].exitCode, 0);
  });
});

test("validation stops after the first failing command", async () => {
  await withTempDir(async (workspace) => {
    const run = await runValidationCommands(
      workspace,
      [nodeCommand("process.stderr.write('bad'); process.exit(7)"), nodeCommand("process.stdout.write('should-not-run')")],
      { timeoutMs: 5000, maxOutputChars: 1000 },
    );

    assert.equal(run.passed, false);
    assert.equal(run.commandsRequested, 2);
    assert.equal(run.commandsRun, 1);
    assert.equal(run.results[0].exitCode, 7);
    assert.equal(run.results[0].stderr, "bad");
  });
});

test("validation bounds captured output", async () => {
  await withTempDir(async (workspace) => {
    const run = await runValidationCommands(
      workspace,
      [nodeCommand("process.stdout.write('x'.repeat(200))")],
      { timeoutMs: 5000, maxOutputChars: 32 },
    );

    assert.equal(run.passed, true);
    assert.equal(run.results[0].stdout.length, 32);
    assert.equal(run.results[0].outputTruncated, true);
  });
});

test("a pre-aborted validation run executes nothing and fails closed", async () => {
  await withTempDir(async (workspace) => {
    const controller = new AbortController();
    controller.abort();

    const run = await runValidationCommands(
      workspace,
      [nodeCommand("process.stdout.write('never')")],
      { timeoutMs: 5000, maxOutputChars: 1000, signal: controller.signal },
    );

    assert.equal(run.passed, false);
    assert.equal(run.commandsRun, 0);
  });
});

test("repair prompt carries bounded failure evidence and acceptance criteria", () => {
  const now = new Date().toISOString();
  const task: OrchestratorTask = {
    id: "repair-test",
    goal: "Fix the broken feature without unrelated changes",
    workspace: "/tmp/workspace",
    status: "repairing",
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: ["Typecheck passes", "Existing behavior is preserved"],
  };
  const validation: ValidationRun = {
    startedAt: now,
    completedAt: now,
    durationMs: 10,
    passed: false,
    commandsRequested: 1,
    commandsRun: 1,
    results: [
      {
        command: "npm run typecheck",
        startedAt: now,
        completedAt: now,
        durationMs: 10,
        exitCode: 2,
        timedOut: false,
        aborted: false,
        stdout: "compiler output",
        stderr: "Type error in src/example.ts",
      },
    ],
  };

  const prompt = buildValidationRepairPrompt(task, validation);
  assert.match(prompt, /Fix the broken feature/);
  assert.match(prompt, /Typecheck passes/);
  assert.match(prompt, /npm run typecheck/);
  assert.match(prompt, /Type error in src\/example\.ts/);
  assert.match(prompt, /smallest change needed/);
});
