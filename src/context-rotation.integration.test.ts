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
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-rotation-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Rotation Test");
    await git(dir, "config", "user.email", "rotation@example.invalid");
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
    contextRotateAtTokens: 100,
    maxContextRotations: 2,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

class FakeCline {
  readonly subscribers: Array<(event: any) => void> = [];
  readonly abortedSessionIds: string[] = [];
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

  send({ sessionId, prompt }: { sessionId: string; prompt: string }) {
    this.sendCount += 1;
    const call = this.sendCount;
    this.prompts.push({ sessionId, prompt });

    return new Promise<{ finishReason: string; text: string }>((resolve) => {
      setImmediate(() => {
        this.emitAgent({ type: "iteration_start", iteration: call });
        this.emitAgent({ type: "usage", inputTokens: 120, outputTokens: 10 });
        this.emitAgent({ type: "iteration_end", iteration: call, toolCallCount: 1 });

        if (call === 3) {
          setImmediate(() => resolve({ finishReason: "completed", text: "done" }));
        }
      });
    });
  }

  async abort(sessionId: string) {
    this.abortedSessionIds.push(sessionId);
  }

  async dispose() {}

  private emitAgent(event: Record<string, unknown>) {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_event", payload: { event } });
    }
  }
}

function task(workspace: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "multiple-rotation-test",
    goal: "Complete after two planned context rotations",
    workspace,
    status: "waiting",
    createdAt: now,
    updatedAt: now,
  };
}

test("multiple planned context rotations are bounded and preserve distinct handoff generations", async () => {
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
      assert.equal(fake.sendCount, 3);
      assert.equal(fake.sessionCount, 3);
      assert.deepEqual(fake.abortedSessionIds, ["session-1", "session-2"]);
      assert.equal(completed.contextRotationCount, 2);
      assert.equal(completed.contextHandoffCount, 2);
      assert.equal(completed.recoveryCount, 2);
      assert.equal(completed.sessionGeneration, 3);
      assert.equal(completed.lastContextHandoff?.targetGeneration, 3);

      assert.match(fake.prompts[1]?.prompt ?? "", /"targetGeneration": 2/);
      assert.match(fake.prompts[2]?.prompt ?? "", /"targetGeneration": 3/);

      const metrics = completed.lastRunMetrics;
      assert.ok(metrics);
      assert.equal(metrics.attempts, 3);
      assert.equal(metrics.retries, 0);
      assert.equal(metrics.stalls, 0);
      assert.equal(metrics.iterations, 3);
      assert.equal(metrics.toolCalls, 3);
      assert.equal(metrics.totalInputTokens, 360);
      assert.equal(metrics.totalOutputTokens, 30);
      assert.deepEqual(
        metrics.turns.map((turn) => ({
          attempt: turn.attempt,
          iteration: turn.iteration,
          toolCalls: turn.toolCalls,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
        })),
        [
          { attempt: 1, iteration: 1, toolCalls: 1, inputTokens: 120, outputTokens: 10 },
          { attempt: 2, iteration: 2, toolCalls: 1, inputTokens: 120, outputTokens: 10 },
          { attempt: 3, iteration: 3, toolCalls: 1, inputTokens: 120, outputTokens: 10 },
        ],
      );
      assert.equal(completed.retryCount ?? 0, 0);
      assert.equal(completed.stallCount ?? 0, 0);

      const events = await store.events(value.id);
      const rotationEvents = events.filter((event) => event.type === "context_rotating");
      const handoffEvents = events.filter((event) => event.type === "context_handoff_created");
      const recoveredEvents = events.filter((event) => event.type === "session_recovered");

      assert.equal(rotationEvents.length, 2);
      assert.equal(handoffEvents.length, 2);
      assert.equal(recoveredEvents.length, 2);
      assert.deepEqual(
        rotationEvents.map((event) => event.data?.runRotationCount),
        [1, 2],
      );
      assert.deepEqual(
        handoffEvents.map((event) => ({
          reason: event.data?.reason,
          sourceGeneration: event.data?.sourceGeneration,
          targetGeneration: event.data?.targetGeneration,
        })),
        [
          { reason: "context_threshold", sourceGeneration: 1, targetGeneration: 2 },
          { reason: "context_threshold", sourceGeneration: 2, targetGeneration: 3 },
        ],
      );
      assert.deepEqual(
        recoveredEvents.map((event) => ({
          reason: event.data?.reason,
          generation: event.data?.generation,
        })),
        [
          { reason: "context_threshold", generation: 2 },
          { reason: "context_threshold", generation: 3 },
        ],
      );
      assert.equal(new Set(handoffEvents.map((event) => event.data?.handoffId)).size, 2);
      assert.equal(events.some((event) => event.type === "stalled"), false);
      assert.equal(events.some((event) => event.type === "retrying"), false);
    } finally {
      (ClineCore as any).create = originalCreate;
    }
  });
});
