import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildContextHandoffPrompt,
  createContextHandoff,
  loadContextHandoff,
} from "./context-handoff.js";
import type { OrchestratorTask } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-handoff-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Handoff Test");
    await git(dir, "config", "user.email", "handoff@example.invalid");
    await writeFile(path.join(dir, "tracked.txt"), "base\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await git(dir, "commit", "-m", "base");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(workspace: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "handoff-task",
    goal: "Implement durable context handoff without broadening scope",
    workspace,
    status: "running",
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: ["Persist a structured handoff"],
    validationCommands: ["npm test"],
    expectedChangedPaths: ["src/**"],
    runCount: 2,
    sessionGeneration: 1,
    recoveryCount: 0,
    contextRotationCount: 1,
    lastContextRotationInputTokens: 150123,
    lastContextRotationThreshold: 150000,
    lastRunMetrics: {
      startedAt: now,
      iterations: 4,
      toolCalls: 6,
      totalInputTokens: 180000,
      totalOutputTokens: 4200,
      attempts: 1,
      retries: 0,
      stalls: 0,
      turns: [],
    },
  };
}

test("structured context handoff is persisted with task state, workspace evidence, and pending action", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "tracked.txt"), "changed during task\n", "utf8");
    const value = task(dir);

    const created = await createContextHandoff(dir, value, {
      reason: "context_threshold",
      pendingAction: "Continue implementing the current milestone step",
      previousPrompt: "Implement the durable handoff",
      recentWorkerOutput: "Inspected the recovery path and prepared the handoff module.",
      sourceSessionId: "session-old",
      targetGeneration: 2,
    });

    assert.equal(created.artifact.schemaVersion, 1);
    assert.equal(created.artifact.taskId, value.id);
    assert.equal(created.artifact.reason, "context_threshold");
    assert.equal(created.artifact.originalGoal, value.goal);
    assert.equal(created.artifact.pendingAction, "Continue implementing the current milestone step");
    assert.equal(created.artifact.sourceGeneration, 1);
    assert.equal(created.artifact.targetGeneration, 2);
    assert.equal(created.artifact.taskState.runCount, 2);
    assert.deepEqual(created.artifact.taskState.acceptanceCriteria, value.acceptanceCriteria);
    assert.equal(created.artifact.workspaceEvidence.git.available, true);
    assert.equal(created.artifact.workspaceEvidence.git.dirty, true);
    assert.ok(created.artifact.workspaceEvidence.git.statusLines?.some((line) => line.includes("tracked.txt")));
    assert.match(created.reference.relativePath, /^\.orchestrator\/handoffs\/handoff-task\/2-/);

    const persistedText = await readFile(
      path.join(dir, ...created.reference.relativePath.split("/")),
      "utf8",
    );
    assert.match(persistedText, /"schemaVersion": 1/);

    const loaded = await loadContextHandoff(dir, created.reference);
    assert.equal(loaded.id, created.artifact.id);
    assert.equal(loaded.workspaceEvidence.git.head, created.artifact.workspaceEvidence.git.head);

    const prompt = buildContextHandoffPrompt(loaded, created.reference);
    assert.match(prompt, /durable structured handoff/i);
    assert.match(prompt, /"reason": "context_threshold"/);
    assert.match(prompt, /"pendingAction": "Continue implementing the current milestone step"/);
    assert.match(prompt, new RegExp(created.reference.relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("supporting prose is bounded while the structured handoff remains durable", async () => {
  await withRepo(async (dir) => {
    const value = task(dir);
    const longPrompt = "p".repeat(9000);
    const longOutput = `old-${"x".repeat(15000)}-latest`;

    const created = await createContextHandoff(dir, value, {
      reason: "session_not_found",
      pendingAction: "Resume from durable state",
      previousPrompt: longPrompt,
      recentWorkerOutput: longOutput,
      sourceSessionId: "missing-session",
      targetGeneration: 2,
    });

    assert.ok((created.artifact.supportingContext.previousPrompt?.length ?? 0) < longPrompt.length);
    assert.match(created.artifact.supportingContext.previousPrompt ?? "", /truncated by orchestrator/);
    assert.ok((created.artifact.supportingContext.recentWorkerOutput?.length ?? 0) < longOutput.length);
    assert.match(created.artifact.supportingContext.recentWorkerOutput ?? "", /^\[truncated by orchestrator\]/);
    assert.match(created.artifact.supportingContext.recentWorkerOutput ?? "", /latest$/);
  });
});

test("handoff loader refuses paths outside the durable handoff root", async () => {
  await withRepo(async (dir) => {
    await assert.rejects(
      loadContextHandoff(dir, {
        id: "bad",
        createdAt: new Date().toISOString(),
        relativePath: "../tracked.txt",
        reason: "session_not_found",
        sourceGeneration: 1,
        targetGeneration: 2,
      }),
      /escapes handoff root/,
    );
  });
});
