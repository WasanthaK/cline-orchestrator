import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedMachineAuthenticationBootstrapError,
  type DistributedMachineAuthenticationChallengeRequestV1,
  type DistributedMachineAuthenticationChallengeResponseV1,
  type DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import {
  DISTRIBUTED_NETWORK_MACHINE_AUTH_BOOTSTRAP_CONTRACT,
  DistributedNetworkMachineAuthRoute,
  type DistributedNetworkMachineAuthRequestV1,
} from "./distributed-network-machine-auth-bootstrap.js";
import {
  DistributedMachineTransportError,
  type DistributedMachineTransportIssueResultV1,
} from "./distributed-machine-transport.js";

const ORIGIN = "https://controller.example.com:8443";
const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const MACHINE_ID = "22222222-2222-4222-8222-222222222222";
const CHALLENGE_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID_2 = "66666666-6666-4666-8666-666666666666";
const TOKEN = `dmt_${"x".repeat(48)}`;
const NOW = new Date("2026-10-02T06:00:00.000Z");
const FINGERPRINT = `sha256/${"A".repeat(43)}=`;

function challenge(
  overrides: Partial<DistributedMachineAuthenticationChallengeV1> = {},
): DistributedMachineAuthenticationChallengeV1 {
  return {
    schemaVersion: 1,
    challengeId: CHALLENGE_ID,
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
    registrationRevision: 1,
    publicKeyFingerprint: FINGERPRINT,
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

function issueResult(): DistributedMachineTransportIssueResultV1 {
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
  };
}

function challengeBody(
  registrationId = REGISTRATION_ID,
  capabilities: string[] = ["accept_writer_candidates"],
  sessionTtlMs = 60_000,
): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    registrationId,
    capabilities,
    sessionTtlMs,
  }), "utf8");
}

function sessionBody(
  challengeId = CHALLENGE_ID,
  signatureBase64Url = Buffer.alloc(64, 7).toString("base64url"),
): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    challengeId,
    signatureBase64Url,
  }), "utf8");
}

function headers(body: Buffer, requestId = REQUEST_ID): string[] {
  return [
    "Host", "controller.example.com:8443",
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

function request(
  url: "/v1/distributed/auth/challenge" | "/v1/distributed/auth/session",
  body: Buffer,
  requestId = REQUEST_ID,
  overrides: Partial<DistributedNetworkMachineAuthRequestV1> = {},
): DistributedNetworkMachineAuthRequestV1 {
  return {
    method: "POST",
    url,
    httpVersion: "1.1",
    rawHeaders: headers(body, requestId),
    body,
    peerAddress: "10.0.0.20",
    ...overrides,
  };
}

class Bootstrap {
  issueCalls: DistributedMachineAuthenticationChallengeRequestV1[] = [];
  completeCalls: DistributedMachineAuthenticationChallengeResponseV1[] = [];

  constructor(
    public issueBehavior: DistributedMachineAuthenticationChallengeV1 | Error = challenge(),
    public completeBehavior: DistributedMachineTransportIssueResultV1 | Error = issueResult(),
  ) {}

  async issueChallenge(
    input: DistributedMachineAuthenticationChallengeRequestV1,
  ): Promise<DistributedMachineAuthenticationChallengeV1> {
    this.issueCalls.push(structuredClone(input));
    if (this.issueBehavior instanceof Error) throw this.issueBehavior;
    return structuredClone(this.issueBehavior);
  }

  async completeChallenge(
    input: DistributedMachineAuthenticationChallengeResponseV1,
  ): Promise<DistributedMachineTransportIssueResultV1> {
    this.completeCalls.push(structuredClone(input));
    if (this.completeBehavior instanceof Error) throw this.completeBehavior;
    return structuredClone(this.completeBehavior);
  }
}

function bodyless(output: { statusCode: number; headers: Readonly<Record<string, string>>; body: Buffer }, status: number): void {
  assert.equal(output.statusCode, status);
  assert.equal(output.body.length, 0);
  assert.equal(output.headers["Content-Length"], "0");
  assert.equal(output.headers["Cache-Control"], "no-store");
  assert.equal(output.headers.Connection, "close");
}

test("M12U route contract remains bootstrap-only and non-authorizing", () => {
  assert.deepEqual(DISTRIBUTED_NETWORK_MACHINE_AUTH_BOOTSTRAP_CONTRACT, {
    schemaVersion: 1,
    routes: [
      "/v1/distributed/auth/challenge",
      "/v1/distributed/auth/session",
    ],
    protocol: "https_http_1_1",
    sharesCanonicalControllerOriginWithM12T: true,
    registrationIdIsCredential: false,
    requiresExistingMachineRegistration: true,
    requiresExistingEd25519Binding: true,
    privateKeyAcceptedByAdapter: false,
    privateKeyProvisioningIncluded: false,
    delegatesChallengeToM12Q: true,
    delegatesCompletionToM12Q: true,
    exposesM12CIssueDirectly: false,
    challengeRequestIdempotentUntilExpiry: true,
    oneActiveChallengePerRegistration: true,
    completionReplayAllowed: false,
    automaticCompletionRetryAllowed: false,
    networkedEnrollmentIncluded: false,
    automaticListen: false,
    tlsIdentityProvisioningIncluded: false,
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

test("canonical challenge request delegates exactly once to M12Q and returns validated challenge", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });
  const body = challengeBody();

  const output = await route.handle(request("/v1/distributed/auth/challenge", body));
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(output.headers["Content-Encoding"], "identity");
  assert.equal(output.headers.Pragma, "no-cache");
  assert.equal(output.headers["Content-Length"], String(output.body.length));
  assert.deepEqual(JSON.parse(output.body.toString("utf8")), challenge());
  assert.deepEqual(bootstrap.issueCalls, [{
    registrationId: REGISTRATION_ID,
    capabilities: ["accept_writer_candidates"],
    sessionTtlMs: 60_000,
  }]);
});

test("challenge request-id idempotency returns same challenge without second M12Q call", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });
  const body = challengeBody();

  const first = await route.handle(request("/v1/distributed/auth/challenge", body));
  const second = await route.handle(request("/v1/distributed/auth/challenge", body));
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(bootstrap.issueCalls.length, 1);
});

test("same challenge request id with different body is 409 and second active challenge is 409", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });
  const firstBody = challengeBody();
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(REGISTRATION_ID, ["report_status"]),
    )),
    200,
  );
});
