import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  assertDistributedFenceState,
  DistributedFenceError,
  type DistributedFenceBackend,
  type DistributedFenceStateV1,
} from "./distributed-fencing.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TABLE = "orchestrator_distributed_fences";
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

export const POSTGRES_DISTRIBUTED_FENCE_BACKEND_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  sharedAcrossProcesses: true as const,
  linearizableCompareExchange: true as const,
  durableMonotonicGeneration: true as const,
  credentialsRemainMachineLocal: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
  enablesDistributedWriteExecutionByItself: false as const,
});

export interface PostgresDistributedFenceBackendOptions {
  tableName?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

function workspaceId(value: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new DistributedFenceError("workspaceId must be an opaque UUID", "backend_invalid");
  }
  return normalized;
}

function tableName(value: string | undefined): string {
  const normalized = (value ?? DEFAULT_TABLE).trim();
  if (!TABLE_NAME.test(normalized)) {
    throw new DistributedFenceError("PostgreSQL fence table name is invalid", "backend_invalid");
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new DistributedFenceError(`PostgreSQL fence ${field} is invalid`, "backend_invalid");
  }
  return parsed;
}

function parseStateRow(row: Record<string, unknown>, expectedWorkspaceId: string): DistributedFenceStateV1 {
  const revision = positiveInteger(row.revision, "revision");
  const generation = positiveInteger(row.generation, "generation");
  const state = row.state_json;
  assertDistributedFenceState(state);
  if (
    state.workspaceId !== expectedWorkspaceId
    || state.revision !== revision
    || state.generation !== generation
  ) {
    throw new DistributedFenceError(
      "PostgreSQL fence row metadata does not match its durable state",
      "backend_invalid",
    );
  }
  return structuredClone(state);
}

/**
 * M12F production shared fencing backend.
 *
 * PostgreSQL is the serialization point. A workspace row is keyed by workspace_id;
 * compareExchange is one INSERT-if-absent or one revision-qualified UPDATE. PostgreSQL
 * serializes conflicting writes on the primary-key row, so exactly one caller can
 * commit a given expected revision. State and generation live in the database and
 * therefore survive orchestrator/controller process restart.
 *
 * Connection material is supplied only through machine-local Pool/PoolConfig input.
 * It is never copied into a fence claim, task, placement, assignment or model-facing
 * state. This backend remains fencing-only and does not enable distributed writes by
 * itself; the M12F target write boundary must still compose it with current durable
 * task/Safety/registry authority and the current local writer lease.
 */
export class PostgresDistributedFenceBackend implements DistributedFenceBackend {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly table: string;

  constructor(options: PostgresDistributedFenceBackendOptions = {}) {
    if (options.pool && options.poolConfig) {
      throw new DistributedFenceError(
        "Provide either a PostgreSQL pool or poolConfig, not both",
        "backend_invalid",
      );
    }
    this.table = tableName(options.tableName);
    this.pool = options.pool ?? new Pool(options.poolConfig);
    this.ownsPool = !options.pool;
  }

  async initialize(): Promise<void> {
    await this.query(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          workspace_id uuid PRIMARY KEY,
          revision bigint NOT NULL CHECK (revision >= 1),
          generation bigint NOT NULL CHECK (generation >= 1),
          state_json jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    });
  }

  async read(workspaceIdInput: string): Promise<DistributedFenceStateV1 | undefined> {
    const id = workspaceId(workspaceIdInput);
    return await this.query(async (client) => {
      const result = await client.query(
        `SELECT revision, generation, state_json FROM ${this.table} WHERE workspace_id = $1`,
        [id],
      );
      if (result.rowCount === 0) return undefined;
      if (result.rowCount !== 1) {
        throw new DistributedFenceError("PostgreSQL fence key returned multiple rows", "backend_invalid");
      }
      return parseStateRow(result.rows[0] as Record<string, unknown>, id);
    });
  }

  async compareExchange(
    workspaceIdInput: string,
    expectedRevision: number | null,
    nextInput: DistributedFenceStateV1,
  ): Promise<boolean> {
    const id = workspaceId(workspaceIdInput);
    assertDistributedFenceState(nextInput);
    if (nextInput.workspaceId !== id) {
      throw new DistributedFenceError("fence backend key/state workspace mismatch", "backend_invalid");
    }
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw new DistributedFenceError("expected fence revision is invalid", "backend_invalid");
    }
    if (expectedRevision === null) {
      if (nextInput.revision !== 1 || nextInput.generation !== 1) {
        throw new DistributedFenceError(
          "initial fence state must start at revision/generation 1",
          "backend_invalid",
        );
      }
      return await this.query(async (client) => {
        const result = await client.query(
          `INSERT INTO ${this.table} (workspace_id, revision, generation, state_json)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (workspace_id) DO NOTHING
           RETURNING revision`,
          [id, nextInput.revision, nextInput.generation, JSON.stringify(nextInput)],
        );
        return result.rowCount === 1;
      });
    }

    if (nextInput.revision !== expectedRevision + 1) {
      throw new DistributedFenceError("fence backend revision must advance by one", "backend_invalid");
    }

    return await this.query(async (client) => {
      const stateJson = JSON.stringify(nextInput);
      const result = await client.query(
        `UPDATE ${this.table}
         SET revision = $3, generation = $4, state_json = $5::jsonb, updated_at = now()
         WHERE workspace_id = $1
           AND revision = $2
           AND (
             generation = $4
             OR (generation + 1 = $4 AND ($5::jsonb ? 'activeFence'))
           )
         RETURNING revision`,
        [id, expectedRevision, nextInput.revision, nextInput.generation, stateJson],
      );
      return result.rowCount === 1;
    });
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  private async query<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      return await operation(client);
    } catch (error) {
      if (error instanceof DistributedFenceError) throw error;
      throw new DistributedFenceError(
        `PostgreSQL distributed fence backend failed: ${error instanceof Error ? error.message : String(error)}`,
        "backend_unavailable",
      );
    } finally {
      client?.release();
    }
  }
}
