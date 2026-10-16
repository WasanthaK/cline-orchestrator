import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { testSavedModel, SAVED_MODEL_PROBE_CONTRACT } from "./native-saved-model-probe.js";
import { routeProductCli } from "./product-cli.js";

const provider = { providerId: "openai-compatible", modelId: "saved-model",
  baseUrl: "http://127.0.0.1:8080/v1" };
const original = JSON.stringify({
  schemaVersion: 1, provider,
  runtime: { autoApproveEdits: false, autoApproveCommands: false },
  daemon: { host: "127.0.0.1" },
});
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const response = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200, headers: { "content-type": "application/json" },
});
async function fixture(work: (dir: string, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19e4d-"));
  try {
    const dir = path.join(root, "state");
    await mkdir(dir);
    const file = path.join(dir, "config.json");
    await writeFile(file, original);
    await work(dir, file);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("M19E4D saved probe verifies immutable revision and never exposes model output", async () => {
  await fixture(async (dir, file) => {
    const calls: string[] = [];
    const mock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith("/models")) return response({data: [{id: provider.modelId}]});
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).model, provider.modelId);
      return response({choices: [{message: {content: "SECRET_TEST_REPLY"}}]});
    }) as typeof fetch;
    const result = await testSavedModel(dir, hash(original), mock);
    assert.equal(result.status, "response_observed");
    assert.equal(result.inferenceResponseObserved, true);
    assert.equal(result.modelAuthenticityVerified, false);
    assert.equal(result.grantsAuthority, false);
    assert.doesNotMatch(JSON.stringify(result),
      /SECRET_TEST_REPLY|"saved-model"|127\.0\.0\.1|config\.json/);
    assert.deepEqual(calls, [
      "http://127.0.0.1:8080/v1/models",
      "http://127.0.0.1:8080/v1/chat/completions",
    ]);
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(SAVED_MODEL_PROBE_CONTRACT.startsTask, false);
    assert.equal(SAVED_MODEL_PROBE_CONTRACT.configSaved, false);
  });
});

test("M19E4D stale, corrupt, and unsafe current files refuse before contacting a model", async () => {
  await fixture(async (dir, file) => {
    let calls = 0;
    const mock = (async () => { calls++; return response({}); }) as typeof fetch;
    await assert.rejects(testSavedModel(dir, "a".repeat(64), mock), {code: "stale"});
    await writeFile(file, "NOT JSON");
    await assert.rejects(testSavedModel(dir, hash(original), mock), {code: "unsafe"});
    await writeFile(file, JSON.stringify({...JSON.parse(original),
      provider: {...provider, baseUrl: "https://remote.example/v1"}}));
    await assert.rejects(testSavedModel(dir, hash(original), mock), {code: "unsafe"});
    assert.equal(calls, 0);
  });
});

test("M19E4D detects a config replacement during model inference", async () => {
  await fixture(async (dir, file) => {
    const mock = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/models")) return response({data: [{id: provider.modelId}]});
      await writeFile(file, JSON.stringify({...JSON.parse(original),
        provider: {...provider, modelId: "CHANGED"}}));
      return response({choices: [{message: {content: "Hello"}}]});
    }) as typeof fetch;
    await assert.rejects(testSavedModel(dir, hash(original), mock), {code: "stale"});
    assert.equal(JSON.parse(await readFile(file, "utf8")).provider.modelId, "CHANGED");
  });
});

test("M19E4D exact native CLI route rejects arbitrary paths and extra flags", () => {
  const revision = hash(original);
  assert.deepEqual(routeProductCli(["test-saved-model-desktop", revision]),
    {kind: "desktop_saved_model_probe", expectedRevision: revision});
  for (const args of [
    ["test-saved-model-desktop"],
    ["test-saved-model-desktop", revision, "C:\\other.json"],
    ["--config", "private.json", "test-saved-model-desktop", revision],
  ]) assert.throws(() => routeProductCli(args), {code: "usage_invalid"});
});
