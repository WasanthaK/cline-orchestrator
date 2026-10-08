import crypto from "node:crypto";
import path from "node:path";
import { realpath, lstat, open, link, unlink } from "node:fs/promises";
import { FirstRunSetupService, type FirstRunSetupOptions, type FirstRunSetupResultV1 } from "./first-run-setup.js";
import { resolveProductConfigSource } from "./product-config-source.js";

export class ConfigWriteSetupError extends Error {
  constructor(public readonly code: "target_invalid" | "target_exists" | "write_failed") {
    super(code === "target_exists" ? "Config destination already exists; choose a new file"
      : code === "target_invalid" ? "Config destination must be a new JSON file in an existing directory"
      : "Config file could not be created");
    this.name = "ConfigWriteSetupError";
  }
}

export interface ConfigWriteReview {
  targetPath: string;
  config: unknown;
  confirmationText: string;
  expiresAt: string;
}

export async function runConfigWriteSetup(
  targetInput: string,
  configInput: unknown,
  confirm: (review: ConfigWriteReview) => Promise<boolean>,
  options: FirstRunSetupOptions = {},
): Promise<{ written: boolean; result?: FirstRunSetupResultV1; grantsAuthority: false }> {
  const config = structuredClone(configInput);
  await resolveProductConfigSource("setup-preview", {}, async () => JSON.stringify(config));
  if (!targetInput || targetInput.includes("\0") || !path.basename(targetInput).endsWith(".json")) {
    throw new ConfigWriteSetupError("target_invalid");
  }
  const requested = path.resolve(targetInput);
  let parent: string;
  let parentIdentity: { dev: number; ino: number };
  try {
    parent = await realpath(path.dirname(requested));
    const stat = await lstat(parent);
    if (!stat.isDirectory()) throw new Error("not a directory");
    parentIdentity = { dev: stat.dev, ino: stat.ino };
  } catch { throw new ConfigWriteSetupError("target_invalid"); }
  const target = path.join(parent, path.basename(requested));
  try {
    await lstat(target);
    throw new ConfigWriteSetupError("target_exists");
  } catch (error) {
    if (error instanceof ConfigWriteSetupError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigWriteSetupError("target_invalid");
  }
  const checkParent = async () => {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.dev !== parentIdentity.dev || stat.ino !== parentIdentity.ino) {
      throw new ConfigWriteSetupError("target_invalid");
    }
  };
  const unsupported = async () => { throw new ConfigWriteSetupError("write_failed"); };
  const service = new FirstRunSetupService({
    async writeConfig(payload) {
      if (payload.targetPath !== target) throw new ConfigWriteSetupError("target_invalid");
      await resolveProductConfigSource("setup-execute", {}, async () => JSON.stringify(payload.config));
      const content = JSON.stringify(payload.config, null, 2) + "\n";
      let temporary: string | undefined;
      try {
        await checkParent();
        const candidate = path.join(parent, ".config-" + crypto.randomBytes(16).toString("hex") + ".tmp");
        const handle = await open(candidate, "wx", 0o600);
        temporary = candidate;
        try { await handle.writeFile(content, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        await checkParent();
        // Atomic create-only publication. An existing file/symlink always wins.
        await link(temporary, target);
      } catch {
        throw new ConfigWriteSetupError("write_failed");
      } finally {
        if (temporary) await unlink(temporary).catch(() => undefined);
      }
    },
    registerProject: unsupported,
    registerWorkspace: unsupported,
    startLoopbackDaemon: unsupported,
  }, options);
  const preview = await service.preview({
    schemaVersion: 1, action: "write_config", payload: { targetPath: target, config },
  });
  const accepted = await confirm({
    targetPath: target, config: structuredClone(config),
    confirmationText: preview.confirmationText, expiresAt: preview.expiresAt,
  });
  if (accepted !== true) return { written: false, grantsAuthority: false };
  const result = await service.execute({
    action: "write_config", payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true,
  });
  return { written: true, result, grantsAuthority: false };
}
