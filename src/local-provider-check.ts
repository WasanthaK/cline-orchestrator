import { resolveProductConfig } from "./product-config.js";
import { preflightProvider } from "./provider-preflight.js";
import type { ProviderPreflightResult, WorkerConfig } from "./types.js";

/**
 * M19C1 is an opt-in, metadata-only local provider preflight for the native
 * first-run window. It creates no config, task, listener, model or credentials.
 * No arbitrary URL/DNS redirects or external-provider requests are accepted.
 */
export const LOCAL_PROVIDER_CHECK_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  networkScope: "literal_loopback_only" as const,
  metadataOnly: true as const,
  writesConfig: false as const,
  startsModel: false as const,
  registersWorkspace: false as const,
  grantsAuthority: false as const,
});

export class LocalProviderCheckError extends Error {
  constructor() {
    super("Local provider check requires a supported model ID and loopback /v1 HTTP endpoint");
    this.name = "LocalProviderCheckError";
  }
}

export interface LocalProviderCheckResultV1 {
  schemaVersion: 1;
  command: "check-provider";
  checkedAt: string;
  ok: boolean;
  supported: true;
  code: ProviderPreflightResult["code"];
  availableModels: string[];
  latencyMs?: number;
  readOnly: true;
  configSaved: false;
  modelStarted: false;
  grantsAuthority: false;
}

const safeModel = /^[A-Za-z0-9_.:\/-]{1,160}$/;

export async function checkLocalProvider(
  input: { providerId: string; modelId: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderCheckResultV1> {
  if (!input || !["openai-compatible", "ollama-openai"].includes(input.providerId)
    || !safeModel.test(input.modelId)
    || typeof input.baseUrl !== "string" || input.baseUrl.length > 250) {
    throw new LocalProviderCheckError();
  }
  let url: URL;
  try { url = new URL(input.baseUrl); }
  catch { throw new LocalProviderCheckError(); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || url.search || url.hash
    || url.pathname !== "/v1") {
    throw new LocalProviderCheckError();
  }
  let config;
  try {
    config = resolveProductConfig({ schemaVersion: 1, provider: {
      providerId: "openai-compatible", modelId: input.modelId, baseUrl: url.href,
    }, runtime: { preflightTimeoutMs: 4000 } });
  } catch { throw new LocalProviderCheckError(); }
  const worker: WorkerConfig = {
    ...config.runtime,
    providerId: "openai-compatible",
    modelId: config.provider.modelId,
    baseUrl: config.provider.baseUrl,
  };
  let observation: ProviderPreflightResult;
  try {
    observation = await preflightProvider(worker, (resource, options) =>
      fetchImpl(resource, { ...options, redirect: "error", credentials: "omit" }));
  } catch {
    // No transport error/path/model/user inputs should escape this boundary.
    throw new LocalProviderCheckError();
  }
  // Never expose the upstream endpoint/error message, even when supplied by
  // a malicious loopback process. IDs are bounded to simple literal text.
  const models = (observation.availableModels ?? [])
    .filter(x => safeModel.test(x)).slice(0, 50);
  return Object.freeze({
    schemaVersion: 1, command: "check-provider",
    checkedAt: observation.checkedAt,
    ok: observation.ok === true && observation.supported === true,
    supported: true,
    code: observation.code,
    availableModels: models,
    ...(typeof observation.latencyMs === "number"
      && Number.isFinite(observation.latencyMs)
      && observation.latencyMs >= 0 ? { latencyMs: observation.latencyMs } : {}),
    readOnly: true,
    configSaved: false,
    modelStarted: false,
    grantsAuthority: false,
  });
}
