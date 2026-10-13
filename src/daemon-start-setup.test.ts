import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";
import { resolveProductConfig } from "./product-config.js";
import { runDaemonStartSetup } from "./daemon-start-setup.js";
import { routeProductCli, runProductCli, type ProductCliDependencies } from "./product-cli.js";

const profile = { policyVersion: "policy-v1", workerProfileId: "local-worker", maxChangedFiles: 3,
  allowedPathPatterns: ["src/**"], protectedPathPatterns: ["src/auth/**"], validationCommands: ["npm test"] };
const draft = { schemaVersion: 1, provider: { providerId: "ollama-openai", modelId: "local-model",
  baseUrl: "http://127.0.0.1:8080/v1", apiKeySecretRef: "SETUP_TEST_PROVIDER_KEY" },
  daemon: { host: "127.0.0.1", port: 5431 }, runtime: { maxTokensPerTurn: 8192 } };

async function disposable(body: (directory: string, registry: WorkspaceRegistry, workspace: RegisteredWorkspace) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b3d-"));
  const root = path.join(directory, "workspace"); await mkdir(root);
  const registry = new WorkspaceRegistry(path.join(directory, "registry.json"));
  const project = await registry.registerProject("Example");
  const workspace = await registry.registerWorkspace({ projectId: project.projectId, displayName: "Workspace", root, safetyProfile: profile });
  try { await body(directory, registry, workspace); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("M18B3d startup confirmation dispatches the immutable registered root and exact selected configuration only", async () => {
  await disposable(async (_directory, registry, workspace) => {
    const before = await readFile(registry.path, "utf8");
    const config = resolveProductConfig(draft);
    const inherited = { ORCH_DIFF_MAX_CHANGED_FILES: "1", ORCH_DIFF_EXPECTED_PATHS: "src/only.ts",
      ORCH_DIFF_PROTECTED_PATTERNS: "src/protected/**", SETUP_TEST_PROVIDER_KEY: "synthetic-private-sentinel" };
    let calls = 0;
    const result = await runDaemonStartSetup(workspace.workspaceId, config, inherited, async review => {
      assert.equal(calls, 0);
      assert.deepEqual(review.workspace, workspace);
      assert.equal(Object.hasOwn(review, "confirmationToken"), false);
      assert.equal(review.config.provider?.apiKeySecretRef, "SETUP_TEST_PROVIDER_KEY");
      assert.doesNotMatch(JSON.stringify(review), /synthetic-private-sentinel/);
      review.workspace.canonicalRoot = "/changed";
      review.config.daemon!.port = 9999;
      config.runtime.maxTokensPerTurn = 1;
      inherited.ORCH_DIFF_MAX_CHANGED_FILES = "100";
      return true;
    }, async (args, env) => {
      calls++;
      assert.deepEqual(args, ["daemon", workspace.canonicalRoot]);
      assert.equal(env.ORCH_DAEMON_HOST, "127.0.0.1");
      assert.equal(env.ORCH_DAEMON_PORT, "5431");
      assert.equal(env.ORCH_MAX_TOKENS_PER_TURN, "8192");
      assert.equal(env.ORCH_API_KEY_SECRET_REF, "SETUP_TEST_PROVIDER_KEY");
      assert.equal(env.ORCH_API_KEY, undefined);
      assert.equal(env.ORCH_DIFF_MAX_CHANGED_FILES, "1");
      assert.equal(env.ORCH_DIFF_EXPECTED_PATHS, "src/only.ts");
      assert.equal(env.ORCH_DIFF_PROTECTED_PATTERNS, "src/protected/**");
      assert.equal(env.ORCH_AUTO_APPROVE_COMMANDS, "false");
      assert.equal(env.ORCH_AUTO_APPROVE_EDITS, "false");
    }, registry);
    assert.equal(calls, 1);
    assert.equal(result.dispatched, true);
    assert.equal(result.grantsAuthority, false);
    assert.equal(result.result?.grantsTaskAuthority, false);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-sentinel|SETUP_TEST_PROVIDER_KEY/);
    assert.equal(await readFile(registry.path, "utf8"), before);
    assert.deepEqual(await readdir(workspace.canonicalRoot), []);
  });
});

test("M18B3d decline and expiry do not dispatch or write state", async () => {
  await disposable(async (_directory, registry, workspace) => {
    let calls = 0;
    const dispatch = async () => { calls++; };
    const config = resolveProductConfig(draft);
    const declined = await runDaemonStartSetup(workspace.workspaceId, config, {}, async () => false, dispatch, registry);
    assert.equal(declined.dispatched, false);
    let now = 100_000;
    await assert.rejects(runDaemonStartSetup(workspace.workspaceId, config, {}, async () => { now += 60_000; return true; },
      dispatch, registry, { now: () => now }), { code: "confirmation_expired" });
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(workspace.canonicalRoot), []);
  });
});

