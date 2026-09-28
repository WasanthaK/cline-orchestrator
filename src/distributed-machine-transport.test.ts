import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistributedMachineTransportSessionClaims,
  createDistributedMachineTransportSessionClaims,
  DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT,
  DistributedMachineTransportError,
  DistributedMachineTransportGateway,
  type DistributedMachineRegistrationLookup,
} from "./distributed-machine-transport.js";
import type {
  DistributedMachineCapabilityV1,
  DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";

const IDs = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  requestA: "44444444-4444-4444-8444-444444444444",
  requestB: "55555555-5555-4555-8555-555555555555",
  requestC: "66666666-6666-4666-8666-666666666666",
};

function registration(
  overrides: Partial<DistributedMachineRegistrationV1> = {},
): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: IDs.registration,
    machineId: IDs.machine,
    revision: 1,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
    authority: "identity_only",
    ...overrides,
  };
}

class MutableLookup implements DistributedMachineRegistrationLookup {
  value = registration();

  async get(registrationId: string): Promise<DistributedMachineRegistrationV1> {
    if (registrationId !== this.value.registrationId) throw new Error("not found");
    return structuredClone(this.value);
  }
}

function gateway(
  lookup: MutableLookup,
  clock: { now: Date },
  capabilities: readonly DistributedMachineCapabilityV1[] = [
    "report_status",
    "accept_writer_candidates",
  ],
) {
  const transport = new DistributedMachineTransportGateway(lookup, {
    now: () => clock.now,
    idFactory: () => IDs.session,
    tokenFactory: () => "dmt_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    livenessTtlMs: 30_000,
  });
  return {
    transport,
    issue: () => transport.issue(IDs.registration, {
      capabilities: [...capabilities],
      ttlMs: 60_000,
    }),
  };
}

test("12C transport identity is short-lived and grants no execution authority", async () => {
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.sessionIssuanceControllerLocalOnly, true);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.networkListenerIncluded, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.crossMachineWriteDispatchEnabled, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.distributedWriteExecutionEnabled, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsFilesystemAuthority, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsSafetyPlanAuthority, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsWriterLeaseAuthority, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsCredentialAuthority, false);
  assert.equal(DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.transportGrantsReleaseAuthority, false);

  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const issued = await gateway(lookup, clock).issue();
  assert.equal(issued.claims.registrationRevision, 1);
  assert.equal(issued.claims.authority, "authenticated_machine_identity_only");
  assert.equal(issued.claims.grantsTaskAuthority, false);
  assert.equal(JSON.stringify(issued.claims).includes(issued.token), false);
  assert.doesNotThrow(() => assertDistributedMachineTransportSessionClaims(issued.claims));
});

test("session request cannot widen registration capability or add transport authority fields", () => {
  assert.throws(
    () => createDistributedMachineTransportSessionClaims(
      registration({ allowedCapabilities: ["report_status"] }),
      { capabilities: ["accept_writer_candidates"], ttlMs: 60_000 },
      { now: () => new Date("2026-09-29T00:10:00.000Z"), idFactory: () => IDs.session },
    ),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "capability_not_allowed",
  );
  assert.throws(
    () => createDistributedMachineTransportSessionClaims(
      registration(),
      { capabilities: ["report_status"], ttlMs: 60_000, endpoint: "https://bad.invalid" } as never,
      { now: () => new Date("2026-09-29T00:10:00.000Z"), idFactory: () => IDs.session },
    ),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "request_invalid",
  );
});

test("registration revision change or revocation invalidates an existing session", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();

  lookup.value = registration({
    revision: 2,
    updatedAt: "2026-09-29T00:10:01.000Z",
  });
  await assert.rejects(
    () => transport.authorize(issued.token, IDs.requestA, "report_status"),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "session_stale",
  );

  const lookup2 = new MutableLookup();
  const { transport: transport2, issue: issue2 } = gateway(lookup2, clock);
  const issued2 = await issue2();
  lookup2.value = registration({
    revokedAt: "2026-09-29T00:10:02.000Z",
    updatedAt: "2026-09-29T00:10:02.000Z",
    revision: 2,
  });
  await assert.rejects(
    () => transport2.authorize(issued2.token, IDs.requestB, "report_status"),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "registration_not_current",
  );
});

test("request ids are single-use and candidate coordination requires its explicit capability", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock, ["report_status"] as const);
  const issued = await issue();
  const authorized = await transport.authorize(issued.token, IDs.requestA, "report_status");
  assert.equal(authorized.authority, "transport_identity_only");
  assert.equal(authorized.grantsTaskAuthority, false);

  await assert.rejects(
    () => transport.authorize(issued.token, IDs.requestA, "report_status"),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "request_replayed",
  );
  await assert.rejects(
    () => transport.authorize(issued.token, IDs.requestB, "accept_writer_candidates"),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "capability_not_allowed",
  );
});

