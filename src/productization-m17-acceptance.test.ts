import assert from "node:assert/strict";
import test from "node:test";
import { assessFirstRun, type FirstRunAssessmentV1, type FirstRunWorkspaceObservationV1 } from "./first-run-assessment.js";
import { FirstRunSetupService, type FirstRunSetupDriver, type FirstRunSetupAction } from "./first-run-setup.js";
import { resolveProductConfig } from "./product-config.js";
import { routeProductCli, runNativeProductCommand, productCliUsage, type ProductCliDependencies } from "./product-cli.js";
import { LocalServiceLifecycleService, type LocalServiceSpecV1 } from "./local-service-lifecycle.js";
import { planInstall, planUninstall, type InstallManifestV1 } from "./installer-packaging.js";
import { ProductionReadinessEvaluator } from "./production-readiness.js";

const NOW = new Date("2026-10-08T10:00:00.000Z");

function noAuthority(value: object): void {
  const record = value as Record<string, unknown>;
  const flags = Object.entries(record).filter(([key]) => key.startsWith("grants"));
  assert.ok(flags.length > 0);
  for (const [key, flag] of flags) assert.equal(flag, false, key);
}

function fixture(platform: "windows" | "linux") {
  let configFile: unknown = undefined;
  let registered = false;
  let installed = false;
  let running = false;
  let preflightOk = true;
  const mutations: string[] = [];
  const reads: string[] = [];
  const userData = new Map([
    ["config/product.json", "operator-config"],
    ["state/workspaces", "registry"],
    ["state/secrets", "secret-sentinel"],
    ["state/tasks", "task-sentinel"],
  ]);
  const manifest: InstallManifestV1 = {
    schemaVersion: 1, platform, version: "0.1.0",
    authority: "install_manifest_plan_only", grantsAuthority: false,
    entries: [
      { path: "bin/product-cli.js", ownership: "product_owned", kind: "file" },
      { path: "orchestrator-service", ownership: "product_owned", kind: "service_registration" },
      { path: "config/product.json", ownership: "user_owned_config", kind: "file" },
      { path: "state/workspaces", ownership: "user_owned_workspace_registry", kind: "directory" },
      { path: "state/secrets", ownership: "user_owned_secrets", kind: "directory" },
      { path: "state/tasks", ownership: "user_owned_task_state", kind: "directory" },
    ],
  };
  const workspace = (): FirstRunWorkspaceObservationV1 => ({
    schemaVersion: 1, registered,
    ...(registered ? {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      rootAlias: "workspace",
    } : {}),
    safetyProfileConfigured: registered, validationCommandsConfigured: registered,
    authority: "first_run_workspace_observation", grantsAuthority: false,
  });
  const deps: ProductCliDependencies = {
    env: { ORCH_PROVIDER: "openai-compatible", ORCH_MODEL: "qwen38-27b-192k", ORCH_BASE_URL: "http://127.0.0.1:8080/v1" },
    runtime: { nodeVersion: "v22.23.3", platform: platform === "windows" ? "win32" : "linux", architecture: "x64" },
    async findWorkspace() { reads.push("registry"); return workspace(); },
    async fetchJson(url) {
      reads.push(url);
      assert.equal(new URL(url).hostname, "127.0.0.1");
      return { ok: running, status: running ? 200 : 0,
        payload: { ok: preflightOk, privatePath: "/private/operator", token: "secret-sentinel" } };
    },
  };
  const spec: LocalServiceSpecV1 = {
    schemaVersion: 1, manager: platform === "windows" ? "windows-service" : "systemd",
    serviceName: "cline-orchestrator", displayName: "Cline Orchestrator",
    executable: "node", args: ["dist/product-cli.js", "start", "workspace"],
    workingDirectory: "product", configPath: "config/product.json",
    secretReferenceNames: ["PROVIDER_KEY"], daemonHost: "127.0.0.1", daemonPort: 4317,
    autoStart: false, authority: "local_service_specification_only", grantsAuthority: false,
  };
  // Only external effects are faked; the real assessment/config/CLI/setup/
  // lifecycle/installer boundaries decide what may reach these drivers.
  const driver: FirstRunSetupDriver = {
    async writeConfig(payload) {
      resolveProductConfig(payload);
      configFile = structuredClone(payload);
      userData.set("config/product.json", JSON.stringify(configFile));
      mutations.push("write_config");
    },
    async registerProject() { mutations.push("register_project"); },
    async registerWorkspace() { registered = true; mutations.push("register_workspace"); },
    async startLoopbackDaemon() { running = true; mutations.push("start_loopback_daemon"); },
  };
  const lifecycle = new LocalServiceLifecycleService({
    async install() { installed = true; mutations.push("service_install"); },
    async start() { running = true; mutations.push("service_start"); },
    async stop() { running = false; mutations.push("service_stop"); },
    async status(input) {
      return { schemaVersion: 1, serviceName: input.serviceName, manager: input.manager,
        installed, running, authority: "local_service_status_observation", grantsAuthority: false };
    },
  }, { now: () => NOW });
  async function native(argv: string[]) {
    const route = routeProductCli(argv);
    assert.equal(route.kind, "native");
    if (route.kind !== "native") throw new Error("native route required");
    const before = [...mutations];
    const result = await runNativeProductCommand(route, deps);
    assert.deepEqual(mutations, before);
    noAuthority(result);
    assert.equal(result.mutatesConfig, false);
    assert.equal(result.registersWorkspace, false);
    assert.equal(result.startsService, false);
    assert.equal(result.performsNetworkMutation, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-sentinel|private\/operator/);
    return result;
  }
  return { manifest, deps, spec, driver, lifecycle, native, mutations, reads, userData, workspace,
    config: () => resolveProductConfig(configFile, deps.env),
    failPreflight: () => { preflightOk = false; } };
}

