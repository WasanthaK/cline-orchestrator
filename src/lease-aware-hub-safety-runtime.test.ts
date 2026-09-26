import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLeaseAwareHubSafetySessionContributions,
  leaseAwareWriterAuthorityFromTask,
  LeaseAwareWriterSafetyError,
  type LeaseAwareWriterAuthorityProvider,
  type LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
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
    goal: "Safely edit src/a.txt",
    workspace: root,
    status: "created",
    createdAt: now,
    updatedAt: now,
    projectId: "project-1",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceRegistryRevision: 4,
    safetyPlanId: "plan-1",
    safetyPolicyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 7,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"],
    workerProfileId: "pilot-safe",
  };
}

class FakeLease implements WriterLeaseSession {
  readonly signalController = new AbortController();
  validateError: unknown;
  validateCount = 0;

  constructor(private claim: WorkspaceWriterClaimV1) {}

  get taskId(): string { return this.claim.taskId; }
  get workspaceId(): string { return this.claim.workspaceId; }
  get ownerInstanceId(): string { return this.claim.ownerInstanceId; }
  get signal(): AbortSignal { return this.signalController.signal; }

  currentClaim(): WorkspaceWriterClaimV1 {
    return structuredClone(this.claim);
  }

  setClaim(claim: WorkspaceWriterClaimV1): void {
    this.claim = structuredClone(claim);
  }

  async validateCurrent(): Promise<void> {
    this.validateCount += 1;
    if (this.validateError) throw this.validateError;
  }
}

function claimFor(taskValue: OrchestratorTask): WorkspaceWriterClaimV1 {
  return {
    schemaVersion: 1,
    workspaceId: taskValue.workspaceId!,
    stateRevision: 2,
    leaseId: "33333333-3333-4333-8333-333333333333",
    fenceToken: "44444444-4444-4444-8444-444444444444",
    taskId: taskValue.id,
    ownerInstanceId: "55555555-5555-4555-8555-555555555555",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authority: "coordination_only",
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-lease-aware-hub-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  return root;
}

function provider(current: LeaseAwareWriterAuthorityV1): LeaseAwareWriterAuthorityProvider {
  return {
    async revalidateCurrent() {
      return structuredClone(current);
    },
  };
}

test("lease-aware Hub write executor requires current authority and lease before editor mutation", async () => {
  const root = await workspace();
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(authority) },
  );
  const editor = safety.capabilities.toolExecutors?.editor;
  assert.ok(editor);

  await editor!(
    { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
    root,
    { agentId: "a", conversationId: "c", iteration: 1 } as any,
  );

  assert.equal(lease.validateCount, 1);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "b\n");
});

test("authority revision drift fails closed before editor mutation", async () => {
  const root = await workspace();
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const stale = { ...authority, safetyProfileRevision: authority.safetyProfileRevision + 1 };
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(stale) },
  );
  const editor = safety.capabilities.toolExecutors?.editor!;

  await assert.rejects(
    () => editor(
      { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError && error.code === "authority_stale",
  );
  assert.equal(lease.validateCount, 0);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "a\n");
});

test("lease validation failure fails closed before applyPatch mutation", async () => {
  const root = await workspace();
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  lease.validateError = new Error("stale claim");
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(authority) },
  );
  const applyPatch = safety.capabilities.toolExecutors?.applyPatch!;
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/a.txt",
    "@@",
    "-a",
    "+b",
    "*** End Patch",
  ].join("\n");

  await assert.rejects(
    () => applyPatch(
      { input: patch } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError && error.code === "lease_invalid",
  );
  assert.equal(lease.validateCount, 1);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "a\n");
});

test("aborted lease fails closed before authority or write execution", async () => {
  const root = await workspace();
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  let authorityChecks = 0;
  const authorityProvider: LeaseAwareWriterAuthorityProvider = {
    async revalidateCurrent() {
      authorityChecks += 1;
      return structuredClone(authority);
    },
  };
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider },
  );
  lease.signalController.abort(new Error("heartbeat failed"));
  const editor = safety.capabilities.toolExecutors?.editor!;

  await assert.rejects(
    () => editor(
      { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError && error.code === "lease_aborted",
  );
  assert.equal(authorityChecks, 0);
  assert.equal(lease.validateCount, 0);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "a\n");
});

test("fence replacement fails closed even if replacement claim could otherwise validate", async () => {
  const root = await workspace();
  const approved = task(root);
  const initial = claimFor(approved);
  const lease = new FakeLease(initial);
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(authority) },
  );

  lease.setClaim({
    ...initial,
    stateRevision: initial.stateRevision + 1,
    leaseId: "66666666-6666-4666-8666-666666666666",
    fenceToken: "77777777-7777-4777-8777-777777777777",
  });

  const editor = safety.capabilities.toolExecutors?.editor!;
  await assert.rejects(
    () => editor(
      { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError && error.code === "lease_identity_changed",
  );
  assert.equal(lease.validateCount, 0);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "a\n");
});

test("normal heartbeat renewal may advance revision and expiry without replacing lease/fence identity", async () => {
  const root = await workspace();
  const approved = task(root);
  const initial = claimFor(approved);
  const lease = new FakeLease(initial);
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(authority) },
  );

  lease.setClaim({
    ...initial,
    stateRevision: initial.stateRevision + 1,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });

  const editor = safety.capabilities.toolExecutors?.editor!;
  await editor(
    { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
    root,
    { agentId: "a", conversationId: "c", iteration: 1 } as any,
  );
  assert.equal(lease.validateCount, 1);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "b\n");
});

test("read/search owner executors do not require a writer lease validation", async () => {
  const root = await workspace();
  const approved = task(root);
  const lease = new FakeLease(claimFor(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved,
    root,
    worker(),
    { lease, authorityProvider: provider(authority) },
  );
  const read = safety.capabilities.toolExecutors?.readFile!;

  await read(
    { path: path.join(root, "src", "a.txt") } as any,
    { agentId: "a", conversationId: "c", iteration: 1 } as any,
  );
  assert.equal(lease.validateCount, 0);
});
