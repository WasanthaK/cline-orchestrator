import assert from "node:assert/strict";
import test from "node:test";
import {
  probeInferenceBackend, correlateClineInference,
  type InferenceProbeConfigV1, type ClineProgressEvidenceV1,
} from "./recovery-inference-monitor.js";

const make = (backend: InferenceProbeConfigV1["backend"], baseUrl = "http://127.0.0.1:8080/v1"): InferenceProbeConfigV1 =>
  ({ schemaVersion: 1, backend, baseUrl });
const mock = (routes: Record<string, { status?: number; body: string }>, seen: string[]) =>
  (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    const route = routes[new URL(String(url)).pathname] ?? { status: 404, body: "not found" };
    return new Response(route.body, { status: route.status ?? 200 });
  }) as typeof fetch;

test("M19R2A llama.cpp metrics are optional and counters stay sanitized", async () => {
  const seen: string[] = [];
  const result = await probeInferenceBackend(make("llama.cpp"), mock({
    "/health": { body: '{"status":"ok"}' },
    "/metrics": { body: [
      "# HELP llamacpp:requests_processing active",
      "llamacpp:requests_processing 1",
      "llamacpp:requests_deferred 2",
      "llamacpp:tokens_predicted_total 234",
      "llamacpp:kv_cache_usage_ratio 0.5",
      "sensitive_secret{token=\"canary\"} 100",
    ].join("\n") },
  }, seen));
  assert.deepEqual(seen.map(x => new URL(x).pathname), ["/health", "/metrics"]);
  assert.equal(result.activeRequests, 1);
  assert.equal(result.queueDepth, 2);
  assert.equal(result.generationTokensTotal, 234);
  assert.equal(result.kvCacheUsageRatio, 0.5);
  assert.equal(result.telemetry, "available");
  assert.doesNotMatch(JSON.stringify(result), /canary|secret|http|token/);
  const noMetrics = await probeInferenceBackend(make("llama.cpp"), mock({
    "/health": { body: "ok" }, "/metrics": { status: 501, body: "metrics disabled" },
  }, []));
  assert.equal(noMetrics.availability, "available");
  assert.equal(noMetrics.telemetry, "unavailable");
});

test("M19R2A Ollama /api/ps only reports loaded models, not active requests", async () => {
  const seen: string[] = [];
  const report = await probeInferenceBackend(make("ollama", "http://127.0.0.1:11434"), mock({
    "/api/ps": { body: '{"models":[{"name":"any"},{"name":"other"}]}' },
  }, seen));
  assert.equal(report.loadedModelCount, 2);
  assert.equal(report.availability, "available");
  assert.equal(report.telemetry, "unsupported");
  assert.equal(report.activeRequests, undefined);
  assert.deepEqual(seen.map(x => new URL(x).pathname), ["/api/ps"]);
});

test("M19R2A vLLM parses labelled Prometheus series without exporting labels", async () => {
  const report = await probeInferenceBackend(make("vllm"), mock({
    "/v1/models": { body: '{"data":[{"id":"model"}]}' },
    "/metrics": { body: [
      'vllm:num_requests_running{model_name="private-a"} 2',
      'vllm:num_requests_running{model_name="private-b"} 3',
      'vllm:num_requests_waiting{model_name="private-a"} 1',
      'vllm:generation_tokens_total{model_name="private-a"} 150',
      'vllm:kv_cache_usage_perc{model_name="private-a"} 0.75',
    ].join("\n") },
  }, []));
  assert.equal(report.activeRequests, 5);
  assert.equal(report.queueDepth, 1);
  assert.equal(report.generationTokensTotal, 150);
  assert.equal(report.kvCacheUsageRatio, 0.75);
  assert.doesNotMatch(JSON.stringify(report), /private-a|private-b|model_name/);
});