test("M18B3d unregistered IDs, raw paths, remote hosts, reserved references and automatic approvals fail before confirmation", async () => {
  await disposable(async (_directory, registry, workspace) => {
    let calls = 0;
    const confirm = async () => { calls++; return true; };
    const dispatch = async () => { assert.fail("invalid setup must not dispatch"); };
    const config = resolveProductConfig(draft);
    for (const id of [workspace.canonicalRoot, "unknown", "00000000-0000-0000-0000-000000000000"]) {
      await assert.rejects(runDaemonStartSetup(id, config, {}, confirm, dispatch, registry), { code: "workspace_invalid" });
    }
    const remote = structuredClone(config); remote.daemon.host = "0.0.0.0";
    const raw = structuredClone(config); (raw.provider as any).apiKey = "synthetic-secret";
    const reserved = structuredClone(config); reserved.provider.apiKeySecretRef = "ORCH_API_KEY";
    for (const bad of [remote, raw, reserved,
      resolveProductConfig({ ...draft, runtime: { autoApproveCommands: true } }),
      resolveProductConfig({ ...draft, runtime: { autoApproveEdits: true } })]) {
      await assert.rejects(runDaemonStartSetup(workspace.workspaceId, bad, {}, confirm, dispatch, registry),
        { code: "config_invalid" });
    }
    assert.equal(calls, 0);
  });
});

test("M18B3d Safety profile drift and root replacement after review prevent dispatch", async () => {
  await disposable(async (_directory, registry, workspace) => {
    let calls = 0;
    const dispatch = async () => { calls++; };
    const config = resolveProductConfig(draft);
    await assert.rejects(runDaemonStartSetup(workspace.workspaceId, config, {}, async () => {
      await registry.updateSafetyProfile(workspace.workspaceId, { ...profile, maxChangedFiles: 4 }); return true;
    }, dispatch, registry), { code: "execution_failed" });
    await assert.rejects(runDaemonStartSetup(workspace.workspaceId, config, {}, async () => {
      await rename(workspace.canonicalRoot, workspace.canonicalRoot + "-old");
      await mkdir(workspace.canonicalRoot); return true;
    }, dispatch, registry), { code: "execution_failed" });
    assert.equal(calls, 0);
  });
});

test("M18B3d root retargeting is refused by the existing verified-workspace boundary", async () => {
  await disposable(async (directory, registry, workspace) => {
    const elsewhere = path.join(directory, "elsewhere"); await mkdir(elsewhere);
    await assert.rejects(runDaemonStartSetup(workspace.workspaceId, resolveProductConfig(draft), {}, async () => {
      await rename(workspace.canonicalRoot, workspace.canonicalRoot + "-old");
      await symlink(elsewhere, workspace.canonicalRoot); return true;
    }, async () => { assert.fail("retargeted root must not dispatch"); }, registry), { code: "execution_failed" });
    assert.deepEqual(await readdir(elsewhere), []);
  });
});

test("M18B3d foreground receipt waits for dispatcher completion and sanitizes failure", async () => {
  await disposable(async (_directory, registry, workspace) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let dispatched!: () => void;
    const started = new Promise<void>(resolve => { dispatched = resolve; });
    let complete = false;
    const running = runDaemonStartSetup(workspace.workspaceId, resolveProductConfig(draft), {}, async () => true,
      async () => { dispatched(); await gate; }, registry).then(result => { complete = true; return result; });
    await started;
    assert.equal(complete, false);
    release(); await running;
    await assert.rejects(runDaemonStartSetup(workspace.workspaceId, resolveProductConfig(draft), {}, async () => true,
      async () => { throw new Error("synthetic-private-sentinel"); }, registry), error => {
      assert.equal((error as any).code, "execution_failed");
      assert.doesNotMatch((error as Error).message, /synthetic-private-sentinel/); return true;
    });
  });
});

