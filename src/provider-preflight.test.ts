import assert from "node:assert/strict";
import test from "node:test";
import { preflightProvider } from "./provider-preflight.js";
import type { WorkerConfig } from "./types.js";

function worker(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    providerId: "ollama",
    modelId: "qwen-test:latest",
    baseUrl: "http://localhost:11434",
    contextWindow: 32768,
    maxInputTokens: 30000,
    maxTokensPerTurn: 4096,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 1000,
    validationTimeoutMs: 600000,
    maxValidationOutputChars: 20000,
    maxValidationRepairs: 1,
    checkpointMaxUntrackedFiles: 10000,
    checkpointMaxUntrackedBytes: 268435456,
    maxIterations: 0,
    stallTimeoutMs: 300000,
    maxRetries: 2,
    retryDelayMs: 5000,
    autoApproveCommands: false,
    autoApproveEdits: false,
    ...overrides,
  };
}

test("native Ollama preflight only reads /api/tags and accepts installed model", async () => {
  let requested = "";
  const fakeFetch: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(
      JSON.stringify({ models: [{ name: "qwen-test:latest", model: "qwen-test:latest" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await preflightProvider(
    worker({ baseUrl: "http://localhost:11434/v1" }),
    fakeFetch,
  );

  assert.equal(requested, "http://localhost:11434/api/tags");
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
});

test("native Ollama preflight rejects a model that is not installed", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ models: [{ name: "other:latest" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await preflightProvider(worker(), fakeFetch);

  assert.equal(result.ok, false);
  assert.equal(result.code, "model_not_found");
  assert.deepEqual(result.availableModels, ["other:latest"]);
});

test("OpenAI-compatible preflight reads /models and sends configured bearer token", async () => {
  let requested = "";
  let authorization = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requested = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ data: [{ id: "qwen-test:latest" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await preflightProvider(
    worker({
      providerId: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    }),
    fakeFetch,
  );

  assert.equal(requested, "http://localhost:11434/v1/models");
  assert.equal(authorization, "Bearer ollama");
  assert.equal(result.ok, true);
});

test("unsupported providers preserve admission and perform no network request", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };

  const result = await preflightProvider(
    worker({ providerId: "some-cloud-provider", baseUrl: "https://example.invalid" }),
    fakeFetch,
  );

  assert.equal(called, false);
  assert.equal(result.ok, true);
  assert.equal(result.supported, false);
  assert.equal(result.code, "unsupported_provider");
});

test("provider connection errors fail admission without throwing", async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new Error("connection refused");
  };

  const result = await preflightProvider(worker(), fakeFetch);

  assert.equal(result.ok, false);
  assert.equal(result.code, "provider_unreachable");
  assert.match(result.message, /connection refused/);
});
