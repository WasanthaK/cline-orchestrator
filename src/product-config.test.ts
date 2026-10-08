import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_CONFIG_CONTRACT,
  ProductConfigError,
  resolveProductConfig,
} from "./product-config.js";

test("M17B contract is read-only, safe-defaulted and secret-reference-only", () => {
  assert.equal(PRODUCT_CONFIG_CONTRACT.environmentOverridesFile, true);
  assert.equal(PRODUCT_CONFIG_CONTRACT.explicitSafeDefaults, true);
  assert.equal(PRODUCT_CONFIG_CONTRACT.rawSecretPersistenceAllowed, false);
  assert.equal(PRODUCT_CONFIG_CONTRACT.secretReferencesOnly, true);
  assert.equal(PRODUCT_CONFIG_CONTRACT.writesConfig, false);
  assert.equal(PRODUCT_CONFIG_CONTRACT.grantsAuthority, false);
});

test("M17B empty v1 config resolves explicit current-safe defaults", () => {
  const config = resolveProductConfig({ schemaVersion: 1 });
  assert.equal(config.provider.providerId, "ollama-openai");
  assert.equal(config.provider.modelId, "qwen38-27b-192k:latest");
  assert.equal(config.provider.baseUrl, "http://localhost:11434/");
  assert.equal(config.runtime.autoApproveCommands, false);
  assert.equal(config.runtime.autoApproveEdits, false);
  assert.equal(config.daemon.host, "127.0.0.1");
  assert.equal(config.daemon.port, 4317);
  assert.equal(config.grantsAuthority, false);
});

test("M17B environment values override file values deterministically", () => {
  const config = resolveProductConfig(
    {
      schemaVersion: 1,
      provider: {
        providerId: "ollama",
        modelId: "file-model",
        baseUrl: "http://localhost:9999",
      },
      runtime: {
        maxRetries: 1,
        autoApproveEdits: false,
      },
      daemon: {
        port: 4318,
      },
    },
    {
      ORCH_PROVIDER: "openai-compatible",
      ORCH_MODEL: "env-model",
      ORCH_BASE_URL: "http://127.0.0.1:8080/v1",
      ORCH_MAX_RETRIES: "3",
      ORCH_AUTO_APPROVE_EDITS: "true",
      ORCH_DAEMON_PORT: "4320",
    },
  );

  assert.equal(config.provider.providerId, "openai-compatible");
  assert.equal(config.provider.modelId, "env-model");
  assert.equal(config.provider.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(config.runtime.maxRetries, 3);
  assert.equal(config.runtime.autoApproveEdits, true);
  assert.equal(config.daemon.port, 4320);
});

test("M17B file stores only a named secret reference, never raw secret material", () => {
  const config = resolveProductConfig({
    schemaVersion: 1,
    provider: {
      apiKeySecretRef: "ORCH_PROVIDER_API_KEY",
    },
  });
  assert.equal(config.provider.apiKeySecretRef, "ORCH_PROVIDER_API_KEY");
  assert.equal(config.usesSecretMaterial, false);

  assert.throws(
    () => resolveProductConfig({
      schemaVersion: 1,
      provider: {
        apiKey: "sk-secret",
      },
    } as any),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "secret_material_rejected",
  );
});

test("M17B rejects widened legacy raw ORCH_API_KEY environment material", () => {
  assert.throws(
    () => resolveProductConfig(
      { schemaVersion: 1 },
      { ORCH_API_KEY: "secret-value" } as any,
    ),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "secret_material_rejected",
  );
});

test("M17B rejects unsupported/future schemas rather than guessing migration", () => {
  assert.throws(
    () => resolveProductConfig({ schemaVersion: 2 }),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "schema_unsupported",
  );
});

test("M17B rejects unknown fields and credential-bearing base URLs", () => {
  assert.throws(
    () => resolveProductConfig({ schemaVersion: 1, surprise: true }),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "config_invalid",
  );

  assert.throws(
    () => resolveProductConfig({
      schemaVersion: 1,
      provider: {
        baseUrl: "https://user:password@example.com/v1",
      },
    }),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "secret_material_rejected",
  );
});

test("M17B product daemon config remains loopback-only", () => {
  assert.throws(
    () => resolveProductConfig({
      schemaVersion: 1,
      daemon: { host: "0.0.0.0" },
    }),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "config_invalid",
  );

  assert.throws(
    () => resolveProductConfig({
      schemaVersion: 1,
      daemon: { url: "http://192.168.1.10:4317" },
    }),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "config_invalid",
  );
});

test("M17B invalid booleans/numbers fail closed", () => {
  assert.throws(
    () => resolveProductConfig(
      { schemaVersion: 1 },
      { ORCH_AUTO_APPROVE_EDITS: "yes" },
    ),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "config_invalid",
  );

  assert.throws(
    () => resolveProductConfig(
      { schemaVersion: 1 },
      { ORCH_DAEMON_PORT: "70000" },
    ),
    (error: unknown) =>
      error instanceof ProductConfigError
      && error.code === "config_invalid",
  );
});
