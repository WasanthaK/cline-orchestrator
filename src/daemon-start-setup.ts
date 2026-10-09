import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import { FirstRunSetupService, type FirstRunSetupOptions, type FirstRunSetupResultV1 } from "./first-run-setup.js";
import { resolveProductConfigSource } from "./product-config-source.js";
import type { ProductConfigFileV1, ResolvedProductConfigV1 } from "./product-config.js";
import { productExecutionEnvironment } from "./product-execution-config.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";

export class DaemonStartSetupError extends Error {
  constructor(public readonly code: "workspace_invalid" | "config_invalid" | "state_changed") {
    super({
      workspace_invalid: "Daemon setup requires a valid registered workspace ID",
      config_invalid: "Daemon setup requires loopback configuration with automatic commands and edits disabled",
      state_changed: "Workspace or Safety profile changed after review; start a new confirmation",
    }[code]);
    this.name = "DaemonStartSetupError";
  }
}

export interface DaemonStartSetupReview {
  workspace: RegisteredWorkspace;
  config: ProductConfigFileV1;
  confirmationText: string;
  expiresAt: string;
}

const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function workspaceSnapshot(registry: WorkspaceRegistry, workspaceId: string) {
  try {
    const workspace = await registry.resolveVerifiedWorkspace(workspaceId);
    const info = await stat(workspace.canonicalRoot);
    if (!info.isDirectory()) throw new Error("invalid directory");
    return { workspace, dev: info.dev, ino: info.ino };
  } catch { throw new DaemonStartSetupError("workspace_invalid"); }
}

export async function runDaemonStartSetup(
  workspaceId: string,
  selectedConfig: ResolvedProductConfigV1,
  inherited: Record<string, string | undefined>,
  confirm: (review: DaemonStartSetupReview) => Promise<boolean>,
  dispatch: (args: string[], env: Record<string, string | undefined>) => Promise<void>,
  registry = new WorkspaceRegistry(),
  options: FirstRunSetupOptions = {},
): Promise<{ dispatched: boolean; result?: FirstRunSetupResultV1; grantsAuthority: false }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new DaemonStartSetupError("workspace_invalid");
  }
  const inheritedSnapshot = { ...inherited };
  const input: ProductConfigFileV1 = structuredClone({ schemaVersion: 1,
    provider: selectedConfig.provider, runtime: selectedConfig.runtime, daemon: selectedConfig.daemon });
  let config: ResolvedProductConfigV1;
  try {
    config = await resolveProductConfigSource("setup-start", {}, async () => JSON.stringify(input));
    if (config.runtime.autoApproveCommands || config.runtime.autoApproveEdits) throw new Error("automatic approval");
    if (["ORCH_API_KEY", "ORCH_API_KEY_SECRET_REF"].includes(config.provider.apiKeySecretRef ?? "")) {
      throw new Error("reserved reference");
    }
  } catch { throw new DaemonStartSetupError("config_invalid"); }
  const childEnv = productExecutionEnvironment(config, inheritedSnapshot);
  if (config.provider.apiKeySecretRef) childEnv.ORCH_API_KEY_SECRET_REF = config.provider.apiKeySecretRef;
  const original = await workspaceSnapshot(registry, workspaceId);
  const workspaceDigest = digest(original);
  const configDigest = digest(input);
  const unsupported = async () => { throw new DaemonStartSetupError("config_invalid"); };
  const service = new FirstRunSetupService({
    writeConfig: unsupported, registerProject: unsupported, registerWorkspace: unsupported,
    async startLoopbackDaemon(payload) {
      if (payload.workspaceDigest !== workspaceDigest || payload.configDigest !== configDigest) {
        throw new DaemonStartSetupError("state_changed");
      }
      const current = await workspaceSnapshot(registry, workspaceId);
      if (digest(current) !== workspaceDigest) throw new DaemonStartSetupError("state_changed");
      // Credentials remain unresolved here; only the existing daemon child selects the named value.
      // Foreground dispatch waits for child exit, exactly as the existing start command does.
      await dispatch(["daemon", original.workspace.canonicalRoot], { ...childEnv });
    },
  }, options);
  const preview = await service.preview({ schemaVersion: 1, action: "start_loopback_daemon", payload: {
    host: config.daemon.host === "[::1]" ? "::1" : config.daemon.host,
    workspaceId, workspaceDigest, configDigest,
  } });
  const accepted = await confirm({ workspace: structuredClone(original.workspace), config: structuredClone(input),
    confirmationText: preview.confirmationText, expiresAt: preview.expiresAt });
  if (accepted !== true) return { dispatched: false, grantsAuthority: false };
  const result = await service.execute({ action: "start_loopback_daemon", payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true });
  return { dispatched: true, result, grantsAuthority: false };
}
