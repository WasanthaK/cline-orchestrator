import assert from "node:assert/strict";
import test from "node:test";
import { testLocalInference, NATIVE_INFERENCE_PROBE_CONTRACT } from "./native-local-inference.js";
import { LocalProviderCheckError } from "./local-provider-check.js";
import { routeProductCli } from "./product-cli.js";

const input = { providerId: "openai-compatible", modelId: "qwen38-27b-192k",
  baseUrl: "http://127.0.0.1:8080/v1" };
const models = () => new Response(JSON.stringify({ data: [{ id: input.modelId }] }),
  { status: 200, headers: { "content-type": "application/json" } });
const answer = () => new Response(JSON.stringify({
  model: input.modelId, choices: [{ message: { role: "assistant", content: "Hello!" } }],
}), { status: 200, headers: { "content-type": "application/json" } });

test("M19E4C manually requested inference is bounded and never returns raw output", async () => {
  const called: string[] = [];
  const mock = (async (url: string | URL | Request, init?: RequestInit) => {
    called.push(String(url));
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    if (String(url).endsWith("/models")) return models();
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, input.modelId);
    assert.equal(body.max_tokens, 12);
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 1);
    return answer();
  }) as typeof fetch;
  const result = await testLocalInference(input, mock);
  assert.equal(result.status, "response_observed");
  assert.equal(result.inferenceResponseObserved, true);
  assert.equal(result.modelAuthenticityVerified, false);
  assert.equal(result.grantsAuthority, false);
  assert.deepEqual(called, [
    "http://127.0.0.1:8080/v1/models",
    "http://127.0.0.1:8080/v1/chat/completions",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Hello|qwen|http|prompt|Bearer/);
  assert.equal(NATIVE_INFERENCE_PROBE_CONTRACT.startsTask, false);
  assert.equal(NATIVE_INFERENCE_PROBE_CONTRACT.startsModel, false);
});

test("M19E4C missing alias stops before sending any prompt", async () => {
  let calls = 0;
  const mock = (async () => { calls++; return new Response(JSON.stringify({
    data: [{ id: "other" }],
  }), { status: 200 }); }) as typeof fetch;
  const result = await testLocalInference(input, mock);
  assert.equal(result.status, "metadata_not_ready");
  assert.equal(calls, 1);
});

test("M19E4C malformed, remote, credential URLs reject before network", async () => {
  let calls = 0;
  for (const baseUrl of [
    "http://localhost:8080/v1", "http://example.com/v1",
    "https://127.0.0.1:8080/v1", "http://user:pw@127.0.0.1:8080/v1",
    "http://127.0.0.1:8080/v1?secret=1",
  ]) {
    await assert.rejects(testLocalInference({ ...input, baseUrl }, (async () => {
      calls++; throw new Error("network forbidden");
    }) as typeof fetch), LocalProviderCheckError);
  }
  assert.equal(calls, 0);
});

test("M19E4C remote redirects and absent/bad/oversized completion fail closed", async () => {
  for (const result of [
    new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    new Response(JSON.stringify({ choices: [] }), { status: 200,
      headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ choices: [{ message: { content: "A".repeat(9_000) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }),
  ]) {
    const mock = (async (url: string | URL | Request) =>
      String(url).endsWith("/models") ? models() : result) as typeof fetch;
    const r = await testLocalInference(input, mock);
    assert.equal(r.inferenceResponseObserved, false);
    assert.equal(r.grantsAuthority, false);
  }
});

test("M19E4C exact CLI route cannot select arbitrary source, path or config override", () => {
  assert.deepEqual(routeProductCli(["test-local-inference", "openai-compatible",
    input.modelId, input.baseUrl]), { kind: "local_inference_probe", ...input });
  for (const args of [
    ["test-local-inference"], ["test-local-inference", "provider", "model"],
    ["--config", "C:\\private.json", "test-local-inference", "x", "y", "z"],
    ["test-local-inference", "x", "y", "z", "extra"],
  ]) assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
});
