import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNativeProject, NativeProjectSetupError, NATIVE_PROJECT_SETUP_CONTRACT } from "./native-project-setup.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { routeProductCli } from "./product-cli.js";

async function disposable(run: (registry: WorkspaceRegistry, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m19c2b1-"));
  const registry = new WorkspaceRegistry(path.join(dir, "config", "workspace-registry.json"));
  try { await run(registry, dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("M19C2B1 project creation requires one reviewed confirmation and returns project ID", async () => {
  await disposable(async registry => {
    let approvals = 0;
    const result = await createNativeProject("Example Project", async review => {
      approvals++;
      assert.equal(review.kind, "project-review");
      assert.equal(review.projectName, "Example Project");
      assert.equal(review.destination, "local_user_workspace_registry");
      assert.equal(review.requiresExactReply, "REGISTER PROJECT");
      assert.equal(review.grantsAuthority, false);
      assert.equal((await registry.listProjects()).length, 0);
      return true;
    }, registry);
    assert.equal(approvals, 1);
    assert.equal(result.outcome, "created");
    assert.match(result.projectId!, /^[0-9a-f-]{36}$/);
    assert.equal((await registry.listProjects())[0]?.projectId, result.projectId);
    assert.equal(NATIVE_PROJECT_SETUP_CONTRACT.launchesTask, false);
  });
});

test("M19C2B1 decline does not write a registry", async () => {
  await disposable(async registry => {
    const result = await createNativeProject("Example Project", async () => false, registry);
    assert.deepEqual(result, { schemaVersion: 1, kind: "project-result",
      outcome: "cancelled", grantsAuthority: false });
    assert.equal((await registry.listProjects()).length, 0);
  });
});

test("M19C2B1 invalid names do not reach confirmation", async () => {
  await disposable(async registry => {
    let called = false;
    for (const name of ["", "../bad", "evil\nname", " x", "a".repeat(121), "☃", "\u0000"]) {
      await assert.rejects(createNativeProject(name, async () => { called = true; return true; }, registry),
        (error: unknown) => error instanceof NativeProjectSetupError);
    }
    assert.equal(called, false);
  });
});

test("M19C2B1 rejects malformed/symlink registries without replacing their contents", async () => {
  await disposable(async (registry, dir) => {
    await mkdir(path.dirname(registry.path), { recursive: true });
    await writeFile(registry.path, "EXISTING-SENTINEL");
    await assert.rejects(createNativeProject("New Project", async () => true, registry),
      { code: "registration_failed" });
    assert.equal(await readFile(registry.path, "utf8"), "EXISTING-SENTINEL");
    await rm(registry.path);
    const target = path.join(dir, "preserved.json");
    await writeFile(target, "PRESERVED");
    await symlink(target, registry.path);
    await assert.rejects(createNativeProject("New Project", async () => true, registry),
      { code: "registration_failed" });
    assert.equal(await readFile(target, "utf8"), "PRESERVED");
  });
});

test("M19C2B1 native CLI route uses one display name and refuses config-file overrides", () => {
  assert.deepEqual(routeProductCli(["setup-project-desktop", "My Project"]), {
    kind: "desktop_project_create", displayName: "My Project",
  });
  for (const args of [["setup-project-desktop"], ["setup-project-desktop", "Name", "extra"],
    ["--config", "some.json", "setup-project-desktop", "Name"]]) {
    assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  }
});
