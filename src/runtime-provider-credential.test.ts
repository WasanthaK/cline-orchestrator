import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveProductConfig } from "./product-config.js";
import { withRuntimeProviderCredential, RuntimeProviderCredentialError } from "./runtime-provider-credential.js";
import { preflightProvider } from "./provider-preflight.js";
import type { WorkerConfig } from "./types.js";

function worker(): WorkerConfig {
  const config = resolveProductConfig({ schemaVersion: 1 });
  return { ...config.runtime, providerId: "openai-compatible", modelId: "local-model",
    baseUrl: "http://127.0.0.1:8080/v1" };
}

test("M18B3a runtime resolver selects exactly one named value without mutating settings", () => {
  const original = worker();
  const before = structuredClone(original);
  const reads: string[] = [];
  const runtime = withRuntimeProviderCredential(original, "PROVIDER_KEY", (name) => {
    reads.push(name); return "synthetic-key-sentinel";
  });
  assert.deepEqual(reads, ["PROVIDER_KEY"]);
  assert.equal(runtime.apiKey, "synthetic-key-sentinel");
  assert.deepEqual(original, before);
  const { apiKey: _key, ...settings } = runtime;
  assert.deepEqual(settings, original);
});

test("M18B3a absent reference preserves existing worker and performs no lookup", () => {
  const original = worker();
  assert.equal(withRuntimeProviderCredential(original, undefined, () => {
    throw new Error("lookup must not run");
  }), original);
});

test("M18B3a malformed/reserved references reject without lookup", () => {
  for (const reference of ["", "bad name", "lowercase", "ORCH_API_KEY", "ORCH_API_KEY_SECRET_REF", "A".repeat(129)]) {
    let reads = 0;
    assert.throws(() => withRuntimeProviderCredential(worker(), reference, () => { reads++; return "secret"; }),
      { code: "reference_invalid" });
    assert.equal(reads, 0);
  }
});

test("M18B3a missing/invalid values and lookup exceptions expose no value or reference", () => {
  for (const value of [undefined, "", " ", "synthetic-key-sentinel\n", "\0synthetic-key-sentinel", "x".repeat(16_385)]) {
    assert.throws(() => withRuntimeProviderCredential(worker(), "PROVIDER_KEY", () => value), (error: unknown) => {
      assert.ok(error instanceof RuntimeProviderCredentialError);
      assert.equal(error.code, "credential_unavailable");
      assert.doesNotMatch(JSON.stringify(error) + error.message, /synthetic-key-sentinel|PROVIDER_KEY/);
      return true;
    });
  }
  assert.throws(() => withRuntimeProviderCredential(worker(), "PROVIDER_KEY", () => {
    throw new Error("synthetic-key-sentinel provider exception");
  }), { code: "credential_unavailable" });
});

test("M18B3a existing metadata preflight receives credential while public success/failure results omit it", async () => {
  const runtime = withRuntimeProviderCredential(worker(), "PROVIDER_KEY", () => "synthetic-key-sentinel");
  const result = await preflightProvider(runtime, (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key-sentinel");
    return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-key-sentinel|PROVIDER_KEY/);
  const failed = await preflightProvider(runtime, (async () => {
    throw new Error("synthetic-key-sentinel provider failure synthetic-key-sentinel");
  }) as typeof fetch);
  assert.equal(failed.ok, false);
  assert.doesNotMatch(JSON.stringify(failed), /synthetic-key-sentinel|PROVIDER_KEY/);
});

test("M18B3a actual daemon child fails missing credential before binding or writing state; clients ignore reference", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b3a-"));
  try {
    const file = path.join(directory, "product.json");
    const input = JSON.stringify({ schemaVersion: 1,
      provider: { apiKeySecretRef: "M18_SYNTHETIC_MISSING_KEY" } });
    await writeFile(file, input);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("ORCH_")) delete env[key];
    delete env.M18_SYNTHETIC_MISSING_KEY;
    const invoke = (command: string) => spawnSync(process.execPath,
      ["--import", "tsx", "src/product-cli.ts", "--config", file, command, directory],
      { encoding: "utf8", env, timeout: 30_000 });
    const start = invoke("start");
    assert.equal(start.status, 1);
    assert.equal(start.stdout, "");
    assert.match(start.stderr, /Selected provider credential is unavailable or invalid/);
    assert.doesNotMatch(start.stderr, /M18_SYNTHETIC_MISSING_KEY|m18b3a-/);
    assert.deepEqual(await readdir(directory), ["product.json"]);
    assert.equal(await readFile(file, "utf8"), input);
    const list = invoke("tasks");
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /No orchestrator tasks found/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
