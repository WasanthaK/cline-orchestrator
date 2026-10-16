import crypto from "node:crypto";
import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { readProductConfigFile, resolveProductConfigSource } from "./product-config-source.js";
import { inspectNativeSettingsRecovery, NATIVE_SETTINGS_RECOVERY_CONTRACT } from "./native-settings-recovery.js";
import { existingSettings, commitRevision, NativeSettingsUpdateError } from "./native-settings-update.js";
import { checkLocalProvider } from "./local-provider-check.js";
import { FirstRunSetupService, type FirstRunSetupOptions } from "./first-run-setup.js";
import type { ProductConfigFileV1 } from "./product-config.js";

/**
 * M19D3B: explicit native saved-model selection restore. A restore changes
 * ONLY the three provider selection fields, never task, runtime or Safety
 * policy. No browser route, no filesystem path argument, no OS service.
 */
export const NATIVE_SETTINGS_RESTORE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  fixedLocalUserState: true as const,
  maxChoices: NATIVE_SETTINGS_RECOVERY_CONTRACT.maxVersions,
  exactCurrentRevisionRequired: true as const,
  exactBackupDigestRequired: true as const,
  freshLoopbackPreflight: true as const,
  singleUseConfirmation: true as const,
  preservesCurrentRuntimeAndDaemon: true as const,
  restoresTaskOrWorkspace: false as const,
  browserMutation: false as const,
  startsTask: false as const,
  startsModel: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

type Selection = { providerId: string; modelId: string; baseUrl: string };
export interface NativeRestoreChoiceV1 {
  revision: string;
  selection: Selection;
}
export interface NativeRestoreChoicesV1 {
  schemaVersion: 1;
  command: "restore-choices-desktop";
  status: "available" | "none" | "needs_attention" | "unavailable";
  currentRevision?: string;
  choices: readonly NativeRestoreChoiceV1[];
  readOnly: true;
  grantsAuthority: false;
}
export interface NativeRestoreReviewV1 {
  schemaVersion: 1;
  kind: "settings-restore-review";
  action: "restore_provider";
  destination: "local_app_data_config";
  currentRevision: string;
  selectedBackupRevision: string;
  selection: Selection;
  expiresAt: string;
  requiresExactReply: "RESTORE CONFIG";
  grantsAuthority: false;
}
export interface NativeRestoreResultV1 {
  schemaVersion: 1;
  kind: "settings-restore-result";
  outcome: "restored" | "cancelled";
  currentVersionPreserved: boolean;
  configSaved: boolean;
  grantsAuthority: false;
}

const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const isRevision = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const backupFile = (dir: string, revision: string) =>
  path.join(dir, "config.previous-" + revision + ".json");

async function verifiedBackup(dir: string, revision: string): Promise<NativeRestoreChoiceV1> {
  if (!isRevision(revision)) throw new NativeSettingsUpdateError("unsafe");
  const file = backupFile(dir, revision);
  try {
    const parent = await lstat(dir);
    const before = await lstat(file);
    if (!parent.isDirectory() || parent.isSymbolicLink()
      || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 2 || before.size > 65_536) throw new Error("unsafe backup");
    const raw = await readProductConfigFile(file);
    const after = await lstat(file);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || sha(raw) !== revision) throw new Error("modified backup");
    const doc: unknown = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("invalid backup");
    const config = doc as ProductConfigFileV1;
    const selected = config.provider;
    if (!selected || typeof selected.providerId !== "string"
      || typeof selected.modelId !== "string" || typeof selected.baseUrl !== "string"
      || selected.apiKeySecretRef !== undefined
      || !["openai-compatible", "ollama-openai"].includes(selected.providerId)
      || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(selected.modelId)
      || selected.baseUrl.length > 250) throw new Error("unsafe metadata");
    const url = new URL(selected.baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
      || !url.port || url.pathname !== "/v1" || url.search || url.hash
      || url.username || url.password) throw new Error("unsafe model url");
    const resolved = await resolveProductConfigSource(file, {}, async () => raw);
    if (resolved.runtime.autoApproveCommands || resolved.runtime.autoApproveEdits
      || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(resolved.daemon.host))
      throw new Error("unsafe policy");
    return { revision, selection: {
      providerId: selected.providerId, modelId: selected.modelId, baseUrl: selected.baseUrl,
    } };
  } catch { throw new NativeSettingsUpdateError("unsafe"); }
}

