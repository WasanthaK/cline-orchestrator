import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DistributedDeliveryAckClient,
  DistributedDeliveryAckRoute,
  DistributedDeliveryAckTransportError,
  createDistributedDeliveryAckRequestPlan,
  DISTRIBUTED_DELIVERY_ACK_PATH,
  DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT,
  type DistributedDeliveryAckRawResponse,
  type DistributedDeliveryAckRequestPlan,
} from "./distributed-delivery-ack-transport.js";
import {
  FileDistributedDeliveryStateStore,
  createDistributedDeliveryStateRecord,
  type DistributedDeliveryAdmissionAcknowledgementV1,
} from "./distributed-delivery-reconciliation.js";
import type { DistributedMachineAuthorizedRequestV1 } from "./distributed-machine-transport.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";

const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const DISPATCH_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const MACHINE_ID = "55555555-5555-4555-8555-555555555555";
const REGISTRATION_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "88888888-8888-4888-8888-888888888888";
const ACK_ID = "99999999-9999-4999-8999-999999999999";
const TOKEN = `dmt_${"x".repeat(48)}`;
const T0 = new Date("2026-10-05T06:00:00.000Z");
const T1 = new Date("2026-10-05T06:00:01.000Z");
const T2 = new Date("2026-10-05T06:00:02.000Z");
const ROOT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
const TEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_FOR_TEST = (value: string) => TEST_UUID.test(value);

function acknowledgement(): DistributedDeliveryAdmissionAcknowledgementV1 {
  return {
    schemaVersion: 1,
    acknowledgementId: ACK_ID,
    deliveryId: DELIVERY_ID,
    dispatchId: DISPATCH_ID,
    taskId: TASK_ID,
    workspaceId: WORKSPACE_ID,
    machineId: MACHINE_ID,
    machineRegistrationId: REGISTRATION_ID,
    machineRegistrationRevision: 1,
    admittedAt: T1.toISOString(),
    acknowledgedAt: T2.toISOString(),
    authority: "delivery_admission_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function authorized(machineId = MACHINE_ID): DistributedMachineAuthorizedRequestV1 {
  return {
    schemaVersion: 1,
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    registrationId: REGISTRATION_ID,
    machineId,
    registrationRevision: 1,
    capability: "report_status",
    authority: "transport_identity_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function headers(body: Buffer, requestId = REQUEST_ID): string[] {
  return [
    "Host", "controller.example.com:8443",
    "Authorization", `Bearer ${TOKEN}`,
    "X-Cline-Request-Id", requestId,
    "Accept", "application/json",
    "Accept-Encoding", "identity",
    "Cache-Control", "no-store",
    "Connection", "close",
    "Content-Type", "application/json; charset=utf-8",
    "Content-Encoding", "identity",
    "Content-Length", String(body.length),
  ];
}

function profile(): DistributedSecureTransportProfileV1 {
  return {
    schemaVersion: 1,
    profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    controllerOrigin: "https://controller.example.com:8443",
    serverSpkiSha256Pins: ["sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    connectTimeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    serverAuthentication: "system_ca_plus_spki_sha256_pin",
    authority: "transport_configuration_only",
    networkIoEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

test("M12Y-C contract permits idempotent ACK retry but never work retry/requeue", () => {
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.fixedPath, DISTRIBUTED_DELIVERY_ACK_PATH);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.requiredCapability, "report_status");
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.explicitIdempotentAckRetryAllowed, true);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.automaticAckRetryAllowed, false);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.workDeliveryRetryAllowed, false);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.workRequeueAllowed, false);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.writerExecutionIncluded, false);
  assert.equal(DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT.grantsTaskAuthority, false);
});

