import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createUnattendedWorkflow,
  UnattendedWorkflowError,
} from "./unattended-workflow.js";
import {
  UnattendedWorkflowNotFoundError,
  UnattendedWorkflowStore,
} from "./unattended-workflow-store.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  workflow: "11111111-1111-4111-8111-111111111111",
  node: "21111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan: "55555555-5555-4555-8555-555555555555",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function approvedTask(): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "Durable workflow task",
    workspace: "/private/workspace",
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    validationCommands: ["npm test"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 1,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*"],
    workerProfileId: "pilot-safe",
  } as OrchestratorTask;
}

function durableWorkflow() {
  return createUnattendedWorkflow([{ task: approvedTask() }], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => IDS.node,
    now: () => new Date("2026-09-25T06:30:00.000Z"),
  });
}

test("workflow store atomically persists and reloads immutable workflow authority references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-workflow-store-"));
  try {
    const store = new UnattendedWorkflowStore(root);
    const workflow = durableWorkflow();
    await store.save(workflow);

    assert.deepEqual(await store.load(IDS.workflow), workflow);
    assert.deepEqual(await store.list(), [workflow]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow store rejects traversal/non-opaque IDs before filesystem lookup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-workflow-store-"));
  try {
    const store = new UnattendedWorkflowStore(root);
    await assert.rejects(
      () => store.load("../outside"),
      (error: unknown) =>
        error instanceof UnattendedWorkflowError && error.code === "workflow_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow store reports missing opaque workflow separately from malformed identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-workflow-store-"));
  try {
    const store = new UnattendedWorkflowStore(root);
    await assert.rejects(
      () => store.load(IDS.workflow),
      (error: unknown) => error instanceof UnattendedWorkflowNotFoundError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow store refuses persisted identity mismatch and invalid graph state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-workflow-store-"));
  try {
    const store = new UnattendedWorkflowStore(root);
    const workflowsDir = path.join(root, "workflows");
    await mkdir(workflowsDir, { recursive: true });

    const mismatched = { ...durableWorkflow(), workflowId: "77777777-7777-4777-8777-777777777777" };
    await writeFile(
      path.join(workflowsDir, `${IDS.workflow}.json`),
      JSON.stringify(mismatched),
      "utf8",
    );
    await assert.rejects(
      () => store.load(IDS.workflow),
      (error: unknown) =>
        error instanceof UnattendedWorkflowError && error.code === "workflow_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
