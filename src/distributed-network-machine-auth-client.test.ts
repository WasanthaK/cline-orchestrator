import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { PeerCertificate } from "node:tls";
import {
  createDistributedMachineAuthenticationBinding,
  distributedMachineAuthenticationChallengePayload,
  type DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import {
  DISTRIBUTED_NETWORK_MACHINE_AUTH_CLIENT_CONTRACT,
  DistributedNetworkMachineAuthClient,
  DistributedNetworkMachineAuthClientError,
  DistributedNetworkMachineAuthTransportError,
  type DistributedNetworkMachineAuthClientTransport,
  type DistributedNetworkMachineAuthRawResponse,
  type DistributedNetworkMachineAuthRequestPlan,
} from "./distributed-network-machine-auth-client.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";
import type { DistributedMachineTransportIssueResultV1 } from "./distributed-machine-transport.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REGISTRATION_ID = "22222222-2222-4222-8222-222222222222";
const MACHINE_ID = "33333333-3333-4333-8333-333333333333";
const CHALLENGE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID_1 = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID_2 = "77777777-7777-4777-8777-777777777777";
const TOKEN = `dmt_${"x".repeat(48)}`;
const NOW = new Date("2026-10-02T06:00:00.000Z");
const SYSTEM_CA = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
const SERVER_PUBKEY = Buffer.from("m12u-test-server-pubkey");
const SERVER_PIN = `sha256/${crypto.createHash("sha256").update(SERVER_PUBKEY).digest("base64")}`;

function machineKeys(): {
  privateKey: crypto.KeyObject;
  fingerprint: string;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  assert.ok(Buffer.isBuffer(der));
  const binding = createDistributedMachineAuthenticationBinding({
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
    registrationRevision: 1,
    publicKeySpkiDerBase64: der.toString("base64"),
  });
  return { privateKey, fingerprint: binding.publicKeyFingerprint };
}

function profile(): DistributedSecureTransportProfileV1 {
  return {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    controllerOrigin: "https://controller.example.com:8443",
    serverSpkiSha256Pins: [SERVER_PIN],
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

function challenge(fingerprint: string, overrides: Partial<DistributedMachineAuthenticationChallengeV1> = {}): DistributedMachineAuthenticationChallengeV1 {
  return {
    schemaVersion: 1,
    challengeId: CHALLENGE_ID,
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
    registrationRevision: 1,
    publicKeyFingerprint: fingerprint,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
    nonce: "A".repeat(43),
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    authority: "authentication_challenge_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
    ...overrides,
  };
}

function issueResult(overrides: Partial<DistributedMachineTransportIssueResultV1> = {}): DistributedMachineTransportIssueResultV1 {
  return {
    schemaVersion: 1,
    token: TOKEN,
    claims: {
      schemaVersion: 1,
      sessionId: SESSION_ID,
      registrationId: REGISTRATION_ID,
      machineId: MACHINE_ID,
      registrationRevision: 1,
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      capabilities: ["accept_writer_candidates"],
      authority: "authenticated_machine_identity_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    ...overrides,
  };
}

function jsonResponse(value: unknown): DistributedNetworkMachineAuthRawResponse {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "identity",
      "content-length": String(body.length),
    },
    body,
  };
}

class FakeTransport implements DistributedNetworkMachineAuthClientTransport {
  calls = 0;
  plans: DistributedNetworkMachineAuthRequestPlan[] = [];

  constructor(
    private readonly responses:
      | DistributedNetworkMachineAuthRawResponse[]
      | ((plan: DistributedNetworkMachineAuthRequestPlan, index: number) => Promise<DistributedNetworkMachineAuthRawResponse>),
  ) {}

  async post(plan: DistributedNetworkMachineAuthRequestPlan): Promise<DistributedNetworkMachineAuthRawResponse> {
    const index = this.calls++;
    this.plans.push(plan);
    if (typeof this.responses === "function") return this.responses(plan, index);
    const response = this.responses[index];
    if (!response) throw new Error("unexpected transport call");
    return {
      statusCode: response.statusCode,
      headers: structuredClone(response.headers),
      body: Buffer.from(response.body),
    };
  }
}

function expectCode(code: DistributedNetworkMachineAuthClientError["code"]): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof DistributedNetworkMachineAuthClientError);
    assert.equal(error.code, code);
    return true;
  };
}

function requestIds(): () => string {
  const ids = [REQUEST_ID_1, REQUEST_ID_2];
  return () => {
    const next = ids.shift();
    assert.ok(next);
    return next;
  };
}

