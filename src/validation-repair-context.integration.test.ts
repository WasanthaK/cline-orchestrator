import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ClineCore } from "@cline/sdk";
import { ClineRunner } from "./cline-runner.js";
import { loadContextHandoff } from "./context-handoff.js";
import { createGitRollbackCheckpoint } from "./git-checkpoint.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, ValidationRun, WorkerConfig } from "./types.js";
import { buildValidationRepairPrompt } from "./validation.js";

const execFile = promisify(execFileCallback);
const checkpointLimits = {
  maxUntrackedFiles: 100,
  maxUntrackedBytes: 1024 * 1024,
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-validation-repair-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Validation Repair Test");
    await git(dir, "config", "user.email", "validation-repair@example.invalid");
    await writeFile(path.join(dir, "tracked.txt"), "base\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await git(dir, "commit", "-m", "base");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function worker(): WorkerConfig {
  return {
    providerId: "openai-compatible",
    modelId: "test-model",
    apiKey: "test",
    baseUrl: "http://127.0.0.1:1/v1",
    contextWindow: 1000,
    maxInputTokens: 900,
    maxTokensPerTurn: 100,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 1000,
    validationTimeoutMs: 1000,
    maxValidationOutputChars: 2000,
    maxValidationRepairs: 1,
    checkpointMaxUntrackedFiles: checkpointLimits.maxUntrackedFiles,
    checkpointMaxUntrackedBytes: checkpointLimits.maxUntrackedBytes,
    contextRotateAtTokens: 800,
    maxContextRotations: 2,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

function failedValidation(): ValidationRun {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 10,
    passed: false,
    commandsRequested: 1,
    commandsRun: 1,
    results: [
      {
        command: "npm test",
        startedAt: now,
        completedAt: now,
        durationMs: 10,
        exitCode: 1,
        timedOut: false,
        aborted: false,
        stdout: "",
        stderr: "repair target failed",
      },
    ],
  };
}

class SessionNotFoundError extends Error {
  readonly code = "session_not_found";

  constructor() {
    super("session not found during validation repair");
    this.name = "SessionNotFoundError";
  }
}

class FakeCline {
  readonly subscribers: Array<(event: any) => void> = [];
  readonly prompts: Array<{ sessionId: string; prompt: string }> = [];
  sessionCount = 1;
  sendCount = 0;

  subscribe(handler: (event: any) => void) {
    this.subscribers.push(handler);
    return () => undefined;
  }

  async start() {
    this.sessionCount += 1;
    return { sessionId: `session-${this.sessionCount}` };
  }

  async send({ sessionId, prompt }: { sessionId: string; prompt: string }) {
    this.sendCount += 1;
    this.prompts.push({ sessionId, prompt });
    if (this.sendCount === 1) throw new SessionNotFoundError();
    return { finishReason: "completed", text: "repair applied" };
  }

  async abort() {}
  async dispose() {}
}

test("validation repair session recovery preserves original checkpoint and returns to validation", async () => {
  await withRepo(async (dir) => {
    const store = new TaskStore(dir);
    const validation = failedValidation();
    const checkpoint = await createGitRollbackCheckpoint(
      dir,
      "validation-repair-context-test",
      1,
      checkpointLimits,
    );
    assert.equal(checkpoint.available, true, checkpoint.error);
    assert.ok(checkpoint.beforeFingerprint?.digest);

    const now = new Date().toISOString();
    const value: OrchestratorTask = {
      id: "validation-repair-context-test",
      goal: "Fix the implementation until npm test passes",
      workspace: dir,
      status: "repairing",
      createdAt: now,
      updatedAt: now,
      acceptanceCriteria: ["npm test passes"],
      validationCommands: ["npm test"],
      validationRunCount: 1,
      validationRepairCount: 1,
      lastValidation: validation,
      runCount: 1,
      clineSessionId: "session-1",
      sessionGeneration: 1,
      lastRunCheckpoint: checkpoint,
      error: "Validation command failed with exit code 1: npm test",
    };
    await store.save(value);

    const originalCheckpointCreatedAt = checkpoint.createdAt;
    const originalCheckpointHead = checkpoint.head;
    const originalCheckpointDigest = checkpoint.beforeFingerprint?.digest;
    const repairPrompt = buildValidationRepairPrompt(value, validation);

    const fake = new FakeCline();
    const originalCreate = (ClineCore as any).create;
    (ClineCore as any).create = async () => fake;

    try {
      const runner = new ClineRunner(dir, worker());
      const result = await runner.resume(value, repairPrompt);

      assert.equal(result.status, "validating");
      assert.equal(result.finishReason, "completed");
      assert.equal(result.runCount, 2);
      assert.equal(result.validationRepairCount, 1);
      assert.equal(result.lastValidation?.passed, false);
      assert.equal(result.validationRunCount, 2);

      assert.equal(result.lastRunCheckpoint?.createdAt, originalCheckpointCreatedAt);
      assert.equal(result.lastRunCheckpoint?.head, originalCheckpointHead);
      assert.equal(result.lastRunCheckpoint?.beforeFingerprint?.digest, originalCheckpointDigest);

      assert.equal(result.sessionGeneration, 2);
      assert.equal(result.recoveryCount, 1);
      assert.equal(result.lastRecoveryReason, "session_not_found");
      assert.equal(result.contextHandoffCount, 1);
      assert.equal(result.lastContextHandoff?.targetGeneration, 2);
      assert.equal(result.lastContextHandoff?.reason, "session_not_found");

      assert.equal(fake.sendCount, 2);
      assert.equal(fake.sessionCount, 2);
      assert.equal(fake.prompts[0]?.sessionId, "session-1");
      assert.equal(fake.prompts[0]?.prompt, repairPrompt);
      assert.equal(fake.prompts[1]?.sessionId, "session-2");
      assert.match(fake.prompts[1]?.prompt ?? "", /durable structured handoff/i);
      assert.match(fake.prompts[1]?.prompt ?? "", /repair target failed/);

      const handoffReference = result.lastContextHandoff;
      assert.ok(handoffReference);
      const handoff = await loadContextHandoff(dir, handoffReference);
      assert.equal(handoff.originalGoal, value.goal);
      assert.equal(handoff.pendingAction, repairPrompt);
      assert.equal(handoff.taskState.validationRepairCount, 1);
      assert.equal(handoff.taskState.status, "running");
      assert.equal(handoff.workspaceEvidence.lastValidation?.passed, false);
      assert.equal(handoff.workspaceEvidence.lastValidation?.commandsRun, 1);
      assert.equal(handoff.workspaceEvidence.checkpoint?.createdAt, originalCheckpointCreatedAt);
      assert.equal(handoff.workspaceEvidence.checkpoint?.head, originalCheckpointHead);
      assert.equal(
        handoff.workspaceEvidence.checkpoint?.beforeFingerprintDigest,
        originalCheckpointDigest,
      );

      const persisted = await store.load(value.id);
      assert.equal(persisted.status, "validating");
      assert.equal(persisted.lastRunCheckpoint?.createdAt, originalCheckpointCreatedAt);
      assert.equal(persisted.lastRunCheckpoint?.beforeFingerprint?.digest, originalCheckpointDigest);

      const events = await store.events(value.id);
      assert.equal(events.filter((event) => event.type === "context_handoff_created").length, 1);
      assert.equal(events.filter((event) => event.type === "session_recovered").length, 1);
      assert.ok(events.some((event) => event.type === "validation_started"));
      assert.equal(events.some((event) => event.type === "completed"), false);
    } finally {
      (ClineCore as any).create = originalCreate;
    }
  });
});
