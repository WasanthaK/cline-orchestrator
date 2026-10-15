import path from "node:path";
import { lstat } from "node:fs/promises";
import { readProductConfigFile, resolveProductConfigSource } from "./product-config-source.js";
import { checkLocalProvider } from "./local-provider-check.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

/**
 * M19C3: native first-run setup snapshot. "Complete" means the local
 * prerequisites were observed, NOT that any Cline execution is authorized.
 * No browser route, config writes, service or model/task start.
 */
export const NATIVE_SETUP_READINESS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  observationOnly: true as const,
  literalLoopbackMetadataOnly: true as const,
  noCredentials: true as const,
  noWorkspacePaths: true as const,
  noBrowserRoute: true as const,
  configWrites: false as const,
  startsDaemon: false as const,
  startsModel: false as const,
  startsTask: false as const,
  grantsAuthority: false as const,
});

export type NativeSetupStepId = "model" | "settings" | "project" | "workspace";
export type NativeSetupState = "ready" | "needed" | "attention";
export interface NativeSetupReadinessV1 {
  schemaVersion: 1;
  command: "readiness-desktop";
  status: "setup_complete" | "needs_setup" | "attention";
  checkedAt: string;
  steps: readonly { id: NativeSetupStepId; state: NativeSetupState }[];
  projectCount: number;
  workspaceCount: number;
  setupCompleteIsTaskAuthority: false;
  readOnly: true;
  grantsAuthority: false;
}

interface SavedProvider {
  providerId: string;
  modelId: string;
  baseUrl: string;
}

export class NativeSetupReadinessError extends Error {
  constructor() {
    super("Native setup status requires a local user-state directory");
    this.name = "NativeSetupReadinessError";
  }
}

const step = (id: NativeSetupStepId, state: NativeSetupState) => ({ id, state });
const bounded = (size: number) => Math.min(999, size);

async function inspectConfig(file: string): Promise<{
  status: NativeSetupState; provider?: SavedProvider;
}> {
  try {
    const parent = await lstat(path.dirname(file));
    const info = await lstat(file);
    if (!parent.isDirectory() || parent.isSymbolicLink()
      || !info.isFile() || info.isSymbolicLink() || info.size > 65_536) {
      return { status: "attention" };
    }
    // Reuse the existing strict configuration reader; never trust defaults as
    // evidence that a model has actually been configured by the operator.
    const raw = JSON.parse(await readProductConfigFile(file)) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "attention" };
    const doc = raw as Record<string, unknown>;
    if (doc.schemaVersion !== 1 || !doc.provider || typeof doc.provider !== "object"
      || Array.isArray(doc.provider)) return { status: "attention" };
    const provider = doc.provider as Record<string, unknown>;
    if (typeof provider.providerId !== "string" || typeof provider.modelId !== "string"
      || typeof provider.baseUrl !== "string") return { status: "attention" };
    const resolved = await resolveProductConfigSource(file, {});
    if (resolved.runtime.autoApproveCommands || resolved.runtime.autoApproveEdits
      || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(resolved.daemon.host)) {
      return { status: "attention" };
    }
    return { status: "ready", provider: {
      providerId: provider.providerId,
      modelId: provider.modelId,
      baseUrl: provider.baseUrl,
    } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "needed" };
    return { status: "attention" };
  }
}

export async function inspectNativeSetupReadiness(
  stateDirectory: string,
  registry = new WorkspaceRegistry(),
  fetchImpl: typeof fetch = fetch,
): Promise<NativeSetupReadinessV1> {
  if (typeof stateDirectory !== "string" || !path.isAbsolute(stateDirectory)) {
    throw new NativeSetupReadinessError();
  }
  const file = path.join(stateDirectory, "ClineOrchestrator", "config.json");
  const config = await inspectConfig(file);
  let modelState: NativeSetupState = "needed";
  if (config.provider) {
    try {
      const result = await checkLocalProvider(config.provider, fetchImpl);
      modelState = result.ok && result.code === "ok" ? "ready" : "attention";
    } catch {
      // No raw endpoints, upstream model output, credentials or errors leave
      // this isolated, explicitly user-invoked metadata preflight.
      modelState = "attention";
    }
  }

  let projectState: NativeSetupState = "needed";
  let workspaceState: NativeSetupState = "needed";
  let projectCount = 0;
  let workspaceCount = 0;
  try {
    const projects = await registry.listProjects();
    const workspaces = await registry.listWorkspaces();
    projectCount = bounded(projects.length);
    workspaceCount = bounded(workspaces.length);
    projectState = projects.length > 0 ? "ready" : "needed";
    if (workspaces.length) {
      let verified = false;
      for (const entry of workspaces.slice(0, 100)) {
        try {
          const registered = await registry.resolveVerifiedWorkspace(entry.workspaceId);
          const safety = registered.safetyProfile;
          if (projects.some(p => p.projectId === registered.projectId)
            && safety.maxChangedFiles >= 0
            && safety.allowedPathPatterns.length > 0
            && safety.protectedPathPatterns.length > 0
            && safety.validationCommands.length > 0
            && safety.workerProfileId.length > 0) {
            verified = true;
            break;
          }
        } catch { /* Stale workspace is not proof of a safe, current registration. */ }
      }
      workspaceState = verified ? "ready" : "attention";
    }
  } catch {
    // Malformed registries and failed reads must never appear green.
    projectState = "attention";
    workspaceState = "attention";
    projectCount = 0;
    workspaceCount = 0;
  }
  const steps = Object.freeze([
    step("model", modelState),
    step("settings", config.status),
    step("project", projectState),
    step("workspace", workspaceState),
  ]);
  const status = steps.every(x => x.state === "ready") ? "setup_complete"
    : steps.some(x => x.state === "attention") ? "attention" : "needs_setup";
  return Object.freeze({
    schemaVersion: 1,
    command: "readiness-desktop",
    status,
    checkedAt: new Date().toISOString(),
    steps,
    projectCount, workspaceCount,
    setupCompleteIsTaskAuthority: false,
    readOnly: true,
    grantsAuthority: false,
  });
}
