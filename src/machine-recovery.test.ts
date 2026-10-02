import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import { RestartAwareMachineOrchestratorService } from "./machine-recovery.js";
import { SafetyPlanService } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-machine-recovery-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.name", "Recovery Test");
    await git(dir, "config", "user.email", "recovery@example.invalid");
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
    const sessionId = `replacement-owner-${++this.sessionCount}`;
    this.sessions.set(sessionId, {
      sessionId,
      workspaceRoot: input?.config?.workspaceRoot,
    });
    return { sessionId };
  }

  async send(input: any) {
    this.sends.push(input);
    return { finishReason: "completed", text: "recovered safely" };
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
  service: RestartAwareMachineOrchestratorService,
  taskId: string,
  expected: OrchestratorTask["status"],
): Promise<void> {
  for (let i = 0; i < 150; i += 1) {
    if ((await service.getTask(taskId)).status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`task ${taskId} did not reach ${expected}`);
}

async function setupInterruptedTask(dir: string) {
  const registry = new WorkspaceRegistry(path.join(dir, "machine", "registry.json"));
  const project = await registry.registerProject("Recovery Project");
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Recovery Workspace",
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
  const preview = await plans.preview({
    workspaceId: workspace.workspaceId,
    goal: "Continue the approved src/app.ts task after owner loss",
    requestedScope: ["src/**"],
  });
  const started = await startApprovedTask(plans, preview.planToken);
  const store = new TaskStore(dir);
  const task = started.task;
  task.status = "running";
  task.runCount = 1;
  task.sessionGeneration = 1;
  task.clineSessionId = "disconnected-owner-session";
  task.lastPrompt = task.goal;
  await store.save(task);
  const persisted = await store.load(task.id);
  assert.equal(persisted.lastRunCheckpoint?.available, true);
  return { registry, plans, workspace, store, task: persisted };
}

test("gateway restart replaces a disconnected Hub owner and preserves the original checkpoint", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { registry, plans, store, task } = await setupInterruptedTask(dir);
    const originalCheckpoint = task.lastRunCheckpoint?.createdAt;
    const runtimeFactory = new FakeRuntimeFactory();
    const service = new RestartAwareMachineOrchestratorService(
      registry,
      plans,
      (profileId) => {
        assert.equal(profileId, "pilot");
        return worker(metadata.baseUrl);
      },
      runtimeFactory,
    );

    try {
      const summary = await service.recoverInterruptedTasks();
      assert.deepEqual(summary, { scanned: 1, queued: 1, failedClosed: 0 });
      await waitForStatus(service, task.id, "completed");

      const recovered = await store.load(task.id);
      assert.equal(recovered.status, "completed");
      assert.equal(recovered.runCount, 2);
      assert.equal(recovered.sessionGeneration, 2);
      assert.equal(recovered.recoveryCount, 1);
      assert.equal(recovered.lastRecoveryReason, "missing_session_id");
      assert.equal(recovered.lastRunCheckpoint?.createdAt, originalCheckpoint);
      assert.equal(recovered.lastRunCheckpoint?.runCount, 1);
      assert.equal(recovered.lastDiffSafety?.passed, true);

      assert.equal(runtimeFactory.requests.length, 1);
      assert.equal(runtimeFactory.requests[0]?.mode, "hub");
      assert.equal(runtimeFactory.runtime.starts.length, 1);
      assert.equal(runtimeFactory.runtime.sends.length, 1);
      assert.equal(runtimeFactory.runtime.sends[0]?.sessionId, "replacement-owner-1");

      const events = await store.events(task.id);
      const restart = events.find(
        (event) => event.type === "resume_queued"
          && event.message?.includes("replacement Hub owner session"),
      );
      assert.ok(restart);
      assert.equal(restart.data?.previousSessionId, "disconnected-owner-session");
      assert.ok(events.some((event) => event.type === "context_handoff_created"));
      assert.ok(events.some((event) => event.type === "session_recovered"));
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});

test("gateway restart fails closed when an interrupted task safety binding is stale", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { registry, plans, workspace, store, task } = await setupInterruptedTask(dir);
    await registry.updateSafetyProfile(workspace.workspaceId, {
      policyVersion: "policy-v2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot",
      maxChangedFiles: 20,
    });

    const runtimeFactory = new FakeRuntimeFactory();
    const service = new RestartAwareMachineOrchestratorService(
      registry,
      plans,
      () => worker(metadata.baseUrl),
      runtimeFactory,
    );

    try {
      const summary = await service.recoverInterruptedTasks();
      assert.deepEqual(summary, { scanned: 1, queued: 0, failedClosed: 1 });
      const denied = await store.load(task.id);
      assert.equal(denied.status, "failed");
      assert.equal(denied.finishReason, "gateway_recovery_denied");
      assert.match(denied.error ?? "", /approved authority is no longer valid/i);
      assert.equal(runtimeFactory.requests.length, 0);
      assert.equal(runtimeFactory.runtime.starts.length, 0);
      assert.equal(runtimeFactory.runtime.sends.length, 0);
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});

test("gateway restart closes interrupted validation fail-safe instead of inventing model authority", async () => {
  await withRepo(async (dir) => {
    const metadata = await startModelMetadataServer();
    const { registry, plans, store, task } = await setupInterruptedTask(dir);
    task.status = "validating";
    await store.save(task);

    const runtimeFactory = new FakeRuntimeFactory();
    const service = new RestartAwareMachineOrchestratorService(
      registry,
      plans,
      () => worker(metadata.baseUrl),
      runtimeFactory,
    );

    try {
      const summary = await service.recoverInterruptedTasks();
      assert.deepEqual(summary, { scanned: 1, queued: 0, failedClosed: 1 });
      const denied = await store.load(task.id);
      assert.equal(denied.status, "failed");
      assert.equal(denied.finishReason, "gateway_recovery_denied");
      assert.match(denied.error ?? "", /validation was not replayed automatically/i);
      assert.equal(denied.lastRunCheckpoint?.available, true);
      assert.equal(runtimeFactory.requests.length, 0);
    } finally {
      await service.close();
      await metadata.close();
    }
  });
});
