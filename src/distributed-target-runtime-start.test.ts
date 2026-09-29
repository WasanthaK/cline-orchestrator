import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import type { DistributedFenceClaimV1 } from "./distributed-fencing.js";
import {
  DistributedTargetRuntimeStartError,
  DistributedTargetRuntimeStarter,
} from "./distributed-target-runtime-start.js";
import type {
  DistributedTargetRuntimeHandoffContext,
  DistributedTargetRuntimeHandoffEvidenceV1,
} from "./distributed-target-runtime-handoff.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type DistributedWriterFenceGuard,
  type LeaseAwareWriterAuthorityProvider,
} from "./lease-aware-hub-safety-runtime.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

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
    autoApproveEdits: true,
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
    message: "ready",
  };
}

function initGit(root: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "m12i@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "M12I Test"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: root, stdio: "ignore" });
}

async function saveTask(root: string): Promise<OrchestratorTask> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  initGit(root);
  const now = new Date().toISOString();
  const task: OrchestratorTask = {
    id: crypto.randomUUID(),
    goal: "Change src/a.txt from a to b",
    workspace: root,
    status: "created",
    createdAt: now,
    updatedAt: now,
    projectId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    workspaceRegistryRevision: 1,
    safetyPlanId: crypto.randomUUID(),
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: crypto.randomUUID(),
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env"],
    workerProfileId: "pilot-safe",
    validationCommands: [],
    expectedChangedPaths: ["src/**"],
  };
  await new TaskStore(root).save(task);
  return task;
}

class TestLease implements WriterLeaseSession {
  private readonly controller = new AbortController();
  private readonly claimValue: WorkspaceWriterClaimV1;
  validateCount = 0;

  constructor(task: OrchestratorTask, readonly ownerInstanceId = crypto.randomUUID()) {
    this.claimValue = {
      schemaVersion: 1,
      workspaceId: task.workspaceId!,
      stateRevision: 1,
      leaseId: crypto.randomUUID(),
      fenceToken: crypto.randomUUID(),
      taskId: task.id,
      ownerInstanceId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      authority: "coordination_only",
    };
  }
  get taskId() { return this.claimValue.taskId; }
  get workspaceId() { return this.claimValue.workspaceId; }
  get signal() { return this.controller.signal; }
  currentClaim() { return structuredClone(this.claimValue); }
  async validateCurrent() { this.validateCount += 1; }
  lose() { this.controller.abort(new Error("lease lost")); }
}

class TestFence implements DistributedWriterFenceGuard {
  validateCount = 0;
  fail = false;
  constructor(readonly taskId: string, readonly workspaceId: string) {}
  async validateCurrent(): Promise<void> {
    this.validateCount += 1;
    if (this.fail) throw new Error("stale fence");
  }
}

class RenewableTestFence extends TestFence {
  private claimValue: DistributedFenceClaimV1;
  failRenewal = false;
  renewCount = 0;

  constructor(taskId: string, workspaceId: string) {
    super(taskId, workspaceId);
    const issuedAt = new Date();
    this.claimValue = {
      schemaVersion: 1,
      fenceId: crypto.randomUUID(),
      workspaceId,
      taskId,
      machineId: crypto.randomUUID(),
      machineRegistrationId: crypto.randomUUID(),
      machineRegistrationRevision: 1,
      placementId: crypto.randomUUID(),
      placementRevision: 1,
      candidateAssignmentId: crypto.randomUUID(),
      generation: 1,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 10_000).toISOString(),
      authority: "fencing_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
  }

  currentClaim(): DistributedFenceClaimV1 {
    return structuredClone(this.claimValue);
  }

  async renew(ttlMs: number): Promise<DistributedFenceClaimV1> {
    this.renewCount += 1;
    if (this.failRenewal) throw new Error("candidate no longer current");
    const issuedAt = new Date();
    this.claimValue = {
      ...this.claimValue,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
    };
    return this.currentClaim();
  }
}

class FakeRuntime implements ClineRuntime {
  startCount = 0;
  abortCount = 0;
  sendPrompt?: string;
  startInput: any;
  private sendResolver?: (value: any) => void;

  constructor(private readonly mode: "complete" | "wait") {}
  async start(input: unknown): Promise<any> {
    this.startCount += 1;
    this.startInput = input;
    return { sessionId: crypto.randomUUID() };
  }
  async send(input: any): Promise<any> {
    this.sendPrompt = input.prompt;
    if (this.mode === "complete") {
      return { finishReason: "completed", text: "done" };
    }
    return await new Promise((resolve) => { this.sendResolver = resolve; });
  }
  async abort(): Promise<any> {
    this.abortCount += 1;
    this.sendResolver?.({ finishReason: "aborted", text: "aborted" });
  }
  subscribe(): unknown { return undefined; }
  async dispose(): Promise<void> {}
}

class FakeFactory implements ClineRuntimeFactory {
  readonly createRequests: ClineRuntimeCreateRequest[] = [];
  constructor(readonly runtime: FakeRuntime) {}
  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.createRequests.push({ ...request });
    return this.runtime;
  }
}

