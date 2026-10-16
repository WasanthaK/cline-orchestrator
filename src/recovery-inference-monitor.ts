/**
 * M19R2A: explicitly invoked read-only, loopback-only inference observations.
 * Optional server metrics are never used as proof of Cline task progress.
 * No model names, endpoints, raw responses, prompts, or credentials in receipts.
 */
export type InferenceBackend = "llama.cpp" | "ollama" | "vllm" | "openai-compatible";
export interface InferenceProbeConfigV1 {
  schemaVersion: 1;
  backend: InferenceBackend;
  baseUrl: string;
}
export interface InferenceSnapshotV1 {
  schemaVersion: 1;
  backend: InferenceBackend;
  availability: "available" | "unavailable" | "unknown";
  telemetry: "available" | "unavailable" | "unsupported";
  latencyMs?: number;
  loadedModelCount?: number;
  activeRequests?: number;
  queueDepth?: number;
  generationTokensTotal?: number;
  kvCacheUsageRatio?: number;
  readOnly: true;
  grantsAuthority: false;
}
export interface ClineProgressEvidenceV1 {
  schemaVersion: 1;
  source: "trusted_cline_runner";
  state: "running" | "waiting_for_human" | "completed" | "unknown";
  observedAtMs: number;
  lastActivityAtMs?: number;
  /** Completed tool/checkpoint/validation proof, not mere token generation. */
  lastVerifiedProgressAtMs?: number;
  activeTool?: boolean;
  watchdogStallVerified?: boolean;
}
export interface ClineInferenceCorrelationV1 {
  schemaVersion: 1;
  classification: "verified_progress" | "activity_unverified" |
    "backend_busy_without_cline_progress" | "tool_in_flight" |
    "watchdog_stall_verified" | "waiting_for_human" | "completed" |
    "insufficient_evidence";
  inferenceBusy: boolean | null;
  retryAuthorized: false;
  skipExecutionPermitted: false;
  grantsAuthority: false;
}

const MAX_BYTES = 128 * 1024;
const MAX_DURATION_MS = 15_000;
const MAX_COUNT = 1_000_000;
const backends: readonly InferenceBackend[] =
  ["llama.cpp", "ollama", "vllm", "openai-compatible"];

function probeBase(config: InferenceProbeConfigV1): string {
  if (!config || config.schemaVersion !== 1 || !backends.includes(config.backend)
    || typeof config.baseUrl !== "string" || config.baseUrl.length > 250) {
    throw new Error("invalid_probe_config");
  }
  let url: URL;
  try { url = new URL(config.baseUrl); }
  catch { throw new Error("invalid_probe_config"); }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || url.search || url.hash
    || !["/", "/v1"].includes(path)) {
    throw new Error("invalid_probe_config");
  }
  return url.origin;
}

type ProbeResponse = { ok: boolean; status: number; text: string; latencyMs: number };
async function readMetadata(
  endpoint: string, fetchImpl: typeof fetch, timeoutMs: number,
): Promise<ProbeResponse> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { accept: "application/json, text/plain" },
      signal: abort.signal,
    });
    // A response with no body cannot be interpreted as a successful probe.
    if (!response.body) throw new Error("empty_probe_body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error("probe_response_too_large");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    return {
      ok: response.ok, status: response.status, text,
      latencyMs: Math.max(0, Date.now() - started),
    };
  } finally { clearTimeout(timer); }
}

function finiteCount(value: unknown, max = MAX_COUNT): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= 0 && value <= max;
}
function metricValues(text: string, allow: readonly string[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const rawLine of text.split("\n")) {
    if (rawLine.length > 2048 || rawLine.startsWith("#")) continue;
    const match = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{[^}]{0,1024}\})?\s+([+]?[\d.]+(?:[eE][+-]?\d+)?)\s*$/.exec(rawLine.trim());
    if (!match || !allow.includes(match[1])) continue;
    const value = Number(match[2]);
    if (!finiteCount(value, 1_000_000_000_000)) continue;
    const previous = values.get(match[1]) ?? 0;
    // Multiple model labels may produce distinct series; sum bounded counts.
    if (finiteCount(previous + value, 1_000_000_000_000)) {
      values.set(match[1], previous + value);
    }
  }
  return values;
}
function metricNumber(values: Map<string, number>, key: string, max = MAX_COUNT): number | undefined {
  const n = values.get(key);
  return finiteCount(n, max) ? n : undefined;
}
function noData(backend: InferenceBackend, availability: InferenceSnapshotV1["availability"]): InferenceSnapshotV1 {
  return Object.freeze({
    schemaVersion: 1, backend, availability,
    telemetry: backend === "ollama" || backend === "openai-compatible" ? "unsupported" : "unavailable",
    readOnly: true, grantsAuthority: false,
  });
}
function validJsonArray(text: string, key: "models" | "data"): number | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const items = (value as Record<string, unknown>)[key];
    if (!Array.isArray(items) || items.length > 1000
      || !items.every(item => item && typeof item === "object" && !Array.isArray(item))) return undefined;
    return items.length;
  } catch { return undefined; }
}

