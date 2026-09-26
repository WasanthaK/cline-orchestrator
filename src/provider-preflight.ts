import type { ProviderPreflightResult, WorkerConfig } from "./types.js";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function rootBaseUrl(value: string | undefined): string {
  const base = stripTrailingSlash(value || "http://localhost:11434");
  return base.replace(/\/(?:v1|api)$/i, "");
}

function boundedModels(models: string[]): string[] {
  return Array.from(new Set(models.filter(Boolean))).slice(0, 50);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchJson(
  endpoint: string,
  timeoutMs: number,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ response: Response; payload: any; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Provider preflight timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const started = Date.now();

  try {
    const response = await fetchImpl(endpoint, {
      ...init,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    return { response, payload, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightProvider(
  worker: WorkerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderPreflightResult> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = Math.max(250, worker.preflightTimeoutMs || 5000);

  if (worker.providerId === "ollama") {
    const endpoint = `${rootBaseUrl(worker.baseUrl)}/api/tags`;
    try {
      const { response, payload, latencyMs } = await fetchJson(
        endpoint,
        timeoutMs,
        {},
        fetchImpl,
      );
      if (!response.ok) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "provider_unreachable",
          message: `Ollama metadata request failed with HTTP ${response.status}`,
          endpoint,
          latencyMs,
        };
      }

      if (!Array.isArray(payload?.models)) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "invalid_response",
          message: "Ollama /api/tags response did not contain a models array",
          endpoint,
          latencyMs,
        };
      }

      const models = boundedModels(
        payload.models.flatMap((model: any) => [String(model?.name ?? ""), String(model?.model ?? "")]),
      );
      if (!models.includes(worker.modelId)) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "model_not_found",
          message: `Configured Ollama model '${worker.modelId}' is not installed`,
          endpoint,
          latencyMs,
          availableModels: models,
        };
      }

      return {
        checkedAt,
        ok: true,
        supported: true,
        providerId: worker.providerId,
        modelId: worker.modelId,
        code: "ok",
        message: "Ollama is reachable and the configured model is installed",
        endpoint,
        latencyMs,
        availableModels: models,
      };
    } catch (error) {
      return {
        checkedAt,
        ok: false,
        supported: true,
        providerId: worker.providerId,
        modelId: worker.modelId,
        code: "provider_unreachable",
        message: errorMessage(error),
        endpoint,
      };
    }
  }

  if (worker.providerId === "openai-compatible") {
    const base = stripTrailingSlash(worker.baseUrl || "");
    const endpoint = `${base}/models`;
    const headers: Record<string, string> = {};
    if (worker.apiKey) headers.authorization = `Bearer ${worker.apiKey}`;

    try {
      const { response, payload, latencyMs } = await fetchJson(
        endpoint,
        timeoutMs,
        { headers },
        fetchImpl,
      );
      if (!response.ok) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "provider_unreachable",
          message: `OpenAI-compatible metadata request failed with HTTP ${response.status}`,
          endpoint,
          latencyMs,
        };
      }

      if (!Array.isArray(payload?.data)) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "invalid_response",
          message: "OpenAI-compatible /models response did not contain a data array",
          endpoint,
          latencyMs,
        };
      }

      const models = boundedModels(payload.data.map((model: any) => String(model?.id ?? "")));
      if (!models.includes(worker.modelId)) {
        return {
          checkedAt,
          ok: false,
          supported: true,
          providerId: worker.providerId,
          modelId: worker.modelId,
          code: "model_not_found",
          message: `Configured model '${worker.modelId}' was not reported by the provider`,
          endpoint,
          latencyMs,
          availableModels: models,
        };
      }

      return {
        checkedAt,
        ok: true,
        supported: true,
        providerId: worker.providerId,
        modelId: worker.modelId,
        code: "ok",
        message: "Provider is reachable and the configured model is available",
        endpoint,
        latencyMs,
        availableModels: models,
      };
    } catch (error) {
      return {
        checkedAt,
        ok: false,
        supported: true,
        providerId: worker.providerId,
        modelId: worker.modelId,
        code: "provider_unreachable",
        message: errorMessage(error),
        endpoint,
      };
    }
  }

  return {
    checkedAt,
    ok: true,
    supported: false,
    providerId: worker.providerId,
    modelId: worker.modelId,
    code: "unsupported_provider",
    message: `No metadata-only preflight is implemented for provider '${worker.providerId}'; admission is unchanged`,
  };
}