function contextFor(
  task: OrchestratorTask,
  lease: TestLease,
  fence: DistributedWriterFenceGuard,
): DistributedTargetRuntimeHandoffContext {
  const evidence: DistributedTargetRuntimeHandoffEvidenceV1 = {
    schemaVersion: 1,
    dispatchId: crypto.randomUUID(),
    taskId: task.id,
    workspaceId: task.workspaceId!,
    machineId: crypto.randomUUID(),
    fenceGeneration: 1,
    admittedAt: new Date().toISOString(),
    preparedAt: new Date().toISOString(),
    authority: "local_runtime_handoff_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  const authorityProvider: LeaseAwareWriterAuthorityProvider = {
    revalidateCurrent: async () => {
      const current = await new TaskStore(task.workspace).load(task.id);
      return leaseAwareWriterAuthorityFromTask(current, lease.ownerInstanceId);
    },
  };
  return {
    evidence,
    task: structuredClone(task),
    safetyOptions: { lease, authorityProvider, distributedFenceGuard: fence },
  };
}

function starter(
  task: OrchestratorTask,
  factory: FakeFactory,
  distributedFenceLifecycle?: ConstructorParameters<typeof DistributedTargetRuntimeStarter>[0]["distributedFenceLifecycle"],
) {
  return new DistributedTargetRuntimeStarter({
    tasks: {
      loadCurrent: async (taskId, workspaceId) => {
        const current = await new TaskStore(task.workspace).load(taskId);
        assert.equal(current.workspaceId, workspaceId);
        return current;
      },
    },
    resolveWorkerProfile: async () => worker(),
    baseRuntimeFactory: factory,
    providerPreflight: async () => preflightOk(),
    ...(distributedFenceLifecycle ? { distributedFenceLifecycle } : {}),
  });
}

test("M12I starts existing lease-aware Hub runtime using only target-local task goal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12i-start-"));
  try {
    const task = await saveTask(root);
    const lease = new TestLease(task);
    const fence = new TestFence(task.id, task.workspaceId!);
    const runtime = new FakeRuntime("complete");
    const factory = new FakeFactory(runtime);
    const result = await starter(task, factory).start(contextFor(task, lease, fence));

    assert.equal(result.status, "completed");
    assert.equal(runtime.startCount, 1);
    assert.equal(runtime.sendPrompt, task.goal);
    assert.equal(factory.createRequests.length, 1);
    assert.equal(factory.createRequests[0]?.mode, "hub");
    assert.equal(factory.createRequests[0]?.workspaceRoot, task.workspace);
    assert.equal(runtime.startInput.config.enableSpawnAgent, false);
    assert.equal(runtime.startInput.config.enableAgentTeams, false);
    assert.equal(runtime.startInput.toolPolicies["*"].enabled, false);
    assert.ok(lease.validateCount >= 2);
    assert.ok(fence.validateCount >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M12I stale distributed fence blocks physical Hub session start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12i-fence-"));
  try {
    const task = await saveTask(root);
    const lease = new TestLease(task);
    const fence = new TestFence(task.id, task.workspaceId!);
    const runtime = new FakeRuntime("complete");
    const factory = new FakeFactory(runtime);
    const context = contextFor(task, lease, fence);

    let validations = 0;
    const original = fence.validateCurrent.bind(fence);
    fence.validateCurrent = async () => {
      validations += 1;
      if (validations >= 2) throw new Error("generation advanced");
      await original();
    };

    await assert.rejects(
      starter(task, factory).start(context),
      (error: unknown) => error instanceof DistributedTargetRuntimeStartError && error.code === "fence_not_current",
    );
    assert.equal(runtime.startCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M12I local writer lease loss actively aborts an in-flight Cline run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12i-lease-loss-"));
  try {
    const task = await saveTask(root);
    const lease = new TestLease(task);
    const fence = new TestFence(task.id, task.workspaceId!);
    const runtime = new FakeRuntime("wait");
    const factory = new FakeFactory(runtime);
    const startPromise = starter(task, factory).start(contextFor(task, lease, fence));

    while (!runtime.sendPrompt) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    lease.lose();
    const result = await startPromise;
    assert.equal(runtime.abortCount, 1);
    assert.equal(result.status, "aborted");
    const persisted = await new TaskStore(root).load(task.id);
    assert.equal(persisted.status, "aborted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M12L distributed fence renewal loss actively aborts an in-flight Cline run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12l-fence-renewal-loss-"));
  try {
    const task = await saveTask(root);
    const lease = new TestLease(task);
    const fence = new RenewableTestFence(task.id, task.workspaceId!);
    const runtime = new FakeRuntime("wait");
    const factory = new FakeFactory(runtime);
    let scheduled: (() => void) | undefined;
    const startPromise = starter(task, factory, {
      renewTtlMs: 10_000,
      renewIntervalMs: 2_000,
      setTimeoutFn: ((callback: () => void) => {
        scheduled = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    }).start(contextFor(task, lease, fence));

    while (!runtime.sendPrompt) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(scheduled, "renewal lifecycle should schedule while the run is active");
    fence.failRenewal = true;
    scheduled!();

    const result = await startPromise;
    assert.equal(fence.renewCount, 1);
    assert.equal(runtime.abortCount, 1);
    assert.equal(result.status, "aborted");
    assert.equal(lease.signal.aborted, false, "distributed fence loss must not masquerade as local lease loss");
    const persisted = await new TaskStore(root).load(task.id);
    assert.equal(persisted.status, "aborted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
