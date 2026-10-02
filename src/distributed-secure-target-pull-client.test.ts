import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { PeerCertificate } from "node:tls";
import {
  DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT,
  DistributedSecureTargetPullClient,
  DistributedSecureTargetPullClientError,
  DistributedSecureTargetPullTransportError,
  assertDistributedSecureTargetPullRuntime,
  createDistributedSecureTargetPullRequestPlan,
  type DistributedSecureTargetPullRawResponse,
  type DistributedSecureTargetPullRequestPlan,
  type DistributedSecureTargetPullRequestTransport,
} from "./distributed-secure-target-pull-client.js";
import type { DistributedExecutionDeliveryBundleV1 } from "./distributed-execution-delivery.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const REGISTRATION_ID = "44444444-4444-4444-8444-444444444444";
const MACHINE_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";
const TASK_ID = "77777777-7777-4777-8777-777777777777";
const WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const PLACEMENT_ID = "99999999-9999-4999-8999-999999999999";
const ASSIGNMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FENCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DISPATCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = `dmt_${"x".repeat(48)}`;
const SYSTEM_CA = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
const PUBKEY = Buffer.from("m12s-test-public-key");
const PIN = `sha256/${crypto.createHash("sha256").update(PUBKEY).digest("base64")}`;

function profile(overrides: Partial<DistributedSecureTransportProfileV1> = {}): DistributedSecureTransportProfileV1 {
  return {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    controllerOrigin: "https://controller.example.com",
    serverSpkiSha256Pins: [PIN],
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
    ...overrides,
  };
}

function bundle(): DistributedExecutionDeliveryBundleV1 {
  const issuedAt = "2026-10-02T00:00:00.000Z";
  const expiresAt = "2026-10-02T00:01:00.000Z";
  return {
    schemaVersion: 1,
    deliveryId: DELIVERY_ID,
    transportRequest: {
      schemaVersion: 1,
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      registrationId: REGISTRATION_ID,
      machineId: MACHINE_ID,
      registrationRevision: 1,
      capability: "accept_writer_candidates",
      authority: "transport_identity_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    dispatch: {
      schemaVersion: 1,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      machineRegistrationId: REGISTRATION_ID,
      machineRegistrationRevision: 1,
      placementId: PLACEMENT_ID,
      placementRevision: 1,
      candidateAssignmentId: ASSIGNMENT_ID,
      fenceId: FENCE_ID,
      fenceGeneration: 1,
      issuedAt,
      expiresAt,
      authority: "execution_request_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    assignment: {
      schemaVersion: 1,
      assignmentId: ASSIGNMENT_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      machineRegistrationId: REGISTRATION_ID,
      machineRegistrationRevision: 1,
      placementId: PLACEMENT_ID,
      placementRevision: 1,
      issuedAt,
      expiresAt,
      authority: "coordination_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    fence: {
      schemaVersion: 1,
      fenceId: FENCE_ID,
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      machineId: MACHINE_ID,
      machineRegistrationId: REGISTRATION_ID,
      machineRegistrationRevision: 1,
      placementId: PLACEMENT_ID,
      placementRevision: 1,
      candidateAssignmentId: ASSIGNMENT_ID,
      generation: 1,
      issuedAt,
      expiresAt,
      authority: "fencing_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    authority: "transport_delivery_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function response(
  statusCode: number,
  body: Buffer = Buffer.alloc(0),
  headers: DistributedSecureTargetPullRawResponse["headers"] = {},
): DistributedSecureTargetPullRawResponse {
  return { statusCode, body, headers };
}

class FakeTransport implements DistributedSecureTargetPullRequestTransport {
  calls = 0;
  plans: DistributedSecureTargetPullRequestPlan[] = [];

  constructor(
    private readonly behavior:
      | DistributedSecureTargetPullRawResponse
      | ((plan: DistributedSecureTargetPullRequestPlan) => Promise<DistributedSecureTargetPullRawResponse>),
  ) {}

  async request(plan: DistributedSecureTargetPullRequestPlan): Promise<DistributedSecureTargetPullRawResponse> {
    this.calls += 1;
    this.plans.push(plan);
    return typeof this.behavior === "function"
      ? this.behavior(plan)
      : structuredClone(this.behavior);
  }
}

function clientWith(
  transport: DistributedSecureTargetPullRequestTransport,
  systemCaProvider: () => string[] = () => [SYSTEM_CA],
): DistributedSecureTargetPullClient {
  return new DistributedSecureTargetPullClient({ transport, systemCaProvider });
}

function expectCode(
  code: DistributedSecureTargetPullClientError["code"],
): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof DistributedSecureTargetPullClientError);
    assert.equal(error.code, code);
    return true;
  };
}