/** Caller opts in and provides an already selected literal-loopback target. */
export async function probeInferenceBackend(
  config: InferenceProbeConfigV1,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<InferenceSnapshotV1> {
  // Fail closed before any fetch, even if a caller passes a custom transport.
  const base = probeBase(config);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > MAX_DURATION_MS) {
    throw new Error("invalid_probe_timeout");
  }
  const backend = config.backend;
  const statusPath = backend === "ollama" ? "/api/ps"
    : backend === "llama.cpp" ? "/health" : "/v1/models";
  let primary: ProbeResponse;
  try { primary = await readMetadata(base + statusPath, fetchImpl, timeoutMs); }
  catch { return noData(backend, "unavailable"); }
  if (!primary.ok) return noData(backend, primary.status === 401 || primary.status === 403 ? "unknown" : "unavailable");
  const count = backend === "ollama" ? validJsonArray(primary.text, "models")
    : backend === "llama.cpp" ? 0 : validJsonArray(primary.text, "data");
  if (count === undefined) return noData(backend, "unknown");
  const baseline: InferenceSnapshotV1 = {
    schemaVersion: 1, backend, availability: "available",
    telemetry: backend === "ollama" || backend === "openai-compatible" ? "unsupported" : "unavailable",
    latencyMs: primary.latencyMs,
    ...(backend === "ollama" ? { loadedModelCount: count } : {}),
    readOnly: true, grantsAuthority: false,
  };
  if (backend !== "llama.cpp" && backend !== "vllm") return Object.freeze(baseline);
  // Metrics are optional. Missing/disabled/broken metrics do not imply a hang.
  let metrics: ProbeResponse;
  try { metrics = await readMetadata(base + "/metrics", fetchImpl, timeoutMs); }
  catch { return Object.freeze(baseline); }
  if (!metrics.ok) return Object.freeze(baseline);
  const prefix = backend === "llama.cpp" ? "llamacpp:" : "vllm:";
  const activeKey = prefix + (backend === "llama.cpp" ? "requests_processing" : "num_requests_running");
  const queueKey = prefix + (backend === "llama.cpp" ? "requests_deferred" : "num_requests_waiting");
  const genKey = prefix + (backend === "llama.cpp" ? "tokens_predicted_total" : "generation_tokens_total");
  const kvKey = prefix + (backend === "llama.cpp" ? "kv_cache_usage_ratio" : "kv_cache_usage_perc");
  const values = metricValues(metrics.text, [activeKey, queueKey, genKey, kvKey]);
  if (values.size === 0) return Object.freeze(baseline);
  const activeRequests = metricNumber(values, activeKey);
  const queueDepth = metricNumber(values, queueKey);
  const generationTokensTotal = metricNumber(values, genKey, 1_000_000_000_000);
  const kv = metricNumber(values, kvKey, 1);
  return Object.freeze({
    ...baseline, telemetry: "available",
    ...(activeRequests !== undefined ? { activeRequests } : {}),
    ...(queueDepth !== undefined ? { queueDepth } : {}),
    ...(generationTokensTotal !== undefined ? { generationTokensTotal } : {}),
    ...(kv !== undefined ? { kvCacheUsageRatio: kv } : {}),
  });
}

function timestamp(value: unknown, nowMs: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= nowMs;
}
/**
 * Cline is progressing only if independent trusted tool/checkpoint/validation
 * evidence advances. A busy inference server is never sufficient proof.
 */
export function correlateClineInference(
  cline: unknown, backend: InferenceSnapshotV1 | undefined,
  nowMs: number, stallThresholdMs = 90_000,
): ClineInferenceCorrelationV1 {
  const observed = cline && typeof cline === "object" ? cline as Partial<ClineProgressEvidenceV1> : {};
  const backendBusy = backend?.availability === "available"
    && backend.telemetry === "available" && finiteCount(backend.activeRequests)
      ? backend.activeRequests! > 0 : null;
  let classification: ClineInferenceCorrelationV1["classification"] = "insufficient_evidence";
  if (Number.isSafeInteger(nowMs) && nowMs >= 0
    && Number.isSafeInteger(stallThresholdMs) && stallThresholdMs >= 1000 && stallThresholdMs <= 900_000
    && observed.schemaVersion === 1 && observed.source === "trusted_cline_runner"
    && timestamp(observed.observedAtMs, nowMs)
    && ["running", "waiting_for_human", "completed", "unknown"].includes(observed.state ?? "")) {
    if (observed.state === "waiting_for_human") classification = "waiting_for_human";
    else if (observed.state === "completed") classification = "completed";
    else if (observed.state === "running") {
      const recentProgress = timestamp(observed.lastVerifiedProgressAtMs, observed.observedAtMs!)
        && nowMs - observed.lastVerifiedProgressAtMs! <= stallThresholdMs;
      const recentActivity = timestamp(observed.lastActivityAtMs, observed.observedAtMs!)
        && nowMs - observed.lastActivityAtMs! <= stallThresholdMs;
      if (recentProgress) classification = "verified_progress";
      else if (observed.activeTool === true) classification = "tool_in_flight";
      else if (recentActivity) classification = "activity_unverified";
      else if (observed.watchdogStallVerified === true
        && observed.activeTool === false
        && timestamp(observed.lastActivityAtMs, observed.observedAtMs!)
        && nowMs - observed.lastActivityAtMs! > stallThresholdMs) {
        classification = "watchdog_stall_verified";
      } else if (backendBusy === true) classification = "backend_busy_without_cline_progress";
    }
  }
  return Object.freeze({
    schemaVersion: 1, classification, inferenceBusy: backendBusy,
    retryAuthorized: false, skipExecutionPermitted: false, grantsAuthority: false,
  });
}
