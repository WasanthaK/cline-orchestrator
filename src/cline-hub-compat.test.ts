import assert from "node:assert/strict";
import test from "node:test";
import {
  ClineHubCompatibilityError,
  planClineHubDaemonEntryShim,
} from "./cline-hub-compat.js";

test("Cline Hub compatibility plan maps the pinned Windows package layout to the observed missing entry", () => {
  const plan = planClineHubDaemonEntryShim({
    coreVersion: "0.0.83",
    coreEntryPath: "C:\\repo\\node_modules\\@cline\\core\\dist\\index.js",
    daemonEntryPath: "C:\\repo\\node_modules\\@cline\\core\\dist\\hub\\daemon\\entry.js",
    pathFlavor: "win32",
  });

  assert.equal(
    plan.expectedEntryPath,
    "C:\\repo\\node_modules\\@cline\\core\\dist\\entry.js",
  );
  assert.equal(
    plan.daemonEntryPath,
    "C:\\repo\\node_modules\\@cline\\core\\dist\\hub\\daemon\\entry.js",
  );
  assert.match(plan.shimSource, /import "\.\/hub\/daemon\/entry\.js";/);
});

test("Cline Hub compatibility plan is case-insensitive for canonical Windows package paths", () => {
  const plan = planClineHubDaemonEntryShim({
    coreVersion: "0.0.83",
    coreEntryPath: "C:\\Repo\\NODE_MODULES\\@cline\\core\\dist\\index.js",
    daemonEntryPath: "c:\\repo\\node_modules\\@cline\\core\\dist\\hub\\daemon\\entry.js",
    pathFlavor: "win32",
  });

  assert.equal(plan.expectedEntryPath.endsWith("dist\\entry.js"), true);
});

test("Cline Hub compatibility plan fails closed for an unreviewed core version", () => {
  assert.throws(
    () => planClineHubDaemonEntryShim({
      coreVersion: "0.0.84",
      coreEntryPath: "/repo/node_modules/@cline/core/dist/index.js",
      daemonEntryPath: "/repo/node_modules/@cline/core/dist/hub/daemon/entry.js",
      pathFlavor: "posix",
    }),
    ClineHubCompatibilityError,
  );
});

test("Cline Hub compatibility plan fails closed when the exported daemon layout differs", () => {
  assert.throws(
    () => planClineHubDaemonEntryShim({
      coreVersion: "0.0.83",
      coreEntryPath: "/repo/node_modules/@cline/core/dist/index.js",
      daemonEntryPath: "/tmp/other/entry.js",
      pathFlavor: "posix",
    }),
    ClineHubCompatibilityError,
  );
});
