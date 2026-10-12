import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import { buildOrchestrationDashboard } from "./orchestration-dashboard.js";
import { buildOperatorVisualization, type OperatorVisualizationV1 } from "./operator-visualization.js";
import type { TrustedPassiveSnapshotReader } from "./passive-operator-viewer.js";

/**
 * Only read APIs are accepted. In particular, this adapter receives no
 * startTask, approveEscalation, raw TaskStore, model, process or file access.
 */
export type TrustedDashboardMachineReader = Pick<
  MachineOrchestratorService, "listProjects" | "listWorkspaces" | "findTasks"
>;

export const MACHINE_DASHBOARD_READER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  serviceQueries: ["listProjects", "listWorkspaces", "findTasks"] as const,
  tasksLimit: 100 as const,
  noSyntheticHealthySources: true as const,
  noRawTaskOutput: true as const,
  startsDaemon: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

type SourceName = "projects" | "workspaces" | "tasks";
type SourceFailure = { source: SourceName; code: string };

function sourceFailure(code: string): SourceFailure["code"] {
  return code;
}

function capture<T>(
  result: PromiseSettledResult<T>,
  capturedAt: string,
  source: SourceName,
): { values: T | undefined; meta: { capturedAt: string; available: boolean; errorCode?: string } } {
  if (result.status === "fulfilled" && Array.isArray(result.value)) {
    return { values: result.value, meta: { capturedAt, available: true } };
  }
  return {
    values: undefined,
    meta: { capturedAt, available: false, errorCode: sourceFailure(source + "_unavailable") },
  };
}

/**
 * E2b2 connects the existing passive viewer to three current, independently
 * read-only MachineOrchestratorService APIs. Queries are settled separately,
 * preserving explicit source errors without showing a failed query as no work.
 *
 * Workflow, incident, supervisor, writer-lock and specialist-handoff adapters
 * are NOT connected in this slice. They must never be described as healthy.
 * A list at the machine findTasks cap is not proven complete.
 */
export function createMachineDashboardSnapshotReader(
  machine: TrustedDashboardMachineReader,
  options: { now?: () => Date } = {},
): TrustedPassiveSnapshotReader {
  if (!machine
    || typeof machine.listProjects !== "function"
    || typeof machine.listWorkspaces !== "function"
    || typeof machine.findTasks !== "function") {
    throw new Error("Trusted read-only machine dashboard APIs are required");
  }
  const clock = options.now ?? (() => new Date());
  return {
    async readSnapshot(): Promise<OperatorVisualizationV1> {
      const results = await Promise.allSettled([
        machine.listProjects(),
        machine.listWorkspaces(),
        machine.findTasks({ limit: MACHINE_DASHBOARD_READER_CONTRACT.tasksLimit }),
      ] as const);
      const now = clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new Error("Invalid dashboard capture clock");
      }
      const at = now.toISOString();
      const projects = capture(results[0], at, "projects");
      const workspaces = capture(results[1], at, "workspaces");
      const tasks = capture(results[2], at, "tasks");
      // The service's limit is not an exhaustive total count. A saturated
      // response must fail closed rather than advertise a complete task feed.
      if (tasks.values && tasks.values.length >= MACHINE_DASHBOARD_READER_CONTRACT.tasksLimit) {
        tasks.meta.available = false;
        tasks.meta.errorCode = "task_listing_completeness_unknown";
      }
      const disconnected = {
        capturedAt: at,
        available: false,
        errorCode: "source_not_connected",
      };
      const dash = buildOrchestrationDashboard({
        projects: projects.values ?? [],
        projectsMeta: projects.meta,
        workspaces: workspaces.values ?? [],
        workspacesMeta: workspaces.meta,
        tasks: tasks.values ?? [],
        tasksMeta: tasks.meta,
        workflows: [],
        workflowsMeta: disconnected,
        incidents: [],
        incidentsMeta: disconnected,
        supervisor: {
          ...disconnected,
          plannerProposals: 0,
          reviewerPasses: 0,
          reviewerRepairs: 0,
          reviewerEscalations: 0,
          pendingHumanEscalations: 0,
        },
      }, { now });
      const projected = buildOperatorVisualization({
        dashboard: dash,
        handoffs: [],
        writerLocks: [],
      }, { now });

      // Other source adapters are deliberately disconnected and reflected
      // as unavailable in the dashboard's typed source notices.
      return {
        ...projected,
        header: { ...projected.header, health: "unknown" },
      };
    },
  };
}
