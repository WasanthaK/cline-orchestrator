import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { readProductConfigFile } from "./product-config-source.js";
import { runProductCli, type ProductCliDependencies } from "./product-cli.js";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";

const draft = { schemaVersion: 1, provider: { providerId: "ollama-openai", modelId: "file-model",
  baseUrl: "http://127.0.0.1:8080/v1", apiKeySecretRef: "M18_ACCEPTANCE_PROVIDER_KEY" },
  daemon: { host: "127.0.0.1", port: 5431 }, runtime: { maxTokensPerTurn: 8192 } };
const profile = { policyVersion: "policy-v1", workerProfileId: "safe-worker-v1", maxChangedFiles: 3,
  allowedPathPatterns: ["src/**"], protectedPathPatterns: ["src/auth/**", ".env*", ".git/**"],
  validationCommands: ["npm test"] };

function noAuthority(value: Record<string, unknown>) {
  const flags = Object.entries(value).filter(([key]) => key.startsWith("grants"));
  assert.ok(flags.length > 0);
  for (const [key, flag] of flags) assert.equal(flag, false, key);
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b-acceptance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "workspace"); await mkdir(root);
  const userFiles = { "user.txt": "operator-owned content", "tasks.json": "operator-owned task sentinel",
    ".env": "operator-owned secret-file sentinel" };
  for (const [name, content] of Object.entries(userFiles)) await writeFile(path.join(root, name), content);
  const inputPath = path.join(directory, "draft.json"); await writeFile(inputPath, JSON.stringify(draft));
  const configPath = path.join(directory, "product.json");
  const registry = new WorkspaceRegistry(path.join(directory, "registry.json"));
  const confirmations: string[] = [];
  const reads: string[] = [];
  const calls: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
  const outputs: string[] = [];
  let running = false;
  let preflightOk = true;
  let accepted = true;
  const deps: ProductCliDependencies = {
    env: { ORCH_MODEL: "env-model", M18_ACCEPTANCE_PROVIDER_KEY: "synthetic-value-must-stay-private",
      ORCH_DIFF_MAX_CHANGED_FILES: "1", ORCH_DIFF_EXPECTED_PATHS: "src/only.ts", ORCH_DIFF_PROTECTED_PATTERNS: "src/protected/**" },
    runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
    registrationRegistry: registry,
    readConfigFile: async selected => { reads.push(selected); return readProductConfigFile(selected); },
    confirmConfigWrite: async review => {
      confirmations.push("write_config"); assert.equal(review.targetPath, configPath);
      assert.deepEqual(review.config, draft); assert.equal(Object.hasOwn(review, "confirmationToken"), false);
      return accepted;
    },
    confirmRegistration: async review => {
      confirmations.push(review.action); assert.equal(Object.hasOwn(review, "confirmationToken"), false);
      assert.equal(review.registryPath, registry.path); return accepted;
    },
    confirmDaemonStart: async review => {
      confirmations.push("start_loopback_daemon");
      assert.equal(review.workspace.canonicalRoot, root);
      assert.equal(review.config.provider?.modelId, "env-model");
      assert.equal(Object.hasOwn(review, "confirmationToken"), false); return accepted;
    },
    // Real registry observation; only external daemon dispatch/health/preflight are simulated.
    findWorkspace: async requested => {
      const records = await registry.listWorkspaces();
      for (const record of records) {
        const workspace = await registry.resolveVerifiedWorkspace(record.workspaceId);
        if (workspace.canonicalRoot !== requested) continue;
        return { schemaVersion: 1, registered: true, workspaceId: workspace.workspaceId, projectId: workspace.projectId,
          rootAlias: path.basename(workspace.canonicalRoot), safetyProfileConfigured: true,
          validationCommandsConfigured: workspace.safetyProfile.validationCommands.length > 0,
          authority: "first_run_workspace_observation", grantsAuthority: false };
      }
      return { schemaVersion: 1, registered: false, safetyProfileConfigured: false, validationCommandsConfigured: false,
        authority: "first_run_workspace_observation", grantsAuthority: false };
    },
    fetchJson: async url => {
      assert.equal(new URL(url).hostname, "127.0.0.1");
      return { ok: running, status: running ? 200 : 0,
        payload: { ok: preflightOk, privatePath: root, secret: "synthetic-value-must-stay-private" } };
    },
    dispatchLegacy: async (args, env) => {
      calls.push({ args, env });
      if (args[0] === "daemon") running = true;
    },
  };
  async function invoke(argv: string[]): Promise<Record<string, unknown>> {
    let output = "";
    const writer = t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"); return true;
    });
    try { await runProductCli(argv, deps); }
    finally { writer.mock.restore(); outputs.push(output); }
    return JSON.parse(output) as Record<string, unknown>;
  }
  async function register() {
    const project = await invoke(["setup-project", "Example"]);
    const workspaceInput = path.join(directory, "workspace.json");
    await writeFile(workspaceInput, JSON.stringify({ projectId: project.projectId, displayName: "Workspace", root, safetyProfile: profile }));
    const workspace = await invoke(["setup-workspace", workspaceInput]);
    return { project, workspace };
  }
  async function preserved() {
    assert.deepEqual((await readdir(root)).sort(), Object.keys(userFiles).sort());
    for (const [name, content] of Object.entries(userFiles)) assert.equal(await readFile(path.join(root, name), "utf8"), content);
    assert.doesNotMatch(outputs.join("\n"), /synthetic-value-must-stay-private|operator-owned secret-file sentinel/);
  }
  return { directory, root, registry, inputPath, configPath, deps, invoke, register, preserved, confirmations, reads, calls,
    decline: () => { accepted = false; }, degraded: () => { preflightOk = false; } };
}

