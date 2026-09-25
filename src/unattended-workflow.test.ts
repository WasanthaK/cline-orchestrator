import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnattendedWorkflow,
  selectRunnableWorkflowNodes,
  UnattendedWorkflowError,
} from "./unattended-workflow.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  workflow: "11111111-1111-4111-8111-111111111111",
  node1: "21111111-1111-4111-8111-111111111111",
  node2: "31111111-1111-4111-8111-111111111111",
  node3: "41111111-1111-4111-8111-111111111111",
  task1: "22222222-2222-4222-8222-222222222221",
  task2: "22222222-2222-4222-8222-222222222222",
  task3: "22222222-2222-4222-8222-222222222223",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan1: "55555555-5555-4555-8555-555555555551",
  safetyPlan2: "55555555-5555-4555-8555-555555555552",
  safetyPlan3: "55555555-5555-4555-8555-555555555553",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function approvedTask(
  id: string,
  safetyPlanId: string,
  overrides: Record<string, unknown> = {},
): OrchestratorTask {
  return {
    id,
    goal: `Task ${id}`,
    workspace: "/private/workspace/that-workflow-must-not-authorize",
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    validationCommands: ["npm test"],
    expectedChangedPaths: ["src/**"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 2,
    safetyPlanId,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 3,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*", ".git/**"],
    workerProfileId: "pilot-safe",
    ...overrides,
  } as OrchestratorTask;
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2, IDS.node3];
  let index = 0;
  return createUnattendedWorkflow([
    { task: approvedTask(IDS.task1, IDS.safetyPlan1) },
    { task: approvedTask(IDS.task2, IDS.safetyPlan2), dependsOnTaskIds: [IDS.task1] },
    { task: approvedTask(IDS.task3, IDS.safetyPlan3), dependsOnTaskIds: [IDS.task1] },
  ], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => nodeIds[index++]!,
    now: () => new Date("2026-09-25T06:00:00.000Z"),
  });
}

test("workflow stores only opaque task authority bindings and dependency ordering", () => {
  const value = workflow();

  assert.equal(value.schemaVersion, 1);
  assert.equal(value.workflowId, IDS.workflow);
  assert.deepEqual(value.nodes.map((node) => node.taskId), [IDS.task1, IDS.task2, IDS.task3]);
  assert.deepEqual(value.nodes[1]?.dependsOnTaskIds, [IDS.task1]);
  assert.deepEqual(value.nodes.map((node) => node.order), [0, 1, 2]);
  assert.equal(value.nodes.every((node) => node.validationRequired), true);

  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("/private/workspace"), false);
  assert.equal(serialized.includes("src/**"), false);
  assert.equal(serialized.includes(".env"), false);
  assert.equal(serialized.includes("npm test"), false);
});

test("workflow rejects missing durable approval binding rather than inventing authority", () => {
  assert.throws(
    () => createUnattendedWorkflow([
      { task: approvedTask(IDS.task1, IDS.safetyPlan1, { safetyPlanId: undefined }) },
    ]),
    (error: unknown) =>
      error instanceof UnattendedWorkflowError && error.code === "task_not_approved",
  );
});

test("workflow rejects self-cycles, multi-node cycles, duplicate tasks, and unknown dependencies", () => {
  assert.throws(
    () => createUnattendedWorkflow([
      { task: approvedTask(IDS.task1, IDS.safetyPlan1), dependsOnTaskIds: [IDS.task1] },
    ]),
    (error: unknown) => error instanceof UnattendedWorkflowError && error.code === "cycle_detected",
  );

  assert.throws(
    () => createUnattendedWorkflow([
      { task: approvedTask(IDS.task1, IDS.safetyPlan1), dependsOnTaskIds: [IDS.task2] },
      { task: approvedTask(IDS.task2, IDS.safetyPlan2), dependsOnTaskIds: [IDS.task1] },
    ]),
    (error: unknown) => error instanceof UnattendedWorkflowError && error.code === "cycle_detected",
  );

  assert.throws(
    () => createUnattendedWorkflow([
      { task: approvedTask(IDS.task1, IDS.safetyPlan1) },
      { task: approvedTask(IDS.task1, IDS.safetyPlan2) },
    ]),
    (error: unknown) => error instanceof UnattendedWorkflowError && error.code === "workflow_invalid",
  );

  assert.throws(
    () => createUnattendedWorkflow([
      { task: approvedTask(IDS.task1, IDS.safetyPlan1), dependsOnTaskIds: [IDS.task2] },
    ]),
    (error: unknown) => error instanceof UnattendedWorkflowError && error.code === "workflow_invalid",
  );
});

test("runnable selection is deterministic and waits for successful durable dependency evidence", () => {
  const value = workflow();

  const first = selectRunnableWorkflowNodes(value, [
    { taskId: IDS.task1, status: "created" },
    { taskId: IDS.task2, status: "created" },
    { taskId: IDS.task3, status: "created" },
  ]);
  assert.deepEqual(first.runnable.map((node) => node.taskId), [IDS.task1]);

  const afterFirst = selectRunnableWorkflowNodes(value, [
    {
      taskId: IDS.task1,
      status: "completed",
      validationPassed: true,
      diffSafetyPassed: true,
    },
    { taskId: IDS.task2, status: "created" },
    { taskId: IDS.task3, status: "created" },
  ]);
  assert.deepEqual(afterFirst.runnable.map((node) => node.taskId), [IDS.task2, IDS.task3]);
});

test("failed validation, failed diff safety, human escalation, or non-success dependency blocks downstream nodes", () => {
  const value = workflow();

  for (const evidence of [
    {
      taskId: IDS.task1,
      status: "completed" as const,
      validationPassed: false,
      diffSafetyPassed: true,
      expected: "dependency_validation_not_passed",
    },
    {
      taskId: IDS.task1,
      status: "completed" as const,
      validationPassed: true,
      diffSafetyPassed: false,
      expected: "dependency_diff_safety_not_passed",
    },
    {
      taskId: IDS.task1,
      status: "waiting_for_human" as const,
      validationPassed: true,
      diffSafetyPassed: true,
      expected: "dependency_waiting_for_human",
    },
    {
      taskId: IDS.task1,
      status: "failed" as const,
      validationPassed: true,
      diffSafetyPassed: true,
      expected: "dependency_not_completed",
    },
  ]) {
    const selection = selectRunnableWorkflowNodes(value, [
      evidence,
      { taskId: IDS.task2, status: "created" },
      { taskId: IDS.task3, status: "created" },
    ]);
    const downstream = selection.blocked.filter((item) =>
      item.node.taskId === IDS.task2 || item.node.taskId === IDS.task3
    );
    assert.equal(downstream.length, 2);
    assert.equal(downstream.every((item) => item.reason === evidence.expected), true);
  }
});

test("a node with an active or escalated own task is never selected as runnable", () => {
  const value = workflow();

  const active = selectRunnableWorkflowNodes(value, [
    { taskId: IDS.task1, status: "running" },
    { taskId: IDS.task2, status: "created" },
    { taskId: IDS.task3, status: "created" },
  ]);
  assert.equal(active.runnable.length, 0);
  assert.equal(active.blocked.find((item) => item.node.taskId === IDS.task1)?.reason, "task_already_active");

  const escalated = selectRunnableWorkflowNodes(value, [
    { taskId: IDS.task1, status: "created", pendingHumanEscalation: true },
    { taskId: IDS.task2, status: "created" },
    { taskId: IDS.task3, status: "created" },
  ]);
  assert.equal(escalated.runnable.length, 0);
  assert.equal(escalated.blocked.find((item) => item.node.taskId === IDS.task1)?.reason, "task_waiting_for_human");
});
