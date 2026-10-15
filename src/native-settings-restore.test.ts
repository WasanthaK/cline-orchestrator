import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, symlink } from "node:fs/promises";
import { inspectNativeRestoreChoices, restoreNativeModelSelection,
  NATIVE_SETTINGS_RESTORE_CONTRACT } from "./native-settings-restore.js";
import { routeProductCli } from "./product-cli.js";

const oldModel = { providerId: "openai-compatible", modelId: "old-model",
  baseUrl: "http://127.0.0.1:8080/v1" };
const newModel = { ...oldModel, modelId: "new-model" };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const config = (provider: typeof oldModel, maxIterations: number) => JSON.stringify({
  schemaVersion: 1, provider,
  runtime: { autoApproveCommands: false, autoApproveEdits: false, maxIterations },
  daemon: { host: "127.0.0.1" },
});
const providerCheck = (async () => new Response(JSON.stringify({ data: [{ id: "old-model" }] }),
  { status: 200 })) as typeof fetch;

async function fixture(work: (dir: string, target: string, current: string,
  backup: string, hash: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19d3b-"));
  try {
    const dir = path.join(root, "ClineOrchestrator"); await mkdir(dir);
    const target = path.join(dir, "config.json"), current = config(newModel, 5);
    const backup = config(oldModel, 99), hash = sha(backup);
    await writeFile(target, current);
    await writeFile(path.join(dir, "config.previous-" + hash + ".json"), backup);
    await work(dir, target, current, backup, hash);
  } finally { await rm(root, { force: true, recursive: true }); }
}

test("M19D3B only returns verified finite model choices, not raw settings or paths", async () => {
  await fixture(async (dir, target, current, backup, hash) => {
    const found = await inspectNativeRestoreChoices(dir);
    assert.equal(found.status, "available");
    assert.equal(found.currentRevision, sha(current));
    assert.deepEqual(found.choices, [{ revision: hash, selection: oldModel }]);
    const publicView = JSON.stringify(found);
    assert.doesNotMatch(publicView, /config\\.json|ClineOrchestrator|"runtime"|"daemon"|"maxIterations"/);
    // SHA-256 revisions are opaque hex digests; arbitrary digit sequences such
    // as "99" may legitimately occur in them and are not private settings.
    assert.deepEqual(Object.keys(found.choices[0]!).sort(), ["revision", "selection"]);
    assert.deepEqual(Object.keys(found.choices[0]!.selection).sort(), ["baseUrl", "modelId", "providerId"]);
    assert.equal(found.readOnly, true);
    assert.equal(found.grantsAuthority, false);
    assert.equal(NATIVE_SETTINGS_RESTORE_CONTRACT.browserMutation, false);
    assert.equal(NATIVE_SETTINGS_RESTORE_CONTRACT.startsTask, false);
  });
});

test("M19D3B cancelled restore leaves files unchanged; approved restore preserves current runtime", async () => {
  await fixture(async (dir, target, current, backup, hash) => {
    const input = { stateDirectory: dir, expectedRevision: sha(current), backupRevision: hash };
    const cancelled = await restoreNativeModelSelection(input, async review => {
      assert.equal(review.requiresExactReply, "RESTORE CONFIG");
      assert.equal(review.selectedBackupRevision, hash);
      assert.equal(review.currentRevision, sha(current));
      assert.deepEqual(review.selection, oldModel);
      assert.equal(review.grantsAuthority, false);
      return false;
    }, providerCheck);
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(await readFile(target, "utf8"), current);
    const restored = await restoreNativeModelSelection(input, async () => true, providerCheck);
    assert.equal(restored.outcome, "restored");
    assert.equal(restored.grantsAuthority, false);
    const saved = JSON.parse(await readFile(target, "utf8"));
    assert.deepEqual(saved.provider, oldModel);
    assert.equal(saved.runtime.maxIterations, 5);
    assert.equal(saved.runtime.autoApproveCommands, false);
    assert.equal(saved.runtime.autoApproveEdits, false);
    assert.equal(await readFile(path.join(dir,"config.previous-" + sha(current) + ".json"),"utf8"),current);
    assert.equal(await readFile(path.join(dir,"config.previous-" + hash + ".json"),"utf8"),backup);
    await assert.rejects(() => restoreNativeModelSelection(input, async () => true, providerCheck), { code: "stale" });
  });
});

test("M19D3B rejects changed current revision or backup and never invokes confirmation", async () => {
  await fixture(async (dir, target, current, backup, hash) => {
    const input = { stateDirectory: dir, expectedRevision: sha(current), backupRevision: hash };
    let called = false;
    await assert.rejects(restoreNativeModelSelection({
      ...input, expectedRevision: "0".repeat(64),
    }, async () => { called=true; return true; }, providerCheck), { code: "stale" });
    assert.equal(called,false);
    await writeFile(path.join(dir,"config.previous-" + hash + ".json"),backup+"TAMPER");
    const choices = await inspectNativeRestoreChoices(dir);
    assert.equal(choices.status,"needs_attention");
    assert.equal(choices.choices.length,0);
    await assert.rejects(restoreNativeModelSelection(input,
      async () => {called=true;return true;}, providerCheck), { code:"unsafe" });
    assert.equal(called,false);
    assert.equal(await readFile(target,"utf8"), current);
  });
});

test("M19D3B denies races after approval, offline provider and expiring consent", async () => {
  await fixture(async (dir, target, current, backup, hash) => {
    const input = { stateDirectory: dir, expectedRevision: sha(current), backupRevision: hash };
    const offline = (async () => new Response(JSON.stringify({data:[]}),{status:200})) as typeof fetch;
    await assert.rejects(restoreNativeModelSelection(input, async () => true, offline), { code: "unavailable" });
    await assert.rejects(restoreNativeModelSelection(input, async () => {
      await writeFile(target, "SENTINEL_CHANGED");
      return true;
    }, providerCheck), { code:"write_failed" });
    assert.equal(await readFile(target,"utf8"),"SENTINEL_CHANGED");
    await writeFile(target,current);
    let clock=100_000;
    await assert.rejects(restoreNativeModelSelection(input, async () => {
      clock += 60_001; return true;
    }, providerCheck, { now: () => clock }), {code:"write_failed"});
    assert.equal(await readFile(target,"utf8"),current);
    assert.deepEqual((await readdir(dir)).filter(x=>x.startsWith(".config-")),[]);
  });
});

test("M19D3B private native CLI rejects paths and config overrides", () => {
  assert.deepEqual(routeProductCli(["restore-choices-desktop"]), {kind:"desktop_restore_choices"});
  assert.deepEqual(routeProductCli(["restore-model-desktop","a".repeat(64),"b".repeat(64)]),
    {kind:"desktop_model_restore", expectedRevision:"a".repeat(64), backupRevision:"b".repeat(64)});
  for(const args of [
    ["restore-choices-desktop","extra"], ["restore-model-desktop","one"],
    ["restore-model-desktop","a","b","C:/private"],
    ["--config","private.json","restore-choices-desktop"],
    ["--config","private.json","restore-model-desktop","a","b"],
  ]) assert.throws(() => routeProductCli(args), {code:"usage_invalid"});
});