test("status report creates controller-timestamped liveness observation only", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();
  const view = await transport.reportStatus(issued.token, IDs.requestA, {
    status: "ready",
    acceptingWriterCandidates: true,
  });

  assert.equal(view.state, "live");
  assert.equal(view.observedAt, "2026-09-29T00:10:00.000Z");
  assert.equal(view.validUntil, "2026-09-29T00:10:30.000Z");
  assert.equal(view.acceptingWriterCandidates, true);
  assert.equal(view.authority, "observation_only");
  assert.equal(view.grantsTaskAuthority, false);
  const raw = JSON.stringify(view);
  for (const forbidden of [
    "workspacePath",
    "canonicalRoot",
    "command",
    "safetyPlan",
    "credential",
    "hubToken",
    "releaseAuthority",
    issued.token,
  ]) {
    assert.equal(raw.includes(forbidden), false);
  }
});

test("writer-candidate acceptance cannot be reported without the registered transport capability", async () => {
  const lookup = new MutableLookup();
  lookup.value = registration({ allowedCapabilities: ["report_status"] });
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock, ["report_status"] as const);
  const issued = await issue();
  await assert.rejects(
    () => transport.reportStatus(issued.token, IDs.requestA, {
      status: "ready",
      acceptingWriterCandidates: true,
    }),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "capability_not_allowed",
  );
});

test("liveness expires fail-closed and process restart does not resurrect it", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();
  await transport.reportStatus(issued.token, IDs.requestA, {
    status: "busy",
    acceptingWriterCandidates: false,
  });

  clock.now = new Date("2026-09-29T00:10:30.000Z");
  const stale = await transport.getLiveness(IDs.registration);
  assert.equal(stale.state, "stale");
  assert.equal(stale.acceptingWriterCandidates, false);

  const restarted = gateway(lookup, clock).transport;
  const unknown = await restarted.getLiveness(IDs.registration);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.acceptingWriterCandidates, false);
});

test("registration revision drift invalidates prior liveness instead of carrying it forward", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();
  await transport.reportStatus(issued.token, IDs.requestA, {
    status: "ready",
    acceptingWriterCandidates: true,
  });

  lookup.value = registration({
    revision: 2,
    updatedAt: "2026-09-29T00:10:05.000Z",
  });
  const unknown = await transport.getLiveness(IDs.registration);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.registrationRevision, 2);
  assert.equal(unknown.acceptingWriterCandidates, false);
});

test("liveness cannot outlive its authenticating session", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const transport = new DistributedMachineTransportGateway(lookup, {
    now: () => clock.now,
    idFactory: () => IDs.session,
    tokenFactory: () => "dmt_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    livenessTtlMs: 120_000,
  });
  const issued = await transport.issue(IDs.registration, {
    capabilities: ["report_status"],
    ttlMs: 30_000,
  });
  const live = await transport.reportStatus(issued.token, IDs.requestA, {
    status: "ready",
    acceptingWriterCandidates: false,
  });
  assert.equal(live.validUntil, issued.claims.expiresAt);

  clock.now = new Date(issued.claims.expiresAt);
  const stale = await transport.getLiveness(IDs.registration);
  assert.equal(stale.state, "stale");
  await assert.rejects(
    () => transport.authorize(issued.token, IDs.requestB, "report_status"),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "session_expired",
  );
});

test("explicit session revocation immediately clears liveness from that session", async () => {
  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();
  await transport.reportStatus(issued.token, IDs.requestA, {
    status: "ready",
    acceptingWriterCandidates: true,
  });
  transport.revokeSession(issued.token);
  const unknown = await transport.getLiveness(IDs.registration);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.acceptingWriterCandidates, false);
});

test("forged authority or payload fields fail closed", async () => {
  const claims = createDistributedMachineTransportSessionClaims(
    registration(),
    { capabilities: ["report_status"], ttlMs: 60_000 },
    { now: () => new Date("2026-09-29T00:10:00.000Z"), idFactory: () => IDs.session },
  );
  assert.throws(
    () => assertDistributedMachineTransportSessionClaims({ ...claims, grantsTaskAuthority: true }),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "session_invalid",
  );
  assert.throws(
    () => assertDistributedMachineTransportSessionClaims({ ...claims, command: "npm test" }),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "session_invalid",
  );

  const lookup = new MutableLookup();
  const clock = { now: new Date("2026-09-29T00:10:00.000Z") };
  const { transport, issue } = gateway(lookup, clock);
  const issued = await issue();
  await assert.rejects(
    () => transport.reportStatus(issued.token, IDs.requestC, {
      status: "ready",
      acceptingWriterCandidates: false,
      workspacePath: "/tmp/secret",
    } as never),
    (error: unknown) => error instanceof DistributedMachineTransportError
      && error.code === "request_invalid",
  );
});
