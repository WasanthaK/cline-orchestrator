import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { checkLocalProvider } from "./local-provider-check.js";
import { runConfigWriteSetup, type ConfigWriteReview } from "./config-write-setup.js";

/**
 * M19C2: a fixed-name config in a separate, existing operator-state
 * directory. Only an explicit local consent response to the trusted
 * create-only service can produce a file. There is no HTTP or browser path.
 */
export const NATIVE_PROVIDER_SAVE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  configFilename: "config.json" as const,
  needsFreshMetadataCheck: true as const,
  requiresExplicitLocalConfirmation: true as const,
  createOnly: true as const,
  hasBrowserRoute: false as const,
  startsModel: false as const,
  registersWorkspace: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

export class NativeProviderSaveError extends Error {
  constructor(public readonly code: "scope_invalid" | "provider_unavailable" | "write_failed") {
    super({
      scope_invalid: "Native config destination must be a separate existing local user-state directory",
      provider_unavailable: "The selected loopback provider and model could not be verified",
      write_failed: "Native configuration was not created; review current local state before retrying",
    }[code]);
    this.name = "NativeProviderSaveError";
  }
}

export interface NativeProviderReviewV1 {
  schemaVersion: 1;
  kind: "config-review";
  action: "write_config";
  destination: "local_app_data_config";
  providerId: string;
  modelId: string;
  baseUrl: string;
  expiresAt: string;
  confirmationText: string;
  requiresExactReply: "CREATE CONFIG";
  grantsAuthority: false;
}

export interface NativeProviderResultV1 {
  schemaVersion: 1;
  kind: "config-result";
  outcome: "created" | "cancelled";
  destination: "local_app_data_config";
  configSaved: boolean;
  grantsAuthority: false;
}

/** Neither the provider nor the model is launched as part of verification. */
export async function saveNativeProviderConfig(
  request: {
    providerId: string; modelId: string; baseUrl: string;
    stateDirectory: string;
  },
  confirm: (review: NativeProviderReviewV1) => Promise<boolean>,
  fetchImpl: typeof fetch = fetch,
): Promise<NativeProviderResultV1> {
  if (typeof confirm !== "function" || !request ||
    typeof request.stateDirectory !== "string" || !path.isAbsolute(request.stateDirectory)) {
    throw new NativeProviderSaveError("scope_invalid");
  }
  const directory = path.resolve(request.stateDirectory);
  try {
    const [physical, entry] = await Promise.all([realpath(directory), lstat(directory)]);
    // Windows canonical filesystem casing is not guaranteed to match the
    // caller's casing even when it identifies the same real directory.
    // Keep physical alias/symlink denial; compare Windows roots case-folded.
    const sameLocation = process.platform === "win32"
      ? path.win32.normalize(physical).toLowerCase() === path.win32.normalize(directory).toLowerCase()
      : physical === directory;
    if (!sameLocation || !entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("state alias");
    }
  } catch { throw new NativeProviderSaveError("scope_invalid"); }

  let observation;
  try {
    observation = await checkLocalProvider({
      providerId: request.providerId,
      modelId: request.modelId,
      baseUrl: request.baseUrl,
    }, fetchImpl);
  } catch { throw new NativeProviderSaveError("provider_unavailable"); }
  if (!observation.ok || observation.code !== "ok") {
    throw new NativeProviderSaveError("provider_unavailable");
  }

  const config = {
    schemaVersion: 1 as const,
    provider: {
      providerId: request.providerId,
      modelId: request.modelId,
      baseUrl: request.baseUrl,
    },
    runtime: {
      autoApproveCommands: false,
      autoApproveEdits: false,
    },
    daemon: { host: "127.0.0.1" },
  };
  try {
    const result = await runConfigWriteSetup(
      path.join(directory, NATIVE_PROVIDER_SAVE_CONTRACT.configFilename),
      config,
      async (review: ConfigWriteReview) => confirm(Object.freeze({
        schemaVersion: 1,
        kind: "config-review",
        action: "write_config",
        destination: "local_app_data_config",
        providerId: config.provider.providerId,
        modelId: config.provider.modelId,
        baseUrl: config.provider.baseUrl,
        expiresAt: review.expiresAt,
        confirmationText: review.confirmationText,
        requiresExactReply: "CREATE CONFIG",
        grantsAuthority: false,
      })),
    );
    return Object.freeze({
      schemaVersion: 1,
      kind: "config-result",
      outcome: result.written ? "created" : "cancelled",
      destination: "local_app_data_config",
      configSaved: result.written,
      grantsAuthority: false,
    });
  } catch {
    throw new NativeProviderSaveError("write_failed");
  }
}