test("controller ACK route authenticates report_status and reconciles exact durable delivery state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m12y-c-route-"));
  try {
    const store = new FileDistributedDeliveryStateStore(path.join(dir, "distributed-delivery-state.json"));
    await store.create(createDistributedDeliveryStateRecord({
      deliveryId: DELIVERY_ID,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      machineRegistrationId: REGISTRATION_ID,
      machineRegistrationRevision: 1,
    }, { now: () => T0 }));
    await store.advance(DELIVERY_ID, "pending", "claimed", { now: () => T1 });
    await store.advance(DELIVERY_ID, "claimed", "delivered_unconfirmed", { now: () => T2 });

    const capabilities: string[] = [];
    const route = new DistributedDeliveryAckRoute({
      controllerOrigin: "https://controller.example.com:8443",
      authorizer: {
        async authorize(_token, requestId, capability) {
          assert.ok(UUID_FOR_TEST(requestId));
          capabilities.push(capability);
          return { ...authorized(), requestId };
        },
      },
      stateStore: store,
    });
    const body = Buffer.from(JSON.stringify(acknowledgement()), "utf8");
    const response = await route.handle({
      method: "POST",
      url: DISTRIBUTED_DELIVERY_ACK_PATH,
      httpVersion: "1.1",
      rawHeaders: headers(body),
      body,
    });
    assert.equal(response.statusCode, 204);
    assert.deepEqual(capabilities, ["report_status"]);
    const reconciled = await store.get(DELIVERY_ID);
    assert.equal(reconciled.state, "admission_acknowledged");
    assert.deepEqual(reconciled.acknowledgement, acknowledgement());

    const duplicate = await route.handle({
      method: "POST",
      url: DISTRIBUTED_DELIVERY_ACK_PATH,
      httpVersion: "1.1",
      rawHeaders: headers(body, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      body,
    });
    assert.equal(duplicate.statusCode, 204);
    assert.equal((await store.get(DELIVERY_ID)).state, "admission_acknowledged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("controller ACK route rejects wrong authenticated machine before reconciliation", async () => {
  let stateCalls = 0;
  const route = new DistributedDeliveryAckRoute({
    controllerOrigin: "https://controller.example.com:8443",
    authorizer: {
      async authorize() {
        return authorized("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      },
    },
    stateStore: {
      async acknowledge() {
        stateCalls += 1;
        throw new Error("must not be called");
      },
    },
  });
  const body = Buffer.from(JSON.stringify(acknowledgement()), "utf8");
  const response = await route.handle({
    method: "POST",
    url: DISTRIBUTED_DELIVERY_ACK_PATH,
    httpVersion: "1.1",
    rawHeaders: headers(body),
    body,
  });
  assert.equal(response.statusCode, 403);
  assert.equal(stateCalls, 0);
});

test("ACK request plan carries only durable acknowledgement evidence over pinned HTTPS", () => {
  const ack = acknowledgement();
  const plan = createDistributedDeliveryAckRequestPlan({
    profile: profile(),
    bearerToken: TOKEN,
    requestId: REQUEST_ID,
    acknowledgement: ack,
  }, [ROOT]);
  assert.equal(plan.url.href, "https://controller.example.com:8443/v1/distributed/execution/ack");
  assert.equal(plan.method, "POST");
  assert.equal(plan.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(plan.headers["X-Cline-Request-Id"], REQUEST_ID);
  assert.equal(plan.headers["Content-Length"], String(plan.body.length));
  assert.deepEqual(JSON.parse(plan.body.toString("utf8")), ack);
  assert.equal(plan.agent, false);
  assert.equal(plan.rejectUnauthorized, true);
});

test("ACK client treats ambiguous upload as ACK ambiguity only and never retries internally", async () => {
  let calls = 0;
  const client = new DistributedDeliveryAckClient(
    {
      async post(_plan: DistributedDeliveryAckRequestPlan): Promise<DistributedDeliveryAckRawResponse> {
        calls += 1;
        throw new DistributedDeliveryAckTransportError("ambiguous", "ambiguous_outcome");
      },
    },
    () => [ROOT],
  );
  await assert.rejects(
    () => client.upload({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
      acknowledgement: acknowledgement(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof DistributedDeliveryAckTransportError);
      assert.equal(error.code, "ambiguous_outcome");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("ACK client accepts only empty 204 confirmation", async () => {
  const client = new DistributedDeliveryAckClient(
    {
      async post(): Promise<DistributedDeliveryAckRawResponse> {
        return { statusCode: 204, headers: { "content-length": "0" }, body: Buffer.alloc(0) };
      },
    },
    () => [ROOT],
  );
  await client.upload({
    profile: profile(),
    bearerToken: TOKEN,
    requestId: REQUEST_ID,
    acknowledgement: acknowledgement(),
  });
});
