import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveProductConfig } from "./product-config.js";
import { resolveProductConfigSource } from "./product-config-source.js";
import { productExecutionEnvironment } from "./product-execution-config.js";
import { runProductCli, type ProductCliDependencies } from "./product-cli.js";

function fixture(env: ProductCliDependencies["env"] = {}) {
  const calls: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
  const deps: ProductCliDependencies = {
    env, runtime: { nodeVersion: "v22.23.3", platform: "linux", architecture: "x64" },
    async findWorkspace() { throw new Error("execution must not use native observation"); },
    async fetchJson() { throw new Error("execution must not fetch before dispatcher"); },
    async dispatchLegacy(args, childEnv) { calls.push({ args, env: childEnv }); },
  };
  return { calls, deps };
}

const fileConfig = {
  schemaVersion: 1,
  provider: { providerId: "ollama-openai", modelId: "file-model", baseUrl: "http://127.0.0.1:8080/v1" },
  runtime: { maxRetries: 3, contextWindow: 196608, maxTokensPerTurn: 8192, autoApproveCommands: false, autoApproveEdits: false },
  daemon: { host: "127.0.0.1", port: 5431 },
};

test("M18B2 all runtime/provider/daemon settings round-trip unchanged through existing dispatcher environment", () => {
  const config = resolveProductConfig(fileConfig, { ORCH_MODEL: "env-model" });
  const child = productExecutionEnvironment(config, {
    PATH: "/usr/bin", ORCH_MAX_OUTPUT_TOKENS: "17", ORCH_CONFIG_FILE: "/private/file",
    ORCH_DIFF_MAX_CHANGED_FILES: "1", ORCH_DIFF_PROTECTED_PATTERNS: "src/protected/**",
    ORCH_DIFF_EXPECTED_PATHS: "src/only.ts", ORCH_API_KEY: "not-forwarded",
  });
  assert.deepEqual(resolveProductConfig({ schemaVersion: 1 }, child), config);
  assert.equal(child.PATH, "/usr/bin");
  assert.equal(child.ORCH_CONFIG_FILE, undefined);
  assert.equal(child.ORCH_MAX_OUTPUT_TOKENS, undefined);
  assert.equal(child.ORCH_DIFF_MAX_CHANGED_FILES, "1");
  assert.equal(child.ORCH_DIFF_PROTECTED_PATTERNS, "src/protected/**");
  assert.equal(child.ORCH_DIFF_EXPECTED_PATHS, "src/only.ts");
  assert.equal(child.ORCH_API_KEY, undefined);
  assert.equal(child.ORCH_AUTO_APPROVE_COMMANDS, "false");
  assert.equal(child.ORCH_AUTO_APPROVE_EDITS, "false");
});

test("M18B2 start uses the same single validated file/environment snapshot as observation", async () => {
  const f = fixture({ ORCH_MODEL: "env-model", ORCH_CONFIG_FILE: "environment-file" });
  let reads = 0;
  f.deps.readConfigFile = async (file) => {
    assert.equal(file, "selected-file");
    reads++;
    return JSON.stringify(fileConfig);
  };
  const expected = await resolveProductConfigSource("selected-file", f.deps.env, f.deps.readConfigFile);
  reads = 0;
  await runProductCli(["--config", "selected-file", "start", "workspace"], f.deps);
  assert.equal(reads, 1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]!.args, ["daemon", "workspace"]);
  assert.deepEqual(resolveProductConfig({ schemaVersion: 1 }, f.calls[0]!.env), expected);
});

