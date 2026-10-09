import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir, rm, symlink, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runConfigWriteSetup } from "./config-write-setup.js";
import { FirstRunSetupService } from "./first-run-setup.js";
import { routeProductCli } from "./product-cli.js";

const config = { schemaVersion: 1, provider: {
  providerId: "ollama-openai", modelId: "local-model", baseUrl: "http://127.0.0.1:8080/v1",
  apiKeySecretRef: "PROVIDER_KEY",
}, runtime: { maxTokensPerTurn: 4096 }, daemon: { host: "127.0.0.1", port: 4317 } };

async function disposable(body: (directory: string, target: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m18b3b-"));
  try { await body(directory, path.join(directory, "product.json")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("M18B3b real config creation uses one confirmed snapshot including reference/token-budget fields", async () => {
  await disposable(async (directory, target) => {
    const input = structuredClone(config);
    const result = await runConfigWriteSetup(target, input, async (review) => {
      assert.deepEqual(await readdir(directory), []);
      assert.equal(review.targetPath, target);
      assert.deepEqual(review.config, config);
      assert.equal(Object.hasOwn(review, "confirmationToken"), false);
      // Neither caller nor displayed-copy mutation changes the confirmed payload.
      input.provider.modelId = "changed-after-preview";
      (review.config as typeof config).provider.modelId = "changed-display-copy";
      return true;
    });
    assert.equal(result.written, true);
    assert.equal(result.grantsAuthority, false);
    assert.equal(result.result?.grantsTaskAuthority, false);
    assert.equal(result.result?.grantsFilesystemAuthority, false);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), config);
    assert.deepEqual(await readdir(directory), ["product.json"]);
    if (process.platform !== "win32") assert.equal((await stat(target)).mode & 0o777, 0o600);
  });
});

test("M18B3b decline and expired confirmation create no config or temporary files", async () => {
  await disposable(async (directory, target) => {
    const declined = await runConfigWriteSetup(target, config, async () => false);
    assert.equal(declined.written, false);
    assert.deepEqual(await readdir(directory), []);
    let now = 100_000;
    await assert.rejects(runConfigWriteSetup(target, config, async () => {
      now += 60_000; return true;
    }, { now: () => now }), { code: "confirmation_expired" });
    assert.deepEqual(await readdir(directory), []);
  });
});

test("M18B3b existing file/symlink destinations are rejected before confirmation", async () => {
  await disposable(async (directory, target) => {
    let confirmations = 0;
    await writeFile(target, "operator-owned");
    await assert.rejects(runConfigWriteSetup(target, config, async () => { confirmations++; return true; }),
      { code: "target_exists" });
    assert.equal(confirmations, 0);
    assert.equal(await readFile(target, "utf8"), "operator-owned");
    await rm(target);
    const other = path.join(directory, "other.json");
    await writeFile(other, "protected-existing");
    await symlink(other, target);
    await assert.rejects(runConfigWriteSetup(target, config, async () => { confirmations++; return true; }),
      { code: "target_exists" });
    assert.equal(await readFile(other, "utf8"), "protected-existing");
    assert.equal(confirmations, 0);
  });
});

test("M18B3b a competing destination after preview is never overwritten; failed confirmation is consumed", async () => {
  await disposable(async (directory, target) => {
    await assert.rejects(runConfigWriteSetup(target, config, async () => {
      await writeFile(target, "competing-operator-file"); return true;
    }), { code: "execution_failed" });
    assert.equal(await readFile(target, "utf8"), "competing-operator-file");
    assert.deepEqual(await readdir(directory), ["product.json"]);
  });
  let attempts = 0;
  const unsupported = async () => { throw new Error("not supported"); };
  const service = new FirstRunSetupService({
    writeConfig: async () => { attempts++; throw new Error("synthetic-private-path"); },
    registerProject: unsupported, registerWorkspace: unsupported, startLoopbackDaemon: unsupported,
  });
  const preview = await service.preview({ schemaVersion: 1, action: "write_config",
    payload: { targetPath: "/selected/new.json", config } });
  const confirmation = { action: preview.action, payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true as const };
  await assert.rejects(service.execute(confirmation), { code: "execution_failed" });
  await assert.rejects(service.execute(confirmation), { code: "confirmation_invalid" });
  assert.equal(attempts, 1);
});

test("M18B3b invalid destination/schema/raw secrets fail before confirmation or writes", async () => {
  await disposable(async (directory, target) => {
    let confirmations = 0;
    const confirm = async () => { confirmations++; return true; };
    for (const bad of [
      { schemaVersion: 2 }, { schemaVersion: 1, provider: { apiKey: "synthetic-secret-sentinel" } },
      { schemaVersion: 1, daemon: { host: "0.0.0.0" } },
      { schemaVersion: 1, runtime: { maxTokensPerTurn: "bad" } },
    ]) await assert.rejects(runConfigWriteSetup(target, bad, confirm));
    await assert.rejects(runConfigWriteSetup(path.join(directory, "missing", "new.json"), config, confirm),
      { code: "target_invalid" });
    await assert.rejects(runConfigWriteSetup(path.join(directory, "new.txt"), config, confirm),
      { code: "target_invalid" });
    assert.equal(confirmations, 0);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("M18B3b confirmation cannot be replayed concurrently or after service reconstruction", async () => {
  let writes = 0;
  const unsupported = async () => { throw new Error("not supported"); };
  const driver = { writeConfig: async () => { writes++; }, registerProject: unsupported,
    registerWorkspace: unsupported, startLoopbackDaemon: unsupported };
  const service = new FirstRunSetupService(driver);
  const preview = await service.preview({ schemaVersion: 1, action: "write_config",
    payload: { targetPath: "/selected/new.json", config } });
  const confirmation = { action: preview.action, payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true as const };
  await assert.rejects(new FirstRunSetupService(driver).execute(confirmation), { code: "confirmation_invalid" });
  const outcomes = await Promise.allSettled([service.execute(confirmation), service.execute(confirmation)]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(writes, 1);
});

test("M18B3b setup-config route requires explicit input/output and refuses global file selector", () => {
  assert.deepEqual(routeProductCli(["setup-config", "input.json", "output.json"]),
    { kind: "setup_config", inputPath: "input.json", targetPath: "output.json" });
  assert.throws(() => routeProductCli(["setup-config", "one.json"]), { code: "usage_invalid" });
  assert.throws(() => routeProductCli(["--config", "other.json", "setup-config", "one.json", "two.json"]),
    { code: "usage_invalid" });
});

test("M18B3b actual CLI rejects noninteractive confirmation and leaves destination absent", async () => {
  await disposable(async (directory, target) => {
    const input = path.join(directory, "input.json");
    await writeFile(input, JSON.stringify(config));
    const result = spawnSync(process.execPath,
      ["--import", "tsx", "src/product-cli.ts", "setup-config", input, target],
      { encoding: "utf8", input: "WRITE CONFIG\n", timeout: 30_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an interactive terminal/);
    assert.doesNotMatch(result.stderr, /m18b3b-|PROVIDER_KEY/);
    assert.deepEqual(await readdir(directory), ["input.json"]);
  });
});
