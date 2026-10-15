import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NativeProviderSaveError, saveNativeProviderConfig } from "./native-provider-config-save.js";

const provider = { providerId: "openai-compatible", modelId: "qwen38-27b-192k",
  baseUrl: "http://127.0.0.1:8080/v1" };
const available = (async () => new Response(JSON.stringify({
  data: [{ id: "qwen38-27b-192k" }],
}), { status: 200 })) as typeof fetch;
const absent = (async () => new Response(JSON.stringify({
  data: [{ id: "other-model" }],
}), { status: 200 })) as typeof fetch;

async function isolated(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m19c2-"));
  try { await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("M19C2 creates exactly one confirmed configuration, with auto-approvals disabled", async () => {
  await isolated(async directory => {
    let confirms = 0;
    const result = await saveNativeProviderConfig({ ...provider, stateDirectory: directory }, async review => {
      confirms++;
      assert.equal(review.kind, "config-review");
      assert.equal(review.requiresExactReply, "CREATE CONFIG");
      assert.equal(review.baseUrl, provider.baseUrl);
      assert.equal(review.modelId, provider.modelId);
      assert.equal(review.grantsAuthority, false);
      assert.deepEqual(await readdir(directory), []);
      return true;
    }, available);
    assert.equal(confirms, 1);
    assert.equal(result.outcome, "created");
    assert.equal(result.grantsAuthority, false);
    const files = await readdir(directory);
    assert.deepEqual(files, ["config.json"]);
    const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));
    assert.equal(config.provider.modelId, provider.modelId);
    assert.equal(config.runtime.autoApproveCommands, false);
    assert.equal(config.runtime.autoApproveEdits, false);
    assert.equal(config.daemon.host, "127.0.0.1");
  });
});

test("M19C2 decline and missing model leave no file", async () => {
  await isolated(async directory => {
    const declined = await saveNativeProviderConfig({ ...provider, stateDirectory: directory },
      async () => false, available);
    assert.equal(declined.outcome, "cancelled");
    assert.deepEqual(await readdir(directory), []);
    let called = false;
    await assert.rejects(saveNativeProviderConfig({ ...provider, stateDirectory: directory },
      async () => { called = true; return true; }, absent), { code: "provider_unavailable" });
    assert.equal(called, false);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("M19C2 never replaces existing file or symlink", async () => {
  await isolated(async directory => {
    const dest = path.join(directory, "config.json");
    await writeFile(dest, "SENTINEL_KEEP");
    let confirmed = false;
    await assert.rejects(saveNativeProviderConfig({ ...provider, stateDirectory: directory },
      async () => { confirmed = true; return true; }, available), { code: "write_failed" });
    assert.equal(confirmed, false);
    assert.equal(await readFile(dest, "utf8"), "SENTINEL_KEEP");
    await rm(dest);
    const other = path.join(directory, "preserved.json");
    await writeFile(other, "OTHER_SENTINEL");
    await symlink(other, dest);
    await assert.rejects(saveNativeProviderConfig({ ...provider, stateDirectory: directory },
      async () => true, available), { code: "write_failed" });
    assert.equal(await readFile(other, "utf8"), "OTHER_SENTINEL");
  });
});

test("M19C2 rejects unsafe target directory and remote endpoint without writing", async () => {
  await isolated(async directory => {
    await assert.rejects(saveNativeProviderConfig({ ...provider, stateDirectory: "relative" },
      async () => true, available), (e: unknown) => e instanceof NativeProviderSaveError);
    const link = path.join(directory, "alias");
    await symlink(directory, link, "dir");
    await assert.rejects(saveNativeProviderConfig({ ...provider, stateDirectory: link },
      async () => true, available), { code: "scope_invalid" });
    await assert.rejects(saveNativeProviderConfig({
      ...provider, baseUrl: "http://example.com/v1", stateDirectory: directory,
    }, async () => true, available), { code: "provider_unavailable" });
  });
});