export async function inspectNativeRestoreChoices(
  stateDirectory: string,
): Promise<NativeRestoreChoicesV1> {
  const result = (status: NativeRestoreChoicesV1["status"],
    currentRevision?: string, choices: readonly NativeRestoreChoiceV1[] = []): NativeRestoreChoicesV1 =>
    Object.freeze({
      schemaVersion: 1, command: "restore-choices-desktop", status,
      ...(currentRevision ? { currentRevision } : {}),
      choices, readOnly: true, grantsAuthority: false,
    });
  if (typeof stateDirectory !== "string" || !path.isAbsolute(stateDirectory)
    || stateDirectory.includes("\0")) return result("unavailable");
  let before;
  try { before = await existingSettings(stateDirectory); }
  catch { return result("unavailable"); }
  // Fail closed on ANY malformed backup. Unlike a selector that drops bad
  // rows, this prevents hiding tampering among otherwise valid candidates.
  const provenance = await inspectNativeSettingsRecovery(stateDirectory);
  if (provenance.status === "no_previous_version") return result("none", before.revision);
  if (provenance.status !== "verified_versions") return result("needs_attention", before.revision);
  try {
    const entries = (await readdir(before.directory)).filter(n => n.startsWith("config.previous-"));
    if (entries.length !== provenance.verifiedCount || entries.length > 32)
      throw new Error("changed recovery listing");
    const choices = [];
    for (const name of entries) {
      const match = /^config\.previous-([a-f0-9]{64})\.json$/.exec(name);
      if (!match) throw new Error("invalid backup name");
      choices.push(await verifiedBackup(before.directory, match[1]!));
    }
    // Validate current revision after reading the backups; never give a
    // fresh-looking selector after a concurrent settings replacement.
    const recent = await existingSettings(before.directory);
    if (recent.revision !== before.revision || recent.identity.dev !== before.identity.dev
      || recent.identity.ino !== before.identity.ino) throw new Error("current changed");
    choices.sort((a,b) => a.revision.localeCompare(b.revision));
    return result("available", before.revision, choices);
  } catch { return result("needs_attention", before.revision); }
}

export async function restoreNativeModelSelection(
  input: { stateDirectory: string; expectedRevision: string; backupRevision: string },
  confirm: (review: NativeRestoreReviewV1) => Promise<boolean>,
  fetchImpl: typeof fetch = fetch,
  options: FirstRunSetupOptions = {},
): Promise<NativeRestoreResultV1> {
  if (!input || !isRevision(input.expectedRevision) || !isRevision(input.backupRevision)
    || typeof confirm !== "function") throw new NativeSettingsUpdateError("unsafe");
  const before = await existingSettings(input.stateDirectory);
  if (before.revision !== input.expectedRevision) throw new NativeSettingsUpdateError("stale");
  const list = await inspectNativeRestoreChoices(before.directory);
  const chosen = list.status === "available"
    && list.currentRevision === before.revision
    ? list.choices.find(x => x.revision === input.backupRevision) : undefined;
  if (!chosen) throw new NativeSettingsUpdateError("unsafe");
  if (JSON.stringify(before.selection) === JSON.stringify(chosen.selection))
    throw new NativeSettingsUpdateError("unsafe");
  const preflight = async () => {
    try {
      const checked = await checkLocalProvider(chosen.selection, fetchImpl);
      if (!checked.ok || checked.code !== "ok") throw new Error("offline");
    } catch { throw new NativeSettingsUpdateError("unavailable"); }
  };
  await preflight();
  const next: ProductConfigFileV1 = structuredClone(before.config);
  next.provider = { ...chosen.selection }; // current runtime + daemon remain authoritative
  await resolveProductConfigSource("restore-preview", {}, async () => JSON.stringify(next));
  const unsupported = async () => { throw new NativeSettingsUpdateError("unsafe"); };
  const service = new FirstRunSetupService({
    async writeConfig(payload) {
      if (payload.targetPath !== before.file ||
        JSON.stringify(payload.config) !== JSON.stringify(next))
        throw new NativeSettingsUpdateError("unsafe");
      const currentList = await inspectNativeRestoreChoices(before.directory);
      if (currentList.currentRevision !== before.revision || currentList.status !== "available"
        || !currentList.choices.some(x => x.revision === chosen.revision
          && JSON.stringify(x.selection) === JSON.stringify(chosen.selection)))
        throw new NativeSettingsUpdateError("stale");
      await preflight(); // never restore a provider that went offline after review
      await commitRevision(before, next); // same proven fixed-directory writer as M19D2
    },
    registerProject: unsupported, registerWorkspace: unsupported,
    startLoopbackDaemon: unsupported,
  }, options);
  const preview = await service.preview({
    schemaVersion: 1, action: "write_config",
    payload: { targetPath: before.file, config: next },
  });
  const approved = await confirm(Object.freeze({
    schemaVersion: 1, kind: "settings-restore-review", action: "restore_provider",
    destination: "local_app_data_config", currentRevision: before.revision,
    selectedBackupRevision: chosen.revision, selection: { ...chosen.selection },
    expiresAt: preview.expiresAt, requiresExactReply: "RESTORE CONFIG",
    grantsAuthority: false,
  }));
  if (!approved) return Object.freeze({
    schemaVersion: 1, kind: "settings-restore-result", outcome: "cancelled",
    currentVersionPreserved: true, configSaved: false, grantsAuthority: false,
  });
  try {
    await service.execute({ action: "write_config",
      payloadDigest: preview.payloadDigest, confirmationToken: preview.confirmationToken,
      confirmed: true });
  } catch { throw new NativeSettingsUpdateError("write_failed"); }
  return Object.freeze({
    schemaVersion: 1, kind: "settings-restore-result", outcome: "restored",
    currentVersionPreserved: true, configSaved: true, grantsAuthority: false,
  });
}
