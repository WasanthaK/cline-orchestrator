import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import {
  MachineGatewayError,
  MachineOrchestratorService,
} from "./machine-orchestrator.js";
import { OperatorActionError, OperatorActionService } from "./operator-action.js";
import { SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

class FakeRuntime implements ClineRuntime {
  private readonly sessions = new Map<string, { sessionId: string; workspaceRoot?: string }>();

  subscribe() {
    return () => undefined;
  }

  async start(input: any) {
    const sessionId = "rollback-authority-session";
    this.sessions.set(sessionId, { sessionId, workspaceRoot: input?.config?.workspaceRoot });
    return { sessionId };
  }

  async send() {
    return { finishReason: "completed", text: "completed" };
  }

  async abort() {}
  async dispose() {}

  async get(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = new Error("session not found") as Error & { code?: string };
      error.code = "session_not_found";
      throw error;
    }
    return session;
  }
}

class FakeRuntimeFactory implements ClineRuntimeFactory {
  readonly runtime = new FakeRuntime();

  async create(_request: ClineRuntimeCreateRequest) {
    return this.runtime;
  }
}

function worker(baseUrl: string): WorkerConfig {
  return {
    providerId: "openai-compatible",
    modelId: "test-model",
    apiKey: "local-test-key",
    baseUrl,
    contextWindow: 4096,
    maxInputTokens: 3500,
    maxTokensPerTurn: 512,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 2000,
    validationTimeoutMs: 5000,
    maxValidationOutputChars: 4000,
    maxValidationRepairs: 0,
    checkpointMaxUntrackedFiles: 100,
    checkpointMaxUntrackedBytes: 1024 * 1024,
    contextRotateAtTokens: 3000,
    maxContextRotations: 2,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

async function startModelMetadataServer(): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  };
}

async function waitForStatus(
  service: MachineOrchestratorService,
  taskId: string,
  expected: OrchestratorTask["status"],
): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if ((await service.getTask(taskId)).status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`task ${taskId} did not reach ${expected}`);
}

async function waitForWorkspaceIdle(service: MachineOrchestratorService, workspaceId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const { runtime } = await service.getWorkspaceStatus(workspaceId);
    if (!runtime.activeTaskId && !runtime.activeValidationTaskId && runtime.queuedJobs === 0 && !runtime.rollbackInProgress) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`workspace ${workspaceId} did not become idle`);
}

