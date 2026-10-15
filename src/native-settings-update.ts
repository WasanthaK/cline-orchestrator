import crypto from "node:crypto";
import path from "node:path";
import { lstat, link, open, rename, unlink } from "node:fs/promises";
import { readProductConfigFile, resolveProductConfigSource } from "./product-config-source.js";
import { checkLocalProvider } from "./local-provider-check.js";
import { FirstRunSetupService, type FirstRunSetupOptions } from "./first-run-setup.js";
import type { ProductConfigFileV1 } from "./product-config.js";

/**
 * M19D2: a revision-checked native-host provider update, restricted to the
 * existing Windows local-user config file. Never callable from the browser.
 * All approvals are held by the existing single-use, expiring setup service.
 */
export const NATIVE_SETTINGS_UPDATE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  changesOnlyProviderSelection: true as const,
  literalLoopbackMetadataOnly: true as const,
  confirmation: "existing_short_lived_single_use" as const,
  scope: "fixed_local_user_config" as const,
  createsPreviousVersion: true as const,
  browserMutation: false as const,
  startsModel: false as const,
  startsTask: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

type Selection = { providerId: string; modelId: string; baseUrl: string };
type Existing = { file: string; directory: string; revision: string; config: ProductConfigFileV1;
  identity: { dev: number; ino: number } ; selection: Selection };

export class NativeSettingsUpdateError extends Error {
  constructor(public readonly code:
    "missing" | "unsafe" | "stale" | "unavailable" | "write_failed") {
    super({
      missing: "Saved local settings are missing",
      unsafe: "Saved local settings cannot be safely updated",
      stale: "Settings changed since the review; refresh and retry",
      unavailable: "Selected local model cannot be verified",
      write_failed: "Settings update failed; inspect the saved configuration before retrying",
    }[code]);
    this.name = "NativeSettingsUpdateError";
  }
}

export interface NativeSettingsInspectionV1 {
  schemaVersion: 1;
  command: "settings-desktop";
  status: "configured" | "missing" | "attention";
  revision?: string;
  selection?: Selection;
  editableFields: readonly ["providerId", "modelId", "baseUrl"];
  readOnly: true;
  grantsAuthority: false;
}

export interface NativeSettingsReviewV1 {
  schemaVersion: 1;
  kind: "settings-revision-review";
  action: "update_config";
  destination: "local_app_data_config";
  previousRevision: string;
  selection: Selection;
  expiresAt: string;
  requiresExactReply: "UPDATE CONFIG";
  grantsAuthority: false;
}

