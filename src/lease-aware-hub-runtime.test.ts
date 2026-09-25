import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type LeaseAwareWriterAuthorityProvider,
} from "./lease-aware-hub-safety-runtime.js";
import {
  LeaseAwareHubRuntimeError,
  LeaseAwareHubRuntimeFactory,
} from "./lease-aware-hub-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
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
    autoApproveEdits: false,
  };
}

function task(root: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    goal: "edit",
    workspace: root,
    status: "created",
    createdAt: now,
    updatedAt: now,
    projectId: "project-1",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceRegistryRevision: 1,
    safetyPlanId: "plan-1",
    safetyPolicyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"],
    workerProfileId: "pilot-safe",
  };
}

class FakeLease implements WriterLeaseSession {
  private readonly abortController = new AbortController();
  validateCount = 0;

  constructor(private readonly claim: WorkspaceWriterClaimV1) {}

  get taskId(): string { return this.claim.taskId; }
  get workspaceId(): string { return this.claim.workspaceId; }
  get ownerInstanceId(): string { return this.claim.ownerInstanceId; }
  get signal(): AbortSignal { return this.abortController.signal; }
  currentClaim(): WorkspaceWriterClaimV1 { return structuredClone(this.claim); }
  async validateCurrent(): Promise<void> { this.validateCount += 1; }
}

class CapturingRuntime implements ClineRuntime {
  startInput: any;
  async start(input: unknown): Promise<any> {
    this.startInput = input;
    return { sessionId: "session-1" };
  }
  async send(): Promise<any> { return { finishReason: "completed", text: "done" }; }
  async abort(): Promise<any> { return undefined; }
  subscribe(): unknown { return undefined; }
  async dispose(): Promise<void> {}
}

class CapturingFactory implements ClineRuntimeFactory {
  readonly runtime = new CapturingRuntime();
  request?: ClineRuntimeCreateRequest;
  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    this.request = request;
    return this.runtime;
  }
}

function claimFor(value: OrchestratorTask): WorkspaceWriterClaimV1 {
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId!,
    stateRevision: 2,
    leaseId: "33333333-3333-4333-8333-333333333333",
    fenceToken: "44444444-4444-4444-8444-444444444444",
    taskId: value.id,
    ownerInstanceId: "55555555-5555-4555-8555-555555555555",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authority: "coordination_only",
  };
}

test("lease-aware runtime wrapper forces Hub mode safety contributions onto session start", async () => {
  const root = path.resolve("lease-aware-runtime-fixture");
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const authorityProvider: LeaseAwareWriterAuthorityProvider = {
    async revalidateCurrent() { return structuredClone(authority); },
  };
  const base = new CapturingFactory();
  const factory = new LeaseAwareHubRuntimeFactory(
    base,
    approved,
    worker(),
    { lease, authorityProvider },
  );

  const runtime = await factory.create({ mode: "hub", workspaceRoot: root });
  await runtime.start({
    config: { enableSpawnAgent: true, pluginPaths: ["unsafe"] },
    toolPolicies: { "*": { enabled: true, autoApprove: true } },
    capabilities: { toolExecutors: { executeCommand: async () => undefined } },
    localRuntime: { hooks: {}, configExtensions: ["unsafe"] },
  });

  const input = base.runtime.startInput;
  assert.equal(input.config.enableSpawnAgent, false);
  assert.equal(input.config.enableAgentTeams, false);
  assert.deepEqual(input.config.pluginPaths, []);
  assert.deepEqual(input.config.agentPluginPaths, []);
  assert.equal(input.toolPolicies["*"].enabled, false);
  assert.deepEqual(Object.keys(input.capabilities.toolExecutors).sort(), [
    "applyPatch",
    "editor",
    "readFile",
    "search",
  ]);
  assert.equal(typeof input.localRuntime.hooks.beforeTool, "function");
});

test("lease-aware runtime wrapper rejects local mode or workspace redirection", async () => {
  const root = path.resolve("lease-aware-runtime-fixture");
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const base = new CapturingFactory();
  const factory = new LeaseAwareHubRuntimeFactory(
    base,
    approved,
    worker(),
    { lease, authorityProvider: { async revalidateCurrent() { return authority; } } },
  );

  await assert.rejects(
    () => factory.create({ mode: "local", workspaceRoot: root }),
    LeaseAwareHubRuntimeError,
  );
  await assert.rejects(
    () => factory.create({ mode: "hub", workspaceRoot: path.resolve("other-workspace") }),
    LeaseAwareHubRuntimeError,
  );
});