test("M18B4 acceptance: diagnose/plan → create config → register project/workspace → confirmed dispatch → observation/task-client", async t => {
  const f = await fixture(t);
  for (const command of ["diagnose", "setup"]) {
    const observation = await f.invoke([command, f.root]); noAuthority(observation);
    assert.equal(observation.mutatesConfig, false); assert.equal(observation.registersWorkspace, false);
    assert.equal(observation.startsService, false);
    const payload = observation.payload as Record<string, unknown>;
    const assessment = (command === "setup" ? payload.assessment : payload) as unknown as FirstRunAssessmentV1;
    assert.equal(assessment.workspaceReady, false); assert.equal(assessment.daemonRunning, false);
    if (command === "setup") assert.equal(payload.mutationPerformed, false);
  }
  assert.equal(f.confirmations.length, 0); assert.equal(f.calls.length, 0);
  assert.deepEqual((await readdir(f.directory)).sort(), ["draft.json", "workspace"]);

  const created = await f.invoke(["setup-config", f.inputPath, f.configPath]); noAuthority(created);
  assert.equal(created.written, true);
  assert.deepEqual(JSON.parse(await readFile(f.configPath, "utf8")), draft);
  assert.deepEqual(await f.registry.listProjects(), []);
  const { project, workspace } = await f.register(); noAuthority(project); noAuthority(workspace);
  const saved = await f.registry.resolveVerifiedWorkspace(workspace.workspaceId as string);
  assert.equal(saved.projectId, project.projectId);
  const { profileId, revision, ...savedProfile } = saved.safetyProfile;
  assert.ok(profileId); assert.equal(revision, 1); assert.deepEqual(savedProfile, profile);

  const configBefore = await readFile(f.configPath, "utf8");
  const registryBefore = await readFile(f.registry.path, "utf8");
  const config = await f.invoke(["--config", f.configPath, "config"]); noAuthority(config);
  assert.equal((config.payload as typeof draft).provider.modelId, "env-model");
  assert.equal(f.calls.length, 0);
  f.reads.length = 0;
  const startup = await f.invoke(["--config", f.configPath, "setup-start", saved.workspaceId]); noAuthority(startup);
  noAuthority(startup.result as Record<string, unknown>);
  assert.equal(startup.dispatched, true);
  assert.deepEqual(f.reads, [f.configPath]);
  assert.deepEqual(f.confirmations, ["write_config", "register_project", "register_workspace", "start_loopback_daemon"]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]!.args, ["daemon", f.root]);
  assert.equal(f.calls[0]!.env.ORCH_MODEL, "env-model");
  assert.equal(f.calls[0]!.env.ORCH_API_KEY_SECRET_REF, "M18_ACCEPTANCE_PROVIDER_KEY");
  assert.equal(f.calls[0]!.env.ORCH_API_KEY, undefined);
  assert.equal(f.calls[0]!.env.ORCH_DAEMON_HOST, "127.0.0.1");
  assert.equal(f.calls[0]!.env.ORCH_DAEMON_PORT, "5431");
  assert.equal(f.calls[0]!.env.ORCH_DIFF_MAX_CHANGED_FILES, "1");
  assert.equal(f.calls[0]!.env.ORCH_DIFF_EXPECTED_PATHS, "src/only.ts");
  assert.equal(f.calls[0]!.env.ORCH_DIFF_PROTECTED_PATTERNS, "src/protected/**");
  assert.equal(f.calls[0]!.env.ORCH_AUTO_APPROVE_COMMANDS, "false");
  assert.equal(f.calls[0]!.env.ORCH_AUTO_APPROVE_EDITS, "false");
  const observed = await f.invoke(["--config", f.configPath, "diagnose", f.root]);
  const assessment = observed.payload as FirstRunAssessmentV1;
  assert.equal(assessment.workspaceReady, true); assert.equal(assessment.providerReady, true);
  assert.equal(assessment.daemonRunning, true); noAuthority(observed);
  const status = await f.invoke(["--config", f.configPath, "status", f.root]); noAuthority(status);
  assert.equal((status.payload as Record<string, unknown>).reachable, true);
  // Task-client handoff preserves the existing dispatcher; no task is actually run in this harness.
  const confirmationsBeforeTask = [...f.confirmations];
  await runProductCli(["--config", f.configPath, "run", f.root, "bounded goal"], f.deps);
  assert.deepEqual(f.calls[1]!.args, ["run", f.root, "bounded goal"]);
  assert.equal(f.calls[1]!.env.ORCH_API_KEY_SECRET_REF, undefined);
  assert.equal(f.calls[1]!.env.ORCH_DIFF_MAX_CHANGED_FILES, "1");
  assert.deepEqual(f.confirmations, confirmationsBeforeTask);
  assert.equal(await readFile(f.configPath, "utf8"), configBefore);
  assert.equal(await readFile(f.registry.path, "utf8"), registryBefore);
  await f.preserved();
});