test("M12U target client contract exposes signer-only non-authorizing bootstrap", () => {
  assert.deepEqual(DISTRIBUTED_NETWORK_MACHINE_AUTH_CLIENT_CONTRACT, {
    schemaVersion: 1,
    usesM12PServerAuthentication: true,
    fixedChallengePath: "/v1/distributed/auth/challenge",
    fixedSessionPath: "/v1/distributed/auth/session",
    privateKeyAccepted: false,
    signerOnlyPrivateKeyBoundary: true,
    validatesChallengeBeforeSigner: true,
    usesExistingM12QChallengePayload: true,
    automaticChallengeRetryAllowed: false,
    automaticCompletionRetryAllowed: false,
    tokenPersistenceIncluded: false,
    startsM12SPolling: false,
    redirectsAllowed: false,
    environmentProxyAllowed: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
});

test("successful M12U client authenticates controller plan, validates challenge before signing and returns M12C result", async () => {
  const keys = machineKeys();
  const challengeValue = challenge(keys.fingerprint);
  const resultValue = issueResult();
  const transport = new FakeTransport([
    jsonResponse(challengeValue),
    jsonResponse(resultValue),
  ]);
  const signedPayloads: Buffer[] = [];

  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });

  const result = await client.bootstrapSession({
    profile: profile(),
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
    signer: {
      publicKeyFingerprint: keys.fingerprint,
      async sign(payload) {
        signedPayloads.push(Buffer.from(payload));
        return crypto.sign(null, payload, keys.privateKey);
      },
    },
  });

  assert.deepEqual(result, resultValue);
  assert.equal(transport.calls, 2);
  assert.equal(signedPayloads.length, 1);
  assert.deepEqual(
    signedPayloads[0],
    distributedMachineAuthenticationChallengePayload(challengeValue),
  );

  const challengePlan = transport.plans[0]!;
  assert.equal(challengePlan.url.href, "https://controller.example.com:8443/v1/distributed/auth/challenge");
  assert.equal(challengePlan.method, "POST");
  assert.equal(challengePlan.headers.Host, "controller.example.com:8443");
  assert.equal(challengePlan.headers["X-Cline-Request-Id"], REQUEST_ID_1);
  assert.equal(challengePlan.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(challengePlan.headers["Content-Encoding"], "identity");
  assert.equal(challengePlan.headers["Content-Length"], String(challengePlan.body.length));
  assert.equal(Object.hasOwn(challengePlan.headers, "Authorization"), false);
  assert.deepEqual(JSON.parse(challengePlan.body.toString("utf8")), {
    schemaVersion: 1,
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
  });
  assert.deepEqual(challengePlan.systemCaCertificates, [SYSTEM_CA]);
  assert.equal(challengePlan.rejectUnauthorized, true);
  assert.equal(challengePlan.minVersion, "TLSv1.2");
  assert.equal(challengePlan.agent, false);

  const sessionPlan = transport.plans[1]!;
  assert.equal(sessionPlan.url.pathname, "/v1/distributed/auth/session");
  assert.equal(sessionPlan.headers["X-Cline-Request-Id"], REQUEST_ID_2);
  const sessionBody = JSON.parse(sessionPlan.body.toString("utf8"));
  assert.equal(sessionBody.schemaVersion, 1);
  assert.equal(sessionBody.challengeId, CHALLENGE_ID);
  assert.equal(Buffer.from(sessionBody.signatureBase64Url, "base64url").length, 64);
});

test("M12U target client applies hostname verification before exact leaf SPKI pin", async () => {
  const keys = machineKeys();
  const transport = new FakeTransport([
    jsonResponse(challenge(keys.fingerprint)),
    jsonResponse(issueResult()),
  ]);
  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });

  await client.bootstrapSession({
    profile: profile(),
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
    signer: {
      publicKeyFingerprint: keys.fingerprint,
      async sign(payload) {
        return crypto.sign(null, payload, keys.privateKey);
      },
    },
  });

  const plan = transport.plans[0]!;
  const cert = {
    subject: { CN: "controller.example.com" },
    subjectaltname: "DNS:controller.example.com",
    pubkey: SERVER_PUBKEY,
  } as unknown as PeerCertificate;
  assert.equal(plan.checkServerIdentity("controller.example.com", cert), undefined);

  const hostnameError = plan.checkServerIdentity("other.example.com", cert) as Error & { code?: string };
  assert.ok(hostnameError instanceof Error);
  assert.equal(hostnameError.code, "M12U_TLS_HOSTNAME_MISMATCH");

  const wrongCert = {
    ...cert,
    pubkey: Buffer.from("wrong-server-pubkey"),
  } as unknown as PeerCertificate;
  const pinError = plan.checkServerIdentity("controller.example.com", wrongCert) as Error & { code?: string };
  assert.ok(pinError instanceof Error);
  assert.equal(pinError.code, "M12U_SERVER_IDENTITY_MISMATCH");
});

