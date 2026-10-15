import assert from "node:assert/strict";
import test from "node:test";
import {
  checkLocalProvider, LocalProviderCheckError, LOCAL_PROVIDER_CHECK_CONTRACT,
} from "./local-provider-check.js";

const input = { providerId: "openai-compatible", modelId: "qwen38-27b-192k",
  baseUrl: "http://127.0.0.1:8080/v1" };

test("M19C1 detects an available local llama.cpp model with existing preflight", async () => {
  let called = 0;
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    called++;
    assert.equal(String(url), "http://127.0.0.1:8080/v1/models");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    return new Response(JSON.stringify({ data: [
      { id: "qwen38-27b-192k" }, { id: "other-model" }, { id: "<img>" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const result = await checkLocalProvider(input, fetchStub);
  assert.equal(called, 1);
  assert.equal(result.command, "check-provider");
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
  assert.deepEqual(result.availableModels, ["qwen38-27b-192k", "other-model"]);
  assert.equal(result.grantsAuthority, false);
  assert.equal(result.configSaved, false);
  assert.equal(result.modelStarted, false);
});

test("M19C1 reports missing model without treating connectivity as readiness", async () => {
  const result = await checkLocalProvider(input, (async () =>
    new Response(JSON.stringify({ data: [{ id: "different" }] }), { status: 200 })) as typeof fetch);
  assert.equal(result.ok, false);
  assert.equal(result.code, "model_not_found");
  assert.deepEqual(result.availableModels, ["different"]);
});

test("M19C1 fails closed before networking for remote or credential-bearing endpoints", async () => {
  for (const baseUrl of [
    "https://127.0.0.1:8080/v1", "http://example.com/v1",
    "http://localhost:8080/v1", "http://127.0.0.1:8080/v1?token=abc",
    "http://user:secret@127.0.0.1:8080/v1",
    "http://127.0.0.1:8080/admin", "http://127.0.0.1/v1",
    "http://127.0.0.1:8080/v1#frag", "http://127.0.0.1:8080/v1/../admin",
  ]) {
    await assert.rejects(() => checkLocalProvider({ ...input, baseUrl },
      (async () => { throw new Error("Network must not be contacted"); }) as typeof fetch),
    (error: unknown) => error instanceof LocalProviderCheckError);
  }
  assert.equal(LOCAL_PROVIDER_CHECK_CONTRACT.grantsAuthority, false);
  assert.equal(LOCAL_PROVIDER_CHECK_CONTRACT.writesConfig, false);
});

test("M19C1 strips upstream errors and prohibits following HTTP redirects", async () => {
  const badResponse = await checkLocalProvider(input, (async (_url, init) => {
    assert.equal(init?.redirect, "error");
    throw new Error("SECRET or private address must not appear");
  }) as typeof fetch);
  assert.equal(badResponse.code, "provider_unreachable");
  assert.equal(JSON.stringify(badResponse).includes("SECRET"), false);
  assert.equal("endpoint" in badResponse, false);
});
