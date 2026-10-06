import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OperatorActionError } from "./operator-action.js";
import {
  OperatorWorkflowActionService,
  OperatorWorkflowAuditStore,
} from "./operator-workflow-action.js";
import type { UnattendedExecutionBudgetV1 } from "./unattended-budget.js";
import { UnattendedBudgetDecisionStore } from "./unattended-budget-store.js";
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
    goal: "operator workflow task",
    workspace: "/private/workspace",
    status: "created",
    createdAt: "2026-09-26T12:00:00.000Z",
    updatedAt: "2026-09-26T12:00:00.000Z",
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

function successfulTask(id: string, safetyPlanId: string): OrchestratorTask {
  return baseTask(id, safetyPlanId, {
    status: "completed",
    runCount: 1,
    updatedAt: "2026-09-26T12:05:00.000Z",
    lastRunMetrics: {
      startedAt: "2026-09-26T12:01:00.000Z",
      completedAt: "2026-09-26T12:02:00.000Z",
      durationMs: 60_000,
      iterations: 2,
      toolCalls: 3,
      totalInputTokens: 500,
      totalOutputTokens: 100,
      turns: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-26T12:01:00.000Z",
      available: true,
      taskId: id,
      runCount: 1,
    },
    lastValidation: {
      startedAt: "2026-09-26T12:02:00.000Z",
      completedAt: "2026-09-26T12:02:01.000Z",
      durationMs: 1000,
      passed: true,
      commandsRequested: 1,
      commandsRun: 1,
      results: [],
    },
    lastDiffSafety: {
      checkedAt: "2026-09-26T12:02:02.000Z",
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
  });
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
    now: () => new Date("2026-09-26T12:00:00.000Z"),
  });
}

function budget(): UnattendedExecutionBudgetV1 {
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
  };
}

async function harness(options: { starterFails?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-operator-workflow-"));
  const workflowStore = new UnattendedWorkflowStore(root);
  await workflowStore.save(workflow());
  const budgetDecisionStore = new UnattendedBudgetDecisionStore(root);
  const auditStore = new OperatorWorkflowAuditStore(root);
  const tasks = new Map<string, OrchestratorTask>([
    [IDS.task1, successfulTask(IDS.task1, "55555555-5555-4555-8555-555555555551")],
    [IDS.task2, baseTask(IDS.task2, "55555555-5555-4555-8555-555555555552")],
  ]);
  const started: string[] = [];
  let now = Date.parse("2026-09-26T12:10:00.000Z");
  const actions = new OperatorWorkflowActionService({
    workflowStore,
    budgetDecisionStore,
    taskReader: {
      loadTask: async (taskId: string) => {
        const task = tasks.get(taskId);
        if (!task) throw new Error(`missing task ${taskId}`);
        return structuredClone(task);
      },
    },
    budget: budget(),
    starter: {
      checkpointMode: "existing_task_pre_run",
      startApprovedTask: async (taskId: string) => {
        if (options.starterFails) throw new Error("current task authority no longer matches registry");
        started.push(taskId);
      },
    },
    auditStore,
  }, () => now);

  return {
    root,
    workflowStore,
    budgetDecisionStore,
    auditStore,
    tasks,
    started,
    actions,
    advanceNow: (milliseconds: number) => { now += milliseconds; },
  };
}

test("operator confirms exactly the previewed workflow task, audits once, and rejects replay", async () => {
  const h = await harness();
  try {
    const preview = await h.actions.previewWorkflowResume(IDS.workflow);
    assert.equal(preview.action, "resume_workflow");
    assert.equal(preview.workflowId, IDS.workflow);
    assert.equal(preview.expectedTaskId, IDS.task2);
    assert.equal(preview.workflowStatus, "ready");
    assert.equal(preview.counts.totalNodes, 2);
    assert.equal(JSON.stringify(preview).includes("/private/workspace"), false);
    assert.equal(JSON.stringify(preview).includes("src/**"), false);

    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: false as true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );

    const result = await h.actions.resumeWorkflow({
      workflowId: IDS.workflow,
      expectedTaskId: IDS.task2,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    });
    assert.equal(result.action, "started");
    assert.equal(result.startedTaskId, IDS.task2);
    assert.deepEqual(h.started, [IDS.task2]);

    const audits = await h.auditStore.list(IDS.workflow);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.kind, "workflow_resume_confirmed");
    assert.equal(audits[0]?.expectedTaskId, IDS.task2);
    assert.equal(JSON.stringify(audits).includes(preview.confirmationToken), false);

    const decisions = await h.budgetDecisionStore.list(IDS.workflow);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.allowed, true);
    assert.equal(decisions[0]?.taskId, IDS.task2);

    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    assert.equal((await h.auditStore.list(IDS.workflow)).length, 1);
    assert.deepEqual(h.started, [IDS.task2]);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("expired workflow confirmation fails closed before audit, budget decision, or starter", async () => {
  const h = await harness();
  try {
    const preview = await h.actions.previewWorkflowResume(IDS.workflow);
    h.advanceNow(60_000);
    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
    );
    assert.deepEqual(h.started, []);
    assert.equal((await h.auditStore.list(IDS.workflow)).length, 0);
    assert.equal((await h.budgetDecisionStore.list(IDS.workflow)).length, 0);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("task or workflow candidate drift after preview burns the token and starts nothing", async () => {
  const h = await harness();
  try {
    const preview = await h.actions.previewWorkflowResume(IDS.workflow);
    const changed = h.tasks.get(IDS.task2)!;
    h.tasks.set(IDS.task2, {
      ...changed,
      updatedAt: "2026-09-26T12:11:00.000Z",
      safetyProfileRevision: 2,
    } as OrchestratorTask);

    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    assert.deepEqual(h.started, []);
    assert.equal((await h.auditStore.list(IDS.workflow)).length, 0);
    assert.equal((await h.budgetDecisionStore.list(IDS.workflow)).length, 0);

    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("authority-enforcing starter failure propagates after audit without reporting a workflow start", async () => {
  const h = await harness({ starterFails: true });
  try {
    const preview = await h.actions.previewWorkflowResume(IDS.workflow);
    await assert.rejects(
      h.actions.resumeWorkflow({
        workflowId: IDS.workflow,
        expectedTaskId: IDS.task2,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      /current task authority no longer matches registry/,
    );
    assert.deepEqual(h.started, []);
    assert.equal((await h.auditStore.list(IDS.workflow)).length, 1);
    const decisions = await h.budgetDecisionStore.list(IDS.workflow);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.allowed, true);
    assert.equal(decisions[0]?.taskId, IDS.task2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
