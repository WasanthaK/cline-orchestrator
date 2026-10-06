import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { MachineOrchestratorService } from "./machine-orchestrator.js";
import { OperatorActionError, OperatorActionService } from "./operator-action.js";
import { startApprovedTask } from "./safe-task-start.js";
import { SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { WorkerConfig } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

function worker(): WorkerConfig {
  return {
    providerId: "openai-compatible",
    modelId: "operator-abort-test",
    apiKey: "local-test-key",
    baseUrl: "http://127.0.0.1:1/v1",
    contextWindow: 4096,
    maxInputTokens: 3500,
    maxTokensPerTurn: 512,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 100,
    validationTimeoutMs: 100,
    maxValidationOutputChars: 1000,
    maxValidationRepairs: 0,
    checkpointMaxUntrackedFiles: 10,
    checkpointMaxUntrackedBytes: 1024 * 1024,
    contextRotateAtTokens: 3000,
    maxContextRotations: 1,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

async function withAbortableTask(fn: (context: {
  actions: OperatorActionService;
  service: MachineOrchestratorService;
  registry: WorkspaceRegistry;
  store: TaskStore;
  taskId: string;
  workspaceId: string;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-operator-abort-"));
  let service: MachineOrchestratorService | undefined;
  try {
    const git = (...args: string[]) => execFile("git", ["-C", root, ...args], { windowsHide: true });
    await git("init");
    await git("config", "user.name", "Operator Abort Test");
    await git("config", "user.email", "operator-abort@example.invalid");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "demo.ts"), "export const value = 1;\n");
    await git("add", ".");
    await git("commit", "-m", "baseline");

    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Operator Abort Test");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Disposable Operator Abort Test",
      root,
      safetyProfile: {
        policyVersion: "policy-v1",
        allowedPathPatterns: ["src/**"],
        protectedPathPatterns: [".env*"],
        validationCommands: [],
        workerProfileId: "test",
        maxChangedFiles: 1,
      },
    });
    const plans = new SafetyPlanService(registry);
    const preview = await plans.preview({
      workspaceId: workspace.workspaceId,
      goal: "Abortable bounded task",
      requestedScope: ["src/demo.ts"],
    });
    const { task } = await startApprovedTask(plans, preview.planToken);
    const store = new TaskStore(root);
    service = new MachineOrchestratorService(registry, plans, () => worker());
    const actions = new OperatorActionService(service);
    await fn({ actions, service, registry, store, taskId: task.id, workspaceId: workspace.workspaceId });
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("operator abort requires confirmation, uses machine abort, audits once, and rejects replay", async () => {
  await withAbortableTask(async ({ actions, service, taskId, workspaceId }) => {
    const preview = await actions.previewTaskAbort(taskId);
    assert.equal(preview.action, "abort_task");
    assert.equal(preview.workspaceId, workspaceId);
    assert.equal(JSON.stringify(preview).includes("src/demo.ts"), false);

    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: preview.confirmationToken, confirmed: false as true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );

    const result = await actions.abortTask({
      taskId,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    });
    assert.equal(result.status, "aborted");
    assert.equal(result.finishReason, "aborted");

    const events = await service.getTaskEvents(taskId);
    assert.equal(events.filter((event) => event.type === "abort_requested").length, 1);
    assert.equal(events.find((event) => event.type === "abort_requested")?.message, "Task aborted by local operator");

    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    await assert.rejects(actions.previewTaskAbort(taskId), OperatorActionError);
  });
});

test("abort confirmation fails closed after task or safety-profile drift and cannot replay", async () => {
  await withAbortableTask(async ({ actions, registry, store, taskId, workspaceId }) => {
    const changedTaskPreview = await actions.previewTaskAbort(taskId);
    const task = await store.load(taskId);
    task.goal = "Changed after operator preview";
    await store.save(task);

    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: changedTaskPreview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: changedTaskPreview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    assert.notEqual((await store.load(taskId)).status, "aborted");

    const profilePreview = await actions.previewTaskAbort(taskId);
    await registry.updateSafetyProfile(workspaceId, {
      policyVersion: "policy-v2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*"],
      validationCommands: [],
      workerProfileId: "test",
      maxChangedFiles: 1,
    });

    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: profilePreview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "task_binding_stale",
    );
    assert.notEqual((await store.load(taskId)).status, "aborted");
    assert.equal((await store.events(taskId)).some((event) => event.type === "abort_requested"), false);
  });
});

test("expired abort confirmation is consumed without changing the task", async () => {
  await withAbortableTask(async ({ service, store, taskId }) => {
    let now = Date.parse("2026-09-26T00:00:00.000Z");
    const actions = new OperatorActionService(service, () => now);
    const preview = await actions.previewTaskAbort(taskId);
    now += 60_000;

    await assert.rejects(
      actions.abortTask({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
    );
    assert.notEqual((await store.load(taskId)).status, "aborted");
    assert.equal((await store.events(taskId)).some((event) => event.type === "abort_requested"), false);
  });
});