test("M18B4 acceptance: declining any setup action cannot be replaced by a read-only plan", async t => {
  const f = await fixture(t); f.decline();
  assert.equal((await f.invoke(["setup-config", f.inputPath, f.configPath])).written, false);
  assert.equal((await f.invoke(["setup-project", "Example"])).registered, false);
  assert.deepEqual(await f.registry.listProjects(), []);
  assert.deepEqual((await readdir(f.directory)).sort(), ["draft.json", "workspace"]);
  // Provision existing registry state through its trusted boundary to test declines independently.
  const project = await f.registry.registerProject("Existing");
  const workspaceInput = path.join(f.directory, "workspace.json");
  await writeFile(workspaceInput, JSON.stringify({ projectId: project.projectId, displayName: "Workspace", root: f.root, safetyProfile: profile }));
  const registryBefore = await readFile(f.registry.path, "utf8");
  assert.equal((await f.invoke(["setup-workspace", workspaceInput])).registered, false);
  assert.equal(await readFile(f.registry.path, "utf8"), registryBefore);
  const workspace = await f.registry.registerWorkspace({ projectId: project.projectId, displayName: "Workspace", root: f.root, safetyProfile: profile });
  await writeFile(f.configPath, JSON.stringify(draft));
  const before = await readFile(f.registry.path, "utf8");
  const plan = await f.invoke(["--config", f.configPath, "setup", f.root]);
  assert.equal((plan.payload as Record<string, unknown>).mutationPerformed, false);
  const startup = await f.invoke(["--config", f.configPath, "setup-start", workspace.workspaceId]);
  assert.equal(startup.dispatched, false); assert.equal(f.calls.length, 0);
  assert.equal(await readFile(f.registry.path, "utf8"), before);
  await f.preserved();
});