for (const platform of ["windows", "linux"] as const) {
  test(`M17H acceptance: ${platform} install plan → diagnose → confirmed setup → service lifecycle → uninstall plan`, async () => {
    const f = fixture(platform);
    const install = planInstall(f.manifest);
    assert.deepEqual(install, planInstall(f.manifest));
    noAuthority(install);
    assert.equal(install.mutatesFilesystem, false);
    assert.equal(install.mutatesServiceManager, false);
    assert.equal(install.explicitExecutionRequired, true);
    assert.deepEqual(f.mutations, []);

    const initial = (await f.native(["diagnose", "workspace"])).payload as FirstRunAssessmentV1;
    assert.equal(initial.status, "needs_setup");
    assert.equal(initial.workspaceReady, false);
    assert.equal(initial.providerReady, false);
    const setupPlan = (await f.native(["setup", "workspace"])).payload as {
      mutationPerformed: boolean; explicitM17CConfirmationRequiredForMutation: boolean;
    };
    assert.equal(setupPlan.mutationPerformed, false);
    assert.equal(setupPlan.explicitM17CConfirmationRequiredForMutation, true);
    await f.native(["config"]);

    const setup = new FirstRunSetupService(f.driver, { now: () => NOW.getTime() });
    const requests: Array<{ action: FirstRunSetupAction; payload: Record<string, unknown> }> = [
      { action: "write_config", payload: { schemaVersion: 1, provider: {
        providerId: "openai-compatible", modelId: "qwen38-27b-192k", baseUrl: "http://127.0.0.1:8080/v1" } } },
      { action: "register_project", payload: { name: "project" } },
      { action: "register_workspace", payload: { root: "workspace", safetyProfile: { validationCommands: ["npm test"] } } },
    ];
    for (const request of requests) {
      const before = [...f.mutations];
      const preview = await setup.preview({ schemaVersion: 1, ...request });
      noAuthority(preview);
      assert.deepEqual(f.mutations, before);
      const confirmation = { action: preview.action, payloadDigest: preview.payloadDigest,
        confirmationToken: preview.confirmationToken, confirmed: true as const };
      noAuthority(await setup.execute(confirmation));
      assert.equal(f.mutations.length, before.length + 1);
      await assert.rejects(setup.execute(confirmation), { code: "confirmation_invalid" });
      assert.equal(f.mutations.length, before.length + 1);
    }
    const config = f.config();
    noAuthority(config);
    assert.equal(config.provider.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(config.runtime.autoApproveCommands, false);
    assert.equal(config.runtime.autoApproveEdits, false);
    assert.equal(config.daemon.host, "127.0.0.1");

    assert.deepEqual(routeProductCli(["start", "workspace"]), { kind: "legacy", args: ["daemon", "workspace"] });
    noAuthority(await f.lifecycle.execute("install", f.spec));
    assert.equal((await f.lifecycle.execute("status", f.spec)).status?.running, false);
    noAuthority(await f.lifecycle.execute("start", f.spec));
    const ready = (await f.native(["diagnose", "workspace"])).payload as FirstRunAssessmentV1;
    assert.equal(ready.status, "ready");
    noAuthority(ready);
    assert.deepEqual((await f.native(["status", "workspace"])).payload, { reachable: true, httpStatus: 200, loopback: true });

    // Readiness/preflight loss after setup cannot be repaired by observation.
    f.failPreflight();
    const beforeLoss = [...f.mutations];
    assert.equal(((await f.native(["diagnose", "workspace"])).payload as FirstRunAssessmentV1).status, "needs_setup");
    assert.deepEqual(f.mutations, beforeLoss);
    noAuthority(await f.lifecycle.execute("stop", f.spec));
    assert.equal((await f.lifecycle.execute("status", f.spec)).status?.running, false);
    assert.equal(((await f.native(["status", "workspace"])).payload as { reachable: boolean }).reachable, false);

    const retained = [...f.userData];
    const beforeUninstall = [...f.mutations];
    const uninstall = planUninstall(f.manifest);
    assert.deepEqual(uninstall, planUninstall(f.manifest));
    assert.deepEqual(uninstall.preservedUserOwnedPaths, [...f.userData.keys()].sort());
    assert.deepEqual(uninstall.productOwnedPaths, install.productOwnedPaths);
    assert.deepEqual(uninstall.serviceRegistrations, install.serviceRegistrations);
    assert.equal(uninstall.destructiveUserDataDeletionRequested, false);
    assert.equal(uninstall.mutatesFilesystem, false);
    assert.equal(uninstall.mutatesServiceManager, false);
    noAuthority(uninstall);
    assert.deepEqual([...f.userData], retained);
    assert.deepEqual(f.mutations, beforeUninstall);
    assert.deepEqual(f.mutations, ["write_config", "register_project", "register_workspace", "service_install", "service_start", "service_stop"]);
  });
}

test("M17H acceptance: confirmation expires, is action-bound, and cannot survive reconstruction or failed execution", async () => {
  const f = fixture("linux");
  let now = NOW.getTime();
  const setup = new FirstRunSetupService(f.driver, { now: () => now });
  const preview = await setup.preview({ schemaVersion: 1, action: "start_loopback_daemon", payload: { host: "127.0.0.1" } });
  const confirmation = { action: preview.action, payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true as const };
  await assert.rejects(setup.execute({ ...confirmation, action: "register_workspace" }), { code: "confirmation_invalid" });
  await assert.rejects(setup.execute({ ...confirmation, payloadDigest: "wrong" }), { code: "confirmation_invalid" });
  await assert.rejects(new FirstRunSetupService(f.driver).execute(confirmation), { code: "confirmation_invalid" });
  now += 60_000;
  await assert.rejects(setup.execute(confirmation), { code: "confirmation_expired" });
  assert.deepEqual(f.mutations, []);

  const failing = new FirstRunSetupService({ ...f.driver, async startLoopbackDaemon() { throw new Error("external failure"); } });
  const failedPreview = await failing.preview({ schemaVersion: 1, action: "start_loopback_daemon", payload: { host: "127.0.0.1" } });
  const failedConfirmation = { action: failedPreview.action, payloadDigest: failedPreview.payloadDigest,
    confirmationToken: failedPreview.confirmationToken, confirmed: true as const };
  await assert.rejects(failing.execute(failedConfirmation), { code: "execution_failed" });
  await assert.rejects(failing.execute(failedConfirmation), { code: "confirmation_invalid" });
  assert.deepEqual(f.mutations, []);
});

test("M17H acceptance: remote/secret/ownership widening fails before external effects", async () => {
  const f = fixture("linux");
  const setup = new FirstRunSetupService(f.driver);
  await assert.rejects(setup.preview({ schemaVersion: 1, action: "start_loopback_daemon", payload: { host: "0.0.0.0" } }), { code: "payload_invalid" });
  await assert.rejects(setup.preview({ schemaVersion: 1, action: "write_config", payload: { apiKey: "secret-sentinel" } }), { code: "payload_invalid" });
  assert.throws(() => resolveProductConfig({ schemaVersion: 1, daemon: { host: "0.0.0.0" } }), { code: "config_invalid" });
  assert.throws(() => resolveProductConfig({ schemaVersion: 1, provider: { apiKey: "secret-sentinel" } }), { code: "secret_material_rejected" });
  await assert.rejects(f.lifecycle.execute("start", { ...f.spec, daemonHost: "0.0.0.0" } as unknown as LocalServiceSpecV1), { code: "spec_invalid" });
  await assert.rejects(f.lifecycle.execute("install", { ...f.spec, autoStart: true } as unknown as LocalServiceSpecV1), { code: "spec_invalid" });
  const bad = structuredClone(f.manifest);
  bad.entries[0]!.path = "../outside";
  assert.throws(() => planInstall(bad), { code: "path_invalid" });
  assert.throws(() => planUninstall(bad), { code: "path_invalid" });
  const ownership = structuredClone(f.manifest);
  ownership.entries[1]!.ownership = "user_owned_secrets";
  assert.throws(() => planUninstall(ownership), { code: "manifest_invalid" });
  assert.deepEqual(f.mutations, []);
});

test("M17H acceptance: production observability loss blocks first-run assessment without setup authority", async () => {
  const f = fixture("linux");
  const readiness = await new ProductionReadinessEvaluator(new Map(), { now: () => NOW }).evaluate();
  const assessment = assessFirstRun({
    runtime: { schemaVersion: 1, ...f.deps.runtime, authority: "first_run_runtime_observation", grantsAuthority: false },
    provider: { schemaVersion: 1, configured: true, preflightSupported: true, preflightOk: true,
      authority: "first_run_provider_observation", grantsAuthority: false },
    workspace: f.workspace(),
    daemon: { schemaVersion: 1, hostClass: "loopback", port: 4317, running: true,
      authority: "first_run_daemon_observation", grantsAuthority: false },
    readiness,
  }, { now: () => NOW });
  assert.equal(assessment.status, "blocked");
  assert.equal(assessment.productionReady, false);
  assert.ok(assessment.summaryCodes.includes("production_not_ready"));
  noAuthority(assessment);
  noAuthority(readiness);
  assert.deepEqual(f.mutations, []);
  assert.match(productCliUsage(), /read-only setup plan/);
  assert.match(productCliUsage(), /existing authority-enforcing dispatcher/);
});
