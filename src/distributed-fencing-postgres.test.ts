import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Pool } from "pg";
import {
  POSTGRES_DISTRIBUTED_FENCE_BACKEND_CONTRACT,
  PostgresDistributedFenceBackend,
} from "./distributed-fencing-postgres.js";
import type { DistributedFenceClaimV1, DistributedFenceStateV1 } from "./distributed-fencing.js";

const execFileAsync = promisify(execFile);
const connectionString = process.env.M12F_POSTGRES_URL;
const workerPath = fileURLToPath(new URL("./distributed-fencing-postgres-worker.ts", import.meta.url));

function state(
  workspaceId: string,
  revision: number,
  generation: number,
  activeFence?: DistributedFenceClaimV1,
): DistributedFenceStateV1 {
  return {
    schemaVersion: 1,
    workspaceId,
    revision,
    generation,
    ...(activeFence ? { activeFence } : {}),
    authority: "fencing_state_only",
  };
}

function claim(workspaceId: string, generation: number): DistributedFenceClaimV1 {
  return {
    schemaVersion: 1,
    fenceId: crypto.randomUUID(),
    workspaceId,
    taskId: crypto.randomUUID(),
    machineId: crypto.randomUUID(),
    machineRegistrationId: crypto.randomUUID(),
    machineRegistrationRevision: 1,
    placementId: crypto.randomUUID(),
    placementRevision: 1,
    candidateAssignmentId: crypto.randomUUID(),
    generation,
    issuedAt: "2026-09-29T00:00:00.000Z",
    expiresAt: "2026-09-29T00:00:30.000Z",
    authority: "fencing_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

async function worker(
  tableName: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await execFileAsync(
    process.execPath,
    ["--import", "tsx", workerPath, JSON.stringify(request)],
    {
      env: {
        ...process.env,
        M12F_POSTGRES_URL: connectionString!,
        M12F_POSTGRES_TABLE: tableName,
      },
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

async function withTable(run: (tableName: string) => Promise<void>): Promise<void> {
  const tableName = `orchestrator_fence_test_${crypto.randomBytes(8).toString("hex")}`;
  const backend = new PostgresDistributedFenceBackend({
    tableName,
    poolConfig: { connectionString },
  });
  const admin = new Pool({ connectionString });
  try {
    await backend.initialize();
    await run(tableName);
  } finally {
    await backend.close();
    await admin.query(`DROP TABLE IF EXISTS ${tableName}`);
    await admin.end();
  }
}

test("M12F PostgreSQL fencing contract remains fencing-only", () => {
  assert.deepEqual(POSTGRES_DISTRIBUTED_FENCE_BACKEND_CONTRACT, {
    schemaVersion: 1,
    sharedAcrossProcesses: true,
    linearizableCompareExchange: true,
    durableMonotonicGeneration: true,
    credentialsRemainMachineLocal: true,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
    enablesDistributedWriteExecutionByItself: false,
  });
});

test(
  "M12F PostgreSQL backend serializes independent-process CAS and survives process restart",
  { skip: !connectionString },
  async () => {
    await withTable(async (tableName) => {
      const workspaceId = crypto.randomUUID();
      const initial = state(workspaceId, 1, 1);

      const [first, second] = await Promise.all([
        worker(tableName, {
          action: "cas",
          workspaceId,
          expectedRevision: null,
          next: initial,
        }),
        worker(tableName, {
          action: "cas",
          workspaceId,
          expectedRevision: null,
          next: initial,
        }),
      ]);

      assert.equal(Number(first.swapped) + Number(second.swapped), 1);

      const afterInitialRestart = await worker(tableName, { action: "read", workspaceId });
      assert.deepEqual(afterInitialRestart.state, initial);

      const generation2 = claim(workspaceId, 2);
      const advanced = state(workspaceId, 2, 2, generation2);
      assert.deepEqual(
        await worker(tableName, {
          action: "cas",
          workspaceId,
          expectedRevision: 1,
          next: advanced,
        }),
        { swapped: true },
      );

      const stale = state(workspaceId, 2, 1);
      assert.deepEqual(
        await worker(tableName, {
          action: "cas",
          workspaceId,
          expectedRevision: 1,
          next: stale,
        }),
        { swapped: false },
      );

      const afterFailoverRestart = await worker(tableName, { action: "read", workspaceId });
      assert.deepEqual(afterFailoverRestart.state, advanced);
    });
  },
);

test(
  "M12F PostgreSQL backend refuses generation skips and generation advance without an active fence",
  { skip: !connectionString },
  async () => {
    await withTable(async (tableName) => {
      const workspaceId = crypto.randomUUID();
      const backend = new PostgresDistributedFenceBackend({
        tableName,
        poolConfig: { connectionString },
      });
      try {
        assert.equal(await backend.compareExchange(workspaceId, null, state(workspaceId, 1, 1)), true);

        assert.equal(
          await backend.compareExchange(
            workspaceId,
            1,
            state(workspaceId, 2, 2),
          ),
          false,
        );
        assert.equal(
          await backend.compareExchange(
            workspaceId,
            1,
            state(workspaceId, 2, 3, claim(workspaceId, 3)),
          ),
          false,
        );

        assert.deepEqual(await backend.read(workspaceId), state(workspaceId, 1, 1));
      } finally {
        await backend.close();
      }
    });
  },
);
