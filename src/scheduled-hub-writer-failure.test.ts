import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import {
  ScheduledHubWriterAuthorityRunner,
  ScheduledHubWriterError,
} from "./scheduled-hub-writer-runner.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import type {
  WorkspaceLockOptions,
  WorkspaceWriterClaimV1,
} from "./workspace-lock.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";
import { WriterConcurrencyScheduler } from "./writer-concurrency-scheduler.js";

function worker(): WorkerConfig {
  return {
    providerId: "openai-compatible",
    modelId: "test-model",
    apiKey: "test",
    baseUrl: "http://127.0.0.1:1/v1",
    contextWindow: 1000,
    maxInputTokens: 900,
    maxTokensPerTurn: 100,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 1000,
    validationTimeoutMs: 1000,
    maxValidationOutputChars: 2000,
    maxValidationRepairs: 0,
    checkpointMaxUntrackedFiles: 100,
    checkpointMaxUntrackedBytes: 1024 * 1024,
    contextRotateAtTokens: 800,
    maxContextRotations: 2,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

function preflightOk(): ProviderPreflightResult {
  return {
    checkedAt: new Date().toISOString(),
    ok: true,
    supported: true,
    providerId: "openai-compatible",
    modelId: "test-model",
    code: "ok",
    message: "fake provider ready",
  };
}

function initializeGitBaseline(root: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "orchestrator-test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Cline Orchestrator Test"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["add", "src/a.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: root, stdio: "ignore" });
}

async function setupRegisteredWorkspace(
  registry: WorkspaceRegistry,
  projectId: string,
  root: string,
): Promise<RegisteredWorkspace> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  initializeGitBaseline(root);
  return await registry.registerWorkspace({
    projectId,
    displayName: "Failure workspace",
    root,
    safetyProfile: {
      profileId: crypto.randomUUID(),
      policyVersion: "policy-1",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot-safe",
      maxChangedFiles: 10,
    },
  });
}

async function saveApprovedTask(workspace: RegisteredWorkspace): Promise<OrchestratorTask> {
  const now = new Date().toISOString();
  const task: OrchestratorTask = {
    id: crypto.randomUUID(),
    goal: "Change src/a.txt from a to b",
    workspace: workspace.canonicalRoot,
    status: "created",
    createdAt: now,
    updatedAt: now,
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    workspaceRegistryRevision: workspace.revision,
    safetyPlanId: crypto.randomUUID(),
    safetyPolicyVersion: workspace.safetyProfile.policyVersion,
    safetyProfileId: workspace.safetyProfile.profileId,
    safetyProfileRevision: workspace.safetyProfile.revision,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [...workspace.safetyProfile.protectedPathPatterns],
    workerProfileId: workspace.safetyProfile.workerProfileId,
    validationCommands: [],
    expectedChangedPaths: ["src/**"],
  };
  await new TaskStore(workspace.canonicalRoot).save(task);
  return task;
}

class LeaseLossFakeRuntime implements ClineRuntime {
  private startInput: any;
  private readonly sessionId = crypto.randomUUID();
  private abortResolve!: () => void;
  private readonly aborted = new Promise<void>((resolve) => {
    this.abortResolve = resolve;
  });

  constructor(
    private readonly workspaceRoot: string,
    private readonly harness: LeaseLossFakeRuntimeFactory,
  ) {}

  async start(input: unknown): Promise<any> {
    this.startInput = input;
    return { sessionId: this.sessionId };
  }

  async send(): Promise<any> {
    this.harness.markSendStarted();
    await this.aborted;

    const editor = this.startInput?.capabilities?.toolExecutors?.editor;
    assert.equal(typeof editor, "function");
    try {
      await editor(
        {
          path: path.join(this.workspaceRoot, "src", "a.txt"),
          old_text: "a",
          new_text: "b",
        },
        this.workspaceRoot,
        { agentId: "stale-fake", conversationId: this.sessionId, iteration: 1 },
      );
      this.harness.staleWriteSucceeded = true;
    } catch {
      this.harness.staleWriteBlocked = true;
    }

    if (this.harness.completesAfterAbort) {
      return { finishReason: "completed", text: "fake Hub ignored the abort" };
    }
    throw new Error("fake Hub send interrupted after lease loss");
  }

  async abort(): Promise<any> {
    this.harness.abortCalls += 1;
    this.abortResolve();
    return undefined;
  }

  subscribe(): unknown { return undefined; }
  async get(): Promise<any> { return { workspaceRoot: this.workspaceRoot }; }
  async dispose(): Promise<void> { this.harness.disposeCalls += 1; }
}

class LeaseLossFakeRuntimeFactory implements ClineRuntimeFactory {
  constructor(readonly completesAfterAbort = false) {}

  sendStarted = false;
  staleWriteBlocked = false;
  staleWriteSucceeded = false;
  abortCalls = 0;
  disposeCalls = 0;
  private sendStartedResolve!: () => void;
  private readonly sendStartedSignal = new Promise<void>((resolve) => {
    this.sendStartedResolve = resolve;
  });

  markSendStarted(): void {
    this.sendStarted = true;
    this.sendStartedResolve();
  }

  async waitUntilSendStarted(): Promise<void> {
    await this.sendStartedSignal;
  }

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    return new LeaseLossFakeRuntime(request.workspaceRoot, this);
  }
}

class FailingHeartbeatLockStore extends WorkspaceLockStore {
  renewAttempts = 0;

  constructor(rootDir: string, private readonly runtime: LeaseLossFakeRuntimeFactory) {
    super(rootDir);
  }

  override async renew(
    _claim: WorkspaceWriterClaimV1,
    _leaseMs: number,
    _options: WorkspaceLockOptions = {},
  ): Promise<{ state: never; claim: never }> {
    this.renewAttempts += 1;
    await this.runtime.waitUntilSendStarted();
    throw new Error("forced lease heartbeat failure");
  }
}

class CrashFakeRuntime implements ClineRuntime {
  private startInput: any;
  private readonly sessionId = crypto.randomUUID();

  constructor(
    private readonly workspaceRoot: string,
    private readonly harness: CrashFakeRuntimeFactory,
  ) {}

  async start(input: unknown): Promise<any> {
    this.startInput = input;
    return { sessionId: this.sessionId };
  }

  async send(): Promise<any> {
    this.harness.editor = this.startInput?.capabilities?.toolExecutors?.editor;
    this.harness.workspaceRoot = this.workspaceRoot;
    this.harness.sessionId = this.sessionId;
    throw new Error("forced worker crash");
  }

  async abort(): Promise<any> { return undefined; }
  subscribe(): unknown { return undefined; }
  async get(): Promise<any> { return { workspaceRoot: this.workspaceRoot }; }
  async dispose(): Promise<void> { this.harness.disposeCalls += 1; }
}

class CrashFakeRuntimeFactory implements ClineRuntimeFactory {
  editor: any;
  workspaceRoot?: string;
  sessionId?: string;
  disposeCalls = 0;

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    return new CrashFakeRuntime(request.workspaceRoot, this);
  }

  async attemptStaleWrite(): Promise<void> {
    assert.equal(typeof this.editor, "function");
    assert.ok(this.workspaceRoot);
    assert.ok(this.sessionId);
    await this.editor(
      {
        path: path.join(this.workspaceRoot, "src", "a.txt"),
        old_text: "a",
        new_text: "b",
      },
      this.workspaceRoot,
      { agentId: "crashed-stale", conversationId: this.sessionId, iteration: 2 },
    );
  }
}

