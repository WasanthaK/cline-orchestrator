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
import { ScheduledHubRestartReconciler } from "./scheduled-hub-recovery.js";
import { ScheduledHubWriterAuthorityRunner } from "./scheduled-hub-writer-runner.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
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
    displayName: "Recovery workspace",
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

async function saveInterruptedTask(workspace: RegisteredWorkspace): Promise<OrchestratorTask> {
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
  const store = new TaskStore(workspace.canonicalRoot);
  await store.save(task);
  task.status = "running";
  task.runCount = 1;
  task.sessionGeneration = 1;
  task.clineSessionId = "disconnected-scheduled-owner";
  task.lastPrompt = task.goal;
  await store.save(task);
  const persisted = await store.load(task.id);
  assert.ok(persisted.lastRunCheckpoint?.available);
  return persisted;
}

class RecoveryFakeRuntime implements ClineRuntime {
  private startInput: any;
  private readonly sessionId: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly harness: RecoveryFakeRuntimeFactory,
  ) {
    this.sessionId = `replacement-owner-${harness.nextSession++}`;
  }

  async start(input: unknown): Promise<any> {
    this.startInput = input;
    this.harness.starts += 1;
    return { sessionId: this.sessionId };
  }

  async send(): Promise<any> {
    this.harness.sends += 1;
    const editor = this.startInput?.capabilities?.toolExecutors?.editor;
    assert.equal(typeof editor, "function");
    await editor(
      {
        path: path.join(this.workspaceRoot, "src", "a.txt"),
        old_text: "a",
        new_text: "b",
      },
      this.workspaceRoot,
      { agentId: "replacement", conversationId: this.sessionId, iteration: 1 },
    );
    return { finishReason: "completed", text: "recovered" };
  }

  async abort(): Promise<any> { return undefined; }
  subscribe(): unknown { return undefined; }
  async get(): Promise<any> { return { workspaceRoot: this.workspaceRoot }; }
  async dispose(): Promise<void> { this.harness.disposed += 1; }
}

class RecoveryFakeRuntimeFactory implements ClineRuntimeFactory {
  starts = 0;
  sends = 0;
  disposed = 0;
  nextSession = 1;
  readonly requests: ClineRuntimeCreateRequest[] = [];

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.requests.push({ ...request });
    return new RecoveryFakeRuntime(request.workspaceRoot, this);
  }
}

function buildRecoveryStack(
  registry: WorkspaceRegistry,
  locks: WorkspaceLockStore,
  runtime: RecoveryFakeRuntimeFactory,
) {
  const runner = new ScheduledHubWriterAuthorityRunner(
    registry,
    async () => worker(),
    runtime,
    async () => preflightOk(),
  );
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
  return {
    runner,
    scheduler,
    reconciler: new ScheduledHubRestartReconciler(registry, locks, runner, scheduler),
  };
}

