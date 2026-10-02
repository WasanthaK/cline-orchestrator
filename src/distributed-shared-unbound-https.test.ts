import assert from "node:assert/strict";
import crypto, {
  X509Certificate,
  createPrivateKey,
  generateKeyPairSync,
} from "node:crypto";
import https from "node:https";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DISTRIBUTED_SHARED_UNBOUND_HTTPS_CONTRACT,
  DistributedBootstrapBodyCollector,
  DistributedSharedHttpsRouter,
  DistributedSharedUnboundHttpsError,
  createUnboundDistributedSharedHttpsServer,
  preflightDistributedSharedTlsIdentity,
  type DistributedSharedHttpsServerBuilder,
  type DistributedSharedHttpsRouterRequestV1,
} from "./distributed-shared-unbound-https.js";
import type { DistributedExecutionDeliveryBundleV1 } from "./distributed-execution-delivery.js";
import type {
  DistributedMachineAuthenticationChallengeRequestV1,
  DistributedMachineAuthenticationChallengeResponseV1,
  DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import type { DistributedMachineTransportIssueResultV1 } from "./distributed-machine-transport.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";

const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1NoM6avK+uN0C
RtrX/8pSjs2tM9UmMsxlMpqeoXBi/XdL8FlbBy2/8+eiD75U2uHqRi7AjWVpsW2m
OfZ7IjS6/prv6lgGaybfv3A+A6+/64P/PCn2wq8HahfgsO0PH1RMuETUm8L2R8mx
gnYQWwaH8Di9XU1b/+GYHa5uZRsEv9kcvQtHNZxQGFIaYDIsJuIu0ojp69QyqEbq
M3OBzA8PaBUcKpC+sPfrdBsgnQpQlhCffMd+rhSau8p4vVUHXkG/9ONoWLrhR8II
RHZYX4Q7p7poeeMHmypngGUidvKt612sOr30voSU36HYCmpPPFQwW3WqqDShUkn/
T/LvB/8jAgMBAAECggEAVtjuYaP5/L/6Y+nzXkvf+lsoZZcO04TLAsES622xwC97
6jAhkwfIvFM3syrabC6O0UmbhHr/nH0FcQIch/znyqrVNKBaWZEnC1rjf0UjCNbl
5wA9mF7LpcEJ+oywwGuiajZx/nc8I+5Z0rIUxVfqtGHDv7Wkqq/ivZWUEKJyJX7A
3W6em22XLCuKUIiFg8Xq/QGNJAjchMO+9ukbj/3VIvv1yc9AN2TNG7VG2fJUE4VZ
wBY1c7TahHiLtyMyOJJaVSx+G5x53eOtUmLJ1HZwXl1fodCUN6xHwPjkGxWl/Wb8
fYtHNoy9r4UnIU5ZIa4RngBUq17WiGepWw19xgEN0QKBgQDw9LGO7Mf/0CndlRDL
h5mcqB+hJCH9oP0owlgAYezoEBnBtY6RKFJnzM5lQwEWLVKLButEhXovzYHRfx/k
/j+zkGeC+8KqNqY9yJSjuuhjpp9jABwYhF19OPsLmTONltvt2Mj0axNod0VA2vfM
iPEM6Z0wv48LNUrAaUNVLLSeSQKBgQDAhuvWQNFNwFKvucCDfC/YEK7UMssphR9j
JxlAVnXxuhdDPX1YEorl05gWGN7HmKkXcCA06qCHxNS1d4Aqiba365pK/t39WMdj
8IcocCmZznzenYOmZ1yvj0Mu4GLjTwvmfkw7Sbg/HrqoZldQRV4J3IzndWqzU7To
yWHv+kOiCwKBgQDoCUufrkdfAo/+cRlOVlPIN2LWI9yTyN9hy91A6Qxh4XdcQkF7
adAJY4Hyo9a9C4IsncocH0muFQIJw5jsRScE/W+hBF7O2Xe3kZwKG+jEZeWhSa7E
sVryRtgCsFKj6/34isXiEecLt6e6L+NnVQyEecfE9QOEMJq+td+Ae1+n+QKBgAXU
0FXX9r71IUwDQ0p4O3a+4py4wSCL0KyPJZumQsJEkanOtfox7ZUSeJvKuwyumgiE
s+UGakBSfOLWMMKZEzi04SJ+X7jptHhZc66M3yWydGPFv5QNs2f53d4Qm84oucKM
dsCg9fyrcJnjJ6fdwgBodrgX/VhbI7KdTuMW4G+LAoGBAMPA22OfuceG9uINpmH/
MzFQ8ieTnnDMiSeplmiBwHMVsvDjAJwcNQzMV3QHCtM9aokN8yrWDvI7BB3Ig7n3
IBZAmBjeRiT72cXO6J0ft4Gfv5sGEgLEIRoJztC41ur4ziq20lxMgEQinoNnMczm
wNOSfDCIJXvrnyecpevvLwDn
-----END PRIVATE KEY-----`;

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDajCCAlKgAwIBAgIUF5x+13ketbgbWJVTnj+cLFdJ6gkwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWY29udHJvbGxlci5leGFtcGxlLmNvbTAeFw0yNjEwMDIw
OTIwNTFaFw0zNjA5MjkwOTIwNTFaMCExHzAdBgNVBAMMFmNvbnRyb2xsZXIuZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1NoM6avK+
uN0CRtrX/8pSjs2tM9UmMsxlMpqeoXBi/XdL8FlbBy2/8+eiD75U2uHqRi7AjWVp
sW2mOfZ7IjS6/prv6lgGaybfv3A+A6+/64P/PCn2wq8HahfgsO0PH1RMuETUm8L2
R8mxgnYQWwaH8Di9XU1b/+GYHa5uZRsEv9kcvQtHNZxQGFIaYDIsJuIu0ojp69Qy
qEbqM3OBzA8PaBUcKpC+sPfrdBsgnQpQlhCffMd+rhSau8p4vVUHXkG/9ONoWLrh
R8IIRHZYX4Q7p7poeeMHmypngGUidvKt612sOr30voSU36HYCmpPPFQwW3WqqDSh
Ukn/T/LvB/8jAgMBAAGjgZkwgZYwHQYDVR0OBBYEFAZZtcD6+1pWjHAYK9UB2h4g
gOZuMB8GA1UdIwQYMBaAFAZZtcD6+1pWjHAYK9UB2h4ggOZuMCEGA1UdEQQaMBiC
FmNvbnRyb2xsZXIuZXhhbXBsZS5jb20wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8E
BAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwEwDQYJKoZIhvcNAQELBQADggEBAIgx
SWMzFCqcR8RPgOtFtyA/9+T6IuQy5PYG3IgUFibMscWwD0pCQaGEdxJBBtenUReX
zL/dCcomACuWvWu6EtuaYu2eIKao39xnKRXxzVXv1E86J9jbEBw09zGUNtFhPbmY
FAdppN4Keh98840z3R+D0zSUn0apGkhTFkjlAcMU41eIlEjoE7E7QyLj8nC2nI9Q
0S2076dN2N1KKTuIsNfLZV0gXqUlzKWQ0U64D0FJqwlpOT6Fv1UCLhmbaf5z1fgG
ftFbJ6SHOedYSnzbfKB/B8vV2XL+NDBwJajpYJKwkMnd53JV0Ds3zR4OQ5sE5fFy
zZQrBfUV/TtGC7Mb76A=
-----END CERTIFICATE-----`;

const CA_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDRjCCAi6gAwIBAgIUBoQaae/j4YQVNo2zfP3HSK6DJdgwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWY29udHJvbGxlci5leGFtcGxlLmNvbTAeFw0yNjEwMDIw
OTIwNDJaFw0zNjA5MjkwOTIwNDJaMCExHzAdBgNVBAMMFmNvbnRyb2xsZXIuZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCrYRixOlGp
xTZpKUTUmq/Uzud16X89nmMlBk7R8eCFgfR45yMwnnm9THOs1B1ZnSTtbPPnasNf
XQwNh7Qpw1SXZFul38DY7AS/fMey/wDS9c3XdwVw/M/au1ZO9CQyRc0qTTK4838U
zIQBGZN9xt27cpK5CIJGNvv9NVtOnQ+30wBvnoJRi81eF3MgN9VjtjgYa9c8+8n5
176TuFg0wQ4wQZYrCMl6eU1wozCIE5sdfoAt0MOgMPpoJFkcpor7+CianyHPBu5n
r6HN9VcF0opBPUuFWrg/1iHohOSJlcPjkZHwJdLz5c+EC0gLLvf9Pptn75LCf4Lh
5XT3X/XhFpkXAgMBAAGjdjB0MB0GA1UdDgQWBBSn1UyDCfrKU44uDPvdUTcd6EE2
WTAfBgNVHSMEGDAWgBSn1UyDCfrKU44uDPvdUTcd6EE2WTAPBgNVHRMBAf8EBTAD
AQH/MCEGA1UdEQQaMBiCFmNvbnRyb2xsZXIuZXhhbXBsZS5jb20wDQYJKoZIhvcN
AQELBQADggEBAHdfanAT28taMzk2kKOn8F4QYkNucCS9W0ljGYHo76ZssH1fm2BX
xrpi63936XBDYIP5hmM4W4WoENmtsw9PuTfx8OVDoekrJ2wJwo7x+oGdyCBLTSTm
MNT8oXSb4aD8VGtyI088qu7jIjBFblGBUfGKmoCo0XIVCCYeG+ANAQuoXSCNyl8z
tTKvYsdxxJrU0nxCR0DEd26AGrEab4kcbgv6KkWIWgQxL4xTP7ITqXScNoOdFdAI
KgPJgb5oMyacdSu4iyxj7MT/Abp5Y+p4jTpTpDmTAYz0oBN495L4MRnVT6dB+OWM
hyaLMWSdcxqmABW0kxBvsXxSo5QUKM+ruFA=
-----END CERTIFICATE-----`;

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";
const MACHINE_ID = "44444444-4444-4444-8444-444444444444";
const CHALLENGE_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = `dmt_${"x".repeat(48)}`;
const TEST_NOW = new Date("2026-10-03T00:00:00.000Z");

function leafPin(certificate = TEST_CERT_PEM): string {
  const x509 = new X509Certificate(certificate);
  const der = x509.publicKey.export({ format: "der", type: "spki" });
  assert.ok(Buffer.isBuffer(der));
  return `sha256/${crypto.createHash("sha256").update(der).digest("base64")}`;
}

function profile(
  overrides: Partial<DistributedSecureTransportProfileV1> = {},
): DistributedSecureTransportProfileV1 {
  return {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    controllerOrigin: "https://controller.example.com:8443",
    serverSpkiSha256Pins: [leafPin()],
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

function identity() {
  return {
    privateKey: createPrivateKey(TEST_KEY_PEM),
    certificates: [TEST_CERT_PEM] as const,
  };
}

function challenge(): DistributedMachineAuthenticationChallengeV1 {
  return {
    schemaVersion: 1,
    challengeId: CHALLENGE_ID,
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
    registrationRevision: 1,
    publicKeyFingerprint: `sha256/${"A".repeat(43)}=`,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
    nonce: "A".repeat(43),
    issuedAt: TEST_NOW.toISOString(),
    expiresAt: new Date(TEST_NOW.getTime() + 30_000).toISOString(),
    authority: "authentication_challenge_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function issueResult(): DistributedMachineTransportIssueResultV1 {
  return {
    schemaVersion: 1,
    token: TOKEN,
    claims: {
      schemaVersion: 1,
      sessionId: "66666666-6666-4666-8666-666666666666",
      registrationId: REGISTRATION_ID,
      machineId: MACHINE_ID,
      registrationRevision: 1,
      issuedAt: TEST_NOW.toISOString(),
      expiresAt: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
      capabilities: ["accept_writer_candidates"],
      authority: "authenticated_machine_identity_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
  };
}

function challengeBody(): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
  }), "utf8");
}

function challengeHeaders(body: Buffer): string[] {
  return [
    "Host", "controller.example.com:8443",
    "X-Cline-Request-Id", REQUEST_ID,
    "Accept", "application/json",
    "Accept-Encoding", "identity",
    "Cache-Control", "no-store",
    "Connection", "close",
    "Content-Type", "application/json; charset=utf-8",
    "Content-Encoding", "identity",
    "Content-Length", String(body.length),
  ];
}

function pullHeaders(): string[] {
  return [
    "Host", "controller.example.com:8443",
    "Authorization", `Bearer ${TOKEN}`,
    "X-Cline-Request-Id", REQUEST_ID,
    "Accept", "application/json",
    "Accept-Encoding", "identity",
    "Cache-Control", "no-store",
    "Connection", "close",
    "Content-Length", "0",
  ];
}

function expectCode(
  code: DistributedSharedUnboundHttpsError["code"],
): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof DistributedSharedUnboundHttpsError);
    assert.equal(error.code, code);
    return true;
  };
}

test("M12V contract exposes one unbound non-authorizing shared origin", () => {
  assert.deepEqual(DISTRIBUTED_SHARED_UNBOUND_HTTPS_CONTRACT, {
    schemaVersion: 1,
    routes: [
      "/v1/distributed/execution/pull",
      "/v1/distributed/auth/challenge",
      "/v1/distributed/auth/session",
    ],
    protocol: "https_http_1_1",
    singleCanonicalOrigin: true,
    consumesM12PProfile: true,
    reusesM12TRoute: true,
    reusesM12URoute: true,
    fallbackRouteChainingAllowed: false,
    duplicatesM12CAuthorization: false,
    exposesM12CIssueDirectly: false,
    performsM12QDirectly: false,
    localTlsIdentityPreflightRequired: true,
    verifiesTlsHostnameOrIp: true,
    verifiesLeafSpkiPin: true,
    verifiesPrivateKeyMatchesLeaf: true,
    fullSystemCaChainValidationClaimed: false,
    reverseProxyTrustEnabled: false,
    http2Enabled: false,
    automaticListen: false,
    publicBindDefault: false,
    tlsIdentityProvisioningIncluded: false,
    machineKeyProvisioningIncluded: false,
    deliveryAcknowledgementIncluded: false,
    controllerPushEnabled: false,
    invokesTargetRuntime: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
});

test("TLS preflight verifies hostname, M12P pin and exact private-key match without leaking credentials", () => {
  const receipt = preflightDistributedSharedTlsIdentity(
    profile(),
    identity(),
    () => new Date(TEST_NOW),
  );
  assert.equal(receipt.profileId, PROFILE_ID);
  assert.equal(receipt.controllerOrigin, "https://controller.example.com:8443");
  assert.equal(receipt.leafSpkiSha256Pin, leafPin());
  assert.equal(receipt.hostnameOrIpMatched, true);
  assert.equal(receipt.privateKeyMatched, true);
  assert.equal(receipt.authority, "deployment_readiness_evidence_only");
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("PRIVATE KEY"), false);
  assert.equal(serialized.includes("CERTIFICATE"), false);
  assert.equal(serialized.includes(TEST_KEY_PEM.slice(40, 70)), false);
});

test("TLS preflight fails closed on time, host/IP, pin, CA, malformed certificate and wrong key", () => {
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile(),
      identity(),
      () => new Date("2026-10-01T00:00:00.000Z"),
    ),
    expectCode("tls_certificate_not_yet_valid"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile(),
      identity(),
      () => new Date("2037-01-01T00:00:00.000Z"),
    ),
    expectCode("tls_certificate_expired"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile({ controllerOrigin: "https://other.example.com:8443" }),
      identity(),
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_hostname_mismatch"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile({ controllerOrigin: "https://127.0.0.1:8443" }),
      identity(),
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_hostname_mismatch"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile({ serverSpkiSha256Pins: [`sha256/${"A".repeat(43)}=`] }),
      identity(),
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_spki_pin_mismatch"),
  );

  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile(),
      { privateKey: wrongKey, certificates: [TEST_CERT_PEM] },
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_private_key_mismatch"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile({ serverSpkiSha256Pins: [leafPin(CA_CERT_PEM)] }),
      { privateKey: createPrivateKey(TEST_KEY_PEM), certificates: [CA_CERT_PEM] },
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_certificate_invalid"),
  );
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile(),
      { privateKey: createPrivateKey(TEST_KEY_PEM), certificates: ["not a certificate"] },
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_certificate_invalid"),
  );
});

test("TLS identity shape rejects passphrase/path style widening", () => {
  assert.throws(
    () => preflightDistributedSharedTlsIdentity(
      profile(),
      {
        ...identity(),
        passphrase: "forbidden",
      } as any,
      () => new Date(TEST_NOW),
    ),
    expectCode("tls_identity_invalid"),
  );
});

test("shared router isolates exact M12T and M12U paths with no fallback chaining", async () => {
  const calls = {
    pull: [] as DistributedSharedHttpsRouterRequestV1[],
    auth: [] as DistributedSharedHttpsRouterRequestV1[],
  };
  const pullResponse = {
    statusCode: 204,
    headers: { "X-Test": "pull" },
    body: Buffer.alloc(0),
  };
  const authResponse = {
    statusCode: 200,
    headers: { "X-Test": "auth" },
    body: Buffer.from("auth"),
  };
  const router = new DistributedSharedHttpsRouter({
    pullRoute: {
      async handle(input) {
        calls.pull.push({ ...input });
        return pullResponse;
      },
    },
    authRoute: {
      async handle(input) {
        calls.auth.push({ ...input });
        return authResponse;
      },
    },
  });

  const pull = await router.handle({
    method: "POST",
    url: "/v1/distributed/execution/pull",
    httpVersion: "1.1",
    rawHeaders: pullHeaders(),
  });
  assert.equal(pull, pullResponse);
  assert.equal(calls.pull.length, 1);
  assert.equal(calls.auth.length, 0);

  const body = challengeBody();
  const auth = await router.handle({
    method: "POST",
    url: "/v1/distributed/auth/challenge",
    httpVersion: "1.1",
    rawHeaders: challengeHeaders(body),
    body,
    peerAddress: "10.0.0.20",
  });
  assert.equal(auth, authResponse);
  assert.equal(calls.pull.length, 1);
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.auth[0]?.peerAddress, "10.0.0.20");

  const unknown = await router.handle({
    method: "POST",
    url: "/unknown",
    httpVersion: "1.1",
    rawHeaders: [],
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(calls.pull.length, 1);
  assert.equal(calls.auth.length, 1);
});

test("bootstrap body collector buffers exactly declared bytes and fails closed on short/overflow/error", async () => {
  const collector = new DistributedBootstrapBodyCollector(2);

  async function* exact() {
    yield Buffer.from("abc");
    yield Buffer.from("def");
  }
  assert.deepEqual(await collector.collect(exact(), 6, 10), Buffer.from("abcdef"));

  async function* short() {
    yield Buffer.from("abc");
  }
  assert.equal(await collector.collect(short(), 6, 10), null);

  let destroyed = false;
  const overflow = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("abcdefg");
    },
    destroy() {
      destroyed = true;
    },
  };
  assert.equal(await collector.collect(overflow, 6, 10), null);
  assert.equal(destroyed, true);

  const failing = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("a");
      throw new Error("stream secret");
    },
  };
  assert.equal(await collector.collect(failing, 2, 10), null);
});

test("bootstrap body collector enforces independent collector saturation", async () => {
  const collector = new DistributedBootstrapBodyCollector(1);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstStream = {
    async *[Symbol.asyncIterator]() {
      await blocker;
      yield Buffer.from("a");
    },
  };

  const first = collector.collect(firstStream, 1, 10);
  await Promise.resolve();
  assert.equal(
    await collector.collect({
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("b");
      },
    }, 1, 10),
    "saturated",
  );
  release();
  assert.deepEqual(await first, Buffer.from("a"));
});

class Bootstrap {
  issueCalls = 0;
  completeCalls = 0;

  async issueChallenge(
    _request: DistributedMachineAuthenticationChallengeRequestV1,
  ): Promise<DistributedMachineAuthenticationChallengeV1> {
    this.issueCalls += 1;
    return challenge();
  }

  async completeChallenge(
    _response: DistributedMachineAuthenticationChallengeResponseV1,
  ): Promise<DistributedMachineTransportIssueResultV1> {
    this.completeCalls += 1;
    return issueResult();
  }
}

function createServerHarness(overrides: Partial<{
  peerIssueLimitPerMinute: number;
  maxConcurrentBodyCollectors: number;
}> = {}) {
  const bootstrap = new Bootstrap();
  const tlsIdentity = identity();
  let pullCalls = 0;
  let capturedOptions: https.ServerOptions | undefined;
  let capturedListener: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  let listenCalls = 0;
  const builder: DistributedSharedHttpsServerBuilder = {
    create(options, listener) {
      capturedOptions = options;
      capturedListener = listener;
      const server = https.createServer({}, listener);
      const originalListen = server.listen.bind(server);
      server.listen = ((..._args: unknown[]) => {
        listenCalls += 1;
        return originalListen(...([] as never[]));
      }) as typeof server.listen;
      return server;
    },
  };

  const result = createUnboundDistributedSharedHttpsServer(
    {
      profile: profile(),
      selector: {
        async pullNext(): Promise<DistributedExecutionDeliveryBundleV1 | null> {
          pullCalls += 1;
          return null;
        },
      },
      bootstrap,
      tlsIdentityProvider: () => tlsIdentity,
      now: () => new Date(TEST_NOW),
      ...(overrides.peerIssueLimitPerMinute === undefined
        ? {}
        : { peerIssueLimitPerMinute: overrides.peerIssueLimitPerMinute }),
      ...(overrides.maxConcurrentBodyCollectors === undefined
        ? {}
        : { maxConcurrentBodyCollectors: overrides.maxConcurrentBodyCollectors }),
    },
    { serverBuilder: builder },
  );

  return {
    ...result,
    bootstrap,
    get pullCalls() {
      return pullCalls;
    },
    capturedOptions: () => capturedOptions,
    capturedListener: () => capturedListener,
    listenCalls: () => listenCalls,
    tlsIdentity,
  };
}

function fakeResponse() {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const response = {
    statusCode: 0,
    shouldKeepAlive: true,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0),
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body?: Buffer) {
      this.body = body ? Buffer.from(body) : Buffer.alloc(0);
      resolveDone();
    },
  };
  return { response, done };
}

function fakeRequest(
  input: {
    method?: string;
    url?: string;
    httpVersion?: string;
    rawHeaders?: string[];
    body?: Buffer;
    peerAddress?: string;
    forbidBodyRead?: boolean;
  },
): IncomingMessage {
  const stream = new PassThrough();
  Object.assign(stream, {
    method: input.method ?? "POST",
    url: input.url,
    httpVersion: input.httpVersion ?? "1.1",
    rawHeaders: input.rawHeaders ?? [],
  });
  Object.defineProperty(stream, "socket", {
    configurable: true,
    value: { remoteAddress: input.peerAddress ?? "10.0.0.20" },
  });
  if (input.forbidBodyRead) {
    Object.defineProperty(stream, Symbol.asyncIterator, {
      configurable: true,
      value() {
        throw new Error("pull body must not be read");
      },
    });
  } else {
    stream.end(input.body ?? Buffer.alloc(0));
  }
  return stream as unknown as IncomingMessage;
}

test("shared server is unbound, strict, uses the exact preflighted identity and never reads pull bodies", async () => {
  const harness = createServerHarness();
  assert.equal(harness.server.listening, false);
  assert.equal(harness.listenCalls(), 0);
  assert.equal(harness.server.maxHeadersCount, 16);
  assert.equal(harness.server.maxRequestsPerSocket, 1);
  assert.equal(harness.server.headersTimeout, 10_000);
  assert.equal(harness.server.requestTimeout, 10_000);

  const options = harness.capturedOptions();
  assert.equal(options?.minVersion, "TLSv1.2");
  assert.deepEqual(options?.ALPNProtocols, ["http/1.1"]);
  assert.equal(options?.requestCert, false);
  assert.equal(options?.insecureHTTPParser, false);
  assert.equal(options?.joinDuplicateHeaders, false);
  assert.equal(options?.maxHeaderSize, 8192);
  assert.equal(options?.handshakeTimeout, 10_000);
  assert.ok(Array.isArray(options?.key));
  assert.equal(options?.key?.[0], harness.tlsIdentity.privateKey);
  assert.deepEqual(options?.cert, [TEST_CERT_PEM]);

  const listener = harness.capturedListener();
  assert.ok(listener);
  const { response, done } = fakeResponse();
  listener(
    fakeRequest({
      url: "/v1/distributed/execution/pull",
      rawHeaders: pullHeaders(),
      forbidBodyRead: true,
    }),
    response as unknown as ServerResponse,
  );
  await done;
  assert.equal(response.statusCode, 204);
  assert.equal(harness.pullCalls, 1);
  assert.equal(harness.bootstrap.issueCalls, 0);
});

test("shared server bootstrap framing rejects duplicate/transfer/oversized length before M12U", async () => {
  const cases = [
    [...challengeHeaders(challengeBody()), "Content-Length", String(challengeBody().length)],
    [...challengeHeaders(challengeBody()), "Transfer-Encoding", "chunked"],
    challengeHeaders(challengeBody()).flatMap((value, index) =>
      index === challengeHeaders(challengeBody()).findIndex((item) => item === "Content-Length") + 1
        ? ["2048"]
        : [value]),
  ];

  for (const rawHeaders of cases) {
    const harness = createServerHarness();
    const listener = harness.capturedListener();
    assert.ok(listener);
    const { response, done } = fakeResponse();
    listener(
      fakeRequest({
        url: "/v1/distributed/auth/challenge",
        rawHeaders,
        body: challengeBody(),
      }),
      response as unknown as ServerResponse,
    );
    await done;
    assert.equal(response.statusCode, 400);
    assert.equal(harness.bootstrap.issueCalls, 0);
  }
});

test("shared server collects exact bootstrap body, delegates to M12U and forwards direct peer semantics", async () => {
  const harness = createServerHarness({ peerIssueLimitPerMinute: 1 });
  const listener = harness.capturedListener();
  assert.ok(listener);

  const firstBody = challengeBody();
  const first = fakeResponse();
  listener(
    fakeRequest({
      url: "/v1/distributed/auth/challenge",
      rawHeaders: challengeHeaders(firstBody),
      body: firstBody,
      peerAddress: "10.0.0.20",
    }),
    first.response as unknown as ServerResponse,
  );
  await first.done;
  assert.equal(first.response.statusCode, 200);
  assert.equal(harness.bootstrap.issueCalls, 1);

  const secondHeaders = challengeHeaders(firstBody);
  const requestIdIndex = secondHeaders.findIndex((value) => value === "X-Cline-Request-Id") + 1;
  secondHeaders[requestIdIndex] = "77777777-7777-4777-8777-777777777777";
  const second = fakeResponse();
  listener(
    fakeRequest({
      url: "/v1/distributed/auth/challenge",
      rawHeaders: secondHeaders,
      body: firstBody,
      peerAddress: "10.0.0.20",
    }),
    second.response as unknown as ServerResponse,
  );
  await second.done;
  assert.equal(second.response.statusCode, 409, "active challenge rejection precedes peer rate limit");
  assert.equal(harness.bootstrap.issueCalls, 1);
});

test("unknown shared path reaches neither M12T nor M12U", async () => {
  const harness = createServerHarness();
  const listener = harness.capturedListener();
  assert.ok(listener);
  const { response, done } = fakeResponse();
  listener(
    fakeRequest({
      url: "/unknown",
      rawHeaders: [],
    }),
    response as unknown as ServerResponse,
  );
  await done;
  assert.equal(response.statusCode, 404);
  assert.equal(harness.pullCalls, 0);
  assert.equal(harness.bootstrap.issueCalls, 0);
  assert.equal(harness.bootstrap.completeCalls, 0);
});

test("shared server special events fail closed without route delegation", () => {
  const harness = createServerHarness();
  const { response } = fakeResponse();
  harness.server.emit("checkContinue", {} as never, response as never);
  assert.equal(response.statusCode, 417);

  for (const event of ["upgrade", "connect"] as const) {
    const socket = new PassThrough();
    harness.server.emit(event, {} as never, socket as never, Buffer.alloc(0));
    assert.equal(socket.destroyed, true);
  }
  const clientErrorSocket = new PassThrough();
  harness.server.emit("clientError", new Error("secret"), clientErrorSocket as never);
  assert.equal(clientErrorSocket.destroyed, true);

  const tlsErrorSocket = new PassThrough();
  harness.server.emit("tlsClientError", new Error("secret"), tlsErrorSocket as never);
  assert.equal(tlsErrorSocket.destroyed, true);

  assert.equal(harness.pullCalls, 0);
  assert.equal(harness.bootstrap.issueCalls, 0);
  assert.equal(harness.server.listening, false);
});
