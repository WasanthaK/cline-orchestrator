import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { inspectNativeSettingsRecovery, NATIVE_SETTINGS_RECOVERY_CONTRACT } from "./native-settings-recovery.js";
import { routeProductCli } from "./product-cli.js";

const provider = { providerId: "openai-compatible", modelId: "test-model",
  baseUrl: "http://127.0.0.1:8080/v1" };
const config = () => JSON.stringify({
  schemaVersion: 1, provider,
  runtime: { autoApproveCommands: false, autoApproveEdits: false },
  daemon: { host: "127.0.0.1" },
});
const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

async function fixture(fn: (dir: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19d3a-"));
  try {
    const dir = path.join(root, "ClineOrchestrator");
    await mkdir(dir);
    await fn(dir);
  } finally { await rm(root, { force: true, recursive: true }); }
}

test("M19D3A never claims recoverability when current settings are missing or invalid", async () => {
  await fixture(async dir => {
    const noConfig = await inspectNativeSettingsRecovery(dir);
    assert.equal(noConfig.status, "unavailable");
    assert.equal(noConfig.verifiedCount, null);
    const old = config();
    await writeFile(path.join(dir, "config.previous-" + sha(old) + ".json"), old);
    assert.equal((await inspectNativeSettingsRecovery(dir)).status, "unavailable");
    await writeFile(path.join(dir, "config.json"), "CORRUPT");
    assert.equal((await inspectNativeSettingsRecovery(dir)).status, "unavailable");
  });
});

test("M19D3A observes verified zero and valid versions without exposing content or restoring", async () => {
  await fixture(async dir => {
    await writeFile(path.join(dir, "config.json"), config());
    const none = await inspectNativeSettingsRecovery(dir);
    assert.equal(none.status, "no_previous_version");
    assert.equal(none.verifiedCount, 0);
    const old = config();
    await writeFile(path.join(dir, "config.previous-" + sha(old) + ".json"), old);
    const result = await inspectNativeSettingsRecovery(dir);
    assert.equal(result.status, "verified_versions");
    assert.equal(result.verifiedCount, 1);
    assert.equal(result.restorationAvailable, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.grantsAuthority, false);
    assert.doesNotMatch(JSON.stringify(result), /test-model|127\.0\.0\.1|ClineOrchestrator|config\.json/);
  });
});

test("M19D3A refuses forged hashes, unsafe policy, remote endpoints and backup symlinks", async () => {
  await fixture(async dir => {
    await writeFile(path.join(dir, "config.json"), config());
    const previous = config();
    const file = path.join(dir, "config.previous-" + sha(previous) + ".json");
    await writeFile(file, previous + "tampered");
    const forged = await inspectNativeSettingsRecovery(dir);
    assert.equal(forged.status, "needs_attention");
    assert.equal(forged.verifiedCount, null);
    await writeFile(file, JSON.stringify({
      ...JSON.parse(previous), runtime: { autoApproveCommands: true },
    }));
    assert.equal((await inspectNativeSettingsRecovery(dir)).status, "needs_attention");
    await rm(file);
    const remote = JSON.stringify({
      ...JSON.parse(previous), provider: { ...provider, baseUrl: "https://remote.example/v1" },
    });
    await writeFile(path.join(dir, "config.previous-" + sha(remote) + ".json"), remote);
    assert.equal((await inspectNativeSettingsRecovery(dir)).status, "needs_attention");
  });
  await fixture(async dir => {
    await writeFile(path.join(dir, "config.json"), config());
    const old = config();
    const target = path.join(dir, "stored.json");
    await writeFile(target, old);
    await symlink(target, path.join(dir, "config.previous-" + sha(old) + ".json"));
    assert.equal((await inspectNativeSettingsRecovery(dir)).status, "needs_attention");
  });
});

test("M19D3A exact private read-only CLI and authority contract", () => {
  assert.deepEqual(routeProductCli(["recovery-desktop"]), { kind: "desktop_recovery" });
  for (const args of [
    ["recovery-desktop", "path"], ["--config", "private.json", "recovery-desktop"],
  ]) assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  assert.equal(NATIVE_SETTINGS_RECOVERY_CONTRACT.noRestoreAction, true);
  assert.equal(NATIVE_SETTINGS_RECOVERY_CONTRACT.browserMutationRoute, false);
  assert.equal(NATIVE_SETTINGS_RECOVERY_CONTRACT.grantsAuthority, false);
});