test("M19R2A OpenAI-compatible returns availability only", async () => {
  const seen: string[] = [];
  const result = await probeInferenceBackend(make("openai-compatible"), mock({
    "/v1/models": { body: '{"data":[]}' },
  }, seen));
  assert.equal(result.availability, "available");
  assert.equal(result.telemetry, "unsupported");
  assert.equal(result.activeRequests, undefined);
  assert.equal(seen.length, 1);
});

test("M19R2A disallows external, ambiguous or credentialed targets before fetch", async () => {
  for (const url of [
    "http://example.com:8080/v1", "http://localhost:8080/v1",
    "http://127.0.0.1:8080/v1?x=1", "http://user:pass@127.0.0.1:8080/v1",
    "https://127.0.0.1:8080/v1", "http://127.0.0.1:8080/admin",
    "http://127.0.0.1/v1",
  ]) {
    const seen: string[] = [];
    await assert.rejects(probeInferenceBackend(make("llama.cpp", url), mock({}, seen)),
      /invalid_probe_config/);
    assert.equal(seen.length, 0);
  }
});

test("M19R2A failures are fail-closed and never leak upstream error bodies", async () => {
  const seen: string[] = [];
  const unavailable = await probeInferenceBackend(make("ollama"), mock({
    "/api/ps": { status: 500, body: "secret-prompt-dump" },
  }, seen));
  assert.equal(unavailable.availability, "unavailable");
  assert.doesNotMatch(JSON.stringify(unavailable), /prompt|secret/);
  const bad = await probeInferenceBackend(make("ollama"), mock({
    "/api/ps": { body: '{"models":"bad"}' },
  }, []));
  assert.equal(bad.availability, "unknown");
  const huge = await probeInferenceBackend(make("llama.cpp"), mock({
    "/health": { body: "x".repeat(150000) },
  }, []));
  assert.equal(huge.availability, "unavailable");
});

const trusted: ClineProgressEvidenceV1 = {
  schemaVersion: 1, source: "trusted_cline_runner", state: "running",
  observedAtMs: 200000, lastActivityAtMs: 10000,
  lastVerifiedProgressAtMs: 10000, activeTool: false,
};
test("M19R2A busy backend does not prove Cline progress and authorizes nothing", () => {
  const busy = {
    schemaVersion: 1 as const, backend: "vllm" as const, availability: "available" as const,
    telemetry: "available" as const, activeRequests: 3,
    readOnly: true as const, grantsAuthority: false as const,
  };
  const report = correlateClineInference(trusted, busy, 200000);
  assert.equal(report.classification, "backend_busy_without_cline_progress");
  assert.equal(report.inferenceBusy, true);
  assert.equal(report.retryAuthorized, false);
  assert.equal(report.skipExecutionPermitted, false);
  assert.equal(report.grantsAuthority, false);
  assert.equal(correlateClineInference({ ...trusted, watchdogStallVerified: true }, busy, 200000)
    .classification, "watchdog_stall_verified");
  assert.equal(correlateClineInference({ ...trusted, activeTool: true }, busy, 200000)
    .classification, "tool_in_flight");
});

test("M19R2A verified Cline progress and human waits outweigh inference activity", () => {
  const noMetrics = {
    schemaVersion: 1 as const, backend: "ollama" as const, availability: "available" as const,
    telemetry: "unsupported" as const, loadedModelCount: 1,
    readOnly: true as const, grantsAuthority: false as const,
  };
  assert.equal(correlateClineInference({ ...trusted, lastVerifiedProgressAtMs: 199999 },
    noMetrics, 200000).classification, "verified_progress");
  assert.equal(correlateClineInference({ ...trusted, state: "waiting_for_human" },
    noMetrics, 200000).classification, "waiting_for_human");
  assert.equal(correlateClineInference({ ...trusted, source: "forged" },
    noMetrics, 200000).classification, "insufficient_evidence");
  assert.equal(correlateClineInference({ ...trusted, lastActivityAtMs: 200001 },
    noMetrics, 200000).classification, "insufficient_evidence");
});
