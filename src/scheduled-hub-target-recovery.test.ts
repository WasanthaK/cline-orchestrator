import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ScheduledHubRestartReconciler,
} from "./scheduled-hub-recovery.js";
import {
  ScheduledHubWriterError,
  type ScheduledHubWriterAuthorityRunner,
} from "./scheduled-hub-writer-runner.js";
import type { OrchestratorTask } from "./types.js";
import type { WorkspaceLockStore } from "./workspace-lock-store.js";
import type { RegisteredWorkspace, WorkspaceRegistry } from "./workspace-registry.js";
import type {
  WriterConcurrencyScheduler,
  WriterScheduleResultV1,
} from "./writer-concurrency-scheduler.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const SAFETY_PLAN_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "66666666-6666-4666-8666-666666666666";

function scheduleResult(): WriterScheduleResultV1 {
  return {
    schemaVersion: 1,
    plan: {
      schemaVersion: 1,
      activeWriterCount: 0,
      admittedCount: 1,
      decisions: [{
        schemaVersion: 1,
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        allowed: true,
        reason: "admitted",
        authority: "coordination_only",
      }],
      authority: "coordination_only",
    },
    reservedTaskIds: [TASK_ID],
    completedTaskIds: [TASK_ID],
    failures: [],
    authority: "coordination_only",
  };
}

function workspace(root: string): RegisteredWorkspace {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    displayName: "Recovery workspace",
    canonicalRoot: root,
    revision: 1,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    safetyProfile: {
      profileId: PROFILE_ID,
      revision: 1,
      policyVersion: "policy-v1",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot-safe",
      maxChangedFiles: 10,
    },
  } as RegisteredWorkspace;
}

function interruptedTask(root: string, overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: TASK_ID,
    goal: "Continue the interrupted approved scheduled task",
    workspace: root,
    status: "running",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:01.000Z",
    runCount: 1,
    sessionGeneration: 1,
    recoveryCount: 0,
    clineSessionId: "disconnected-owner",
    lastPrompt: "Continue the interrupted approved scheduled task",
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspaceRegistryRevision: 1,
    safetyPlanId: SAFETY_PLAN_ID,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: PROFILE_ID,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"],
    workerProfileId: "pilot-safe",
    validationCommands: [],
    expectedChangedPaths: ["src/**"],
    lastRunCheckpoint: {
      runCount: 1,
      createdAt: "2026-09-27T00:00:00.500Z",
      available: true,
      workspaceRoot: root,
    },
    ...overrides,
  } as OrchestratorTask;
}

async function writeTask(root: string, task: OrchestratorTask): Promise<void> {
  const dir = path.join(root, ".orchestrator", "tasks");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

async function withHarness<T>(fn: (harness: {
  root: string;
  workspace: RegisteredWorkspace;
  task: OrchestratorTask;
  setLive(value: boolean): void;
  prepareCalls: string[];
  scheduleCalls: string[][];
  reconciler: ScheduledHubRestartReconciler;
}) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-target-recovery-"));
  try {
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const registered = workspace(workspaceRoot);
    const task = interruptedTask(workspaceRoot);
    await writeTask(workspaceRoot, task);

    let live = false;
    const registry = {
      listWorkspaces: async () => [{ workspaceId: WORKSPACE_ID }],
      resolveVerifiedWorkspace: async () => registered,
    } as unknown as WorkspaceRegistry;
    const locks = {
      listActive: async () => live
        ? [{ workspaceId: WORKSPACE_ID, activeWriter: { taskId: TASK_ID } }]
        : [],
    } as unknown as WorkspaceLockStore;
    const prepareCalls: string[] = [];
    const runner = {
      prepareInterruptedTaskRecovery: async (taskId: string) => {
        prepareCalls.push(taskId);
        return { taskId, workspaceId: WORKSPACE_ID, ownerInstanceId: OWNER_ID };
      },
    } as unknown as ScheduledHubWriterAuthorityRunner;
    const scheduleCalls: string[][] = [];
    const scheduler = {
      schedule: async (taskIds: string[]) => {
        scheduleCalls.push([...taskIds]);
        return scheduleResult();
      },
    } as unknown as WriterConcurrencyScheduler;

    const reconciler = new ScheduledHubRestartReconciler(registry, locks, runner, scheduler);
    return await fn({
      root,
      workspace: registered,
      task,
      setLive(value: boolean) { live = value; },
      prepareCalls,
      scheduleCalls,
      reconciler,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("targeted recovery pins one interrupted task and delegates only through permit plus scheduler", async () => {
  await withHarness(async ({ reconciler, prepareCalls, scheduleCalls }) => {
    const preview = await reconciler.previewInterruptedTaskRecovery(TASK_ID);
    assert.equal(preview.taskId, TASK_ID);
    assert.equal(preview.workspaceId, WORKSPACE_ID);
    assert.equal(preview.runCount, 1);
    assert.equal(preview.sessionGeneration, 1);
    assert.equal(preview.fingerprint.length, 64);
    assert.deepEqual(prepareCalls, []);
    assert.deepEqual(scheduleCalls, []);

    const recovered = await reconciler.recoverInterruptedTask(TASK_ID, preview.fingerprint);
    assert.equal(recovered.taskId, TASK_ID);
    assert.equal(recovered.workspaceId, WORKSPACE_ID);
    assert.deepEqual(prepareCalls, [TASK_ID]);
    assert.deepEqual(scheduleCalls, [[TASK_ID]]);
    assert.deepEqual(recovered.schedule.completedTaskIds, [TASK_ID]);
  });
});

test("targeted recovery refuses a newly live writer before permit or scheduling", async () => {
  await withHarness(async ({ reconciler, setLive, prepareCalls, scheduleCalls }) => {
    const preview = await reconciler.previewInterruptedTaskRecovery(TASK_ID);
    setLive(true);

    await assert.rejects(
      reconciler.recoverInterruptedTask(TASK_ID, preview.fingerprint),
      (error: unknown) => error instanceof ScheduledHubWriterError && error.code === "recovery_not_safe",
    );
    assert.deepEqual(prepareCalls, []);
    assert.deepEqual(scheduleCalls, []);
  });
});

test("targeted recovery refuses task-state drift after preview before permit or scheduling", async () => {
  await withHarness(async ({ reconciler, workspace, task, prepareCalls, scheduleCalls }) => {
    const preview = await reconciler.previewInterruptedTaskRecovery(TASK_ID);
    await writeTask(workspace.canonicalRoot, {
      ...task,
      updatedAt: "2026-09-27T00:00:02.000Z",
      sessionGeneration: 2,
    });

    await assert.rejects(
      reconciler.recoverInterruptedTask(TASK_ID, preview.fingerprint),
      (error: unknown) => error instanceof ScheduledHubWriterError && error.code === "recovery_not_safe",
    );
    assert.deepEqual(prepareCalls, []);
    assert.deepEqual(scheduleCalls, []);
  });
});

test("targeted recovery rejects an incorrect fingerprint without creating recovery authority", async () => {
  await withHarness(async ({ reconciler, prepareCalls, scheduleCalls }) => {
    await assert.rejects(
      reconciler.recoverInterruptedTask(TASK_ID, "0".repeat(64)),
      (error: unknown) => error instanceof ScheduledHubWriterError && error.code === "recovery_not_safe",
    );
    assert.deepEqual(prepareCalls, []);
    assert.deepEqual(scheduleCalls, []);
  });
});
