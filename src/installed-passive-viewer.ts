import { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { TrustedDashboardMachineReader } from "./machine-dashboard-snapshot-reader.js";
import { createMachineDashboardSnapshotReader } from "./machine-dashboard-snapshot-reader.js";
import { startPassiveOperatorViewer, type PassiveViewerServerHandle } from "./passive-operator-viewer.js";
import { SafetyPlanService } from "./safety-plan.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

export const INSTALLED_VIEWER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresExplicitCliCommand: true as const,
  tokenSource: "ORCH_VIEWER_TOKEN" as const,
  portSource: "ORCH_VIEWER_PORT" as const,
  host: "127.0.0.1" as const,
  defaultPort: 4321 as const,
  readOnlyMachineMethods: ["listProjects", "listWorkspaces", "findTasks", "getTask", "getTaskEvents", "getTaskRecoveryEvidence"] as const,
  noWorkerProfileResolution: true as const,
  noDaemonStartup: true as const,
  noTaskMutation: true as const,
  noServiceInstallation: true as const,
  grantsAuthority: false as const,
});

export class InstalledViewerConfigurationError extends Error {
  constructor() {
    super("Local viewer requires ORCH_VIEWER_TOKEN (32–4096 safe characters) and a valid ORCH_VIEWER_PORT");
    this.name = "InstalledViewerConfigurationError";
  }
}

export function installedViewerConfigFromEnvironment(env: Record<string, string | undefined>): {
  host: "127.0.0.1";
  port: number;
  token: string;
} {
  const token = env.ORCH_VIEWER_TOKEN;
  const portText = env.ORCH_VIEWER_PORT;
  const port = portText === undefined ? INSTALLED_VIEWER_CONTRACT.defaultPort : Number(portText);
  if (typeof token !== "string" || token.length < 32 || token.length > 4096
    || token.trim() !== token || /[\x00-\x1f\x7f]/.test(token)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || (portText !== undefined && !/^[1-9][0-9]{0,4}$/.test(portText))) {
    throw new InstalledViewerConfigurationError();
  }
  return { host: "127.0.0.1", port, token };
}

/**
 * Pass only the exact six observation capabilities to the installed viewer.
 * Task details and events stay behind registered Safety/task bindings, and
 * the downstream timeline projection drops raw messages and identifiers.
 * No execution, approval, TaskStore, or worker profile capability escapes.
 */
export function createInstalledViewerMachineReader(
  machine: Pick<MachineOrchestratorService,
    "listProjects" | "listWorkspaces" | "findTasks" | "getTask" | "getTaskEvents" | "getTaskRecoveryEvidence">,
): TrustedDashboardMachineReader {
  return {
    listProjects: () => machine.listProjects(),
    listWorkspaces: () => machine.listWorkspaces(),
    findTasks: (options) => machine.findTasks(options),
    getTask: (taskId) => machine.getTask(taskId),
    getTaskEvents: (taskId) => machine.getTaskEvents(taskId),
    getTaskRecoveryEvidence: (taskId) => machine.getTaskRecoveryEvidence(taskId),
  };
}

/**
 * The foreground passive viewer remains read-only and never resolves a
 * worker profile, starts Cline or installs a service.
 */
export async function startInstalledPassiveViewer(
  env: Record<string, string | undefined>,
): Promise<PassiveViewerServerHandle> {
  const config = installedViewerConfigFromEnvironment(env); // validate BEFORE setup
  const registry = new WorkspaceRegistry();
  const safety = new SafetyPlanService(registry);
  const machine = new MachineOrchestratorService(registry, safety, () => {
    throw new Error("Read-only viewer must never resolve or execute a worker profile");
  });
  try {
    const source = createInstalledViewerMachineReader(machine);
    const viewer = await startPassiveOperatorViewer(
      createMachineDashboardSnapshotReader(source), config);
    // Machine service is entirely local to the reader; no worker has been
    // started. Closing the viewer releases any incidental service handles.
    return {
      ...viewer,
      async close() {
        try { await viewer.close(); }
        finally { await machine.close(); }
      },
    };
  } catch {
    await machine.close();
    throw new InstalledViewerConfigurationError();
  }
}