test("M18B2 task/legacy commands delegate exact existing arguments with validated defaults", async () => {
  const f = fixture();
  const routes = [
    { input: ["tasks", "workspace"], output: ["list", "workspace"] },
    { input: ["run", "workspace", "bounded goal"], output: ["run", "workspace", "bounded goal"] },
    { input: ["status", "workspace", "task"], output: ["status", "workspace", "task"] },
    { input: ["resume", "workspace", "task", "bounded prompt"], output: ["resume", "workspace", "task", "bounded prompt"] },
    { input: ["abort", "workspace", "task"], output: ["abort", "workspace", "task"] },
    { input: ["rollback", "workspace", "task"], output: ["rollback", "workspace", "task"] },
    { input: ["legacy", "daemon", "workspace"], output: ["daemon", "workspace"] },
  ];
  for (const route of routes) {
    await runProductCli(route.input, f.deps);
    const call = f.calls.at(-1)!;
    assert.deepEqual(call.args, route.output);
    assert.equal(call.env.ORCH_DAEMON_HOST, "127.0.0.1");
    assert.equal(call.env.ORCH_AUTO_APPROVE_COMMANDS, "false");
    assert.equal(call.env.ORCH_AUTO_APPROVE_EDITS, "false");
  }
});

test("M18B2 invalid/remote/raw-secret inputs fail before dispatcher for start and task paths", async () => {
  for (const env of [
    { ORCH_DAEMON_HOST: "0.0.0.0" },
    { ORCH_DAEMON_URL: "http://192.168.1.5:4317" },
    { ORCH_DAEMON_URL: "http://user:secret-sentinel@127.0.0.1:4317" },
    { ORCH_DAEMON_URL: "https://127.0.0.1:4317" },
    { ORCH_DAEMON_URL: "http://127.0.0.1:4317/?token=secret-sentinel" },
    { ORCH_API_KEY: "secret-sentinel" },
    { ORCH_MAX_RETRIES: "2junk" },
    { ORCH_DAEMON_PORT: "4317.5" },
    { ORCH_AUTO_APPROVE_EDITS: "yes" },
  ]) {
    for (const command of [["start", "workspace"], ["run", "workspace", "goal"]]) {
      const f = fixture(env);
      await assert.rejects(runProductCli(command, f.deps), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret-sentinel|2junk|192.168/);
        return true;
      });
      assert.deepEqual(f.calls, []);
    }
  }
  const f = fixture({ ORCH_CONFIG_FILE: "private-secret-sentinel" });
  f.deps.readConfigFile = async () => { throw new Error("private-secret-sentinel"); };
  await assert.rejects(runProductCli(["start", "workspace"], f.deps), { code: "file_unreadable" });
  assert.deepEqual(f.calls, []);
});

test("M18B3a daemon handoff carries a reference, while clients do not select runtime credentials", async () => {
  const f = fixture({ ORCH_API_KEY_SECRET_REF: "PROVIDER_KEY", PROVIDER_KEY: "secret-sentinel" });
  await runProductCli(["start", "workspace"], f.deps);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.env.ORCH_API_KEY_SECRET_REF, "PROVIDER_KEY");
  assert.equal(f.calls[0]!.env.ORCH_API_KEY, undefined);
  assert.doesNotMatch(JSON.stringify(f.calls[0]!.args), /secret-sentinel|PROVIDER_KEY/);
  await runProductCli(["tasks", "workspace"], f.deps);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.env.ORCH_API_KEY_SECRET_REF, undefined);
  assert.equal(f.calls[1]!.env.ORCH_API_KEY, undefined);
});

test("M18B2 IPv6 loopback host becomes a valid bind literal without changing URL", () => {
  const config = resolveProductConfig({ schemaVersion: 1, daemon: { host: "[::1]" } });
  const env = productExecutionEnvironment(config, {});
  assert.equal(env.ORCH_DAEMON_HOST, "::1");
  assert.equal(env.ORCH_DAEMON_URL, config.daemon.url);
});

test("M18B2 actual source CLI delegates read-only task listing and rejects invalid config before child launch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b2-"));
  try {
    const file = path.join(directory, "product.json");
    await writeFile(file, JSON.stringify(fileConfig));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("ORCH_")) delete env[key];
    const run = () => spawnSync(process.execPath,
      ["--import", "tsx", "src/product-cli.ts", "--config", file, "tasks", directory],
      { encoding: "utf8", env, timeout: 30_000 });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No orchestrator tasks found/);
    assert.equal(await readFile(file, "utf8"), JSON.stringify(fileConfig));
    await writeFile(file, '{"secret-sentinel":');
    const failure = run();
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.doesNotMatch(failure.stderr, /secret-sentinel|m18b2-/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
