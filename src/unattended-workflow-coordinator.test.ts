import assert from "node:assert/strict";
import test from "node:test";
import { advanceUnattendedWorkflow } from "./unattended-workflow-coordinator.js";
import { createUnattendedWorkflow } from "./unattended-workflow.js";
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
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function task(id: string, safetyPlanId: string): OrchestratorTask {
  return {
    id,
    goal: "bounded workflow task",
    workspace: "/private/workspace",
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
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
  } as OrchestratorTask;
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2, IDS.node3];
  let index = 0;
  return createUnattendedWorkflow([
    { task: task(IDS.task1, "55555555-5555-4555-8555-555555555551") },
    { task: task(IDS.task2, "55555555-5555-4555-8555-555555555552"), dependsOnTaskIds: [IDS.task1] },
    { task: task(IDS.task3, "55555555-5555-4555-8555-555555555553"), dependsOnTaskIds: [IDS.task1] },
  ], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => nodeIds[index++]!,
  });
}

test("coordinator starts only the deterministic runnable task by opaque task ID", async () => {
  const started: string[] = [];
  const result = await advanceUnattendedWorkflow(
    workflow(),
    [
      { taskId: IDS.task1, status: "created" },
      { taskId: IDS.task2, status: "created" },
      { taskId: IDS.task3, status: "created" },
    ],
    { startApprovedTask: async (taskId) => { started.push(taskId); } },
  );

  assert.deepEqual(started, [IDS.task1]);
  assert.deepEqual(result.startedTaskIds, [IDS.task1]);
  assert.deepEqual(result.runnableTaskIds, [IDS.task1]);
  assert.deepEqual(result.blockedTaskIds.sort(), [IDS.task2, IDS.task3].sort());
});

test("coordinator progresses multiple independent dependents only after durable predecessor success", async () => {
  const started: string[] = [];
  const result = await advanceUnattendedWorkflow(
    workflow(),
    [
      { taskId: IDS.task1, status: "completed", validationPassed: true, diffSafetyPassed: true },
      { taskId: IDS.task2, status: "created" },
      { taskId: IDS.task3, status: "created" },
    ],
    { startApprovedTask: async (taskId) => { started.push(taskId); } },
    { maxStarts: 2 },
  );

  assert.deepEqual(started, [IDS.task2, IDS.task3]);
  assert.deepEqual(result.startedTaskIds, [IDS.task2, IDS.task3]);
});

test("coordinator never invokes starter for failed or human-blocked dependencies", async () => {
  for (const predecessor of [
    { taskId: IDS.task1, status: "failed" as const },
    { taskId: IDS.task1, status: "waiting_for_human" as const, pendingHumanEscalation: true },
    { taskId: IDS.task1, status: "completed" as const, validationPassed: false, diffSafetyPassed: true },
    { taskId: IDS.task1, status: "completed" as const, validationPassed: true, diffSafetyPassed: false },
  ]) {
    const started: string[] = [];
    await advanceUnattendedWorkflow(
      workflow(),
      [
        predecessor,
        { taskId: IDS.task2, status: "created" },
        { taskId: IDS.task3, status: "created" },
      ],
      { startApprovedTask: async (taskId) => { started.push(taskId); } },
      { maxStarts: 3 },
    );
    assert.deepEqual(started, []);
  }
});

test("coordinator respects maxStarts and propagates starter failure without trying later nodes", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => advanceUnattendedWorkflow(
      workflow(),
      [
        { taskId: IDS.task1, status: "completed", validationPassed: true, diffSafetyPassed: true },
        { taskId: IDS.task2, status: "created" },
        { taskId: IDS.task3, status: "created" },
      ],
      {
        startApprovedTask: async (taskId) => {
          calls.push(taskId);
          throw new Error("starter rejected stale authority");
        },
      },
      { maxStarts: 2 },
    ),
    /starter rejected stale authority/,
  );
  assert.deepEqual(calls, [IDS.task2]);
});
