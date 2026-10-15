import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { inspectNativeSettings, updateNativeSettings,
  NATIVE_SETTINGS_UPDATE_CONTRACT } from "./native-settings-update.js";
import { routeProductCli } from "./product-cli.js";

const old = { providerId: "openai-compatible", modelId: "old-model", baseUrl: "http://127.0.0.1:8080/v1" };
const next = { ...old, modelId: "new-model" };
const available = (async () => new Response(JSON.stringify({ data: [{ id: "new-model" }] }),
  { status: 200 })) as typeof fetch;

async function withSettings(run: (directory: string, config: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19d2-"));
  try {
    const directory = path.join(root, "state");
    await mkdir(directory);
    const target = path.join(directory, "config.json");
    await writeFile(target, JSON.stringify({
      schemaVersion: 1, provider: old,
      runtime: { maxIterations: 9, autoApproveEdits: false, autoApproveCommands: false },
      daemon: { host: "127.0.0.1" },
    }));
    await run(directory, target);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("M19D2 inspects only provider metadata and a revision, not credentials or private paths", async () => {
  await withSettings(async (directory) => {
    const before = await inspectNativeSettings(directory);
    assert.equal(before.command, "settings-desktop");
    assert.equal(before.status, "configured");
    assert.match(before.revision!, /^[a-f0-9]{64}$/);
    assert.deepEqual(before.selection, old);
    assert.equal(before.readOnly, true);
    assert.equal(before.grantsAuthority, false);
    assert.doesNotMatch(JSON.stringify(before), /config\.json|state\/|apiKeySecretRef|autoApprove/);
    assert.equal(NATIVE_SETTINGS_UPDATE_CONTRACT.browserMutation, false);
    assert.equal(NATIVE_SETTINGS_UPDATE_CONTRACT.startsTask, false);
  });
});

test("M19D2 cancelled edit never writes, confirmed edit preserves runtime and previous bytes", async () => {
  await withSettings(async (directory, target) => {
    const snapshot = await inspectNativeSettings(directory);
    const original = await readFile(target, "utf8");
    const cancel = await updateNativeSettings({
      stateDirectory: directory, expectedRevision: snapshot.revision!, selection: next,
    }, async review => {
      assert.equal(review.kind, "settings-revision-review");
      assert.equal(review.requiresExactReply, "UPDATE CONFIG");
      assert.equal(review.grantsAuthority, false);
      return false;
    }, available);
    assert.equal(cancel.outcome, "cancelled");
    assert.equal(await readFile(target, "utf8"), original);
    assert.equal((await readdir(directory)).length, 1);
    const updated = await updateNativeSettings({
      stateDirectory: directory, expectedRevision: snapshot.revision!, selection: next,
    }, async () => true, available);
    assert.equal(updated.outcome, "updated");
    assert.equal(updated.previousVersionPreserved, true);
    const saved = JSON.parse(await readFile(target, "utf8"));
    assert.equal(saved.provider.modelId, "new-model");
    assert.equal(saved.runtime.maxIterations, 9);
    assert.equal(saved.runtime.autoApproveCommands, false);
    assert.equal(saved.runtime.autoApproveEdits, false);
    assert.equal(await readFile(path.join(directory, "config.previous-" + snapshot.revision + ".json"), "utf8"), original);
    const newer = await inspectNativeSettings(directory);
    assert.notEqual(newer.revision, snapshot.revision);
  });
});

test("M19D2 stale edits, remote model, unsafe saved policies, and symlink never overwrite", async () => {
  await withSettings(async (directory, target) => {
    const snapshot = await inspectNativeSettings(directory);
    const original = await readFile(target, "utf8");
    let reviewed = false;
    await assert.rejects(() => updateNativeSettings({
      stateDirectory: directory, expectedRevision: "0".repeat(64), selection: next,
    }, async () => { reviewed = true; return true; }, available), { code: "stale" });
    assert.equal(reviewed, false);
    await assert.rejects(() => updateNativeSettings({
      stateDirectory: directory, expectedRevision: snapshot.revision!,
      selection: { ...next, baseUrl: "https://remote.example/v1" },
    }, async () => { reviewed = true; return true; }, available), { code: "unsafe" });
    assert.equal(reviewed, false);
    await assert.rejects(() => updateNativeSettings({
      stateDirectory: directory, expectedRevision: snapshot.revision!, selection: next,
    }, async () => { await writeFile(target, "USER_REPLACED"); return true; }, available), { code: "write_failed" });
    assert.equal(await readFile(target, "utf8"), "USER_REPLACED");
    assert.deepEqual(await readdir(directory), ["config.json"]);
    await writeFile(target, original.replace('"maxIterations":9', '"maxIterations":9,"autoApproveCommands":true'));
    assert.equal((await inspectNativeSettings(directory)).status, "attention");
    await rm(target);
    await symlink(path.join(directory, "some-target"), target);
    assert.equal((await inspectNativeSettings(directory)).status, "attention");
  });
});

test("M19D2 commands require exact private native scope", () => {
  assert.deepEqual(routeProductCli(["settings-desktop"]), { kind: "desktop_settings_read" });
  assert.deepEqual(routeProductCli(["update-settings-desktop", "x".repeat(64),
    "openai-compatible", "new-model", "http://127.0.0.1:8080/v1"]), {
    kind: "desktop_settings_update", expectedRevision: "x".repeat(64),
    providerId: "openai-compatible", modelId: "new-model", baseUrl: "http://127.0.0.1:8080/v1",
  });
  for (const args of [
    ["settings-desktop", "extra"],
    ["--config", "private.json", "settings-desktop"],
    ["update-settings-desktop", "wrong"],
    ["--config", "private.json", "update-settings-desktop", "revision", "provider", "model", "url"],
  ]) assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
});
