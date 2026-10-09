import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_RUN_SETUP_CONTRACT,
  FirstRunSetupError,
  FirstRunSetupService,
  type FirstRunSetupDriver,
} from "./first-run-setup.js";

class FakeDriver implements FirstRunSetupDriver {
  calls: string[] = [];
  fail = false;

  private async run(name: string) {
    this.calls.push(name);
    if (this.fail) throw new Error("driver failed");
  }

  async writeConfig() { await this.run("write_config"); }
  async registerProject() { await this.run("register_project"); }
  async registerWorkspace() { await this.run("register_workspace"); }
  async startLoopbackDaemon() { await this.run("start_loopback_daemon"); }
}

function service(driver = new FakeDriver(), now = { value: 1_000 }) {
  let token = 0;
  return {
    driver,
    subject: new FirstRunSetupService(driver, {
      now: () => now.value,
      tokenFactory: () => `token-${++token}-${"x".repeat(40)}`,
    }),
    now,
  };
}

test("M17C contract requires explicit one-action confirmation and grants no broader authority", () => {
  assert.equal(FIRST_RUN_SETUP_CONTRACT.explicitConfirmationRequired, true);
  assert.equal(FIRST_RUN_SETUP_CONTRACT.oneActionPerConfirmation, true);
  assert.equal(FIRST_RUN_SETUP_CONTRACT.singleUse, true);
  assert.equal(FIRST_RUN_SETUP_CONTRACT.remoteListenerAllowed, false);
  assert.equal(FIRST_RUN_SETUP_CONTRACT.grantsReleaseAuthority, false);
});

test("M17C preview + execute performs exactly one confirmed config write", async () => {
  const { subject, driver } = service();
  const preview = await subject.preview({
    schemaVersion: 1,
    action: "write_config",
    payload: { schemaVersion: 1, daemon: { host: "127.0.0.1", port: 4317 } },
  });

  const result = await subject.execute({
    action: "write_config",
    payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken,
    confirmed: true,
  });

  assert.deepEqual(driver.calls, ["write_config"]);
  assert.equal(result.action, "write_config");
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M17C config confirmation cannot register workspace or start daemon", async () => {
  const { subject, driver } = service();
  const preview = await subject.preview({
    schemaVersion: 1,
    action: "write_config",
    payload: { schemaVersion: 1 },
  });

  await assert.rejects(
    () => subject.execute({
      action: "register_workspace",
      payloadDigest: preview.payloadDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "confirmation_invalid",
  );
  assert.deepEqual(driver.calls, []);
});

test("M17C burns confirmation before driver mutation and rejects replay", async () => {
  const driver = new FakeDriver();
  driver.fail = true;
  const { subject } = service(driver);

  const preview = await subject.preview({
    schemaVersion: 1,
    action: "register_project",
    payload: { displayName: "Example" },
  });

  await assert.rejects(
    () => subject.execute({
      action: "register_project",
      payloadDigest: preview.payloadDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "execution_failed",
  );

  await assert.rejects(
    () => subject.execute({
      action: "register_project",
      payloadDigest: preview.payloadDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "confirmation_invalid",
  );
});

test("M17C confirmation expires and performs no mutation", async () => {
  const { subject, driver, now } = service();
  const preview = await subject.preview({
    schemaVersion: 1,
    action: "register_project",
    payload: { displayName: "Example" },
  });
  now.value += 60_000;

  await assert.rejects(
    () => subject.execute({
      action: "register_project",
      payloadDigest: preview.payloadDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "confirmation_expired",
  );
  assert.deepEqual(driver.calls, []);
});

test("M17C first-run daemon action is loopback-only", async () => {
  const { subject } = service();
  await assert.rejects(
    () => subject.preview({
      schemaVersion: 1,
      action: "start_loopback_daemon",
      payload: { host: "0.0.0.0", port: 4317 },
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "payload_invalid",
  );

  const preview = await subject.preview({
    schemaVersion: 1,
    action: "start_loopback_daemon",
    payload: { host: "127.0.0.1", port: 4317 },
  });
  assert.equal(preview.action, "start_loopback_daemon");
});

test("M17C setup payload rejects raw secret-like material", async () => {
  const { subject } = service();
  await assert.rejects(
    () => subject.preview({
      schemaVersion: 1,
      action: "write_config",
      payload: { apiKey: "sk-secret-value" },
    }),
    (error: unknown) =>
      error instanceof FirstRunSetupError
      && error.code === "payload_invalid",
  );
});
