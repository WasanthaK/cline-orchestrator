import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ClineCore } from "@cline/sdk";
import { ClineRunner } from "./cline-runner.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-session-recovery-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Session Recovery Test");
    await git(dir, "config", "user.email", "recovery@example.invalid");
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
    maxValidationRepairs: 0,
    checkpointMaxUntrackedFiles: 100,
    checkpointMaxUntrackedBytes: 1024 * 1024,
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

class SessionNotFoundError extends Error {
  readonly code = "session_not_found";

  constructor() {
    super("session not found");
    this.name = "SessionNotFoundError";
  }
}

class FakeCline {
  readonly subscribers: Array<(event: any) => void> = [];
  readonly prompts: Array<{ sessionId: string; prompt: string }> = [];
  sessionCount = 0;
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
    return { finishReason: "completed", text: "recovered" };
  }

  async abort() {}
  async dispose() {}
}

function task(workspace: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "session-not-found-test",
    goal: "Recover from a missing runtime session using durable task state",
    workspace,
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: ["Recovery uses structured durable evidence"],
  };
}

test("session_not_found recovery creates and consumes a durable structured handoff", async () => {
  await withRepo(async (dir) => {
    const store = new TaskStore(dir);
    const value = task(dir);
    await store.save(value);

    const fake = new FakeCline();
    const originalCreate = (ClineCore as any).create;
    (ClineCore as any).create = async () => fake;

    try {
      const runner = new ClineRunner(dir, worker());
      const completed = await runner.start(value);

      assert.equal(completed.status, "completed");
      assert.equal(fake.sendCount, 2);
      assert.equal(fake.sessionCount, 2);
      assert.equal(completed.sessionGeneration, 2);
      assert.equal(completed.recoveryCount, 1);
      assert.equal(completed.lastRecoveryReason, "session_not_found");
      assert.equal(completed.lastRecoveredFromSessionId, "session-1");
      assert.equal(completed.contextHandoffCount, 1);
      assert.equal(completed.contextRotationCount ?? 0, 0);
      assert.equal(completed.lastContextHandoff?.reason, "session_not_found");
      assert.equal(completed.lastContextHandoff?.sourceSessionId, "session-1");
      assert.equal(completed.lastContextHandoff?.targetGeneration, 2);

      assert.equal(fake.prompts[0]?.prompt, value.goal);
      assert.match(fake.prompts[1]?.prompt ?? "", /durable structured handoff/i);
      assert.match(fake.prompts[1]?.prompt ?? "", /"reason": "session_not_found"/);
      assert.match(fake.prompts[1]?.prompt ?? "", /"targetGeneration": 2/);
      assert.match(fake.prompts[1]?.prompt ?? "", /"pendingAction": "Recover from a missing runtime session using durable task state"/);

      const events = await store.events(value.id);
      const handoffEvents = events.filter((event) => event.type === "context_handoff_created");
      const recoveredEvents = events.filter((event) => event.type === "session_recovered");
      assert.equal(handoffEvents.length, 1);
      assert.equal(recoveredEvents.length, 1);
      assert.equal(handoffEvents[0]?.data?.reason, "session_not_found");
      assert.equal(handoffEvents[0]?.data?.targetGeneration, 2);
      assert.equal(recoveredEvents[0]?.data?.reason, "session_not_found");
      assert.equal(recoveredEvents[0]?.data?.generation, 2);
      assert.equal(events.some((event) => event.type === "context_rotating"), false);
    } finally {
      (ClineCore as any).create = originalCreate;
    }
  });
});