test("M18B4 acceptance: invalid config cannot reach setup, observation or execution dispatch", async t => {
  const f = await fixture(t);
  const { workspace } = await f.register();
  const registryBefore = await readFile(f.registry.path, "utf8");
  const confirmationsBefore = [...f.confirmations];
  for (const bad of [{ schemaVersion: 1, daemon: { host: "0.0.0.0" } },
    { schemaVersion: 1, provider: { apiKey: "synthetic-private-key" } },
    { schemaVersion: 1, runtime: { maxTokensPerTurn: "4096suffix" } }]) {
    await writeFile(f.inputPath, JSON.stringify(bad));
    await writeFile(f.configPath, JSON.stringify(bad));
    for (const args of [["setup-config", f.inputPath, path.join(f.directory, "other.json")],
      ["--config", f.configPath, "setup", f.root], ["--config", f.configPath, "config"],
      ["--config", f.configPath, "setup-start", workspace.workspaceId as string],
      ["--config", f.configPath, "run", f.root, "bounded goal"]]) {
      await assert.rejects(f.invoke(args));
    }
  }
  assert.deepEqual(f.confirmations, confirmationsBefore); assert.equal(f.calls.length, 0);
  assert.equal(await readFile(f.registry.path, "utf8"), registryBefore);
  assert.equal((await readdir(f.directory)).includes("other.json"), false);
  await f.preserved();
});

test("M18B4 acceptance: a reviewed workspace/Safety change blocks startup while degraded observations stay read-only", async t => {
  const f = await fixture(t);
  await f.invoke(["setup-config", f.inputPath, f.configPath]);
  const { workspace } = await f.register();
  const configBefore = await readFile(f.configPath, "utf8");
  f.deps.confirmDaemonStart = async () => {
    await f.registry.updateSafetyProfile(workspace.workspaceId as string, { ...profile, maxChangedFiles: 4 }); return true;
  };
  await assert.rejects(f.invoke(["--config", f.configPath, "setup-start", workspace.workspaceId as string]),
    { code: "execution_failed" });
  assert.equal(f.calls.length, 0);
  f.deps.confirmDaemonStart = async () => true;
  await f.invoke(["--config", f.configPath, "setup-start", workspace.workspaceId as string]);
  f.degraded();
  const registryBefore = await readFile(f.registry.path, "utf8");
  const confirmationsBefore = [...f.confirmations];
  const callsBefore = f.calls.length;
  const diagnosis = await f.invoke(["--config", f.configPath, "diagnose", f.root]);
  assert.equal((diagnosis.payload as FirstRunAssessmentV1).providerReady, false); noAuthority(diagnosis);
  const plan = await f.invoke(["--config", f.configPath, "setup", f.root]); noAuthority(plan);
  assert.equal((plan.payload as Record<string, unknown>).mutationPerformed, false);
  assert.deepEqual(f.confirmations, confirmationsBefore); assert.equal(f.calls.length, callsBefore);
  assert.equal(await readFile(f.registry.path, "utf8"), registryBefore);
  assert.equal(await readFile(f.configPath, "utf8"), configBefore);
  await f.preserved();
});
