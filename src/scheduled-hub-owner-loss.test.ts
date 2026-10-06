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
    displayName: "Owner loss workspace",
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

class OwnerLossRuntime implements ClineRuntime {
  private sessionCount = 0;
  private sendCount = 0;
  private latestStartInput: any;

  constructor(
    private readonly workspaceRoot: string,
    private readonly harness: OwnerLossRuntimeFactory,
  ) {}

  async start(input: unknown): Promise<any> {
    this.latestStartInput = input;
    const sessionId = `owner-session-${++this.sessionCount}`;
    this.harness.startedSessions.push(sessionId);
    return { sessionId };
  }

  async send(input: any): Promise<any> {
    this.sendCount += 1;
    this.harness.sentSessions.push(input.sessionId);
    if (this.sendCount === 1) {
      const error = new Error("owner session disappeared") as Error & { code?: string };
      error.code = "session_not_found";
      throw error;
    }

    const editor = this.latestStartInput?.capabilities?.toolExecutors?.editor;
    assert.equal(typeof editor, "function");
    await editor(
      {
        path: path.join(this.workspaceRoot, "src", "a.txt"),
        old_text: "a",
        new_text: "b",
      },
      this.workspaceRoot,
      { agentId: "replacement", conversationId: input.sessionId, iteration: 1 },
    );
    return { finishReason: "completed", text: "recovered after owner loss" };
  }

  async abort(): Promise<any> { return undefined; }
  subscribe(): unknown { return undefined; }
  async get(sessionId: string): Promise<any> { return { sessionId, workspaceRoot: this.workspaceRoot }; }
  async dispose(): Promise<void> { this.harness.disposed += 1; }
}

class OwnerLossRuntimeFactory implements ClineRuntimeFactory {
  readonly requests: ClineRuntimeCreateRequest[] = [];
  readonly startedSessions: string[] = [];
  readonly sentSessions: string[] = [];
  disposed = 0;

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.requests.push({ ...request });
    return new OwnerLossRuntime(request.workspaceRoot, this);
  }
}

test("scheduled Hub session loss recovers through durable handoff while the current fenced lease remains authoritative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-scheduled-owner-loss-"));
  try {
    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Project");
    const workspace = await setupRegisteredWorkspace(registry, project.projectId, path.join(root, "workspace"));
    const task = await saveApprovedTask(workspace);
    const runtime = new OwnerLossRuntimeFactory();
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
    assert.deepEqual(result.completedTaskIds, [task.id]);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(runtime.startedSessions, ["owner-session-1", "owner-session-2"]);
    assert.deepEqual(runtime.sentSessions, ["owner-session-1", "owner-session-2"]);
    assert.equal(runtime.disposed, 1);
    assert.equal((await locks.listActive()).length, 0);
    assert.equal(await readFile(path.join(workspace.canonicalRoot, "src", "a.txt"), "utf8"), "b\n");

    const store = new TaskStore(workspace.canonicalRoot);
    const persisted = await store.load(task.id);
    assert.equal(persisted.status, "completed");
    assert.equal(persisted.sessionGeneration, 2);
    assert.equal(persisted.recoveryCount, 1);
    assert.equal(persisted.lastRecoveryReason, "session_not_found");
    assert.equal(persisted.lastRecoveredFromSessionId, "owner-session-1");
    assert.equal(persisted.clineSessionId, "owner-session-2");
    assert.ok(persisted.lastRunCheckpoint?.available);
    assert.equal(persisted.lastRunCheckpoint?.runCount, 1);
    assert.equal(persisted.lastDiffSafety?.passed, true);

    const events = await store.events(task.id);
    assert.ok(events.some((event) => event.type === "context_handoff_created"));
    assert.ok(events.some((event) => event.type === "session_recovered"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
