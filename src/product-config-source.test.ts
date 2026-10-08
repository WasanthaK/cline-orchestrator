import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveProductConfigSource, ProductConfigSourceError } from "./product-config-source.js";
import { routeProductCli, runNativeProductCommand, type ProductCliDependencies } from "./product-cli.js";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";

async function withFile(body: (file: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b1-"));
  try {
    const file = path.join(directory, "operator config.json");
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      provider: { providerId: "openai", modelId: "local-model", baseUrl: "http://127.0.0.1:8080/v1",
        apiKeySecretRef: "PROVIDER_KEY" },
      daemon: { host: "127.0.0.1", port: 5431 },
    }));
    await body(file, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function dependencies(env: ProductCliDependencies["env"] = {}) {
  const reads: string[] = [];
  const deps: ProductCliDependencies = {
    env,
    runtime: { nodeVersion: "v22.23.3", platform: "linux", architecture: "x64" },
    async findWorkspace() {
      reads.push("workspace");
      return { schemaVersion: 1, registered: false, safetyProfileConfigured: false,
        validationCommandsConfigured: false, authority: "first_run_workspace_observation", grantsAuthority: false };
    },
    async fetchJson(url) { reads.push(url); return { ok: true, status: 200, payload: { ok: true } }; },
  };
  return { deps, reads };
}

async function native(argv: string[], deps: ProductCliDependencies) {
  const route = routeProductCli(argv);
  if (route.kind !== "native") throw new Error("native required");
  const result = await runNativeProductCommand(route, deps);
  assert.equal(result.grantsAuthority, false);
  assert.equal(result.mutatesConfig, false);
  assert.equal(result.registersWorkspace, false);
  assert.equal(result.startsService, false);
  assert.equal(result.performsNetworkMutation, false);
  return result;
}

test("M18B1 real config file supplies native config; environment overrides values without mutation", async () => {
  await withFile(async (file) => {
    const before = await readFile(file, "utf8");
    const { deps, reads } = dependencies({ ORCH_MODEL: "environment-model" });
    const result = await native(["--config", file, "config"], deps);
    const config = result.payload as Awaited<ReturnType<typeof resolveProductConfigSource>>;
    assert.equal(config.provider.modelId, "environment-model");
    assert.equal(config.provider.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(config.provider.apiKeySecretRef, "PROVIDER_KEY");
    assert.equal(config.daemon.port, 5431);
    assert.equal(config.runtime.autoApproveCommands, false);
    assert.equal(config.runtime.autoApproveEdits, false);
    assert.equal(config.grantsAuthority, false);
    assert.deepEqual(reads, []);
    assert.equal(await readFile(file, "utf8"), before);
  });
});

test("M18B1 diagnose/setup/status use selected file and flag overrides environment file selection", async () => {
  await withFile(async (file) => {
    const { deps, reads } = dependencies({ ORCH_CONFIG_FILE: "/unreadable/secret-path" });
    for (const command of ["diagnose", "setup", "status"]) {
      const result = await native(["--config", file, command, "workspace"], deps);
      if (command === "diagnose") assert.equal((result.payload as FirstRunAssessmentV1).providerReady, true);
    }
    assert.ok(reads.includes("http://127.0.0.1:5431/health"));
    assert.ok(reads.includes("http://127.0.0.1:5431/preflight"));
    assert.equal(reads.some((url) => url.includes(":4317")), false);
    const fromEnvironment = await native(["config"], dependencies({ ORCH_CONFIG_FILE: file }).deps);
    assert.equal((fromEnvironment.payload as { daemon: { port: number } }).daemon.port, 5431);
  });
});

test("M18B1 absent selector performs no file reads and preserves default configuration", async () => {
  let reads = 0;
  const result = await resolveProductConfigSource(undefined, {}, async () => { reads++; throw new Error("unexpected"); });
  assert.equal(reads, 0);
  assert.equal(result.daemon.host, "127.0.0.1");
  assert.equal(result.daemon.port, 4317);
  assert.equal(result.grantsAuthority, false);
});

test("M18B1 missing file, directory, malformed JSON and oversized bytes fail with sanitized errors", async () => {
  await withFile(async (file, directory) => {
    const check = (code: string) => (error: unknown) => {
      assert.ok(error instanceof ProductConfigSourceError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /m18b1-|operator config|secret-sentinel|ENOENT|EACCES/);
      return true;
    };
    await assert.rejects(resolveProductConfigSource(path.join(directory, "missing-secret-sentinel"), {}), check("file_unreadable"));
    await assert.rejects(resolveProductConfigSource(directory, {}), check("file_invalid"));
    await writeFile(file, '{"schemaVersion": secret-sentinel');
    await assert.rejects(resolveProductConfigSource(file, {}), check("json_invalid"));
    await writeFile(file, "x".repeat(65_537));
    await assert.rejects(resolveProductConfigSource(file, {}), check("file_invalid"));
    await assert.rejects(resolveProductConfigSource(file, {}, async () => { throw new Error("EACCES secret-sentinel"); }), check("file_unreadable"));
  });
});

test("M18B1 invalid shapes, schema, raw secrets and non-loopback config fail before observation", async () => {
  await withFile(async (file) => {
    const inputs: unknown[] = [
      [], null, { schemaVersion: 2 },
      { schemaVersion: 1, provider: [] },
      { schemaVersion: 1, runtime: { maxRetries: "2" } },
      { schemaVersion: 1, runtime: { maxRetries: -1 } },
      { schemaVersion: 1, runtime: { autoApproveEdits: "false" } },
      { schemaVersion: 1, provider: { apiKey: "secret-sentinel" } },
      { schemaVersion: 1, runtime: { password: "secret-sentinel" } },
      { schemaVersion: 1, daemon: { host: "0.0.0.0" } },
      { schemaVersion: 1, provider: { baseUrl: "https://user:secret-sentinel@example.com" } },
      { schemaVersion: 1, "secret-sentinel": true },
    ];
    for (const input of inputs) {
      await writeFile(file, JSON.stringify(input));
      const { deps, reads } = dependencies();
      await assert.rejects(native(["--config", file, "diagnose", "workspace"], deps), (error: unknown) => {
        assert.ok(error instanceof ProductConfigSourceError);
        assert.equal(error.code, "config_invalid");
        assert.doesNotMatch(error.message, /secret-sentinel|m18b1-|operator config/);
        return true;
      });
      assert.deepEqual(reads, []);
    }
  });
});

test("M18B1 invalid file remains rejected when environment could override it", async () => {
  await assert.rejects(resolveProductConfigSource("selected", { ORCH_MODEL: "safe" },
    async () => JSON.stringify({ schemaVersion: 1, provider: { apiKey: "secret-sentinel" } })),
    { code: "config_invalid" });
  await assert.rejects(resolveProductConfigSource(undefined,
    { ORCH_API_KEY: "secret-sentinel" } as ProductCliDependencies["env"]), { code: "config_invalid" });
});

test("M18B1 explicit file option is native-only; malformed/repeated selectors reject", () => {
  for (const args of [
    ["--config"], ["--config", "", "config"], ["--config", "--bad", "config"],
    ["--config", "one", "--config", "two", "config"],
    ["--config", "one", "start", "workspace"],
    ["--config", "one", "run", "workspace", "goal"],
    ["--config", "one", "legacy", "daemon", "workspace"],
  ]) assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  assert.deepEqual(routeProductCli(["start", "workspace"]), { kind: "legacy", args: ["daemon", "workspace"] });
});

test("M18B1 actual CLI entry loads selected JSON and prints sanitized failure with nonzero exit", async () => {
  await withFile(async (file) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("ORCH_")) delete env[key];
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "src/product-cli.ts", "--config", file, "config"],
      { encoding: "utf8", env, timeout: 30_000 });
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    const result = JSON.parse(success.stdout);
    assert.equal(result.payload.provider.modelId, "local-model");
    assert.equal(result.payload.daemon.port, 5431);
    assert.equal(result.grantsAuthority, false);
    await writeFile(file, '{"secret-sentinel":');
    const failure = run();
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.doesNotMatch(failure.stderr, /secret-sentinel|m18b1-|operator config/);
    assert.match(failure.stderr, /not valid JSON/);
  });
});
