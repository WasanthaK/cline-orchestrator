import assert from "node:assert/strict";
import test from "node:test";
import { routeProductCli } from "./product-cli.js";

test("M19C2 Windows desktop config route is exact and separate from config/managed-run", () => {
  const args = ["setup-config-desktop", "openai-compatible", "qwen38-27b-192k",
    "http://127.0.0.1:8080/v1"];
  assert.deepEqual(routeProductCli(args), { kind: "desktop_config_save",
    providerId: "openai-compatible", modelId: "qwen38-27b-192k",
    baseUrl: "http://127.0.0.1:8080/v1" });
  for (const bad of [
    ["setup-config-desktop"], [...args, "EXTRA"],
    ["--config", "some.json", ...args],
  ]) assert.throws(() => routeProductCli(bad), { code: "usage_invalid" });
});
