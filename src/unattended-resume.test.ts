import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { UnattendedExecutionBudgetV1 } from "./unattended-budget.js";
import { UnattendedBudgetDecisionStore } from "./unattended-budget-store.js";
import { UnattendedResumeError, resumeUnattendedWorkflow } from "./unattended-resume.js";
import { createUnattendedWorkflow } from "./unattended-workflow.js";
import { UnattendedWorkflowStore } from "./unattended-workflow-store.js";
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

function baseTask(
  id: string,
  safetyPlanId: string,
  overrides: Record<string, unknown> = {},
): OrchestratorTask {
  return {
    id,
    goal: "resume-safe task",
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

function successfulTask(
  id: string,
  safetyPlanId: string,
  overrides: Record<string, unknown> = {},
): OrchestratorTask {
  return baseTask(id, safetyPlanId, {
    status: "completed",
    runCount: 1,
    lastRunMetrics: {
      startedAt: "2026-09-25T06:01:00.000Z",
      completedAt: "2026-09-25T06:02:00.000Z",
      durationMs: 60_000,
      iterations: 2,
      toolCalls: 2,
      totalInputTokens: 300,
      totalOutputTokens: 80,
      turns: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-25T06:01:00.000Z",
      available: true,
      taskId: id,
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

function task1(overrides: Record<string, unknown> = {}) {
  return successfulTask(
    IDS.task1,
    "55555555-5555-4555-8555-555555555551",
    overrides,
  );
}

function task2(overrides: Record<string, unknown> = {}) {
  return baseTask(
    IDS.task2,
    "55555555-5555-4555-8555-555555555552",
    overrides,
  );
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2];
  let index = 0;
  return createUnattendedWorkflow([
    { task: baseTask(IDS.task1, "55555555-5555-4555-8555-555555555551") },
    {
      task: baseTask(IDS.task2, "55555555-5555-4555-8555-555555555552"),
      dependsOnTaskIds: [IDS.task1],
    },
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

async function harness(taskValues: OrchestratorTask[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-unattended-resume-"));
  const workflowStore = new UnattendedWorkflowStore(root);
  await workflowStore.save(workflow());
  const budgetDecisionStore = new UnattendedBudgetDecisionStore(root);
  const tasks = new Map(taskValues.map((task) => [task.id, task]));
  const started: string[] = [];
  return {
    root,
    workflowStore,
    budgetDecisionStore,
    tasks,
    started,
    options: {
      workflowStore,
      budgetDecisionStore,
      taskReader: {
        loadTask: async (taskId: string) => {
          const value = tasks.get(taskId);
          if (!value) throw new Error(`missing task ${taskId}`);
          return value;
        },
      },
      budget: budget(),
      starter: {
        checkpointMode: "existing_task_pre_run" as const,
        startApprovedTask: async (taskId: string) => { started.push(taskId); },
      },
      now: new Date("2026-09-25T06:10:00.000Z"),
    },
  };
}

test("restart reconciliation starts only the still-created runnable node", async () => {
  const h = await harness([task1(), task2()]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, h.options);
    assert.equal(result.action, "started");
    assert.equal(result.startedTaskId, IDS.task2);
    assert.deepEqual(h.started, [IDS.task2]);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("pinned workflow resume starts only the exact previewed runnable task", async () => {
  const h = await harness([task1(), task2()]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, {
      ...h.options,
      expectedTaskId: IDS.task2,
    });
    assert.equal(result.action, "started");
    assert.equal(result.startedTaskId, IDS.task2);
    assert.deepEqual(h.started, [IDS.task2]);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("pinned workflow resume fails closed before budget audit or start when the candidate changed", async () => {
  const h = await harness([task1(), task2()]);
  try {
    await assert.rejects(
      resumeUnattendedWorkflow(IDS.workflow, {
        ...h.options,
        expectedTaskId: IDS.task1,
      }),
      (error: unknown) =>
        error instanceof UnattendedResumeError && error.code === "expected_task_changed",
    );
    assert.deepEqual(h.started, []);
    assert.equal((await h.budgetDecisionStore.list(IDS.workflow)).length, 0);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("restart never replays a task that is already active", async () => {
  const h = await harness([
    task1(),
    task2({ status: "running", runCount: 1, lastRunMetrics: {
      startedAt: "2026-09-25T06:05:00.000Z",
      iterations: 0,
      toolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      turns: [],
    } }),
  ]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, h.options);
    assert.equal(result.action, "already_active");
    assert.deepEqual(h.started, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("workflow-level waiting-for-human state pauses unattended progression", async () => {
  const h = await harness([
    baseTask(IDS.task1, "55555555-5555-4555-8555-555555555551", {
      status: "waiting_for_human",
      pendingEscalation: {
        escalationId: "77777777-7777-4777-8777-777777777777",
        taskId: IDS.task1,
        requestedAt: "2026-09-25T06:05:00.000Z",
        reason: "broader scope required",
        actionKind: "edit",
        actionFingerprint: "fingerprint",
        status: "pending",
        reversible: true,
      },
    }),
    task2(),
  ]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, h.options);
    assert.equal(result.action, "waiting_for_human");
    assert.equal(result.report.status, "waiting_for_human");
    assert.deepEqual(h.started, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("terminal failure blocks workflow and does not start an independent stale candidate", async () => {
  const h = await harness([
    baseTask(IDS.task1, "55555555-5555-4555-8555-555555555551", { status: "failed" }),
    task2(),
  ]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, h.options);
    assert.equal(result.action, "workflow_blocked");
    assert.equal(result.report.status, "blocked");
    assert.deepEqual(h.started, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("budget denial is re-evaluated after restart and becomes durable report attention", async () => {
  const h = await harness([task1(), task2()]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, {
      ...h.options,
      budget: budget({ maxInputTokens: 300 }),
    });
    assert.equal(result.action, "budget_or_checkpoint_blocked");
    assert.equal(result.report.status, "budget_blocked");
    assert.deepEqual(h.started, []);
    assert.equal((await h.budgetDecisionStore.list(IDS.workflow)).length, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("completed workflow returns final report and starts nothing", async () => {
  const h = await harness([
    task1(),
    successfulTask(IDS.task2, "55555555-5555-4555-8555-555555555552"),
  ]);
  try {
    const result = await resumeUnattendedWorkflow(IDS.workflow, h.options);
    assert.equal(result.action, "workflow_completed");
    assert.equal(result.report.status, "completed");
    assert.equal(result.report.final, true);
    assert.deepEqual(h.started, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
