import { OrchestratorSentinel, type SentinelIncidentV1 } from "./sentinel.js";
import { TaskStore } from "./state.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SentinelIncidentQuery {
  includeResolved?: boolean;
  limit?: number;
}

export class SentinelQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentinelQueryError";
  }
}

function requireWorkspaceId(value: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new SentinelQueryError("workspace_id must be an opaque UUID");
  }
  return normalized;
}

/**
 * Refreshes Sentinel observations from durable task/event history for one
 * registered workspace, then returns bounded sanitized incident views. The raw
 * canonical workspace root is used only inside the machine process and is never
 * returned to the caller.
 */
export async function listRegisteredWorkspaceIncidents(
  registry: WorkspaceRegistry,
  workspaceId: string,
  query: SentinelIncidentQuery = {},
): Promise<SentinelIncidentV1[]> {
  const verifiedId = requireWorkspaceId(workspaceId);
  const workspace = await registry.resolveVerifiedWorkspace(verifiedId);
  const tasks = new TaskStore(workspace.canonicalRoot);
  const sentinel = new OrchestratorSentinel(workspace.canonicalRoot, workspace.workspaceId);

  for (const task of await tasks.list()) {
    await sentinel.ingestTask(task.id);
  }

  const includeResolved = query.includeResolved === true;
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  return (await sentinel.listIncidents())
    .filter((incident) => includeResolved || incident.status === "open")
    .slice(0, limit);
}