async function withCompletedTask(fn: (context: {
  root: string;
  service: MachineOrchestratorService;
  registry: WorkspaceRegistry;
  store: TaskStore;
  taskId: string;
  workspaceId: string;
  checkpointId: string;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-rollback-authority-"));
  const metadata = await startModelMetadataServer();
  let service: MachineOrchestratorService | undefined;
  try {
    await git(root, "init");
    await git(root, "config", "user.name", "Rollback Authority Test");
    await git(root, "config", "user.email", "rollback-authority@example.invalid");
    await git(root, "config", "core.autocrlf", "false");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "base");

    const registry = new WorkspaceRegistry(path.join(root, "machine", "registry.json"));
    const project = await registry.registerProject("Rollback Authority Test");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Rollback Authority Workspace",
      root,
      safetyProfile: {
        policyVersion: "policy-v1",
        allowedPathPatterns: ["src/**"],
        protectedPathPatterns: ["src/protected/**"],
        validationCommands: [],
        workerProfileId: "pilot",
        maxChangedFiles: 20,
      },
    });
    const plans = new SafetyPlanService(registry);
    service = new MachineOrchestratorService(
      registry,
      plans,
      (profileId) => {
        assert.equal(profileId, "pilot");
        return worker(metadata.baseUrl);
      },
      new FakeRuntimeFactory(),
    );

    const preview = await service.previewTask({
      workspaceId: workspace.workspaceId,
      goal: "Create rollback authority evidence",
      requestedScope: ["src/**"],
    });
    const queued = await service.startTask(preview.planToken);
    await waitForStatus(service, queued.taskId, "completed");
    await waitForWorkspaceIdle(service, workspace.workspaceId);
    const completed = await service.getTask(queued.taskId);
    assert.ok(completed.checkpoint?.checkpointId);

    await fn({
      root,
      service,
      registry,
      store: new TaskStore(root),
      taskId: queued.taskId,
      workspaceId: workspace.workspaceId,
      checkpointId: completed.checkpoint!.checkpointId,
    });
  } finally {
    await service?.close();
    await metadata.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("rollback fails closed on registry safety-profile drift before audit or workspace mutation", async () => {
  await withCompletedTask(async ({ root, service, registry, store, taskId, workspaceId, checkpointId }) => {
    const before = await readFile(path.join(root, "src", "app.ts"), "utf8");
    const beforeEvents = await store.events(taskId);

    await registry.updateSafetyProfile(workspaceId, {
      policyVersion: "policy-v2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot",
      maxChangedFiles: 20,
    });

    await assert.rejects(
      service.rollbackTask(taskId, checkpointId),
      (error: unknown) => error instanceof MachineGatewayError && error.code === "task_binding_stale",
    );

    assert.equal(await readFile(path.join(root, "src", "app.ts"), "utf8"), before);
    assert.equal((await store.load(taskId)).status, "completed");
    const afterEvents = await store.events(taskId);
    assert.equal(afterEvents.length, beforeEvents.length);
    assert.equal(afterEvents.some((event) => event.type === "rollback_requested"), false);
    assert.equal(afterEvents.some((event) => event.type === "rollback_completed"), false);
  });
});

test("rollback fails closed when the task's durable safety binding is stale", async () => {
  await withCompletedTask(async ({ root, service, store, taskId, checkpointId }) => {
    const task = await store.load(taskId) as OrchestratorTask & { safetyPolicyVersion?: string };
    task.safetyPolicyVersion = "stale-policy-version";
    await store.save(task);
    const before = await readFile(path.join(root, "src", "app.ts"), "utf8");

    await assert.rejects(
      service.rollbackTask(taskId, checkpointId),
      (error: unknown) => error instanceof MachineGatewayError && error.code === "task_binding_stale",
    );

    assert.equal(await readFile(path.join(root, "src", "app.ts"), "utf8"), before);
    assert.equal((await store.load(taskId)).status, "completed");
    const events = await store.events(taskId);
    assert.equal(events.some((event) => event.type === "rollback_requested"), false);
    assert.equal(events.some((event) => event.type === "rollback_completed"), false);
  });
});

test("operator rollback requires the previewed checkpoint, audits once, and rejects replay", async () => {
  await withCompletedTask(async ({ service, store, taskId, workspaceId, checkpointId }) => {
    const actions = new OperatorActionService(service);
    const preview = await actions.previewTaskRollback(taskId);
    assert.equal(preview.action, "rollback_task");
    assert.equal(preview.workspaceId, workspaceId);
    assert.equal(preview.checkpointId, checkpointId);
    assert.match(preview.confirmationText, /pre-run checkpoint/i);

    await assert.rejects(
      actions.rollbackTask({
        taskId,
        checkpointId: "0".repeat(32),
        confirmationToken: preview.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );

    const rolledBack = await actions.rollbackTask({
      taskId,
      checkpointId,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    });
    assert.equal(rolledBack.status, "rolled_back");
    const events = await store.events(taskId);
    assert.equal(events.filter((event) => event.type === "rollback_requested").length, 1);
    assert.equal(events.filter((event) => event.type === "rollback_completed").length, 1);

    await assert.rejects(
      actions.rollbackTask({ taskId, checkpointId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    await assert.rejects(
      actions.previewTaskRollback(taskId),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
  });
});

test("operator rollback burns a stale preview when task state changes", async () => {
  await withCompletedTask(async ({ service, store, taskId, checkpointId }) => {
    const actions = new OperatorActionService(service);
    const preview = await actions.previewTaskRollback(taskId);
    const task = await store.load(taskId);
    task.finishReason = "changed-after-preview";
    task.updatedAt = new Date(Date.parse(task.updatedAt) + 1_000).toISOString();
    await store.save(task);

    await assert.rejects(
      actions.rollbackTask({ taskId, checkpointId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    assert.equal((await store.load(taskId)).status, "completed");
    assert.equal((await store.events(taskId)).some((event) => event.type === "rollback_requested"), false);
    await assert.rejects(
      actions.rollbackTask({ taskId, checkpointId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
  });
});

test("operator rollback confirmation expires before invoking the machine rollback service", async () => {
  await withCompletedTask(async ({ service, store, taskId, checkpointId }) => {
    let now = Date.parse("2026-09-26T00:00:00.000Z");
    const actions = new OperatorActionService(service, () => now);
    const preview = await actions.previewTaskRollback(taskId);
    now += 60_000;

    await assert.rejects(
      actions.rollbackTask({ taskId, checkpointId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
    );
    assert.equal((await store.load(taskId)).status, "completed");
    assert.equal((await store.events(taskId)).some((event) => event.type === "rollback_requested"), false);
  });
});
