import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTALLER_PACKAGING_CONTRACT,
  InstallerPackagingError,
  planInstall,
  planUninstall,
  type InstallManifestV1,
} from "./installer-packaging.js";

const manifest: InstallManifestV1 = {
  schemaVersion: 1,
  platform: "windows",
  version: "0.1.0",
  entries: [
    { path: "bin/cline-orchestrator.exe", ownership: "product_owned", kind: "file" },
    { path: "service/cline-orchestrator", ownership: "product_owned", kind: "service_registration" },
    { path: "config/config.json", ownership: "user_owned_config", kind: "file" },
    { path: "state/workspaces.json", ownership: "user_owned_workspace_registry", kind: "file" },
    { path: "secrets/provider.env", ownership: "user_owned_secrets", kind: "file" },
    { path: "state/tasks", ownership: "user_owned_task_state", kind: "directory" },
  ],
  authority: "install_manifest_plan_only",
  grantsAuthority: false,
};

test("M17F contract preserves user data by default and performs no mutation", () => {
  assert.equal(INSTALLER_PACKAGING_CONTRACT.explicitExecutionRequired, true);
  assert.equal(INSTALLER_PACKAGING_CONTRACT.preservesUserDataByDefault, true);
  assert.equal(INSTALLER_PACKAGING_CONTRACT.destructiveUserDataDeletionByDefault, false);
  assert.equal(INSTALLER_PACKAGING_CONTRACT.mutatesFilesystem, false);
  assert.equal(INSTALLER_PACKAGING_CONTRACT.mutatesServiceManager, false);
  assert.equal(INSTALLER_PACKAGING_CONTRACT.grantsAuthority, false);
});

test("M17F install plan separates product-owned and user-owned paths", () => {
  const plan = planInstall(manifest);
  assert.equal(plan.action, "install");
  assert.deepEqual(plan.productOwnedPaths, ["bin/cline-orchestrator.exe"]);
  assert.deepEqual(plan.serviceRegistrations, ["service/cline-orchestrator"]);
  assert.deepEqual(plan.preservedUserOwnedPaths, [
    "config/config.json",
    "secrets/provider.env",
    "state/tasks",
    "state/workspaces.json",
  ]);
  assert.equal(plan.destructiveUserDataDeletionRequested, false);
  assert.equal(plan.grantsAuthority, false);
});

test("M17F uninstall removes only product-owned artifacts by default", () => {
  const plan = planUninstall(manifest);
  assert.equal(plan.action, "uninstall");
  assert.deepEqual(plan.productOwnedPaths, ["bin/cline-orchestrator.exe"]);
  assert.deepEqual(plan.serviceRegistrations, ["service/cline-orchestrator"]);
  assert.equal(plan.preservedUserOwnedPaths.includes("config/config.json"), true);
  assert.equal(plan.preservedUserOwnedPaths.includes("state/tasks"), true);
  assert.equal(plan.destructiveUserDataDeletionRequested, false);
});

test("M17F rejects path traversal and absolute paths", () => {
  assert.throws(
    () => planInstall({
      ...manifest,
      entries: [
        ...manifest.entries,
        { path: "../outside", ownership: "product_owned", kind: "file" },
      ],
    }),
    (error: unknown) =>
      error instanceof InstallerPackagingError
      && error.code === "path_invalid",
  );

  assert.throws(
    () => planInstall({
      ...manifest,
      entries: [
        { path: "C:\\Windows\\system32\\bad.exe", ownership: "product_owned", kind: "file" },
      ],
    }),
    (error: unknown) =>
      error instanceof InstallerPackagingError
      && error.code === "path_invalid",
  );
});

test("M17F user-owned service registration is rejected", () => {
  assert.throws(
    () => planUninstall({
      ...manifest,
      entries: [
        {
          path: "service/cline-orchestrator",
          ownership: "user_owned_config",
          kind: "service_registration",
        },
      ],
    }),
    (error: unknown) =>
      error instanceof InstallerPackagingError
      && error.code === "manifest_invalid",
  );
});

test("M17F duplicate manifest ownership entries fail closed", () => {
  assert.throws(
    () => planInstall({
      ...manifest,
      entries: [
        { path: "bin/cline-orchestrator.exe", ownership: "product_owned", kind: "file" },
        { path: "bin/cline-orchestrator.exe", ownership: "user_owned_config", kind: "file" },
      ],
    }),
    (error: unknown) =>
      error instanceof InstallerPackagingError
      && error.code === "path_invalid",
  );
});
