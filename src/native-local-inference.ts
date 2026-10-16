import { checkLocalProvider, LocalProviderCheckError } from "./local-provider-check.js";

/**
 * M19E4C — one manually requested harmless local inference, not a Cline task.
 * Endpoint/alias policy is inherited from the fail-closed metadata checker.
 * Raw prompt, model output, response bodies, paths and credentials are never
 * returned to the native UI or emitted in a public receipt.
 */
export const NATIVE_INFERENCE_PROBE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  optInNativeAction: true as const,
  literalLoopbackOnly: true as const,
  fixedHarmlessPrompt: true as const,
  maxOutputTokens: 12 as const,
  maxResponseBytes: 8192 as const,
  readsOrWritesOperatorFiles: false as const,
  savesConfig: false as const,
  startsModel: false as const,
  startsTask: false as const,
  startsDaemon: false as const,
  browserMutation: false as const,
  provesRealModelAuthenticity: false as const,
  grantsAuthority: false as const,
});

export type InferenceProbeStatus = "response_observed" | "metadata_not_ready" |
  "provider_unavailable" | "invalid_response";

export interface NativeInferenceProbeV1 {
  schemaVersion: 1;
  command: "test-local-inference";
  status: InferenceProbeStatus;
  inferenceResponseObserved: boolean;
  modelAuthenticityVerified: false;
  configSaved: false;
  taskStarted: false;
  modelStarted: false;
  grantsAuthority: false;
}

const response = (status: InferenceProbeStatus): NativeInferenceProbeV1 => Object.freeze({
  schemaVersion: 1, command: "test-local-inference",
  status, inferenceResponseObserved: status === "response_observed",
  modelAuthenticityVerified: false, configSaved: false,
  taskStarted: false, modelStarted: false, grantsAuthority: false,
});

async function readBoundedJson(res: Response): Promise<unknown> {
  if (!res.body || !(res.headers.get("content-type") ?? "").toLowerCase()
    .includes("application/json")) throw new Error("unsupported response");
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > NATIVE_INFERENCE_PROBE_CONTRACT.maxResponseBytes)
        throw new Error("oversized response");
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function testLocalInference(
  input: { providerId: string; modelId: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<NativeInferenceProbeV1> {
  // The same strict validation used by native model setup rejects remote URLs,
  // redirects, credentials, query strings, arbitrary paths, or model aliases.
  let preflight;
  try { preflight = await checkLocalProvider(input, fetchImpl); }
  catch (error) {
    if (error instanceof LocalProviderCheckError) throw error;
    return response("metadata_not_ready");
  }
  if (!preflight.ok || !preflight.availableModels.includes(input.modelId))
    return response("metadata_not_ready");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetchImpl(input.baseUrl + "/chat/completions", {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: input.modelId, stream: false, max_tokens: 12,
        temperature: 0,
        messages: [{ role: "user", content: "Reply with a short greeting." }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return response("provider_unavailable");
    let json: unknown;
    try { json = await readBoundedJson(res); }
    catch { return response("invalid_response"); }
    if (!json || typeof json !== "object" || Array.isArray(json))
      return response("invalid_response");
    const root = json as Record<string, unknown>;
    if (!Array.isArray(root.choices) || root.choices.length < 1)
      return response("invalid_response");
    const first = root.choices[0];
    if (!first || typeof first !== "object") return response("invalid_response");
    const message = (first as { message?: { content?: unknown } }).message;
    const content = message?.content;
    if (typeof content !== "string" || !content.trim() || content.length > 1024)
      return response("invalid_response");
    return response("response_observed");
  } catch { return response("provider_unavailable"); }
  finally { clearTimeout(timeout); }
}
