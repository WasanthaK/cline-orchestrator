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
import { ProjectMemoryStore } from "./project-memory.js";
import type { OrchestratorTask } from "./types.js";

const execFile = promisify(execFileCallback);
const FULL_MEMORY_SENTINEL = "FULL_ARCHITECTURE_SENTINEL_MUST_NOT_BE_DUMPED_IN_HANDOFF";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-handoff-memory-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Handoff Memory Test");
    await git(dir, "config", "user.email", "handoff-memory@example.invalid");
    await writeFile(path.join(dir, "tracked.txt"), "base\n", "utf8");
    await git(dir, "add", "tracked.txt");
    await git(dir, "commit", "-m", "base");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(workspace: string): OrchestratorTask {
  const now = "2026-09-21T12:30:00.000Z";
  return {
    id: "durable-memory-task",
    goal: "Continue the current milestone using durable project context",
    workspace,
    status: "running",
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: ["Carry bounded durable memory into recovery"],
    validationCommands: ["npm test"],
    expectedChangedPaths: ["src/**"],
    runCount: 3,
    sessionGeneration: 2,
    recoveryCount: 1,
    contextRotationCount: 1,
    contextHandoffCount: 1,
    lastRunMetrics: {
      startedAt: now,
      iterations: 5,
      toolCalls: 7,
      totalInputTokens: 120000,
      totalOutputTokens: 5000,
      attempts: 2,
      retries: 0,
      stalls: 0,
      turns: [],
    },
  };
}

test("new context handoffs include bounded task-summary and project-memory provenance without dumping memory documents", async () => {
  await withRepo(async (dir) => {
    const memory = new ProjectMemoryStore(dir);
    const architecture = await memory.appendArchitectureUpdate({
      taskId: "memory-setup",
      title: "Architecture boundary",
      content: `Stable architecture detail. ${FULL_MEMORY_SENTINEL}`,
      rationale: "Record the durable architecture source for handoff-memory tests.",
      recordedAt: "2026-09-21T12:29:00.000Z",
    });
    const value = task(dir);

    const created = await createContextHandoff(dir, value, {
      reason: "context_threshold",
      pendingAction: "Continue from bounded durable project context",
      previousPrompt: "Continue the current milestone",
      recentWorkerOutput: "The previous session completed the current bounded step.",
      sourceSessionId: "session-two",
      targetGeneration: 3,
    });

    const durable = created.artifact.durableMemory;
    assert.ok(durable);
    assert.equal(durable.taskSummary.schemaVersion, 1);
    assert.equal(durable.taskSummary.taskId, value.id);
    assert.equal(durable.taskSummary.status, "running");
    assert.equal(durable.taskSummary.sourceTaskUpdatedAt, value.updatedAt);
    assert.equal(durable.taskSummary.relativePath, ".orchestrator/task-summaries/durable-memory-task.json");
    assert.equal(durable.project.memoryUpdateCount, 1);
    assert.equal(durable.project.lastMemoryUpdate?.id, architecture.id);
    assert.equal(durable.project.lastMemoryUpdate?.document, "architecture");
    assert.equal(
      durable.project.memoryFiles.architecture,
      ".orchestrator/memory/architecture.md",
    );

    const summaryText = await readFile(
      path.join(dir, ".orchestrator", "task-summaries", "durable-memory-task.json"),
      "utf8",
    );
    assert.match(summaryText, /"taskId": "durable-memory-task"/);

    const artifactText = JSON.stringify(created.artifact);
    assert.doesNotMatch(artifactText, new RegExp(FULL_MEMORY_SENTINEL));

    const prompt = buildContextHandoffPrompt(created.artifact, created.reference);
    assert.match(prompt, /"durableMemory"/);
    assert.match(prompt, /\.orchestrator\/task-summaries\/durable-memory-task\.json/);
    assert.match(prompt, /\.orchestrator\/memory\/architecture\.md/);
    assert.match(prompt, new RegExp(architecture.id));
    assert.doesNotMatch(prompt, new RegExp(FULL_MEMORY_SENTINEL));
  });
});

test("legacy schema-v1 handoffs without durableMemory still load and render", async () => {
  await withRepo(async (dir) => {
    const value = task(dir);
    const created = await createContextHandoff(dir, value, {
      reason: "session_not_found",
      pendingAction: "Resume the same bounded task",
      sourceSessionId: "missing-session",
      targetGeneration: 3,
    });

    const legacy = { ...created.artifact };
    delete legacy.durableMemory;
    await writeFile(
      path.join(dir, ...created.reference.relativePath.split("/")),
      JSON.stringify(legacy, null, 2) + "\n",
      "utf8",
    );

    const loaded = await loadContextHandoff(dir, created.reference);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.durableMemory, undefined);

    const prompt = buildContextHandoffPrompt(loaded, created.reference);
    assert.match(prompt, /"reason": "session_not_found"/);
    assert.match(prompt, /"pendingAction": "Resume the same bounded task"/);
    assert.doesNotMatch(prompt, /"durableMemory"/);
  });
});