test("M18B3d CLI selects one file/environment snapshot and never uses observation as startup authority", async () => {
  await disposable(async (_directory, registry, workspace) => {
    assert.deepEqual(routeProductCli(["--config", "chosen.json", "setup-start", workspace.workspaceId]),
      { kind: "setup_start", workspaceId: workspace.workspaceId, configPath: "chosen.json" });
    assert.throws(() => routeProductCli(["setup-start", workspace.workspaceId, "extra"]), { code: "usage_invalid" });
    let reads = 0;
    let calls = 0;
    const deps: ProductCliDependencies = {
      env: { ORCH_CONFIG_FILE: "other.json", ORCH_MODEL: "env-model" },
      runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
      registrationRegistry: registry,
      readConfigFile: async selected => { reads++; assert.equal(selected, "chosen.json"); return JSON.stringify(draft); },
      confirmDaemonStart: async review => {
        assert.equal(review.config.provider?.modelId, "env-model");
        deps.env.ORCH_MODEL = "after-review"; return true;
      },
      dispatchLegacy: async (args, env) => {
        calls++; assert.deepEqual(args, ["daemon", workspace.canonicalRoot]);
        assert.equal(env.ORCH_MODEL, "env-model");
        assert.equal(env.ORCH_CONFIG_FILE, undefined);
      },
      findWorkspace: async () => { assert.fail("observations cannot grant startup authority"); },
      fetchJson: async () => { assert.fail("setup must not contact a listener"); },
    };
    await runProductCli(["--config", "chosen.json", "setup-start", workspace.workspaceId], deps);
    assert.equal(reads, 1); assert.equal(calls, 1);
  });
});

test("M18B3d actual non-TTY CLI refuses piped startup confirmation without workspace state writes", async () => {
  await disposable(async (directory, registry, workspace) => {
    const configHome = path.join(directory, "config-home");
    const defaultRegistry = path.join(configHome, "cline-orchestrator", "workspace-registry.json");
    await mkdir(path.dirname(defaultRegistry), { recursive: true });
    await writeFile(defaultRegistry, await readFile(registry.path, "utf8"));
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/product-cli.ts", "setup-start", workspace.workspaceId],
      { encoding: "utf8", input: "START DAEMON\n", timeout: 30_000,
        env: { ...process.env, XDG_CONFIG_HOME: configHome, LOCALAPPDATA: configHome,
          ORCH_CONFIG_FILE: undefined, ORCH_API_KEY: undefined } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an interactive terminal/);
    assert.doesNotMatch(result.stderr, /m18b3d-/);
    assert.deepEqual(await readdir(workspace.canonicalRoot), []);
  });
});

test("M18B3d confirmed source CLI reaches the real daemon-child missing-credential guard before any listener/state", async () => {
  await disposable(async (directory, registry, workspace) => {
    const cliUrl = pathToFileURL(path.resolve("src/product-cli.ts")).href;
    const registryUrl = pathToFileURL(path.resolve("src/workspace-registry.ts")).href;
    const helper = path.join(directory, "confirmed-start.mjs");
    const config = { ...draft, provider: { ...draft.provider, apiKeySecretRef: "M18B3D_ABSENT_PROVIDER_KEY" } };
    await writeFile(helper, `import { runProductCli } from ${JSON.stringify(cliUrl)};
import { WorkspaceRegistry } from ${JSON.stringify(registryUrl)};
try { await runProductCli(['setup-start', ${JSON.stringify(workspace.workspaceId)}], {
  env: { ORCH_CONFIG_FILE: 'selected.json' }, runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
  registrationRegistry: new WorkspaceRegistry(${JSON.stringify(registry.path)}),
  readConfigFile: async () => ${JSON.stringify(JSON.stringify(config))}, confirmDaemonStart: async () => true,
  findWorkspace: async () => { throw new Error('must not observe'); }, fetchJson: async () => { throw new Error('must not fetch'); }
}); } catch (error) { process.stderr.write(error.message + '\\n'); process.exitCode = 1; }
`);
    const result = spawnSync(process.execPath, ["--import", "tsx", helper], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Selected provider credential is unavailable or invalid/);
    assert.doesNotMatch(result.stdout + result.stderr, /M18B3D_ABSENT_PROVIDER_KEY|m18b3d-|synthetic-private/);
    assert.deepEqual(await readdir(workspace.canonicalRoot), []);
  });
});
