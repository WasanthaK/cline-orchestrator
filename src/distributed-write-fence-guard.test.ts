import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLeaseAwareHubSafetySessionContributions,
  leaseAwareWriterAuthorityFromTask,
  LeaseAwareWriterSafetyError,
  type DistributedWriterFenceGuard,
  type LeaseAwareWriterAuthorityProvider,
} from "./lease-aware-hub-safety-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

function worker(): WorkerConfig {
  return {
    providerId: "openai-compatible", modelId: "test", apiKey: "test",
    baseUrl: "http://127.0.0.1:1/v1", contextWindow: 1000, maxInputTokens: 900,
    maxTokensPerTurn: 100, reasoningEffort: "none", timeoutMs: 0,
    preflightTimeoutMs: 1000, validationTimeoutMs: 1000, maxValidationOutputChars: 2000,
    maxValidationRepairs: 0, checkpointMaxUntrackedFiles: 100,
    checkpointMaxUntrackedBytes: 1024 * 1024, contextRotateAtTokens: 800,
    maxContextRotations: 2, maxIterations: 0, stallTimeoutMs: 0, maxRetries: 0,
    retryDelayMs: 0, autoApproveCommands: false, autoApproveEdits: false,
  };
}

function task(root: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111", goal: "edit", workspace: root,
    status: "created", createdAt: now, updatedAt: now, projectId: "project-1",
    workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRegistryRevision: 4,
    safetyPlanId: "plan-1", safetyPolicyVersion: "policy-1", safetyProfileId: "profile-1",
    safetyProfileRevision: 7, approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"], workerProfileId: "pilot-safe",
  };
}

class FakeLease implements WriterLeaseSession {
  readonly controller = new AbortController();
  validateCount = 0;
  constructor(private readonly claim: WorkspaceWriterClaimV1) {}
  get taskId(): string { return this.claim.taskId; }
  get workspaceId(): string { return this.claim.workspaceId; }
  get ownerInstanceId(): string { return this.claim.ownerInstanceId; }
  get signal(): AbortSignal { return this.controller.signal; }
  currentClaim(): WorkspaceWriterClaimV1 { return structuredClone(this.claim); }
  async validateCurrent(): Promise<void> { this.validateCount += 1; }
}

function leaseClaim(value: OrchestratorTask): WorkspaceWriterClaimV1 {
  return {
    schemaVersion: 1, workspaceId: value.workspaceId!, stateRevision: 2,
    leaseId: "33333333-3333-4333-8333-333333333333",
    fenceToken: "44444444-4444-4444-8444-444444444444", taskId: value.id,
    ownerInstanceId: "55555555-5555-4555-8555-555555555555",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), authority: "coordination_only",
  };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-m12f-boundary-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  const approved = task(root);
  const lease = new FakeLease(leaseClaim(approved));
  const authority = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
  const authorityProvider: LeaseAwareWriterAuthorityProvider = {
    async revalidateCurrent() { return structuredClone(authority); },
  };
  return { root, approved, lease, authorityProvider };
}

test("M12F distributed guard is required immediately before a distributed editor mutation", async () => {
  const { root, approved, lease, authorityProvider } = await setup();
  let fenceChecks = 0;
  const distributedFenceGuard: DistributedWriterFenceGuard = {
    taskId: approved.id,
    workspaceId: approved.workspaceId!,
    async validateCurrent() { fenceChecks += 1; },
  };
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved, root, worker(), { lease, authorityProvider, distributedFenceGuard },
  );
  const editor = safety.capabilities.toolExecutors?.editor!;
  await editor(
    { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
    root,
    { agentId: "a", conversationId: "c", iteration: 1 } as any,
  );
  assert.equal(lease.validateCount, 1);
  assert.equal(fenceChecks, 1);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "b\n");
});

test("M12F stale distributed generation fails closed before editor mutation", async () => {
  const { root, approved, lease, authorityProvider } = await setup();
  const distributedFenceGuard: DistributedWriterFenceGuard = {
    taskId: approved.id,
    workspaceId: approved.workspaceId!,
    async validateCurrent() { throw new Error("stale generation"); },
  };
  const safety = createLeaseAwareHubSafetySessionContributions(
    approved, root, worker(), { lease, authorityProvider, distributedFenceGuard },
  );
  const editor = safety.capabilities.toolExecutors?.editor!;
  await assert.rejects(
    () => editor(
      { path: path.join(root, "src", "a.txt"), old_text: "a", new_text: "b" } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError
      && error.code === "distributed_fence_invalid",
  );
  assert.equal(lease.validateCount, 1);
  assert.equal(await readFile(path.join(root, "src", "a.txt"), "utf8"), "a\n");
});

test("M12F distributed guard cannot bind another task or workspace", async () => {
  const { root, approved, lease, authorityProvider } = await setup();
  const distributedFenceGuard: DistributedWriterFenceGuard = {
    taskId: "99999999-9999-4999-8999-999999999999",
    workspaceId: approved.workspaceId!,
    async validateCurrent() {},
  };
  assert.throws(
    () => createLeaseAwareHubSafetySessionContributions(
      approved, root, worker(), { lease, authorityProvider, distributedFenceGuard },
    ),
    (error: unknown) => error instanceof LeaseAwareWriterSafetyError && error.code === "binding_invalid",
  );
});
