import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  advanceUnattendedWorkflowWithBudget,
} from "./unattended-budgeted-coordinator.js";
import { UnattendedBudgetDecisionStore } from "./unattended-budget-store.js";
import type { UnattendedExecutionBudgetV1 } from "./unattended-budget.js";
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
  decision: "77777777-7777-4777-8777-777777777777",
};

function baseTask(
  id: string,
  safetyPlanId: string,
  overrides: Record<string, unknown> = {},
): OrchestratorTask {
  return {
    id,
    goal: "budgeted workflow task",
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

function completedTask1(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return baseTask(IDS.task1, "55555555-5555-4555-8555-555555555551", {
    status: "completed",
    runCount: 1,
    lastRunMetrics: {
      startedAt: "2026-09-25T06:01:00.000Z",
      completedAt: "2026-09-25T06:02:00.000Z",
      durationMs: 60_000,
      iterations: 2,
      toolCalls: 3,
      totalInputTokens: 400,
      totalOutputTokens: 100,
      turns: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-25T06:01:00.000Z",
      available: true,
      taskId: IDS.task1,
      runCount: 1,
    },
    ...overrides,
  });
}

function task2(): OrchestratorTask {
  return baseTask(IDS.task2, "55555555-5555-4555-8555-555555555552");
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2];
  let index = 0;
  return createUnattendedWorkflow([
    { task: completedTask1() },
    { task: task2(), dependsOnTaskIds: [IDS.task1] },
  ], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => nodeIds[index++]!,
    now: () => new Date("2026-09-25T06:00:00.000Z"),
  });
}

function budget(overrides: Partial<UnattendedExecutionBudgetV1> = {}): UnattendedExecutionBudgetV1 {
  return {
    schemaVersion: 1,
    maxElapsedMs: 3_600_000,
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

const evidence = [
  {
    taskId: IDS.task1,
    status: "completed" as const,
    validationPassed: true,
    diffSafetyPassed: true,
  },
  { taskId: IDS.task2, status: "created" as const },
];

test("budgeted coordinator starts one runnable task and durably records the allow decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-budget-decisions-"));
  try {
    const decisions = new UnattendedBudgetDecisionStore(root, {
      idFactory: () => IDS.decision,
      now: () => new Date("2026-09-25T06:10:00.000Z"),
    });
    const started: string[] = [];
    const result = await advanceUnattendedWorkflowWithBudget(
      workflow(),
      evidence,
      [completedTask1(), task2()],
      budget(),
      {
        checkpointMode: "existing_task_pre_run",
        startApprovedTask: async (taskId) => { started.push(taskId); },
      },
      {
        now: new Date("2026-09-25T06:10:00.000Z"),
        decisionStore: decisions,
      },
    );

    assert.deepEqual(started, [IDS.task2]);
    assert.equal(result.startedTaskId, IDS.task2);
    assert.equal(result.guard?.reason, "within_budget");
    const recorded = await decisions.list(IDS.workflow);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.allowed, true);
    assert.equal(recorded[0]?.taskId, IDS.task2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exhausted budget blocks start and persists human-visible deny evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-budget-decisions-"));
  try {
    const decisions = new UnattendedBudgetDecisionStore(root, {
      idFactory: () => IDS.decision,
    });
    const started: string[] = [];
    const result = await advanceUnattendedWorkflowWithBudget(
      workflow(),
      evidence,
      [completedTask1(), task2()],
      budget({ maxInputTokens: 400 }),
      {
        checkpointMode: "existing_task_pre_run",
        startApprovedTask: async (taskId) => { started.push(taskId); },
      },
      {
        now: new Date("2026-09-25T06:10:00.000Z"),
        decisionStore: decisions,
      },
    );

    assert.deepEqual(started, []);
    assert.equal(result.guard?.reason, "budget_exhausted");
    assert.ok(result.guard?.exhausted.includes("input_tokens"));
    const recorded = await decisions.list(IDS.workflow);
    assert.equal(recorded[0]?.allowed, false);
    assert.equal(recorded[0]?.reason, "budget_exhausted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incomplete historical accounting fails closed before starter invocation", async () => {
  const started: string[] = [];
  const result = await advanceUnattendedWorkflowWithBudget(
    workflow(),
    evidence,
    [completedTask1({ runCount: 2 }), task2()],
    budget(),
    {
      checkpointMode: "existing_task_pre_run",
      startApprovedTask: async (taskId) => { started.push(taskId); },
    },
    { now: new Date("2026-09-25T06:10:00.000Z") },
  );

  assert.deepEqual(started, []);
  assert.equal(result.guard?.reason, "accounting_incomplete");
});

test("missing completed-dependency checkpoint blocks progression", async () => {
  const started: string[] = [];
  const result = await advanceUnattendedWorkflowWithBudget(
    workflow(),
    evidence,
    [completedTask1({ lastRunCheckpoint: undefined }), task2()],
    budget(),
    {
      checkpointMode: "existing_task_pre_run",
      startApprovedTask: async (taskId) => { started.push(taskId); },
    },
    { now: new Date("2026-09-25T06:10:00.000Z") },
  );

  assert.deepEqual(started, []);
  assert.equal(result.guard?.reason, "checkpoint_policy_failed");
  assert.equal(result.guard?.dependencyTaskId, IDS.task1);
});
