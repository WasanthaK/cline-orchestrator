import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_SERVICE_LIFECYCLE_CONTRACT,
  LocalServiceLifecycleError,
  LocalServiceLifecycleService,
  type LocalServiceLifecycleDriver,
  type LocalServiceSpecV1,
} from "./local-service-lifecycle.js";

const spec: LocalServiceSpecV1 = {
  schemaVersion: 1,
  manager: "systemd",
  serviceName: "cline-orchestrator",
  displayName: "Cline Orchestrator",
  executable: "/opt/cline-orchestrator/bin/cline-orchestrator",
  args: ["start", "/srv/workspace"],
  workingDirectory: "/opt/cline-orchestrator",
  configPath: "/etc/cline-orchestrator/config.json",
  secretReferenceNames: ["ORCH_PROVIDER_API_KEY"],
  daemonHost: "127.0.0.1",
  daemonPort: 4317,
  autoStart: false,
  authority: "local_service_specification_only",
  grantsAuthority: false,
};

class Driver implements LocalServiceLifecycleDriver {
  calls: string[] = [];

  async install() { this.calls.push("install"); }
  async start() { this.calls.push("start"); }
  async stop() { this.calls.push("stop"); }
  async status() {
    this.calls.push("status");
    return {
      schemaVersion: 1 as const,
      serviceName: "cline-orchestrator",
      installed: true,
      running: false,
      manager: "systemd" as const,
      authority: "local_service_status_observation" as const,
      grantsAuthority: false as const,
    };
  }
}

test("M17E contract keeps lifecycle explicit, loopback-only and authority-free", () => {
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.explicitMutationRequired, true);
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.statusReadOnly, true);
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.loopbackOnlyDefault, true);
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.embedsSecretMaterial, false);
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.opensRemoteListener, false);
  assert.equal(LOCAL_SERVICE_LIFECYCLE_CONTRACT.grantsReleaseAuthority, false);
});

for (const action of ["install", "start", "stop"] as const) {
  test(`M17E executes exactly one explicit ${action} lifecycle action`, async () => {
    const driver = new Driver();
    const result = await new LocalServiceLifecycleService(
      driver,
      { now: () => new Date("2026-10-08T14:30:00.000Z") },
    ).execute(action, spec);

    assert.deepEqual(driver.calls, [action]);
    assert.equal(result.action, action);
    assert.equal(result.opensRemoteListener, false);
    assert.equal(result.grantsReleaseAuthority, false);
  });
}

test("M17E status is read-only observation", async () => {
  const driver = new Driver();
  const result = await new LocalServiceLifecycleService(driver).execute("status", spec);

  assert.deepEqual(driver.calls, ["status"]);
  assert.equal(result.status?.installed, true);
  assert.equal(result.status?.running, false);
  assert.equal(result.status?.grantsAuthority, false);
});

test("M17E rejects non-loopback service definition", async () => {
  const driver = new Driver();
  await assert.rejects(
    () => new LocalServiceLifecycleService(driver).execute("install", {
      ...spec,
      daemonHost: "0.0.0.0" as any,
    }),
    (error: unknown) =>
      error instanceof LocalServiceLifecycleError
      && error.code === "spec_invalid",
  );
  assert.deepEqual(driver.calls, []);
});

test("M17E rejects raw secret-bearing service specification", async () => {
  const driver = new Driver();
  await assert.rejects(
    () => new LocalServiceLifecycleService(driver).execute("install", {
      ...spec,
      args: ["start", "/srv/workspace", "--apiKey=secret"],
    }),
    (error: unknown) =>
      error instanceof LocalServiceLifecycleError
      && error.code === "spec_invalid",
  );
  assert.deepEqual(driver.calls, []);
});

test("M17E rejects authority-widened or cross-bound status", async () => {
  const driver: LocalServiceLifecycleDriver = {
    async install() {},
    async start() {},
    async stop() {},
    async status() {
      return {
        schemaVersion: 1,
        serviceName: "other-service",
        installed: true,
        running: true,
        manager: "systemd",
        authority: "local_service_status_observation",
        grantsAuthority: false,
      };
    },
  };

  await assert.rejects(
    () => new LocalServiceLifecycleService(driver).execute("status", spec),
    (error: unknown) =>
      error instanceof LocalServiceLifecycleError
      && error.code === "status_invalid",
  );
});
