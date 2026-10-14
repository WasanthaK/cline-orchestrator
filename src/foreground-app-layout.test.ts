import assert from "node:assert/strict";
import test from "node:test";
import {
  FOREGROUND_APP_LAYOUT_CONTRACT,
  ForegroundAppLayoutError,
  planForegroundAppLayout,
} from "./foreground-app-layout.js";

const request = {
  platform: "windows" as const,
  version: "0.1.0",
  productRoot: "C:\\Users\\Operator\\AppData\\Local\\Programs\\ClineOrchestrator",
  stateRoot: "C:\\Users\\Operator\\AppData\\Local\\ClineOrchestratorState",
};

test("M19A foreground app layout reuses installer ownership and excludes services", () => {
  const plan = planForegroundAppLayout(request);
  assert.equal(plan.authority, "foreground_app_layout_observation_only");
  assert.equal(plan.install.action, "install");
  assert.equal(plan.uninstall.action, "uninstall");
  assert.deepEqual(plan.install.serviceRegistrations, []);
  assert.deepEqual(plan.uninstall.serviceRegistrations, []);
  assert.ok(plan.install.productOwnedPaths.includes("runtime/node.exe"));
  assert.ok(plan.install.productOwnedPaths.includes("launcher/ClineOrchestrator.exe"));
  assert.deepEqual(plan.install.preservedUserOwnedPaths, [
    "operator-data/config", "operator-data/secrets", "operator-data/tasks",
    "operator-data/workspaces",
  ]);
  assert.deepEqual(plan.uninstall.preservedUserOwnedPaths, plan.install.preservedUserOwnedPaths);
  assert.equal(plan.userStatePreserved, true);
  assert.equal(plan.bundledRuntimeRequired, true);
  assert.equal(plan.mutatesFilesystem, false);
  assert.equal(plan.grantsAuthority, false);
  assert.equal(FOREGROUND_APP_LAYOUT_CONTRACT.launchesTask, false);
  assert.equal(FOREGROUND_APP_LAYOUT_CONTRACT.exposesBrowserMutation, false);
});

test("M19A rejects nested, identical or aliasing app and operator-state roots", () => {
  for (const stateRoot of [
    request.productRoot,
    request.productRoot + "\\config",
    request.productRoot.toUpperCase() + "\\data",
    "C:\\Users\\Operator\\AppData\\Local",
  ]) {
    assert.throws(() => planForegroundAppLayout({ ...request, stateRoot }),
      (error: unknown) => error instanceof ForegroundAppLayoutError);
  }
});

test("M19A rejects relative/system-root, UNC and traversal targets", () => {
  for (const productRoot of [
    ".", "..\\Cline", "C:\\", "\\\\server\\share\\Cline",
    "C:\\Apps\\..\\Cline", "C:\\Apps\\bad?name",
    "/tmp/installer", "",
  ]) {
    assert.throws(() => planForegroundAppLayout({ ...request, productRoot }),
      (error: unknown) => error instanceof ForegroundAppLayoutError);
  }
});

test("M19A rejects untrusted platform and invalid version", () => {
  assert.throws(() => planForegroundAppLayout({ ...request, platform: "linux" as never }),
    (error: unknown) => error instanceof ForegroundAppLayoutError);
  assert.throws(() => planForegroundAppLayout({ ...request, version: "../bad" }),
    (error: unknown) => error instanceof ForegroundAppLayoutError);
});