test("M12S contract exposes outbound-only non-authorizing client semantics", () => {
  assert.deepEqual(DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT, {
    schemaVersion: 1,
    direction: "target_to_controller",
    method: "POST",
    fixedPath: "/v1/distributed/execution/pull",
    minimumNodeVersion: "22.15.0",
    requestContainsWorkSelectors: false,
    requiresValidatedM12PProfile: true,
    requiresM12CBearer: true,
    issuesOrRefreshesBearer: false,
    requiresSystemCaValidation: true,
    requiresHostnameValidation: true,
    requiresLeafSpkiSha256Pin: true,
    redirectsAllowed: false,
    environmentProxyAllowed: false,
    automaticRetryAllowed: false,
    connectionReuseAllowed: false,
    requestBodyAllowed: false,
    acceptsNoWork204: true,
    acceptsM12JBundle200: true,
    invokesTargetRuntime: false,
    outboundNetworkIoIncluded: true,
    listenerIncluded: false,
    controllerPushEnabled: false,
    credentialProvisioningIncluded: false,
    distributedTakeoverEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
});

test("M12S enforces Node 22.15 system-root runtime floor", () => {
  assert.throws(() => assertDistributedSecureTargetPullRuntime("22.14.9"), expectCode("unsupported_runtime"));
  assert.doesNotThrow(() => assertDistributedSecureTargetPullRuntime("22.15.0"));
  assert.doesNotThrow(() => assertDistributedSecureTargetPullRuntime("23.0.0"));
});

test("M12S builds exactly one fixed selector-free POST with bounded TLS settings", async () => {
  const transport = new FakeTransport(response(204, Buffer.alloc(0), { "content-length": "0" }));
  const client = clientWith(transport);
  const result = await client.pull({
    profile: profile(),
    bearerToken: TOKEN,
    requestId: REQUEST_ID,
  });

  assert.equal(result, null);
  assert.equal(transport.calls, 1);
  const plan = transport.plans[0]!;
  assert.equal(plan.url.href, "https://controller.example.com/v1/distributed/execution/pull");
  assert.equal(plan.method, "POST");
  assert.equal(plan.agent, false);
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.minVersion, "TLSv1.2");
  assert.equal(plan.connectTimeoutMs, 5_000);
  assert.equal(plan.responseTimeoutMs, 5_000);
  assert.equal(plan.maxResponseBytes, 64 * 1024);
  assert.deepEqual(plan.systemCaCertificates, [SYSTEM_CA]);
  assert.deepEqual(plan.headers, {
    Authorization: `Bearer ${TOKEN}`,
    "X-Cline-Request-Id": REQUEST_ID,
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Length": "0",
  });
  const serialized = JSON.stringify(plan);
  for (const forbidden of ["taskId", "workspaceId", "dispatchId", "candidateAssignmentId", "fenceId", "placementId"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("M12S rejects unknown pull fields and invalid profile/bearer/request id before transport I/O", async () => {
  const transport = new FakeTransport(response(204));
  const client = clientWith(transport);

  await assert.rejects(
    () => client.pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
      taskId: TASK_ID,
    } as any),
    expectCode("profile_invalid"),
  );
  await assert.rejects(
    () => client.pull({
      profile: { ...profile(), controllerOrigin: "http://controller.example.com" },
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("profile_invalid"),
  );
  await assert.rejects(
    () => client.pull({
      profile: profile(),
      bearerToken: "short",
      requestId: REQUEST_ID,
    }),
    expectCode("bearer_invalid"),
  );
  await assert.rejects(
    () => client.pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: "not-a-uuid",
    }),
    expectCode("request_id_invalid"),
  );
  assert.equal(transport.calls, 0);
});

test("M12S fails closed when system roots are unavailable before request transport", async () => {
  const transport = new FakeTransport(response(204));
  const client = clientWith(transport, () => []);
  await assert.rejects(
    () => client.pull({ profile: profile(), bearerToken: TOKEN, requestId: REQUEST_ID }),
    expectCode("system_ca_unavailable"),
  );
  assert.equal(transport.calls, 0);
});

test("M12S hostname verification runs before leaf-SPKI pin acceptance", () => {
  const plan = createDistributedSecureTargetPullRequestPlan(
    { profile: profile(), bearerToken: TOKEN, requestId: REQUEST_ID },
    [SYSTEM_CA],
  );
  const cert = {
    subject: { CN: "controller.example.com" },
    subjectaltname: "DNS:controller.example.com",
    pubkey: PUBKEY,
  } as unknown as PeerCertificate;

  assert.equal(plan.checkServerIdentity("controller.example.com", cert), undefined);

  const hostnameError = plan.checkServerIdentity("other.example.com", cert) as Error & { code?: string };
  assert.ok(hostnameError instanceof Error);
  assert.equal(hostnameError.code, "M12S_TLS_HOSTNAME_MISMATCH");

  const wrongPinPlan = createDistributedSecureTargetPullRequestPlan(
    {
      profile: profile({
        serverSpkiSha256Pins: ["sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
      }),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    },
    [SYSTEM_CA],
  );
  const pinError = wrongPinPlan.checkServerIdentity("controller.example.com", cert) as Error & { code?: string };
  assert.ok(pinError instanceof Error);
  assert.equal(pinError.code, "M12S_SERVER_IDENTITY_MISMATCH");
});

test("M12S accepts only 204 no-work or validated bounded M12J JSON", async () => {
  const noWork = clientWith(new FakeTransport(response(204, Buffer.alloc(0), { "content-length": "0" })));
  assert.equal(
    await noWork.pull({ profile: profile(), bearerToken: TOKEN, requestId: REQUEST_ID }),
    null,
  );

  const delivery = bundle();
  const body = Buffer.from(JSON.stringify(delivery));
  const transport = new FakeTransport(response(200, body, {
    "content-type": "application/json; charset=utf-8",
    "content-encoding": "identity",
    "content-length": String(body.length),
  }));
  const result = await clientWith(transport).pull({
    profile: profile(),
    bearerToken: TOKEN,
    requestId: REQUEST_ID,
  });
  assert.deepEqual(result, delivery);
  assert.notEqual(result, delivery);
});

test("M12S rejects redirects, auth/state conflicts and unexpected statuses without following or retrying", async () => {
  for (const [status, code] of [
    [302, "redirect_rejected"],
    [401, "authentication_rejected"],
    [403, "authentication_rejected"],
    [409, "request_state_conflict"],
    [500, "unexpected_status"],
  ] as const) {
    const transport = new FakeTransport(response(status, Buffer.from("secret controller body"), {
      location: "https://evil.example.com/",
    }));
    const client = clientWith(transport);
    await assert.rejects(
      () => client.pull({ profile: profile(), bearerToken: TOKEN, requestId: REQUEST_ID }),
      expectCode(code),
    );
    assert.equal(transport.calls, 1);
  }
});

test("M12S enforces 204 body, JSON media type, identity encoding and declared/actual size bounds", async () => {
  const cases: Array<[DistributedSecureTargetPullRawResponse, DistributedSecureTargetPullClientError["code"]]> = [
    [response(204, Buffer.from("x")), "response_headers_invalid"],
    [response(200, Buffer.from("{}"), { "content-type": "text/plain" }), "response_headers_invalid"],
    [response(200, Buffer.from("{}"), { "content-type": "application/json", "content-encoding": "br" }), "response_encoding_rejected"],
    [response(200, Buffer.from("{}"), { "content-type": "application/json", "content-length": String(128 * 1024) }), "response_too_large"],
    [response(200, Buffer.alloc(70 * 1024), { "content-type": "application/json" }), "response_too_large"],
  ];
  for (const [raw, code] of cases) {
    await assert.rejects(
      () => clientWith(new FakeTransport(raw)).pull({
        profile: profile(),
        bearerToken: TOKEN,
        requestId: REQUEST_ID,
      }),
      expectCode(code),
    );
  }
});

test("M12S rejects malformed UTF-8, malformed JSON and schema-invalid delivery", async () => {
  const malformedUtf8 = response(200, Buffer.from([0xc3, 0x28]), {
    "content-type": "application/json",
  });
  await assert.rejects(
    () => clientWith(new FakeTransport(malformedUtf8)).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("response_json_invalid"),
  );

  const malformedJson = response(200, Buffer.from("{"), {
    "content-type": "application/json",
  });
  await assert.rejects(
    () => clientWith(new FakeTransport(malformedJson)).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("response_json_invalid"),
  );

  const invalidDelivery = response(200, Buffer.from(JSON.stringify({ schemaVersion: 1 })), {
    "content-type": "application/json",
  });
  await assert.rejects(
    () => clientWith(new FakeTransport(invalidDelivery)).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("delivery_invalid"),
  );
});

test("M12S never retries transport failures and preserves explicit ambiguous outcome", async () => {
  const ambiguous = new FakeTransport(async () => {
    throw new DistributedSecureTargetPullTransportError(
      "ambiguous_outcome",
      "raw error that must be sanitized",
    );
  });
  await assert.rejects(
    () => clientWith(ambiguous).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("ambiguous_outcome"),
  );
  assert.equal(ambiguous.calls, 1);

  const connect = new FakeTransport(async () => {
    throw new DistributedSecureTargetPullTransportError(
      "dns_or_connect_failed",
      "raw network failure",
    );
  });
  await assert.rejects(
    () => clientWith(connect).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    }),
    expectCode("dns_or_connect_failed"),
  );
  assert.equal(connect.calls, 1);
});

test("M12S public errors never expose bearer or controller response body", async () => {
  const secretBody = "controller-secret-response-body";
  const transport = new FakeTransport(response(500, Buffer.from(secretBody)));
  try {
    await clientWith(transport).pull({
      profile: profile(),
      bearerToken: TOKEN,
      requestId: REQUEST_ID,
    });
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof DistributedSecureTargetPullClientError);
    const serialized = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes(secretBody), false);
  }
});

test("M12S returns transport evidence only and has no runtime-execution dependency", async () => {
  const delivery = bundle();
  const body = Buffer.from(JSON.stringify(delivery));
  const result = await clientWith(new FakeTransport(response(200, body, {
    "content-type": "application/json",
  }))).pull({
    profile: profile(),
    bearerToken: TOKEN,
    requestId: REQUEST_ID,
  });

  assert.deepEqual(result, delivery);
  assert.equal(result?.authority, "transport_delivery_evidence_only");
  assert.equal(DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT.invokesTargetRuntime, false);
  assert.equal(DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT.listenerIncluded, false);
  assert.equal(DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT.controllerPushEnabled, false);
});
