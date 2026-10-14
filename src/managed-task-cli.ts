import { lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { preflightProvider } from "./provider-preflight.js";
import { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { PublicTaskView } from "./machine-orchestrator.js";
import { withRuntimeProviderCredential } from "./runtime-provider-credential.js";
import { SafetyPlanService, type SafetyPreview } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { WorkerConfig } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import type { ResolvedProductConfigV1 } from "./product-config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["completed", "validation_failed", "failed", "aborted", "rolled_back", "waiting_for_human"]);
const ACTIVE = new Set(["created", "waiting", "running", "stalled", "validating", "repairing", "safety_checking", "waiting_for_human"]);

export const MANAGED_RUN_CONTRACT = Object.freeze({
  explicitInteractiveApproval: true,
  registeredWorkspaceIdOnly: true,
  exactWorkerProfileRequired: true,
  failClosedExclusiveCliLock: true,
  readOnlySafetyPreviewBeforeStart: true,
  existingMachineGatewayOnly: true,
  noLegacyRunDispatch: true,
  noViewerMutation: true,
  noBackgroundService: true,
  loopbackModelOnly: true,
  automaticApprovals: false,
  releaseAuthority: false,
});

export type ManagedTaskReview = Omit<SafetyPreview, "planToken" | "dirtyFingerprint"> & {
  canonicalRoot: string;
  maxChangedFiles: number;
};

export class ManagedRunError extends Error {
  constructor(public readonly code:
    | "input_invalid" | "provider_invalid" | "profile_mismatch" | "daemon_active"
    | "workspace_busy" | "provider_not_ready") {
    super({
      input_invalid: "Registered workspace ID and bounded goal are required",
      provider_invalid: "Managed preview requires a loopback OpenAI-compatible provider with automatic approvals off",
      profile_mismatch: "Explicit ORCH_WORKER_PROFILE_ID does not match the registered Safety profile",
      daemon_active: "Another daemon is listening on the configured port; stop it before standalone managed execution",
      workspace_busy: "Workspace has an unfinished task; do not start a second writer",
      provider_not_ready: "Local model preflight did not confirm the configured model",
    }[code]);
    this.name = "ManagedRunError";
  }
}

type TaskMachine = Pick<MachineOrchestratorService, "previewTask" | "startTask" | "getTask">;

export interface ManagedRunDependencies {
  registry?: WorkspaceRegistry;
  /** Injectable for dry-run acceptance; production always uses the real gateway. */
  machine?: TaskMachine;
  preflight?: typeof preflightProvider;
  daemonPresent?: (url: string) => Promise<boolean>;
  confirm: (review: ManagedTaskReview) => Promise<boolean>;
  pause?: () => Promise<void>;
}

async function exclusiveCliLock(registry: WorkspaceRegistry, workspaceId: string): Promise<() => Promise<void>> {
  // This create-only lock prevents two standalone managed-run invocations from
  // racing on the same registered workspace. A crash leaves a stale file,
  // intentionally failing closed until the operator investigates it.
  const directory = path.join(path.dirname(registry.path), "managed-run-locks");
  await mkdir(directory, { recursive: true });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new ManagedRunError("workspace_busy");
  }
  const file = path.join(directory, workspaceId + ".lock");
  let handle;
  try { handle = await open(file, "wx", 0o600); }
  catch { throw new ManagedRunError("workspace_busy"); }
  return async () => {
    try { await handle.close(); }
    finally { await unlink(file); }
  };
}

async function listening(url: string): Promise<boolean> {
  try {
    await fetch(url + "/health", { signal: AbortSignal.timeout(1000) });
    return true; // Any local HTTP responder could be another writer.
  } catch (error) {
    // Connection refused is the only benign case. Timeout/unknown errors
    // remain unsafe; never assume an unreachable-but-listening daemon is idle.
    const cause = (error as { cause?: { code?: string } })?.cause?.code;
    return cause !== "ECONNREFUSED";
  }
}

function workerFromProduct(config: ResolvedProductConfigV1,
  env: Record<string, string | undefined>): WorkerConfig {
  const provider = config.provider;
  let url: URL;
  try { url = new URL(provider.baseUrl); }
  catch { throw new ManagedRunError("provider_invalid"); }
  const host = url.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)
    || url.protocol !== "http:" || url.username || url.password
    || !["ollama-openai", "openai-compatible"].includes(provider.providerId)
    || !url.pathname.replace(/\/+$/, "").endsWith("/v1")
    || config.runtime.autoApproveCommands || config.runtime.autoApproveEdits) {
    throw new ManagedRunError("provider_invalid");
  }
  const worker: WorkerConfig = {
    ...config.runtime,
    providerId: "openai-compatible",
    modelId: provider.modelId,
    baseUrl: provider.baseUrl,
    ...(provider.providerId === "ollama-openai" ? { apiKey: "ollama" } : {}),
  };
  return withRuntimeProviderCredential(worker, provider.apiKeySecretRef, key => env[key]);
}

