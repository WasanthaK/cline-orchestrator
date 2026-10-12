import { MachineOrchestratorService } from "./machine-orchestrator.js";
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
  readOnlyMachineMethods: ["listProjects", "listWorkspaces", "findTasks"] as const,
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
 * This intentionally makes only the three existing read-only machine calls
 * available to the viewer. No worker profile may be resolved, and the viewer
 * never calls any other method or creates a daemon/controller/SDK runtime.
 *
 * The machine service instance provides binding-filtered task observations.
 * It does NOT grant task authority by existing in this viewer process.
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
    const source = {
      listProjects: () => machine.listProjects(),
      listWorkspaces: () => machine.listWorkspaces(),
      findTasks: (options: Parameters<MachineOrchestratorService["findTasks"]>[0]) =>
        machine.findTasks(options),
    };
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
