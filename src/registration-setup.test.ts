import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { runRegistrationSetup } from "./registration-setup.js";
import { routeProductCli, runProductCli, type ProductCliDependencies } from "./product-cli.js";

const profile = { policyVersion: "safety-v1", workerProfileId: "local-worker", maxChangedFiles: 3,
  allowedPathPatterns: ["src/**"], protectedPathPatterns: ["src/auth/**"], validationCommands: ["npm test"] };

async function disposable(body: (directory: string, registry: WorkspaceRegistry, root: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b3c-"));
  const root = path.join(directory, "workspace");
  await mkdir(root);
  const registry = new WorkspaceRegistry(path.join(directory, "state", "registry.json"));
  try { await body(directory, registry, root); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("M18B3c project and workspace each require their own confirmation through the real registry", async () => {
  await disposable(async (directory, registry, root) => {
    const projectInput = { displayName: " Example project " };
    const project = await runRegistrationSetup("register_project", projectInput, async review => {
      assert.deepEqual(await readdir(directory), ["workspace"]);
      assert.equal(review.action, "register_project");
      assert.equal(review.registryPath, registry.path);
      assert.deepEqual(review.registration, { displayName: "Example project" });
      assert.equal(Object.hasOwn(review, "confirmationToken"), false);
      projectInput.displayName = "caller mutation";
      review.registration.displayName = "display mutation";
      return true;
    }, registry);
    assert.equal(project.registered, true);
    assert.equal(project.grantsAuthority, false);
    assert.equal(project.result?.grantsTaskAuthority, false);
    assert.deepEqual(await registry.listWorkspaces(), []);
    assert.equal((await registry.listProjects())[0]?.displayName, "Example project");
    const input = { projectId: project.projectId!, displayName: "Workspace", root, safetyProfile: structuredClone(profile) };
    const workspace = await runRegistrationSetup("register_workspace", input, async review => {
      assert.equal(review.action, "register_workspace");
      assert.equal(review.canonicalRoot, root);
      assert.deepEqual((review.registration.safetyProfile), profile);
      assert.deepEqual(await registry.listWorkspaces(), []);
      input.safetyProfile.allowedPathPatterns.push("**");
      (review.registration.safetyProfile as typeof profile).maxChangedFiles = 100;
      return true;
    }, registry);
    const saved = await registry.resolveVerifiedWorkspace(workspace.workspaceId!);
    assert.equal(saved.projectId, project.projectId);
    assert.equal(saved.canonicalRoot, root);
    const { profileId, revision, ...savedProfile } = saved.safetyProfile;
    assert.ok(profileId);
    assert.equal(revision, 1);
    assert.deepEqual(savedProfile, profile);
    assert.equal(workspace.result?.grantsFilesystemAuthority, false);
    assert.deepEqual(await readdir(root), []);
  });
});

test("M18B3c decline and expiry leave registry and workspace unchanged", async () => {
  await disposable(async (directory, registry, root) => {
    const declined = await runRegistrationSetup("register_project", { displayName: "Example" }, async () => false, registry);
    assert.equal(declined.registered, false);
    assert.deepEqual(await readdir(directory), ["workspace"]);
    const project = await registry.registerProject("Existing");
    const before = await readFile(registry.path, "utf8");
    let now = 100_000;
    await assert.rejects(runRegistrationSetup("register_workspace", { projectId: project.projectId,
      displayName: "Workspace", root, safetyProfile: profile }, async () => { now += 60_000; return true; },
    registry, { now: () => now }), { code: "confirmation_expired" });
    assert.equal(await readFile(registry.path, "utf8"), before);
    assert.deepEqual(await readdir(root), []);
  });
});

test("M18B3c strict inputs and existing registry guards reject before confirmation", async () => {
  await disposable(async (directory, registry, root) => {
    const project = await registry.registerProject("Existing");
    const input = { projectId: project.projectId, displayName: "Workspace", root, safetyProfile: profile };
    const before = await readFile(registry.path, "utf8");
    let confirmations = 0;
    const confirm = async () => { confirmations++; return true; };
    for (const bad of [
      { ...input, safetyProfile: undefined }, { ...input, unknown: true },
      { ...input, safetyProfile: { ...profile, allowedPathPatterns: undefined } },
      { ...input, safetyProfile: { ...profile, maxChangedFiles: "3" } },
      { ...input, safetyProfile: { ...profile, profileId: "override" } },
      { ...input, projectId: "missing-project" }, { ...input, root: path.parse(root).root },
      { ...input, root: path.join(directory, "missing") },
      { ...input, displayName: "bad\nname" },
    ]) await assert.rejects(runRegistrationSetup("register_workspace", bad, confirm, registry));
    await assert.rejects(runRegistrationSetup("register_project", { displayName: "", apiKey: "synthetic-secret" }, confirm, registry));
    // Existing generic setup secret-material guard is preserved.
    await assert.rejects(runRegistrationSetup("register_project", { displayName: "bearer synthetic-secret" }, confirm, registry),
      { code: "payload_invalid" });
    assert.equal(confirmations, 0);
    assert.equal(await readFile(registry.path, "utf8"), before);
    await registry.registerWorkspace(input);
    await assert.rejects(runRegistrationSetup("register_workspace", input, confirm, registry),
      { code: "registration_invalid" });
    assert.equal(confirmations, 0);
  });
});

test("M18B3c registry drift during confirmation preserves the external change", async () => {
  await disposable(async (_directory, registry) => {
    await assert.rejects(runRegistrationSetup("register_project", { displayName: "Previewed" }, async () => {
      await registry.registerProject("External change"); return true;
    }, registry), { code: "execution_failed" });
    assert.deepEqual((await registry.listProjects()).map(item => item.displayName), ["External change"]);
  });
});

test("M18B3c workspace root replacement and symlink retargeting after review fail closed", async () => {
  await disposable(async (directory, registry, root) => {
    const project = await registry.registerProject("Existing");
    const before = await readFile(registry.path, "utf8");
    const input = { projectId: project.projectId, displayName: "Workspace", root, safetyProfile: profile };
    await assert.rejects(runRegistrationSetup("register_workspace", input, async () => {
      await rename(root, root + "-old"); await mkdir(root); return true;
    }, registry), { code: "execution_failed" });
    assert.equal(await readFile(registry.path, "utf8"), before);
    const alias = path.join(directory, "alias");
    await symlink(root, alias);
    await assert.rejects(runRegistrationSetup("register_workspace", { ...input, root: alias }, async () => {
      await rm(alias); await symlink(root + "-old", alias); return true;
    }, registry), { code: "execution_failed" });
    assert.equal(await readFile(registry.path, "utf8"), before);
  });
});

test("M18B3c malformed/symlink registry is refused without confirmation or replacement", async () => {
  await disposable(async (directory, registry) => {
    await mkdir(path.dirname(registry.path));
    await writeFile(registry.path, "invalid-registry-private-sentinel");
    let confirmations = 0;
    const confirm = async () => { confirmations++; return true; };
    await assert.rejects(runRegistrationSetup("register_project", { displayName: "Example" }, confirm, registry),
      { code: "registration_invalid" });
    await rm(registry.path);
    const other = path.join(directory, "other.json");
    await writeFile(other, "protected"); await symlink(other, registry.path);
    await assert.rejects(runRegistrationSetup("register_project", { displayName: "Example" }, confirm, registry),
      { code: "registry_invalid" });
    assert.equal(await readFile(other, "utf8"), "protected");
    assert.equal(confirmations, 0);
  });
});

test("M18B3c simultaneous adapter confirmations cannot lose a registration", async () => {
  await disposable(async (_directory, registry) => {
    let previews = 0;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const confirm = async () => { if (++previews === 2) release(); await ready; return true; };
    const outcomes = await Promise.allSettled(["One", "Two"].map(displayName =>
      runRegistrationSetup("register_project", { displayName }, confirm, registry)));
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal((await registry.listProjects()).length, 1);
  });
});

test("M18B3c CLI routes and real dispatcher use separate setup actions without legacy task dispatch", async () => {
  assert.deepEqual(routeProductCli(["setup-project", "Example"]), { kind: "setup_project", displayName: "Example" });
  assert.deepEqual(routeProductCli(["setup-workspace", "input.json"]), { kind: "setup_workspace", inputPath: "input.json" });
  for (const args of [["setup-project"], ["setup-workspace", "one", "two"],
    ["--config", "config.json", "setup-project", "Example"]]) {
    assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  }
  await disposable(async (_directory, registry, root) => {
    let confirmations = 0;
    let reads = 0;
    const deps: ProductCliDependencies = {
      env: { ORCH_CONFIG_FILE: "must-not-read.json", ORCH_API_KEY: "synthetic-private-value" },
      runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
      registrationRegistry: registry,
      confirmRegistration: async review => { confirmations++; return review.action === "register_project" || review.action === "register_workspace"; },
      dispatchLegacy: async () => { assert.fail("setup must not dispatch a task or daemon"); },
      findWorkspace: async () => { assert.fail("setup must not infer workspace authority"); },
      fetchJson: async () => { assert.fail("setup must not contact a listener"); },
      readConfigFile: async () => {
        reads++;
        const project = (await registry.listProjects())[0]!;
        return JSON.stringify({ projectId: project.projectId, displayName: "Workspace", root, safetyProfile: profile });
      },
    };
    await runProductCli(["setup-project", "Example"], deps);
    assert.equal(reads, 0);
    await runProductCli(["setup-workspace", "input.json"], deps);
    assert.equal(reads, 1);
    assert.equal(confirmations, 2);
    assert.equal((await registry.listWorkspaces()).length, 1);
  });
});

test("M18B3c actual non-TTY CLI refuses piped project confirmation without registry writes", async () => {
  await disposable(async (directory) => {
    const configHome = path.join(directory, "config-home");
    const result = spawnSync(process.execPath,
      ["--import", "tsx", "src/product-cli.ts", "setup-project", "Example"],
      { encoding: "utf8", input: "REGISTER PROJECT\n", timeout: 30_000,
        env: { ...process.env, XDG_CONFIG_HOME: configHome, LOCALAPPDATA: configHome } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an interactive terminal/);
    assert.doesNotMatch(result.stderr, /m18b3c-/);
    assert.deepEqual(await readdir(directory), ["workspace"]);
  });
});
