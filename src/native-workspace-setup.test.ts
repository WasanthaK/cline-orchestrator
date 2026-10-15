import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { listNativeProjects, registerNativeWorkspace, NativeWorkspaceSetupError,
  NATIVE_WORKSPACE_SETUP_CONTRACT } from "./native-workspace-setup.js";
import { routeProductCli } from "./product-cli.js";

async function disposable(run: (registry: WorkspaceRegistry, root: string, base: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m19c2b2-"));
  const root = path.join(dir, "workspace");
  await mkdir(root);
  const registry = new WorkspaceRegistry(path.join(dir, "registry", "workspace-registry.json"));
  try { await run(registry, root, dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const safetyProfile = {
  policyVersion: "v1", workerProfileId: "local-qwen", maxChangedFiles: 1,
  allowedPathPatterns: ["test/**"], protectedPathPatterns: ["src/**"],
  validationCommands: ["npm test"],
};
async function input(registry: WorkspaceRegistry, root: string) {
  const project = await registry.registerProject("Test Project");
  return { projectId: project.projectId, displayName: "Test Workspace", root, safetyProfile };
}
test("M19C2B2 project choices are read-only and scoped to actual registry", async () => {
  await disposable(async registry => {
    await registry.registerProject("Test Project");
    const result = await listNativeProjects(registry);
    assert.equal(result.projects.length, 1);
    assert.equal(result.grantsAuthority, false);
    assert.equal((await registry.listWorkspaces()).length, 0);
  });
});
test("M19C2B2 canonical root and every Safety field must be confirmed", async () => {
  await disposable(async (registry, root) => {
    const selected = await input(registry, root);
    let reviews = 0;
    const result = await registerNativeWorkspace(selected, async review => {
      reviews++;
      assert.equal(review.kind, "workspace-review");
      assert.equal(review.canonicalRoot, await (await import("node:fs/promises")).realpath(root));
      assert.deepEqual(review.registration.safetyProfile, safetyProfile);
      assert.equal(review.requiresExactReply, "REGISTER WORKSPACE");
      assert.equal(review.grantsAuthority, false);
      assert.equal((await registry.listWorkspaces()).length, 0);
      return true;
    }, registry);
    assert.equal(reviews, 1);
    assert.equal(result.outcome, "registered");
    assert.match(result.workspaceId!, /^[0-9a-f-]{36}$/);
    assert.equal((await registry.listWorkspaces()).length, 1);
    assert.equal(NATIVE_WORKSPACE_SETUP_CONTRACT.launchesTask, false);
  });
});
test("M19C2B2 decline, duplicate root, root swap and malformed registry reject safely", async () => {
  await disposable(async (registry, root, dir) => {
    const selected = await input(registry, root);
    const no = await registerNativeWorkspace(selected, async () => false, registry);
    assert.equal(no.outcome, "cancelled");
    assert.equal((await registry.listWorkspaces()).length, 0);
    await registerNativeWorkspace(selected, async () => true, registry);
    await assert.rejects(registerNativeWorkspace(selected, async () => true, registry),
      { code: "registration_failed" });
    const before = await readFile(registry.path, "utf8");
    // Switch a separately valid symlinked folder after review; the backend
    // must re-check the canonical target before publishing a registry entry.
    const secondary = path.join(dir, "secondary");
    await mkdir(secondary);
    const alias = path.join(dir, "alias");
    await symlink(secondary, alias, "dir");
    let reachedReview = false;
    await assert.rejects(registerNativeWorkspace({ ...selected, root: alias }, async review => {
      reachedReview = true;
      assert.equal(review.canonicalRoot, await (await import("node:fs/promises")).realpath(secondary));
      await rm(alias);
      await symlink(dir, alias, "dir");
      return true;
    }, registry), { code: "registration_failed" });
    assert.equal(reachedReview, true);
    assert.equal(await readFile(registry.path, "utf8"), before);
  });
});
test("M19C2B2 fails closed for missing Safety clauses or system-root path", async () => {
  await disposable(async (registry, root) => {
    const selected = await input(registry, root);
    let confirmations = 0;
    const approve = async () => { confirmations++; return true; };
    for (const invalid of [
      { ...selected, safetyProfile: { ...safetyProfile, allowedPathPatterns: [] } },
      { ...selected, safetyProfile: { ...safetyProfile, protectedPathPatterns: [] } },
      { ...selected, safetyProfile: { ...safetyProfile, validationCommands: [] } },
      { ...selected, safetyProfile: { ...safetyProfile, allowedPathPatterns: ["**"] } },
      { ...selected, safetyProfile: { ...safetyProfile, validationCommands: ["npm test\nunsafe"] } },
      { ...selected, safetyProfile: { ...safetyProfile, maxChangedFiles: -1 } },
      { ...selected, root: "C:\\" },
      { ...selected, displayName: "../unsafe" },
    ]) await assert.rejects(registerNativeWorkspace(invalid, approve, registry),
      (error: unknown) => error instanceof NativeWorkspaceSetupError);
    assert.equal(confirmations, 0);
    assert.equal((await registry.listWorkspaces()).length, 0);
  });
});
test("M19C2B2 routes are isolated and --config cannot attach to setup bridge", () => {
  assert.deepEqual(routeProductCli(["list-projects-desktop"]), { kind: "desktop_project_list" });
  assert.deepEqual(routeProductCli(["setup-workspace-desktop"]), { kind: "desktop_workspace_create" });
  for (const args of [["setup-workspace-desktop", "extra"], ["list-projects-desktop", "x"],
    ["--config", "file.json", "setup-workspace-desktop"]]) {
    assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  }
});