test("challenge mismatch is rejected before signer and before completion request", async () => {
  const keys = machineKeys();
  const mismatches = [
    challenge(keys.fingerprint, { registrationId: "88888888-8888-4888-8888-888888888888" }),
    challenge(keys.fingerprint, { capabilities: ["report_status"] }),
    challenge(keys.fingerprint, { sessionTtlMs: 30_000 }),
    challenge(`sha256/${"B".repeat(43)}=`),
  ];

  for (const value of mismatches) {
    const transport = new FakeTransport([jsonResponse(value)]);
    let signerCalls = 0;
    const client = new DistributedNetworkMachineAuthClient({
      transport,
      systemCaProvider: () => [SYSTEM_CA],
      requestIdFactory: requestIds(),
    });

    await assert.rejects(
      () => client.bootstrapSession({
        profile: profile(),
        registrationId: REGISTRATION_ID,
        capabilities: ["accept_writer_candidates"],
        sessionTtlMs: 60_000,
        signer: {
          publicKeyFingerprint: keys.fingerprint,
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      }),
      expectCode("challenge_mismatch"),
    );
    assert.equal(signerCalls, 0);
    assert.equal(transport.calls, 1);
  }
});

test("invalid signer output is rejected and completion is never attempted", async () => {
  const keys = machineKeys();
  const transport = new FakeTransport([jsonResponse(challenge(keys.fingerprint))]);
  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });

  await assert.rejects(
    () => client.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign() {
          return Buffer.alloc(63);
        },
      },
    }),
    expectCode("signature_invalid"),
  );
  assert.equal(transport.calls, 1);
});

test("invalid input and private-key-shaped extra fields fail before transport", async () => {
  const keys = machineKeys();
  for (const input of [
    {
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["report_status", "accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: { publicKeyFingerprint: keys.fingerprint, sign: async () => Buffer.alloc(64) },
    },
    {
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: { publicKeyFingerprint: keys.fingerprint, sign: async () => Buffer.alloc(64) },
      privateKey: "forbidden",
    },
    {
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        sign: async () => Buffer.alloc(64),
        privateKey: "forbidden",
      },
    },
  ]) {
    const transport = new FakeTransport([]);
    const client = new DistributedNetworkMachineAuthClient({
      transport,
      systemCaProvider: () => [SYSTEM_CA],
      requestIdFactory: requestIds(),
    });
    await assert.rejects(
      () => client.bootstrapSession(input as any),
      expectCode("request_invalid"),
    );
    assert.equal(transport.calls, 0);
  }
});

test("M12U client does not retry transport failure or ambiguous completion", async () => {
  const keys = machineKeys();
  const failedChallenge = new FakeTransport(async () => {
    throw new DistributedNetworkMachineAuthTransportError("transport_failed");
  });
  const firstClient = new DistributedNetworkMachineAuthClient({
    transport: failedChallenge,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });
  await assert.rejects(
    () => firstClient.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign(payload) {
          return crypto.sign(null, payload, keys.privateKey);
        },
      },
    }),
    expectCode("transport_failed"),
  );
  assert.equal(failedChallenge.calls, 1);

  const ambiguousCompletion = new FakeTransport(async (_plan, index) => {
    if (index === 0) return jsonResponse(challenge(keys.fingerprint));
    throw new DistributedNetworkMachineAuthTransportError("ambiguous_outcome");
  });
  const secondClient = new DistributedNetworkMachineAuthClient({
    transport: ambiguousCompletion,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });
  await assert.rejects(
    () => secondClient.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign(payload) {
          return crypto.sign(null, payload, keys.privateKey);
        },
      },
    }),
    expectCode("ambiguous_outcome"),
  );
  assert.equal(ambiguousCompletion.calls, 2);
});

test("session result must match requested registration and capabilities", async () => {
  const keys = machineKeys();
  const wrong = issueResult();
  wrong.claims.registrationId = "99999999-9999-4999-8999-999999999999";
  const transport = new FakeTransport([
    jsonResponse(challenge(keys.fingerprint)),
    jsonResponse(wrong),
  ]);
  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });

  await assert.rejects(
    () => client.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign(payload) {
          return crypto.sign(null, payload, keys.privateKey);
        },
      },
    }),
    expectCode("session_mismatch"),
  );
});

test("non-200 or malformed JSON responses fail without exposing response body", async () => {
  const keys = machineKeys();
  const secret = "controller-secret-error";
  const badStatus: DistributedNetworkMachineAuthRawResponse = {
    statusCode: 404,
    headers: { "content-length": "0" },
    body: Buffer.from(secret),
  };
  const transport = new FakeTransport([badStatus]);
  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => [SYSTEM_CA],
    requestIdFactory: requestIds(),
  });

  try {
    await client.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign() {
          return Buffer.alloc(64);
        },
      },
    });
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof DistributedNetworkMachineAuthClientError);
    assert.equal(error.code, "unexpected_status");
    assert.equal(error.message.includes(secret), false);
  }
  assert.equal(transport.calls, 1);
});

test("system CA provider failures are sanitized before transport", async () => {
  const keys = machineKeys();
  const transport = new FakeTransport([]);
  const client = new DistributedNetworkMachineAuthClient({
    transport,
    systemCaProvider: () => {
      throw new Error("local CA provider secret");
    },
    requestIdFactory: requestIds(),
  });

  await assert.rejects(
    () => client.bootstrapSession({
      profile: profile(),
      registrationId: REGISTRATION_ID,
      capabilities: ["accept_writer_candidates"],
      sessionTtlMs: 60_000,
      signer: {
        publicKeyFingerprint: keys.fingerprint,
        async sign() {
          return Buffer.alloc(64);
        },
      },
    }),
    expectCode("system_ca_unavailable"),
  );
  assert.equal(transport.calls, 0);
});
