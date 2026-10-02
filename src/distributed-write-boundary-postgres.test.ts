import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Pool } from "pg";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import { PostgresDistributedFenceBackend } from "./distributed-fencing-postgres.js";
import {
  DistributedFenceAuthority,
  type DistributedFenceClaimV1,
  type DistributedFenceStateV1,
} from "./distributed-fencing.js";
import { createDistributedWriterFenceGuard } from "./distributed-write-fence-guard.js";
import {
  createLeaseAwareHubSafetySessionContributions,
  leaseAwareWriterAuthorityFromTask,
  LeaseAwareWriterSafetyError,
  type LeaseAwareWriterAuthorityProvider,
} from "./lease-aware-hub-safety-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const execFileAsync = promisify(execFile);
const connectionString = process.env.M12F_POSTGRES_URL;
const workerPath = fileURLToPath(new URL("./distributed-fencing-postgres-worker.ts", import.meta.url));

function workerConfig(): WorkerConfig {
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

function orchestratorTask(root: string, taskId: string, workspaceId: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: taskId, goal: "Safely edit src/a.txt", workspace: root, status: "created",
    createdAt: now, updatedAt: now, projectId: "project-1", workspaceId,
    workspaceRegistryRevision: 4, safetyPlanId: "plan-1", safetyPolicyVersion: "policy-1",
    safetyProfileId: "profile-1", safetyProfileRevision: 7,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"], workerProfileId: "pilot-safe",
  };
}

function assignment(taskId: string, workspaceId: string): DistributedWriterCandidateAssignmentV1 {
  const now = Date.now();
  return {
    schemaVersion: 1, assignmentId: crypto.randomUUID(), taskId, workspaceId,
    machineId: crypto.randomUUID(), machineRegistrationId: crypto.randomUUID(),
    machineRegistrationRevision: 1, placementId: crypto.randomUUID(), placementRevision: 1,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
    authority: "coordination_only", grantsTaskAuthority: false, grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false, grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false, grantsReleaseAuthority: false,
  };
}

function replacementClaim(
  prior: DistributedFenceClaimV1,
  generation: number,
): DistributedFenceClaimV1 {
  const now = Date.now();
  return {
    ...prior,
    fenceId: crypto.randomUUID(),
    generation,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
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

function localClaim(taskId: string, workspaceId: string): WorkspaceWriterClaimV1 {
  return {
    schemaVersion: 1, workspaceId, stateRevision: 2,
    leaseId: crypto.randomUUID(), fenceToken: crypto.randomUUID(), taskId,
    ownerInstanceId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authority: "coordination_only",
  };
}

async function childCas(
  tableName: string,
  workspaceId: string,
  expectedRevision: number,
  next: DistributedFenceStateV1,
): Promise<boolean> {
  const result = await execFileAsync(
    process.execPath,
    ["--import", "tsx", workerPath, JSON.stringify({
      action: "cas", workspaceId, expectedRevision, next,
    })],
    {
      env: {
        ...process.env,
        M12F_POSTGRES_URL: connectionString!,
        M12F_POSTGRES_TABLE: tableName,
      },
      maxBuffer: 1024 * 1024,
    },
  );
  return (JSON.parse(result.stdout.trim()) as { swapped: boolean }).swapped;
}

test(
  "M12F newer PostgreSQL generation from another process blocks stale target-machine editor write",
  { skip: !connectionString },
  async () => {
    const tableName = `orchestrator_boundary_test_${crypto.randomBytes(8).toString("hex")}`;
    const admin = new Pool({ connectionString });
    const backend = new PostgresDistributedFenceBackend({
      tableName,
      poolConfig: { connectionString },
    });
    try {
      await backend.initialize();
      const root = await mkdtemp(path.join(os.tmpdir(), "orch-m12f-pg-boundary-"));
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");

      const taskId = crypto.randomUUID();
      const workspaceId = crypto.randomUUID();
      const candidate = assignment(taskId, workspaceId);
      const fenceAuthority = new DistributedFenceAuthority(
        backend,
        { async assertCandidateCurrent(value) {
          assert.equal(value.assignmentId, candidate.assignmentId);
        } },
      );
      const staleFence = await fenceAuthority.acquire({ assignment: candidate, ttlMs: 30_000 });
      assert.equal(staleFence.generation, 1);

      const current = await backend.read(workspaceId);
      assert.ok(current);
      const newerFence = replacementClaim(staleFence, 2);
      const advanced: DistributedFenceStateV1 = {
        schemaVersion: 1,
        workspaceId,
        revision: current!.revision + 1,
        generation: 2,
        activeFence: newerFence,
        authority: "fencing_state_only",
      };
      assert.equal(await childCas(tableName, workspaceId, current!.revision, advanced), true);

      const approved = orchestratorTask(root, taskId, workspaceId);
      const lease = new FakeLease(localClaim(taskId, workspaceId));
      const durable = leaseAwareWriterAuthorityFromTask(approved, lease.ownerInstanceId);
      const authorityProvider: LeaseAwareWriterAuthorityProvider = {
        async revalidateCurrent() { return structuredClone(durable); },
      };
      const distributedFenceGuard = createDistributedWriterFenceGuard(
        fenceAuthority,
        staleFence,
        candidate,
      );
      const safety = createLeaseAwareHubSafetySessionContributions(
        approved,
        root,
        workerConfig(),
        { lease, authorityProvider, distributedFenceGuard },
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
      const persisted = await backend.read(workspaceId);
      assert.equal(persisted?.generation, 2);
      assert.equal(persisted?.activeFence?.fenceId, newerFence.fenceId);
    } finally {
      await backend.close();
      await admin.query(`DROP TABLE IF EXISTS ${tableName}`);
      await admin.end();
    }
  },
);