test("gateway restart replaces an expired scheduled owner through a fresh fence and durable handoff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-recovery-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "workspace"));
    const task = await saveInterruptedTask(workspace);
    const originalCheckpoint = task.lastRunCheckpoint?.createdAt;

    const locks = new WorkspaceLockStore(path.join(root, "coordination"));
    const oldOwner = crypto.randomUUID();
    const oldLease = await locks.acquire(
      {
        workspaceId: workspace.workspaceId,
        taskId: task.id,
        ownerInstanceId: oldOwner,
        leaseMs: 1_000,
      },
      { now: () => new Date(Date.now() - 5_000) },
    );
    assert.equal((await locks.listActive()).length, 0);

    const runtime = new RecoveryFakeRuntimeFactory();
    const { reconciler } = buildRecoveryStack(registry, locks, runtime);
    const summary = await reconciler.recoverInterruptedTasks();

    assert.equal(summary.scanned, 1);
    assert.equal(summary.prepared, 1);
    assert.equal(summary.deferredLiveLease, 0);
    assert.equal(summary.failedClosed, 0);
    assert.deepEqual(summary.schedule?.completedTaskIds, [task.id]);
    assert.deepEqual(summary.schedule?.failures, []);
    assert.equal(runtime.starts, 1);
    assert.equal(runtime.sends, 1);
    assert.equal(runtime.disposed, 1);
    assert.ok(runtime.requests.every((request) => request.mode === "hub"));
    assert.equal((await locks.listActive()).length, 0);

    const persisted = await new TaskStore(workspace.canonicalRoot).load(task.id);
    assert.equal(persisted.status, "completed");
    assert.equal(persisted.runCount, 2);
    assert.equal(persisted.sessionGeneration, 2);
    assert.equal(persisted.recoveryCount, 1);
    assert.equal(persisted.lastRecoveryReason, "missing_session_id");
    assert.equal(persisted.clineSessionId, "replacement-owner-1");
    assert.equal(persisted.lastRunCheckpoint?.createdAt, originalCheckpoint);
    assert.equal(persisted.lastRunCheckpoint?.runCount, 1);
    assert.equal(persisted.lastDiffSafety?.passed, true);
    assert.equal(await readFile(path.join(workspace.canonicalRoot, "src", "a.txt"), "utf8"), "b\n");

    const events = await new TaskStore(workspace.canonicalRoot).events(task.id);
    const restart = events.find(
      (event) => event.type === "resume_queued"
        && event.message?.includes("replacement Hub owner session"),
    );
    assert.ok(restart);
    assert.equal(restart.data?.previousSessionId, "disconnected-scheduled-owner");
    assert.ok(events.some((event) => event.type === "context_handoff_created"));
    assert.ok(events.some((event) => event.type === "session_recovered"));

    await assert.rejects(
      () => locks.validate(oldLease.claim),
      /stale|expired|no active writer/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart reconciliation never takes over a workspace that still has a live writer lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-recovery-live-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "workspace"));
    const task = await saveInterruptedTask(workspace);
    const locks = new WorkspaceLockStore(path.join(root, "coordination"));
    const live = await locks.acquire({
      workspaceId: workspace.workspaceId,
      taskId: task.id,
      ownerInstanceId: crypto.randomUUID(),
      leaseMs: 5_000,
    });

    const runtime = new RecoveryFakeRuntimeFactory();
    const { reconciler } = buildRecoveryStack(registry, locks, runtime);
    const summary = await reconciler.recoverInterruptedTasks();

    assert.equal(summary.scanned, 1);
    assert.equal(summary.prepared, 0);
    assert.equal(summary.deferredLiveLease, 1);
    assert.equal(summary.failedClosed, 0);
    assert.equal(summary.schedule, undefined);
    assert.equal(runtime.starts, 0);
    assert.equal(runtime.sends, 0);
    assert.equal((await new TaskStore(workspace.canonicalRoot).load(task.id)).status, "running");

    await locks.release(live.claim);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart reconciliation fails closed before lease acquisition when durable authority drifted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-recovery-drift-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "workspace"));
    const task = await saveInterruptedTask(workspace);
    await registry.updateSafetyProfile(workspace.workspaceId, {
      policyVersion: "policy-2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot-safe",
      maxChangedFiles: 10,
    });

    const locks = new WorkspaceLockStore(path.join(root, "coordination"));
    const runtime = new RecoveryFakeRuntimeFactory();
    const { reconciler } = buildRecoveryStack(registry, locks, runtime);
    const summary = await reconciler.recoverInterruptedTasks();

    assert.equal(summary.scanned, 1);
    assert.equal(summary.prepared, 0);
    assert.equal(summary.failedClosed, 1);
    assert.equal(summary.schedule, undefined);
    assert.equal(runtime.starts, 0);
    assert.equal((await locks.listActive()).length, 0);

    const persisted = await new TaskStore(workspace.canonicalRoot).load(task.id);
    assert.equal(persisted.status, "failed");
    assert.equal(persisted.finishReason, "scheduled_recovery_denied");
    assert.match(persisted.error ?? "", /current durable authority is unsafe/i);
    assert.ok(persisted.lastRunCheckpoint?.available);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