export interface NativeSettingsUpdateResultV1 {
  schemaVersion: 1;
  kind: "settings-revision-result";
  outcome: "updated" | "cancelled";
  previousVersionPreserved: boolean;
  configSaved: boolean;
  grantsAuthority: false;
}

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const validRevision = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validSelection = (s: Selection): boolean => {
  if (!s || !["openai-compatible", "ollama-openai"].includes(s.providerId)
    || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(s.modelId)
    || typeof s.baseUrl !== "string" || s.baseUrl.length > 250) return false;
  try {
    const url = new URL(s.baseUrl);
    return url.protocol === "http:"
      && ["127.0.0.1", "[::1]"].includes(url.hostname)
      && Boolean(url.port) && url.pathname === "/v1"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};

async function existingSettings(stateDirectory: string): Promise<Existing> {
  if (typeof stateDirectory !== "string" || !path.isAbsolute(stateDirectory)
    || stateDirectory.includes("\0")) throw new NativeSettingsUpdateError("unsafe");
  const directory = path.resolve(stateDirectory);
  const file = path.join(directory, "config.json");
  let before;
  try {
    const parent = await lstat(directory);
    before = await lstat(file);
    if (!parent.isDirectory() || parent.isSymbolicLink()
      || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 2 || before.size > 65_536) throw new Error("unsafe file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NativeSettingsUpdateError("missing");
    throw new NativeSettingsUpdateError("unsafe");
  }
  try {
    const text = await readProductConfigFile(file);
    const after = await lstat(file);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("file changed");
    }
    const doc: unknown = JSON.parse(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("invalid JSON");
    const config = doc as ProductConfigFileV1;
    const selection = config.provider;
    if (!selection || typeof selection.providerId !== "string"
      || typeof selection.modelId !== "string" || typeof selection.baseUrl !== "string"
      || !validSelection(selection as Selection)
      // Credential references remain valid in product configuration, but this
      // provider-only editing path refuses to silently carry/change them.
      || selection.apiKeySecretRef !== undefined) throw new Error("unsupported settings");
    const resolved = await resolveProductConfigSource(file, {}, async () => text);
    if (resolved.runtime.autoApproveCommands || resolved.runtime.autoApproveEdits
      || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(resolved.daemon.host)) {
      throw new Error("unsafe runtime configuration");
    }
    return {
      file, directory, revision: digest(text), config,
      identity: { dev: before.dev, ino: before.ino },
      selection: {
        providerId: selection.providerId, modelId: selection.modelId, baseUrl: selection.baseUrl,
      },
    };
  } catch { throw new NativeSettingsUpdateError("unsafe"); }
}

export async function inspectNativeSettings(stateDirectory: string): Promise<NativeSettingsInspectionV1> {
  let status: NativeSettingsInspectionV1["status"] = "attention";
  let found: Existing | undefined;
  try { found = await existingSettings(stateDirectory); status = "configured"; }
  catch (error) {
    if (error instanceof NativeSettingsUpdateError && error.code === "missing") status = "missing";
  }
  return Object.freeze({
    schemaVersion: 1, command: "settings-desktop", status,
    ...(found ? { revision: found.revision, selection: found.selection } : {}),
    editableFields: ["providerId", "modelId", "baseUrl"] as const,
    readOnly: true, grantsAuthority: false,
  });
}

async function commitRevision(before: Existing, next: ProductConfigFileV1): Promise<void> {
  const fresh = await existingSettings(before.directory);
  if (fresh.revision !== before.revision || fresh.identity.dev !== before.identity.dev
    || fresh.identity.ino !== before.identity.ino) throw new NativeSettingsUpdateError("stale");
  const entropy = crypto.randomBytes(16).toString("hex");
  const temporary = path.join(before.directory, ".config-revision-" + entropy + ".tmp");
  // A per-revision, create-only backup remains in user-owned state for later
  // explicit rollback. Never delete or overwrite a pre-existing backup.
  const backup = path.join(before.directory, "config.previous-" + before.revision + ".json");
  let createdBackup = false, installed = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(next, null, 2) + "\n", "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    const current = await existingSettings(before.directory);
    if (current.revision !== before.revision || current.identity.dev !== before.identity.dev
      || current.identity.ino !== before.identity.ino) throw new NativeSettingsUpdateError("stale");
    await link(before.file, backup); // atomic, create-only; existing backup blocks update
    createdBackup = true;
    // Confirm original bytes once again after the backup link and immediately
    // before replacement. Only cooperative local writers are serialised here;
    // a hostile concurrent OS writer cannot be atomically CAS-ed in Node.
    if (digest(await readProductConfigFile(before.file)) !== before.revision)
      throw new NativeSettingsUpdateError("stale");
    await rename(temporary, before.file);
    installed = true;
  } catch (error) {
    if (error instanceof NativeSettingsUpdateError) throw error;
    throw new NativeSettingsUpdateError("write_failed");
  } finally {
    await unlink(temporary).catch(() => undefined);
    if (!installed && createdBackup) await unlink(backup).catch(() => undefined);
  }
}

export async function updateNativeSettings(
  input: { stateDirectory: string; expectedRevision: string; selection: Selection },
  confirm: (review: NativeSettingsReviewV1) => Promise<boolean>,
  fetchImpl: typeof fetch = fetch,
  options: FirstRunSetupOptions = {},
): Promise<NativeSettingsUpdateResultV1> {
  if (typeof confirm !== "function" || !input || !validRevision(input.expectedRevision)
    || !validSelection(input.selection)) throw new NativeSettingsUpdateError("unsafe");
  const before = await existingSettings(input.stateDirectory);
  if (input.expectedRevision !== before.revision) throw new NativeSettingsUpdateError("stale");
  if (before.selection.providerId === input.selection.providerId
    && before.selection.modelId === input.selection.modelId
    && before.selection.baseUrl === input.selection.baseUrl)
    throw new NativeSettingsUpdateError("unsafe");
  let checked;
  try { checked = await checkLocalProvider(input.selection, fetchImpl); }
  catch { throw new NativeSettingsUpdateError("unavailable"); }
  if (!checked.ok || checked.code !== "ok") throw new NativeSettingsUpdateError("unavailable");

  const next: ProductConfigFileV1 = structuredClone(before.config);
  next.provider = { ...input.selection };
  await resolveProductConfigSource("settings-preview", {}, async () => JSON.stringify(next));
  const unsupported = async () => { throw new NativeSettingsUpdateError("unsafe"); };
  const service = new FirstRunSetupService({
    async writeConfig(payload) {
      if (payload.targetPath !== before.file
        || JSON.stringify(payload.config) !== JSON.stringify(next))
        throw new NativeSettingsUpdateError("unsafe");
      const recent = await checkLocalProvider(input.selection, fetchImpl);
      if (!recent.ok || recent.code !== "ok") throw new NativeSettingsUpdateError("unavailable");
      await commitRevision(before, next);
    },
    registerProject: unsupported, registerWorkspace: unsupported,
    startLoopbackDaemon: unsupported,
  }, options);
  // Reuse M17C single-use 60-second write_config authority. The actual
  // private token/config are never returned to the WinForms host.
  const preview = await service.preview({
    schemaVersion: 1, action: "write_config",
    payload: { targetPath: before.file, config: next },
  });
  const approved = await confirm(Object.freeze({
    schemaVersion: 1, kind: "settings-revision-review", action: "update_config",
    destination: "local_app_data_config", previousRevision: before.revision,
    selection: { ...input.selection }, expiresAt: preview.expiresAt,
    requiresExactReply: "UPDATE CONFIG", grantsAuthority: false,
  }));
  if (approved !== true) return Object.freeze({
    schemaVersion: 1, kind: "settings-revision-result", outcome: "cancelled",
    previousVersionPreserved: true, configSaved: false, grantsAuthority: false,
  });
  try {
    await service.execute({
      action: "write_config", payloadDigest: preview.payloadDigest,
      confirmationToken: preview.confirmationToken, confirmed: true,
    });
  } catch {
    throw new NativeSettingsUpdateError("write_failed");
  }
  return Object.freeze({
    schemaVersion: 1, kind: "settings-revision-result", outcome: "updated",
    previousVersionPreserved: true, configSaved: true, grantsAuthority: false,
  });
}
