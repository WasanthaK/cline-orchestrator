import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolveProductConfig, type ProductConfigEnvironment, type ResolvedProductConfigV1 } from "./product-config.js";

export const PRODUCT_CONFIG_SOURCE_CONTRACT = Object.freeze({
  explicitFileSelectionOnly: true,
  maxFileBytes: 65_536,
  environmentOverridesFile: true,
  readOnly: true,
  usesSecretMaterial: false,
  grantsAuthority: false,
});

export class ProductConfigSourceError extends Error {
  constructor(public readonly code: "file_invalid" | "file_unreadable" | "json_invalid" | "config_invalid") {
    super({
      file_invalid: "Selected product configuration file is invalid or exceeds the size limit",
      file_unreadable: "Selected product configuration file could not be read",
      json_invalid: "Selected product configuration file is not valid JSON",
      config_invalid: "Product configuration is invalid; check schema, field types and secret references",
    }[code]);
    this.name = "ProductConfigSourceError";
  }
}

export async function readProductConfigFile(filePath: string): Promise<string> {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > PRODUCT_CONFIG_SOURCE_CONTRACT.maxFileBytes) {
      throw new ProductConfigSourceError("file_invalid");
    }
    const buffer = Buffer.alloc(PRODUCT_CONFIG_SOURCE_CONTRACT.maxFileBytes + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > PRODUCT_CONFIG_SOURCE_CONTRACT.maxFileBytes) throw new ProductConfigSourceError("file_invalid");
    return buffer.subarray(0, used).toString("utf8");
  } catch (error) {
    if (error instanceof ProductConfigSourceError) throw error;
    throw new ProductConfigSourceError("file_unreadable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateShape(input: unknown): void {
  const invalid = () => { throw new ProductConfigSourceError("config_invalid"); };
  if (!plain(input) || input.schemaVersion !== 1) return invalid();
  if (Object.keys(input).some((key) => !["schemaVersion", "provider", "runtime", "daemon"].includes(key))) return invalid();
  const fieldTypes: Record<string, Record<string, "string" | "number" | "boolean">> = {
    provider: { providerId: "string", modelId: "string", baseUrl: "string", apiKeySecretRef: "string" },
    daemon: { host: "string", port: "number", url: "string" },
    runtime: {
      contextWindow: "number", maxInputTokens: "number", maxTokensPerTurn: "number",
      contextRotateAtTokens: "number", maxContextRotations: "number", reasoningEffort: "string",
      timeoutMs: "number", preflightTimeoutMs: "number", validationTimeoutMs: "number",
      maxValidationOutputChars: "number", maxValidationRepairs: "number",
      checkpointMaxUntrackedFiles: "number", checkpointMaxUntrackedBytes: "number",
      maxIterations: "number", stallTimeoutMs: "number", maxRetries: "number", retryDelayMs: "number",
      autoApproveCommands: "boolean", autoApproveEdits: "boolean",
    },
  };
  for (const [section, types] of Object.entries(fieldTypes)) {
    const value = input[section];
    if (value === undefined) continue;
    if (!plain(value)) return invalid();
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(types, key) || typeof item !== types[key]) return invalid();
      if (typeof item === "number" && (!Number.isSafeInteger(item) || item < 0)) return invalid();
      if (typeof item === "number") {
        const minimum = ["contextWindow", "maxInputTokens", "maxTokensPerTurn", "port"].includes(key) ? 1
          : key === "preflightTimeoutMs" ? 250
          : ["validationTimeoutMs", "maxValidationOutputChars"].includes(key) ? 1000 : 0;
        if (item < minimum || (key === "port" && item > 65535)) return invalid();
      }
      if (["baseUrl", "url"].includes(key) && typeof item === "string") {
        try {
          const url = new URL(item);
          if (url.username || url.password) return invalid();
        } catch { return invalid(); }
      }
    }
  }
}

export async function resolveProductConfigSource(
  filePath: string | undefined,
  env: ProductConfigEnvironment,
  reader: (filePath: string) => Promise<string> = readProductConfigFile,
): Promise<ResolvedProductConfigV1> {
  let input: unknown = { schemaVersion: 1 };
  if (filePath !== undefined) {
    if (typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) {
      throw new ProductConfigSourceError("file_invalid");
    }
    let text: string;
    try { text = await reader(filePath); }
    catch (error) {
      if (error instanceof ProductConfigSourceError) throw error;
      throw new ProductConfigSourceError("file_unreadable");
    }
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > PRODUCT_CONFIG_SOURCE_CONTRACT.maxFileBytes) {
      throw new ProductConfigSourceError("file_invalid");
    }
    try { input = JSON.parse(text); }
    catch { throw new ProductConfigSourceError("json_invalid"); }
    validateShape(input);
  }
  try { return resolveProductConfig(input, env); }
  catch { throw new ProductConfigSourceError("config_invalid"); }
}
