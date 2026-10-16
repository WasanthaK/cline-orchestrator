import crypto from "node:crypto";
import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { inspectNativeSettings } from "./native-settings-update.js";
import { readProductConfigFile, resolveProductConfigSource } from "./product-config-source.js";

/**
 * M19D3A: read-only recovery provenance. A backup filename is NOT proof of
 * safety. Every candidate must be checked without executing or restoring it.
 */
export const NATIVE_SETTINGS_RECOVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  fixedUserStateOnly: true as const,
  readOnly: true as const,
  maxVersions: 32 as const,
  requiresVerifiedCurrentSettings: true as const,
  verifiesExactBackupDigest: true as const,
  browserMutationRoute: false as const,
  noRestoreAction: true as const,
  startsTask: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

export interface NativeRecoveryInspectionV1 {
  schemaVersion: 1;
  command: "recovery-desktop";
  status: "no_previous_version" | "verified_versions" | "needs_attention" | "unavailable";
  verifiedCount: number | null;
  restorationAvailable: false;
  readOnly: true;
  grantsAuthority: false;
}

const BACKUP = /^config\.previous-([a-f0-9]{64})\.json$/;
const SHA = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function verifyBackup(
  absolutePath: string, expected: string,
): Promise<boolean> {
  try {
    const before = await lstat(absolutePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 2 || before.size > 65_536) return false;
    const raw = await readProductConfigFile(absolutePath);
    const after = await lstat(absolutePath);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || SHA(raw) !== expected) return false;

    const config: unknown = JSON.parse(raw);
    if (!config || typeof config !== "object" || Array.isArray(config)) return false;
    const doc = config as Record<string, unknown>;
    if (doc.schemaVersion !== 1
      || !doc.provider || typeof doc.provider !== "object" || Array.isArray(doc.provider))
      return false;
    const selection = doc.provider as Record<string, unknown>;
    if (!["openai-compatible", "ollama-openai"].includes(String(selection.providerId))
      || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(String(selection.modelId))
      || typeof selection.baseUrl !== "string" || selection.baseUrl.length > 250
      || selection.apiKeySecretRef !== undefined) return false;
    const endpoint = new URL(selection.baseUrl);
    if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname)
      || !endpoint.port || endpoint.pathname !== "/v1" || endpoint.search
      || endpoint.hash || endpoint.username || endpoint.password) return false;
    const resolved = await resolveProductConfigSource("recovery-verify", {}, async () => raw);
    if (resolved.runtime.autoApproveCommands || resolved.runtime.autoApproveEdits
      || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(resolved.daemon.host))
      return false;
    return true;
  } catch { return false; }
}

export async function inspectNativeSettingsRecovery(
  stateDirectory: string,
): Promise<NativeRecoveryInspectionV1> {
  const result = (
    status: NativeRecoveryInspectionV1["status"], verifiedCount: number | null,
  ): NativeRecoveryInspectionV1 => Object.freeze({
    schemaVersion: 1, command: "recovery-desktop",
    status, verifiedCount, restorationAvailable: false,
    readOnly: true, grantsAuthority: false,
  });
  if (typeof stateDirectory !== "string" || !path.isAbsolute(stateDirectory)
    || stateDirectory.includes("\0")) return result("unavailable", null);

  // The same trusted M19D2 policy validation must pass for the CURRENT file,
  // independently of the presence or contents of any saved previous version.
  const current = await inspectNativeSettings(stateDirectory);
  if (current.status !== "configured") return result("unavailable", null);
  const dir = path.resolve(stateDirectory);
  try {
    const parent = await lstat(dir);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      return result("unavailable", null);
    const entries = await readdir(dir, { withFileTypes: true });
    const matching = entries.filter(e => e.name.startsWith("config.previous-"));
    if (matching.length > NATIVE_SETTINGS_RECOVERY_CONTRACT.maxVersions)
      return result("needs_attention", null);
    for (const entry of matching) {
      const expected = BACKUP.exec(entry.name)?.[1];
      // Do not treat malformed names, symlinks or subdirectories as backups.
      if (!expected || !entry.isFile()
        || !await verifyBackup(path.join(dir, entry.name), expected))
        return result("needs_attention", null);
    }
    return result(matching.length ? "verified_versions" : "no_previous_version", matching.length);
  } catch {
    // File system access errors and inconsistent directory state are unknown,
    // never "zero backups".
    return result("needs_attention", null);
  }
}
