import assert from "node:assert/strict";
import test from "node:test";
import { installedViewerConfigFromEnvironment, INSTALLED_VIEWER_CONTRACT } from "./installed-passive-viewer.js";
import { routeProductCli, PRODUCT_CLI_CONTRACT } from "./product-cli.js";

test("UX-E2b3 requires explicit viewer command and local token", () => {
  assert.deepEqual(routeProductCli(["viewer"]), { kind: "viewer" });
  assert.throws(() => routeProductCli(["viewer", "--public"]), { code: "usage_invalid" });
  assert.throws(() => routeProductCli(["--config", "product.json", "viewer"]), { code: "usage_invalid" });
  assert.equal(PRODUCT_CLI_CONTRACT.grantsAuthority, false);
  assert.equal(INSTALLED_VIEWER_CONTRACT.noDaemonStartup, true);
  assert.equal(INSTALLED_VIEWER_CONTRACT.noTaskMutation, true);
  assert.equal(INSTALLED_VIEWER_CONTRACT.noServiceInstallation, true);
  assert.deepEqual(INSTALLED_VIEWER_CONTRACT.readOnlyMachineMethods,
    ["listProjects", "listWorkspaces", "findTasks", "getTask", "getTaskEvents", "getTaskRecoveryEvidence"]);
});

test("UX-E2b3 validates environment before listening and never permits public bind", () => {
  const token = "12345678".repeat(8);
  assert.deepEqual(installedViewerConfigFromEnvironment({ ORCH_VIEWER_TOKEN: token }),
    { host: "127.0.0.1", port: 4321, token });
  assert.deepEqual(installedViewerConfigFromEnvironment({ ORCH_VIEWER_TOKEN: token,
    ORCH_VIEWER_PORT: "5443" }), { host: "127.0.0.1", port: 5443, token });
  for (const env of [
    {},
    { ORCH_VIEWER_TOKEN: "short" },
    { ORCH_VIEWER_TOKEN: token, ORCH_VIEWER_PORT: "0" },
    { ORCH_VIEWER_TOKEN: token, ORCH_VIEWER_PORT: "65536" },
    { ORCH_VIEWER_TOKEN: token, ORCH_VIEWER_PORT: "abc" },
    { ORCH_VIEWER_TOKEN: token + "\n" },
  ]) assert.throws(() => installedViewerConfigFromEnvironment(env));
});
