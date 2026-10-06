import { PostgresDistributedFenceBackend } from "./distributed-fencing-postgres.js";
import type { DistributedFenceStateV1 } from "./distributed-fencing.js";

interface WorkerRequest {
  action: "read" | "cas";
  workspaceId: string;
  expectedRevision?: number | null;
  next?: DistributedFenceStateV1;
}

async function main(): Promise<void> {
  const connectionString = process.env.M12F_POSTGRES_URL;
  const tableName = process.env.M12F_POSTGRES_TABLE;
  const raw = process.argv[2];
  if (!connectionString || !tableName || !raw) {
    throw new Error("M12F worker requires database URL, table name and request payload");
  }
  const request = JSON.parse(raw) as WorkerRequest;
  const backend = new PostgresDistributedFenceBackend({
    tableName,
    poolConfig: { connectionString },
  });
  try {
    if (request.action === "read") {
      const state = await backend.read(request.workspaceId);
      process.stdout.write(`${JSON.stringify({ state })}\n`);
      return;
    }
    if (request.action === "cas") {
      if (!request.next || request.expectedRevision === undefined) {
        throw new Error("CAS worker request is incomplete");
      }
      const swapped = await backend.compareExchange(
        request.workspaceId,
        request.expectedRevision,
        request.next,
      );
      process.stdout.write(`${JSON.stringify({ swapped })}\n`);
      return;
    }
    throw new Error("Unknown M12F worker action");
  } finally {
    await backend.close();
  }
}

await main();