for (const completesAfterAbort of [false, true]) test(`heartbeat lease loss aborts the worker when Hub ${completesAfterAbort ? "returns completed" : "throws"} after abort`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-lease-loss-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(
      registry,
      project.projectId,
      path.join(root, "workspace"),
    );
    const task = await saveApprovedTask(workspace);

    const runtime = new LeaseLossFakeRuntimeFactory(completesAfterAbort);
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      runtime,
      async () => preflightOk(),
    );
    const locks = new FailingHeartbeatLockStore(path.join(root, "coordination"), runtime);
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      {
        schemaVersion: 1,
        maxActiveWriters: 1,
        maxStartsPerPass: 1,
        maxActiveWritersPerWorkspace: 1,
      },
      runner,
      { leaseMs: 2_000, heartbeatMs: 20 },
    );

    const result = await scheduler.schedule([task.id]);

    assert.deepEqual(result.reservedTaskIds, [task.id]);
    assert.deepEqual(result.completedTaskIds, []);
    assert.ok(result.failures.some((failure) => failure.taskId === task.id && failure.code === "worker_failed"));
    assert.equal(locks.renewAttempts >= 1, true);
    assert.equal(runtime.sendStarted, true);
    assert.equal(runtime.abortCalls >= 1, true);
    assert.equal(runtime.staleWriteBlocked, true);
    assert.equal(runtime.staleWriteSucceeded, false);
    assert.equal(runtime.disposeCalls, 1);
    assert.equal((await locks.listActive()).length, 0);
    assert.equal(await readFile(path.join(workspace.canonicalRoot, "src", "a.txt"), "utf8"), "a\n");

    const persisted = await new TaskStore(workspace.canonicalRoot).load(task.id);
    assert.equal(persisted.status, "aborted");
    assert.equal(persisted.finishReason, "aborted");
    assert.match(persisted.abortReason ?? "", /lease was lost/i);
    assert.ok(persisted.lastRunCheckpoint?.available);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker crash releases its lease and the crashed executor cannot write or restart the failed task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-worker-crash-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(
      registry,
      project.projectId,
      path.join(root, "workspace"),
    );
    const task = await saveApprovedTask(workspace);

    const runtime = new CrashFakeRuntimeFactory();
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      runtime,
      async () => preflightOk(),
    );
    const locks = new WorkspaceLockStore(path.join(root, "coordination"));
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      {
        schemaVersion: 1,
        maxActiveWriters: 1,
        maxStartsPerPass: 1,
        maxActiveWritersPerWorkspace: 1,
      },
      runner,
      { leaseMs: 2_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([task.id]);
    assert.deepEqual(result.reservedTaskIds, [task.id]);
    assert.deepEqual(result.completedTaskIds, []);
    assert.ok(result.failures.some((failure) => failure.taskId === task.id && failure.code === "worker_failed"));
    assert.equal(runtime.disposeCalls, 1);
    assert.equal((await locks.listActive()).length, 0);

    const persisted = await new TaskStore(workspace.canonicalRoot).load(task.id);
    assert.equal(persisted.status, "failed");
    assert.match(persisted.error ?? "", /forced worker crash/i);
    assert.ok(persisted.lastRunCheckpoint?.available);
    assert.equal(await readFile(path.join(workspace.canonicalRoot, "src", "a.txt"), "utf8"), "a\n");

    await assert.rejects(
      () => runtime.attemptStaleWrite(),
      /lease session is no longer active|lease/i,
    );
    assert.equal(await readFile(path.join(workspace.canonicalRoot, "src", "a.txt"), "utf8"), "a\n");

    const restartedRunner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      new CrashFakeRuntimeFactory(),
      async () => preflightOk(),
    );
    await assert.rejects(
      () => restartedRunner.revalidateApprovedTask(task.id),
      (error: unknown) => error instanceof ScheduledHubWriterError && error.code === "task_not_runnable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
