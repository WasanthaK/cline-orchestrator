import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TASK_SUMMARY_MAX_TEXT_CHARS,
  TaskSummaryStore,
} from "./task-summary.js";
import type { OrchestratorTask } from "./types.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-task-summary-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(workspace: string, id = "task-summary-1"): OrchestratorTask {
  return {
    id,
    goal: "Create a durable bounded task summary.",
    workspace,
    status: "running",
    createdAt: "2026-09-21T12:00:00.000Z",
    updatedAt: "2026-09-21T12:01:00.000Z",
  };
}

test("task summary records bounded structured evidence and excludes verbose transient payloads", async () => {
  await withWorkspace(async (dir) => {
    const value = task(dir);
    value.goal = "G".repeat(TASK_SUMMARY_MAX_TEXT_CHARS + 25);
    value.acceptanceCriteria = ["summary is durable", "summary is bounded"];
    value.validationCommands = ["npm run typecheck", "npm test"];
    value.expectedChangedPaths = ["src/task-summary.ts"];
    value.runCount = 3;
    value.sessionGeneration = 2;
    value.recoveryCount = 1;
    value.contextRotationCount = 1;
    value.contextHandoffCount = 1;
    value.validationRunCount = 2;
    value.validationRepairCount = 1;
    value.lastPrompt = "PROMPT_SENTINEL_MUST_NOT_PERSIST";
    value.lastOutput = "OUTPUT_SENTINEL_MUST_NOT_PERSIST";
    value.lastValidation = {
      startedAt: "2026-09-21T12:02:00.000Z",
      completedAt: "2026-09-21T12:03:00.000Z",
      durationMs: 60_000,
      passed: true,
      commandsRequested: 2,
      commandsRun: 2,
      results: [
        {
          command: "npm test",
          startedAt: "2026-09-21T12:02:30.000Z",
          completedAt: "2026-09-21T12:03:00.000Z",
          durationMs: 30_000,
          exitCode: 0,
          timedOut: false,
          aborted: false,
          stdout: "VALIDATION_STDOUT_SENTINEL_MUST_NOT_PERSIST",
          stderr: "VALIDATION_STDERR_SENTINEL_MUST_NOT_PERSIST",
        },
      ],
    };
    value.lastDiffSafety = {
      checkedAt: "2026-09-21T12:04:00.000Z",
      passed: true,
      checkpointCreatedAt: "2026-09-21T12:00:30.000Z",
      baselineRef: "refs/orchestrator/checkpoint",
      baselineBranch: "phase-1/bootstrap",
      baselineHead: "abc123",
      currentBranch: "phase-1/bootstrap",
      currentHead: "abc123",
      finalDiffSummary: "2 files changed, safety policy passed",
      summary: {
        changedFiles: 2,
        trackedFiles: 2,
        untrackedFiles: 0,
        trackedAdditions: 80,
        trackedDeletions: 4,
      },
      changedPaths: [
        {
          path: "CHANGED_PATH_SENTINEL_MUST_NOT_PERSIST",
          status: "modified",
          source: "tracked",
        },
      ],
      warnings: [],
      failures: [],
    };
    value.lastRunGit = {
      after: {
        capturedAt: "2026-09-21T12:04:30.000Z",
        available: true,
        branch: "phase-1/bootstrap",
        head: "abc123",
        dirty: false,
        changedFiles: 2,
        statusLines: ["GIT_STATUS_SENTINEL_MUST_NOT_PERSIST"],
      },
    };
    value.lastContextHandoff = {
      id: "handoff-1",
      createdAt: "2026-09-21T12:01:30.000Z",
      relativePath: ".orchestrator/handoffs/task-summary-1/2-handoff-1.json",
      reason: "context_threshold",
      sourceSessionId: "session-1",
      sourceGeneration: 1,
      targetGeneration: 2,
    };
    value.lastRunMetrics = {
      startedAt: "2026-09-21T12:00:30.000Z",
      completedAt: "2026-09-21T12:04:30.000Z",
      durationMs: 240_000,
      iterations: 4,
      toolCalls: 9,
      totalInputTokens: 11_000,
      totalOutputTokens: 2_000,
      attempts: 2,
      retries: 0,
      stalls: 0,
      turns: [
        {
          attempt: 1,
          iteration: 1,
          toolCalls: 3,
          inputTokens: 5_000,
          outputTokens: 800,
        },
      ],
    };
    value.finishReason = "model_completed";

    const store = new TaskSummaryStore(dir);
    const summary = await store.record(value);

    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.taskId, value.id);
    assert.equal(summary.relativePath, ".orchestrator/task-summaries/task-summary-1.json");
    assert.equal(summary.sourceTaskUpdatedAt, "2026-09-21T12:01:00.000Z");
    assert.equal(summary.revision, 1);
    assert.equal(summary.goal.length, TASK_SUMMARY_MAX_TEXT_CHARS);
    assert.equal(summary.goalTruncated, true);
    assert.deepEqual(summary.lifecycle, {
      runCount: 3,
      sessionGeneration: 2,
      recoveryCount: 1,
      contextRotationCount: 1,
      contextHandoffCount: 1,
    });
    assert.deepEqual(summary.configuration, {
      acceptanceCriteriaCount: 2,
      validationCommandCount: 2,
      expectedChangedPathCount: 1,
    });
    assert.deepEqual(summary.validation, {
      completedAt: "2026-09-21T12:03:00.000Z",
      passed: true,
      commandsRequested: 2,
      commandsRun: 2,
      runCount: 2,
      repairCount: 1,
    });
    assert.equal(summary.diffSafety?.passed, true);
    assert.equal(summary.diffSafety?.changedFiles, 2);
    assert.equal(summary.workspaceEvidence?.branch, "phase-1/bootstrap");
    assert.equal(summary.handoff?.id, "handoff-1");
    assert.equal(summary.metrics?.totalInputTokens, 11_000);
    assert.equal(summary.outcome?.finishReason, "model_completed");

    const summaryPath = path.join(dir, ".orchestrator", "task-summaries", `${value.id}.json`);
    const raw = await readFile(summaryPath, "utf8");
    assert.doesNotMatch(raw, /PROMPT_SENTINEL_MUST_NOT_PERSIST/);
    assert.doesNotMatch(raw, /OUTPUT_SENTINEL_MUST_NOT_PERSIST/);
    assert.doesNotMatch(raw, /VALIDATION_STDOUT_SENTINEL_MUST_NOT_PERSIST/);
    assert.doesNotMatch(raw, /VALIDATION_STDERR_SENTINEL_MUST_NOT_PERSIST/);
    assert.doesNotMatch(raw, /CHANGED_PATH_SENTINEL_MUST_NOT_PERSIST/);
    assert.doesNotMatch(raw, /GIT_STATUS_SENTINEL_MUST_NOT_PERSIST/);
  });
});

