import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ClineRunner } from "./cline-runner.js";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import { RuntimeWorkspaceMismatchError } from "./cline-runtime.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFile("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
}

async function repo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-hub-runtime-"));
  await git(root, "init");
  await git(root, "config", "user.name", "Hub Runtime Test");
  await git(root, "config", "user.email", "hub-runtime@example.invalid");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return root;
}

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

function approvedTask(workspace: string, id: string, status: OrchestratorTask["status"] = "created"): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id,
    goal: "Use the Hub runtime without weakening task safety",
    workspace,
    status,
    createdAt: now,
    updatedAt: now,
    expectedChangedPaths: ["src/**"],
    projectId: "project-1",
    workspaceId: "workspace-1",
    workspaceRegistryRevision: 1,
    safetyPlanId: "plan-1",
    safetyPolicyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".git/**"],
    workerProfileId: "pilot-safe",
  };
}

class FakeHubRuntime implements ClineRuntime {
  readonly startInputs: any[] = [];
  readonly sends: Array<{ sessionId: string; prompt: string }> = [];
  sessionCounter = 0;
  getWorkspace?: string;
  throwGetNotFound = false;
  throwFirstSendNotFound = false;

  constructor(private readonly workspace: string) {
    this.getWorkspace = workspace;
  }

  subscribe() { return () => undefined; }
  async start(input: unknown) {
    this.startInputs.push(input);
    this.sessionCounter += 1;
    return { sessionId: `hub-session-${this.sessionCounter}` };
  }
  async send(input: unknown) {
    const value = input as { sessionId: string; prompt: string };
    this.sends.push(value);
    if (this.throwFirstSendNotFound && this.sends.length === 1) {
      const error = new Error("session not found") as Error & { code: string };
      error.code = "session_not_found";
      throw error;
    }
    return { finishReason: "completed", text: "done" };
  }
  async abort() {}
  async get() {
    if (this.throwGetNotFound) {
      const error = new Error("session not found") as Error & { code: string };
      error.code = "session_not_found";
      throw error;
    }
    return { workspaceRoot: this.getWorkspace };
  }
  async dispose() {}
}

class FakeFactory implements ClineRuntimeFactory {
  readonly requests: ClineRuntimeCreateRequest[] = [];
  constructor(readonly runtime: FakeHubRuntime) {}
  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.requests.push(request);
    return this.runtime;
  }
}

test("ClineRunner Hub mode preserves lifecycle while injecting owner safety contributions", async () => {
  const root = await repo();
  const task = approvedTask(root, "hub-start");
  const store = new TaskStore(root);
  await store.save(task);
  const runtime = new FakeHubRuntime(root);
  const factory = new FakeFactory(runtime);
  const runner = new ClineRunner(root, worker(), { runtimeMode: "hub", runtimeFactory: factory });

  const completed = await runner.start(task);
  assert.equal(completed.status, "completed");
  assert.equal(completed.clineSessionId, "hub-session-1");
  assert.deepEqual(factory.requests, [{ mode: "hub", workspaceRoot: root }]);
  assert.equal(runtime.sends.length, 1);

  const start = runtime.startInputs[0];
  assert.equal(start.config.workspaceRoot, root);
  assert.equal(start.config.cwd, root);
  assert.equal(start.config.disableMcpSettingsTools, true);
  assert.equal(start.config.enableSpawnAgent, false);
  assert.equal(start.config.enableAgentTeams, false);
  assert.deepEqual(start.config.pluginPaths, []);
  assert.deepEqual(start.config.agentPluginPaths, []);
  assert.equal(typeof start.localRuntime?.hooks?.beforeTool, "function");
  assert.deepEqual(Object.keys(start.capabilities?.toolExecutors ?? {}).sort(), ["applyPatch", "editor", "readFile", "search"]);
  assert.equal(start.toolPolicies.run_commands.enabled, false);
  assert.equal(start.toolPolicies.fetch_web_content.enabled, false);
});

test("ClineRunner Hub resume rejects a persisted session from a different workspace before sending", async () => {
  const root = await repo();
  const other = await repo();
  const task = approvedTask(root, "hub-mismatch", "waiting");
  task.clineSessionId = "foreign-session";
  task.sessionGeneration = 1;
  const store = new TaskStore(root);
  await store.save(task);

  const runtime = new FakeHubRuntime(root);
  runtime.getWorkspace = other;
  const runner = new ClineRunner(root, worker(), {
    runtimeMode: "hub",
    runtimeFactory: new FakeFactory(runtime),
  });

  await assert.rejects(
    () => runner.resume(task, "continue"),
    RuntimeWorkspaceMismatchError,
  );
  assert.equal(runtime.sends.length, 0);
  assert.equal((await store.load(task.id)).status, "waiting");
});

test("Hub session_not_found still uses existing durable handoff recovery path", async () => {
  const root = await repo();
  const task = approvedTask(root, "hub-recovery", "waiting");
  task.clineSessionId = "missing-session";
  task.sessionGeneration = 1;
  const store = new TaskStore(root);
  await store.save(task);

  const runtime = new FakeHubRuntime(root);
  runtime.throwGetNotFound = true;
  runtime.throwFirstSendNotFound = true;
  const runner = new ClineRunner(root, worker(), {
    runtimeMode: "hub",
    runtimeFactory: new FakeFactory(runtime),
  });

  const completed = await runner.resume(task, "continue safely");
  assert.equal(completed.status, "completed");
  assert.equal(completed.sessionGeneration, 2);
  assert.equal(completed.recoveryCount, 1);
  assert.equal(completed.lastRecoveryReason, "session_not_found");
  assert.equal(runtime.startInputs.length, 1);
  assert.equal(runtime.sends.length, 2);
  assert.match(runtime.sends[1]?.prompt ?? "", /durable structured handoff/i);
});
