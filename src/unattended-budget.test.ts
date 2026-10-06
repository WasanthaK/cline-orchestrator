import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnattendedBudgetUsage,
  evaluateUnattendedStartGuard,
  type UnattendedExecutionBudgetV1,
} from "./unattended-budget.js";
import { createUnattendedWorkflow } from "./unattended-workflow.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  workflow: "11111111-1111-4111-8111-111111111111",
  node1: "21111111-1111-4111-8111-111111111111",
  node2: "31111111-1111-4111-8111-111111111111",
  task1: "22222222-2222-4222-8222-222222222221",
  task2: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function task(
  id: string,
  safetyPlanId: string,
  overrides: Record<string, unknown> = {},
): OrchestratorTask {
  return {
    id,
    goal: "budgeted task",
    workspace: "/private/workspace",
    status: "created",
    createdAt: "2026-09-25T06:00:00.000Z",
    updatedAt: "2026-09-25T06:00:00.000Z",
    validationCommands: ["npm test"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 1,
    safetyPlanId,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*"],
    workerProfileId: "pilot-safe",
    ...overrides,
  } as OrchestratorTask;
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2];
  let index = 0;
  return createUnattendedWorkflow([
    { task: task(IDS.task1, "55555555-5555-4555-8555-555555555551") },
    {
      task: task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
      dependsOnTaskIds: [IDS.task1],
    },
  ], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => nodeIds[index++]!,
    now: () => new Date("2026-09-25T06:00:00.000Z"),
  });
}

function completedTask1(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return task(IDS.task1, "55555555-5555-4555-8555-555555555551", {
    status: "completed",
    runCount: 1,
    recoveryCount: 1,
    validationRepairCount: 1,
    lastRunMetrics: {
      startedAt: "2026-09-25T06:01:00.000Z",
      completedAt: "2026-09-25T06:02:00.000Z",
      durationMs: 60_000,
      iterations: 3,
      toolCalls: 4,
      totalInputTokens: 500,
      totalOutputTokens: 120,
      turns: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-25T06:01:00.000Z",
      available: true,
      taskId: IDS.task1,
      runCount: 1,
    },
    lastValidation: {
      startedAt: "2026-09-25T06:02:00.000Z",
      completedAt: "2026-09-25T06:02:01.000Z",
      durationMs: 1000,
      passed: true,
      commandsRequested: 1,
      commandsRun: 1,
      results: [],
    },
    lastDiffSafety: {
      checkedAt: "2026-09-25T06:02:02.000Z",
      passed: true,
      finalDiffSummary: "safe",
      summary: {
        changedFiles: 1,
        trackedFiles: 1,
        untrackedFiles: 0,
        trackedAdditions: 1,
        trackedDeletions: 0,
      },
      changedPaths: [],
      warnings: [],
      failures: [],
    },
    ...overrides,
  });
}

function budget(overrides: Partial<UnattendedExecutionBudgetV1> = {}): UnattendedExecutionBudgetV1 {
  return {
    schemaVersion: 1,
    maxElapsedMs: 60 * 60 * 1000,
    maxModelRequests: 20,
    maxInputTokens: 20_000,
    maxOutputTokens: 5_000,
    maxToolCalls: 100,
    maxTaskRuns: 10,
    maxRecoveries: 5,
    maxValidationRepairs: 5,
    checkpointPolicy: {
      requireExistingTaskPreRunCheckpointMechanism: true,
      requireCompletedDependencyCheckpoint: true,
    },
    ...overrides,
  };
}

test("usage is derived from durable latest-run evidence and completed checkpoint state", () => {
  const value = workflow();
  const usage = buildUnattendedBudgetUsage(
    value,
    [completedTask1(), task(IDS.task2, "55555555-5555-4555-8555-555555555552")],
    new Date("2026-09-25T06:10:00.000Z"),
  );

  assert.equal(usage.accountingComplete, true);
  assert.equal(usage.elapsedMs, 10 * 60 * 1000);
  assert.equal(usage.modelRequests, 3);
  assert.equal(usage.inputTokens, 500);
  assert.equal(usage.outputTokens, 120);
  assert.equal(usage.toolCalls, 4);
  assert.equal(usage.taskRuns, 1);
  assert.equal(usage.recoveries, 1);
  assert.equal(usage.validationRepairs, 1);
  assert.equal(usage.checkpointAvailableByTaskId[IDS.task1], true);
});

test("historical run metrics that cannot be reconstructed make accounting incomplete", () => {
  const value = workflow();
  const usage = buildUnattendedBudgetUsage(
    value,
    [
      completedTask1({ runCount: 2 }),
      task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
    new Date("2026-09-25T06:10:00.000Z"),
  );

  assert.equal(usage.accountingComplete, false);
  assert.ok(usage.accountingIssues.some((item) => item.startsWith("historical_run_metrics_unavailable:")));
  const guard = evaluateUnattendedStartGuard(value, IDS.task2, usage, budget(), {
    starterCheckpointMode: "existing_task_pre_run",
  });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reason, "accounting_incomplete");
});

test("guard requires the existing pre-run checkpoint mechanism and completed dependency checkpoint evidence", () => {
  const value = workflow();
  const task2 = task(IDS.task2, "55555555-5555-4555-8555-555555555552");
  const usage = buildUnattendedBudgetUsage(
    value,
    [completedTask1(), task2],
    new Date("2026-09-25T06:10:00.000Z"),
  );

  assert.equal(
    evaluateUnattendedStartGuard(value, IDS.task2, usage, budget(), {
      starterCheckpointMode: "unknown",
    }).reason,
    "starter_checkpoint_mode_untrusted",
  );

  const missingCheckpoint = buildUnattendedBudgetUsage(
    value,
    [completedTask1({ lastRunCheckpoint: undefined }), task2],
    new Date("2026-09-25T06:10:00.000Z"),
  );
  const guard = evaluateUnattendedStartGuard(value, IDS.task2, missingCheckpoint, budget(), {
    starterCheckpointMode: "existing_task_pre_run",
  });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reason, "checkpoint_policy_failed");
  assert.equal(guard.dependencyTaskId, IDS.task1);
});

test("guard blocks exhausted dimensions and allows the final configured task-run slot", () => {
  const value = workflow();
  const usage = buildUnattendedBudgetUsage(
    value,
    [
      completedTask1(),
      task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
    new Date("2026-09-25T06:10:00.000Z"),
  );

  const exhaustedTokens = evaluateUnattendedStartGuard(
    value,
    IDS.task2,
    usage,
    budget({ maxInputTokens: 500 }),
    { starterCheckpointMode: "existing_task_pre_run" },
  );
  assert.equal(exhaustedTokens.allowed, false);
  assert.ok(exhaustedTokens.exhausted.includes("input_tokens"));

  const finalRunSlot = evaluateUnattendedStartGuard(
    value,
    IDS.task2,
    usage,
    budget({ maxTaskRuns: 2 }),
    { starterCheckpointMode: "existing_task_pre_run", projectedAdditionalRuns: 1 },
  );
  assert.equal(finalRunSlot.allowed, true);

  const noRunSlot = evaluateUnattendedStartGuard(
    value,
    IDS.task2,
    usage,
    budget({ maxTaskRuns: 1 }),
    { starterCheckpointMode: "existing_task_pre_run", projectedAdditionalRuns: 1 },
  );
  assert.equal(noRunSlot.allowed, false);
  assert.ok(noRunSlot.exhausted.includes("task_runs"));
});