export async function runManagedTaskCli(
  input: { workspaceId: string; goal: string; config: ResolvedProductConfigV1;
    env: Record<string, string | undefined> },
  deps: ManagedRunDependencies,
): Promise<{ started: boolean; taskId?: string; status?: PublicTaskView["status"]; grantsAuthority: false }> {
  if (!UUID.test(input.workspaceId) || !input.goal.trim() || input.goal.length > 20_000) {
    throw new ManagedRunError("input_invalid");
  }
  // No arbitrary workspace path accepted. Resolve and verify exact registration.
  const registry = deps.registry ?? new WorkspaceRegistry();
  const workspace = await registry.resolveVerifiedWorkspace(input.workspaceId);
  if (!input.env.ORCH_WORKER_PROFILE_ID?.trim()
    || input.env.ORCH_WORKER_PROFILE_ID !== workspace.safetyProfile.workerProfileId) {
    throw new ManagedRunError("profile_mismatch");
  }
  const worker = workerFromProduct(input.config, input.env);
  const mcpPort = input.env.ORCH_MCP_PORT ?? "4318";
  if (!/^[1-9][0-9]{0,4}$/.test(mcpPort) || Number(mcpPort) > 65535) {
    throw new ManagedRunError("daemon_active");
  }
  const otherEndpoints = [input.config.daemon.url, "http://127.0.0.1:4318",
    "http://127.0.0.1:" + mcpPort];
  const daemonActive = async () => {
    for (const endpoint of new Set(otherEndpoints)) {
      if (await (deps.daemonPresent ?? listening)(endpoint)) return true;
    }
    return false;
  };
  if (await daemonActive()) {
    throw new ManagedRunError("daemon_active");
  }
  if ((await new TaskStore(workspace.canonicalRoot).list()).some(task => ACTIVE.has(task.status))) {
    throw new ManagedRunError("workspace_busy");
  }
  const preflight = await (deps.preflight ?? preflightProvider)(worker);
  if (preflight.ok !== true || preflight.supported !== true) {
    throw new ManagedRunError("provider_not_ready");
  }

  const release = await exclusiveCliLock(registry, workspace.workspaceId);
  const ownedService = deps.machine ? undefined : new MachineOrchestratorService(
    registry, new SafetyPlanService(registry),
    selectedProfile => {
      if (selectedProfile !== workspace.safetyProfile.workerProfileId) {
        throw new ManagedRunError("profile_mismatch");
      }
      return worker;
    },
  );
  const service = deps.machine ?? ownedService!;
  try {
    const preview = await service.previewTask({
      workspaceId: workspace.workspaceId,
      goal: input.goal,
    });
    // The single-use token and workspace fingerprint remain private to this
    // in-process operation, never a CLI argument, log, saved file or browser URL.
    const { planToken, dirtyFingerprint: _fingerprint, ...visible } = preview;
    const approved = await deps.confirm({
      ...visible, canonicalRoot: workspace.canonicalRoot,
      maxChangedFiles: workspace.safetyProfile.maxChangedFiles,
    });
    if (!approved) return { started: false, grantsAuthority: false };
    // A separate process may have started since the preview; fail closed.
    if (await daemonActive()) {
      throw new ManagedRunError("daemon_active");
    }
    if ((await new TaskStore(workspace.canonicalRoot).list()).some(task => ACTIVE.has(task.status))) {
      throw new ManagedRunError("workspace_busy");
    }
    const queued = await service.startTask(planToken);
    let observed = queued;
    while (!TERMINAL.has(observed.status)) {
      await (deps.pause ?? (() => new Promise<void>(resolve => setTimeout(resolve, 1000))))();
      observed = await service.getTask(queued.taskId);
    }
    return { started: true, taskId: observed.taskId, status: observed.status, grantsAuthority: false };
  } finally {
    try { if (ownedService) await ownedService.close(); }
    finally { await release(); }
  }
}