test("task summary revisions preserve creation provenance and track the latest task snapshot", async () => {
  await withWorkspace(async (dir) => {
    const store = new TaskSummaryStore(dir);
    const value = task(dir, "task-revision");

    const first = await store.record(value);
    value.status = "completed";
    value.updatedAt = "2026-09-21T12:10:00.000Z";
    value.runCount = 2;
    value.finishReason = "completed_after_validation";

    const second = await store.record(value);

    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.sourceTaskUpdatedAt, "2026-09-21T12:10:00.000Z");
    assert.equal(second.status, "completed");
    assert.equal(second.lifecycle.runCount, 2);
    assert.equal(second.outcome?.finishReason, "completed_after_validation");
    assert.deepEqual(await new TaskSummaryStore(dir).load(value.id), second);
  });
});

test("task summary store rejects unsafe task ids and unsupported summary schemas", async () => {
  await withWorkspace(async (dir) => {
    const store = new TaskSummaryStore(dir);
    await assert.rejects(
      store.record({ ...task(dir), id: "../escape" }),
      /taskId must not contain path separators/,
    );

    const summariesDir = path.join(dir, ".orchestrator", "task-summaries");
    await mkdir(summariesDir, { recursive: true });
    await writeFile(
      path.join(summariesDir, "future.json"),
      JSON.stringify({ schemaVersion: 99, taskId: "future" }) + "\n",
      "utf8",
    );

    await assert.rejects(
      store.load("future"),
      /Unsupported or missing task summary schema/,
    );
  });
});
