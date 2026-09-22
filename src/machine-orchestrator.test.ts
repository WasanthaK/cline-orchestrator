import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function withRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-machine-gateway-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Gateway Test");
    await git(dir, "config", "user.email", "gateway@example.invalid");
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "app.ts"), "export const value = 1;\n", "utf8");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

class FakeRuntime implements ClineRuntime {
  readonly starts: any[] = [];
  readonly sends: any[] = [];
  private readonly sessions = new Map<string, any>();
  private sessionCount = 0;

  subscribe() {
    return () => undefined;
  }

  async start(input: any) {
    this.starts.push(input);
    const sessionId = `fake-session-${++this.sessionCount}`;
    this.sessions.set(sessionId, {
      sessionId,
      workspaceRoot: input?.config?.workspaceRoot,
    });
    return { sessionId };
  }

  async send(input: any) {
    this.sends.push(input);
    return { finishReason: "completed", text: "SECRET-WORKER-OUTPUT" };
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
  readonly requests: ClineRuntimeCreateRequest[] = [];
  readonly runtime = new FakeRuntime();

  async create(request: ClineRuntimeCreateRequest) {
    this.requests.push(request);
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

async function buildService(dir: string, baseUrl: string) {
  const registry = new WorkspaceRegistry(path.join(dir, "machine", "registry.json"));
  const project = await registry.registerProject("Test Project");
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Safe Workspace",
    root: dir,
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
  const runtimeFactory = new FakeRuntimeFactory();
  const service = new MachineOrchestratorService(
    registry,
    plans,
    (profileId) => {
      assert.equal(profileId, "pilot");
      return worker(baseUrl);
    },
    runtimeFactory,
  );
  return { registry, project, workspace, plans, runtimeFactory, service };
}

test("machine gateway uses opaque IDs, queues Hub execution, and sanitizes task/event views", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { service, workspace, runtimeFactory } = await buildService(dir, metadata.baseUrl);
    try {
      const workspaces = await service.listWorkspaces();
      assert.equal(workspaces.length, 1);
      assert.equal(workspaces[0]?.workspaceId, workspace.workspaceId);
      assert.equal(JSON.stringify(workspaces).includes(dir), false);

      const preview = await service.previewTask({
        workspaceId: workspace.workspaceId,
        goal: "Inspect and safely update src/app.ts",
        requestedScope: ["src/**"],
      });
      assert.ok(preview.planToken.length >= 32);

      const queued = await service.startTask(preview.planToken);
      assert.equal(queued.status, "waiting");
      assert.equal(queued.workspaceId, workspace.workspaceId);
      assert.deepEqual(queued.safety.allowedPathPatterns, ["src/**"]);
      assert.equal(JSON.stringify(queued).includes(dir), false);
      assert.equal(JSON.stringify(queued).includes(preview.planToken), false);

      await waitForStatus(service, queued.taskId, "completed");
      const completed = await service.getTask(queued.taskId);
      const serialized = JSON.stringify(completed);
      assert.equal(serialized.includes(dir), false);
      assert.equal(serialized.includes("fake-session"), false);
      assert.equal(serialized.includes("SECRET-WORKER-OUTPUT"), false);
      assert.ok(completed.checkpoint?.checkpointId);
      assert.equal(runtimeFactory.requests[0]?.mode, "hub");

      const events = await service.getTaskEvents(queued.taskId);
      assert.ok(events.some((event) => event.type === "queued"));
      assert.ok(events.some((event) => event.type === "completed"));
      assert.equal(JSON.stringify(events).includes("fake-session"), false);
      assert.equal(events.every((event) => !("data" in event)), true);

      const diff = await service.getTaskDiff(queued.taskId);
      assert.equal(diff.available, true);
      assert.equal(Array.isArray(diff.changedPaths), true);
      assert.equal(JSON.stringify(diff).includes("SECRET-WORKER-OUTPUT"), false);

      const resumed = await service.continueTask(
        queued.taskId,
        "Re-check the approved src/** scope only.",
      );
      assert.equal(resumed.status, "waiting");
      await waitForStatus(service, queued.taskId, "completed");
      assert.equal(runtimeFactory.runtime.sends.length, 2);
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});

test("gateway escalation approval records the decision but requires a new Safety Preview", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { service, workspace, plans } = await buildService(dir, metadata.baseUrl);
    try {
      const preview = await plans.preview({
        workspaceId: workspace.workspaceId,
        goal: "Bounded task",
        requestedScope: ["src/**"],
      });
      const queued = await service.startTask(preview.planToken);
      await waitForStatus(service, queued.taskId, "completed");

      const store = new TaskStore(dir);
      const task = await store.load(queued.taskId);
      const escalationId = crypto.randomUUID();
      task.status = "waiting_for_human";
      task.pendingEscalation = {
        escalationId,
        taskId: task.id,
        requestedAt: new Date().toISOString(),
        reason: "Requested write is outside the approved Safety Plan scope",
        actionKind: "edit",
        actionFingerprint: "fingerprint",
        safetyPolicyVersion: (task as any).safetyPolicyVersion,
        status: "pending",
        reversible: true,
      };
      await store.save(task);

      const result = await service.approveEscalation(task.id, escalationId);
      assert.equal(result.nextAction, "new_safety_preview_required");
      assert.equal(result.task.status, "aborted");
      assert.equal(result.task.pendingEscalation?.status, "approved");
      assert.deepEqual(result.task.safety.allowedPathPatterns, ["src/**"]);

      await assert.rejects(
        service.continueTask(task.id, "Now write outside scope"),
        (error: unknown) =>
          error instanceof MachineGatewayError && error.code === "invalid_task_state",
      );
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});

test("rollback requires the opaque checkpoint id and untrusted task ids cannot traverse storage", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { service, workspace } = await buildService(dir, metadata.baseUrl);
    try {
      const preview = await service.previewTask({
        workspaceId: workspace.workspaceId,
        goal: "Create a reversible no-op run",
        requestedScope: ["src/**"],
      });
      const queued = await service.startTask(preview.planToken);
      await waitForStatus(service, queued.taskId, "completed");
      const task = await service.getTask(queued.taskId);
      const id = task.checkpoint?.checkpointId;
      assert.ok(id);

      await assert.rejects(
        service.rollbackTask(task.taskId, "0".repeat(32)),
        (error: unknown) =>
          error instanceof MachineGatewayError && error.code === "checkpoint_mismatch",
      );

      const rolledBack = await service.rollbackTask(task.taskId, id!);
      assert.equal(rolledBack.status, "rolled_back");

      await assert.rejects(
        service.getTask("../outside"),
        (error: unknown) =>
          error instanceof MachineGatewayError && error.code === "invalid_argument",
      );
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});
