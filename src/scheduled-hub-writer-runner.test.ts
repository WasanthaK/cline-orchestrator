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

class FakeHubRuntime implements ClineRuntime {
  private startInput: any;
  private readonly sessionId = crypto.randomUUID();

  constructor(
    private readonly workspaceRoot: string,
    private readonly harness: FakeHubRuntimeFactory,
  ) {}

  async start(input: unknown): Promise<any> {
    this.startInput = input;
    this.harness.startedWorkspaces.push(this.workspaceRoot);
    return { sessionId: this.sessionId };
  }

  async send(): Promise<any> {
    this.harness.active += 1;
    this.harness.maxActive = Math.max(this.harness.maxActive, this.harness.active);
    try {
      const editor = this.startInput?.capabilities?.toolExecutors?.editor;
      assert.equal(typeof editor, "function");
      await editor(
        {
          path: path.join(this.workspaceRoot, "src", "a.txt"),
          old_text: "a",
          new_text: "b",
        },
        this.workspaceRoot,
        { agentId: "fake", conversationId: this.sessionId, iteration: 1 },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { finishReason: "completed", text: "done" };
    } finally {
      this.harness.active -= 1;
    }
  }

  async abort(): Promise<any> { return undefined; }
  subscribe(): unknown { return undefined; }
  async get(): Promise<any> { return { workspaceRoot: this.workspaceRoot }; }
  async dispose(): Promise<void> { this.harness.disposed += 1; }
}

class FakeHubRuntimeFactory implements ClineRuntimeFactory {
  active = 0;
  maxActive = 0;
  disposed = 0;
  readonly startedWorkspaces: string[] = [];
  readonly createRequests: ClineRuntimeCreateRequest[] = [];

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.createRequests.push({ ...request });
    return new FakeHubRuntime(request.workspaceRoot, this);
  }
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
  displayName: string,
): Promise<RegisteredWorkspace> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  initializeGitBaseline(root);
  return await registry.registerWorkspace({
    projectId,
    displayName,
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

test("real scheduler runs two fresh orchestrator-owned Hub writers concurrently through lease-aware executors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-hub-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace1 = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "w1"), "W1");
    const workspace2 = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "w2"), "W2");
    const task1 = await saveApprovedTask(workspace1);
    const task2 = await saveApprovedTask(workspace2);

    const fakeRuntime = new FakeHubRuntimeFactory();
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      fakeRuntime,
      async () => preflightOk(),
    );
    const owner1 = await runner.revalidateApprovedTask(task1.id);
    const owner2 = await runner.revalidateApprovedTask(task2.id);
    assert.notEqual(owner1.ownerInstanceId, owner2.ownerInstanceId);
    assert.equal(owner1.workspaceId, workspace1.workspaceId);
    assert.equal(owner2.workspaceId, workspace2.workspaceId);

    const locks = new WorkspaceLockStore(path.join(root, "coordination"));
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      {
        schemaVersion: 1,
        maxActiveWriters: 2,
        maxStartsPerPass: 2,
        maxActiveWritersPerWorkspace: 1,
      },
      runner,
      { leaseMs: 2_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([task1.id, task2.id]);
    assert.deepEqual([...result.reservedTaskIds].sort(), [task1.id, task2.id].sort());
    assert.deepEqual([...result.completedTaskIds].sort(), [task1.id, task2.id].sort());
    assert.deepEqual(result.failures, []);
    assert.equal(fakeRuntime.maxActive, 2);
    assert.equal(fakeRuntime.disposed, 2);
    assert.equal(fakeRuntime.createRequests.length, 2);
    assert.ok(fakeRuntime.createRequests.every((request) => request.mode === "hub"));
    assert.equal((await locks.listActive()).length, 0);
    assert.equal(await readFile(path.join(workspace1.canonicalRoot, "src", "a.txt"), "utf8"), "b\n");
    assert.equal(await readFile(path.join(workspace2.canonicalRoot, "src", "a.txt"), "utf8"), "b\n");

    const persisted1 = await new TaskStore(workspace1.canonicalRoot).load(task1.id);
    const persisted2 = await new TaskStore(workspace2.canonicalRoot).load(task2.id);
    assert.equal(persisted1.status, "completed");
    assert.equal(persisted2.status, "completed");
    assert.equal(persisted1.lastDiffSafety?.passed, true);
    assert.equal(persisted2.lastDiffSafety?.passed, true);
    assert.ok(persisted1.lastRunCheckpoint?.available);
    assert.ok(persisted2.lastRunCheckpoint?.available);
    assert.ok(persisted1.clineSessionId);
    assert.ok(persisted2.clineSessionId);
    assert.notEqual(persisted1.clineSessionId, persisted2.clineSessionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scheduled Hub runner rejects silent takeover of a task with existing session history before lease acquisition", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-hub-existing-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "w1"), "W1");
    const task = await saveApprovedTask(workspace);
    task.clineSessionId = "existing-vscode-session";
    task.sessionGeneration = 1;
    task.runCount = 1;
    await new TaskStore(workspace.canonicalRoot).save(task);

    const fakeRuntime = new FakeHubRuntimeFactory();
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      fakeRuntime,
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
    assert.deepEqual(result.reservedTaskIds, []);
    assert.deepEqual(result.failures, [{ taskId: task.id, code: "authority_revalidation_failed" }]);
    assert.equal(fakeRuntime.createRequests.length, 0);
    assert.equal((await locks.listActive()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registry/profile revision drift is rejected before scheduled Hub runtime creation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-hub-drift-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "w1"), "W1");
    const task = await saveApprovedTask(workspace);

    await registry.updateSafetyProfile(workspace.workspaceId, {
      policyVersion: "policy-2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: ["src/protected/**"],
      validationCommands: [],
      workerProfileId: "pilot-safe",
      maxChangedFiles: 10,
    });

    const fakeRuntime = new FakeHubRuntimeFactory();
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      async () => worker(),
      fakeRuntime,
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
    assert.deepEqual(result.reservedTaskIds, []);
    assert.deepEqual(result.failures, [{ taskId: task.id, code: "authority_revalidation_failed" }]);
    assert.equal(fakeRuntime.createRequests.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
