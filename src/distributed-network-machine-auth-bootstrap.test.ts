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
  assert.equal(
    (await route.handle(request("/v1/distributed/auth/challenge", firstBody))).statusCode,
    200,
  );

  const differentBody = challengeBody(REGISTRATION_ID, ["report_status"]);
  bodyless(
    await route.handle(request("/v1/distributed/auth/challenge", differentBody)),
    409,
  );

  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      firstBody,
      REQUEST_ID_2,
    )),
    409,
  );

  assert.equal(bootstrap.issueCalls.length, 1);
});

test("protocol, exact headers and canonical JSON fail closed before M12Q", async () => {
  const canonical = challengeBody();
  const badHeaders = [
    [...headers(canonical), "Authorization", "Bearer forbidden"],
    [...headers(canonical), "Transfer-Encoding", "chunked"],
    [...headers(canonical), "Expect", "100-continue"],
    [...headers(canonical), "Forwarded", "for=10.0.0.20"],
    [...headers(canonical), "X-Forwarded-For", "10.0.0.20"],
    [...headers(canonical), "Cookie", "a=b"],
    [...headers(canonical), "Host", "controller.example.com:8443"],
  ];

  for (const rawHeaders of badHeaders) {
    const bootstrap = new Bootstrap();
    const route = new DistributedNetworkMachineAuthRoute({
      controllerOrigin: ORIGIN,
      bootstrap,
      now: () => new Date(NOW),
    });
    bodyless(
      await route.handle(request("/v1/distributed/auth/challenge", canonical, REQUEST_ID, { rawHeaders })),
      400,
    );
    assert.equal(bootstrap.issueCalls.length, 0);
  }

  const protocolCases: DistributedNetworkMachineAuthRequestV1[] = [
    request("/v1/distributed/auth/challenge", canonical, REQUEST_ID, { method: "GET" }),
    request("/v1/distributed/auth/challenge", canonical, REQUEST_ID, { httpVersion: "2.0" }),
    {
      ...request("/v1/distributed/auth/challenge", canonical),
      url: "/v1/distributed/auth/other",
    },
  ];

  const statuses = [405, 400, 404];
  for (let i = 0; i < protocolCases.length; i += 1) {
    const bootstrap = new Bootstrap();
    const route = new DistributedNetworkMachineAuthRoute({
      controllerOrigin: ORIGIN,
      bootstrap,
      now: () => new Date(NOW),
    });
    bodyless(await route.handle(protocolCases[i]!), statuses[i]!);
    assert.equal(bootstrap.issueCalls.length, 0);
  }

  const nonCanonicalBodies = [
    Buffer.from(JSON.stringify({
      capabilities: ["accept_writer_candidates"],
      registrationId: REGISTRATION_ID,
      schemaVersion: 1,
      sessionTtlMs: 60_000,
    }), "utf8"),
    Buffer.from(` ${challengeBody().toString("utf8")}`, "utf8"),
    challengeBody(REGISTRATION_ID, ["report_status", "accept_writer_candidates"]),
    Buffer.from(
      `{"schemaVersion":1,"registrationId":"${REGISTRATION_ID}","registrationId":"${REGISTRATION_ID}","capabilities":["accept_writer_candidates"],"sessionTtlMs":60000}`,
      "utf8",
    ),
  ];

  for (const body of nonCanonicalBodies) {
    const bootstrap = new Bootstrap();
    const route = new DistributedNetworkMachineAuthRoute({
      controllerOrigin: ORIGIN,
      bootstrap,
      now: () => new Date(NOW),
    });
    bodyless(
      await route.handle(request("/v1/distributed/auth/challenge", body)),
      400,
    );
    assert.equal(bootstrap.issueCalls.length, 0);
  }
});

test("challenge enumeration-sensitive failures collapse to bodyless 404", async () => {
  for (const code of [
    "registration_not_current",
    "binding_invalid",
    "binding_not_current",
    "capability_not_allowed",
  ] as const) {
    const bootstrap = new Bootstrap(
      new DistributedMachineAuthenticationBootstrapError("sensitive", code),
    );
    const route = new DistributedNetworkMachineAuthRoute({
      controllerOrigin: ORIGIN,
      bootstrap,
      now: () => new Date(NOW),
    });
    const output = await route.handle(
      request("/v1/distributed/auth/challenge", challengeBody()),
    );
    bodyless(output, 404);
    assert.equal(output.body.toString().includes("sensitive"), false);
  }
});

test("challenge issuance rate limits are applied before repeated M12Q work", async () => {
  const bootstrap = new Bootstrap(
    new DistributedMachineAuthenticationBootstrapError(
      "missing",
      "registration_not_current",
    ),
  );
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
    peerIssueLimitPerMinute: 1,
    registrationIssueLimitPerMinute: 4,
  });

  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID,
    )),
    404,
  );
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID_2,
    )),
    429,
  );
  assert.equal(bootstrap.issueCalls.length, 1);
});

test("global concurrency saturation returns 503 without a second M12Q call", async () => {
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const bootstrap = {
    async issueChallenge(): Promise<DistributedMachineAuthenticationChallengeV1> {
      calls += 1;
      await blocker;
      return challenge();
    },
    async completeChallenge(): Promise<DistributedMachineTransportIssueResultV1> {
      return issueResult();
    },
  };
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
    maxConcurrent: 1,
  });

  const first = route.handle(request(
    "/v1/distributed/auth/challenge",
    challengeBody(),
    REQUEST_ID,
  ));
  await Promise.resolve();

  const second = await route.handle(request(
    "/v1/distributed/auth/challenge",
    challengeBody(),
    REQUEST_ID_2,
    { peerAddress: "10.0.0.21" },
  ));
  bodyless(second, 503);
  assert.equal(calls, 1);

  release();
  assert.equal((await first).statusCode, 200);
});

test("successful completion delegates exactly once and returns validated short-lived M12C issue result", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });

  assert.equal(
    (await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
    ))).statusCode,
    200,
  );

  const body = sessionBody();
  const output = await route.handle(request(
    "/v1/distributed/auth/session",
    body,
    REQUEST_ID_2,
  ));

  assert.equal(output.statusCode, 200);
  assert.equal(output.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(output.headers.Pragma, "no-cache");
  assert.equal(output.headers["Content-Length"], String(output.body.length));
  assert.deepEqual(JSON.parse(output.body.toString("utf8")), issueResult());
  assert.deepEqual(bootstrap.completeCalls, [{
    challengeId: CHALLENGE_ID,
    signatureBase64Url: Buffer.alloc(64, 7).toString("base64url"),
  }]);
});

test("completion authentication failures collapse to bodyless 401 and clear active challenge", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });

  assert.equal(
    (await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID,
    ))).statusCode,
    200,
  );

  bootstrap.completeBehavior = new DistributedMachineAuthenticationBootstrapError(
    "bad signature sensitive detail",
    "signature_invalid",
  );

  const failed = await route.handle(request(
    "/v1/distributed/auth/session",
    sessionBody(),
    REQUEST_ID_2,
  ));
  bodyless(failed, 401);
  assert.equal(failed.body.toString().includes("sensitive"), false);
  assert.equal(bootstrap.completeCalls.length, 1);

  bootstrap.issueBehavior = challenge({
    challengeId: "77777777-7777-4777-8777-777777777777",
  });
  const next = await route.handle(request(
    "/v1/distributed/auth/challenge",
    challengeBody(),
    "88888888-8888-4888-8888-888888888888",
  ));
  assert.equal(next.statusCode, 200);
  assert.equal(bootstrap.issueCalls.length, 2);
});

test("completion protocol rejects malformed signature and completion rate-limit fires before M12Q", async () => {
  const malformed = sessionBody(CHALLENGE_ID, "A".repeat(85));
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });
  bodyless(
    await route.handle(request("/v1/distributed/auth/session", malformed)),
    400,
  );
  assert.equal(bootstrap.completeCalls.length, 0);

  const replaying = new Bootstrap(
    challenge(),
    new DistributedMachineAuthenticationBootstrapError("missing", "challenge_replayed"),
  );
  const limited = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap: replaying,
    now: () => new Date(NOW),
    peerCompletionLimitPerMinute: 1,
  });
  bodyless(
    await limited.handle(request(
      "/v1/distributed/auth/session",
      sessionBody(),
      REQUEST_ID,
    )),
    401,
  );
  bodyless(
    await limited.handle(request(
      "/v1/distributed/auth/session",
      sessionBody("99999999-9999-4999-8999-999999999999"),
      REQUEST_ID_2,
    )),
    429,
  );
  assert.equal(replaying.completeCalls.length, 1);
});

test("session issue failure exposes no detail and nested M12C capacity maps to 503", async () => {
  const nested = new DistributedMachineAuthenticationBootstrapError(
    "session failed",
    "session_issue_failed",
    {
      cause: new DistributedMachineTransportError("capacity secret", "capacity_exceeded"),
    },
  );
  const bootstrap = new Bootstrap(challenge(), nested);
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });

  assert.equal(
    (await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
    ))).statusCode,
    200,
  );
  const output = await route.handle(request(
    "/v1/distributed/auth/session",
    sessionBody(),
    REQUEST_ID_2,
  ));
  bodyless(output, 503);
  assert.equal(output.body.toString().includes("secret"), false);
});

test("invalid M12Q challenge or invalid M12C issue result fails closed", async () => {
  const invalidChallenge = new Bootstrap(challenge({
    capabilities: ["report_status"],
  }));
  const challengeRoute = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap: invalidChallenge,
    now: () => new Date(NOW),
  });
  bodyless(
    await challengeRoute.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
    )),
    500,
  );

  const invalidResult = issueResult();
  invalidResult.token = "short";
  const invalidSession = new Bootstrap(challenge(), invalidResult);
  const sessionRoute = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap: invalidSession,
    now: () => new Date(NOW),
  });
  assert.equal(
    (await sessionRoute.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
    ))).statusCode,
    200,
  );
  bodyless(
    await sessionRoute.handle(request(
      "/v1/distributed/auth/session",
      sessionBody(),
      REQUEST_ID_2,
    )),
    500,
  );
});

test("M12U rejects non-IP peers, malformed UTF-8 and oversized bodies before M12Q", async () => {
  const bootstrap = new Bootstrap();
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
  });

  const canonical = challengeBody();
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      canonical,
      REQUEST_ID,
      { peerAddress: "not-an-ip" },
    )),
    400,
  );

  const malformedUtf8 = Buffer.from([0xc3, 0x28]);
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      malformedUtf8,
      REQUEST_ID,
      { rawHeaders: headers(malformedUtf8) },
    )),
    400,
  );

  const oversized = Buffer.alloc(1025, 0x41);
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      oversized,
      REQUEST_ID,
      { rawHeaders: headers(oversized) },
    )),
    400,
  );

  assert.equal(bootstrap.issueCalls.length, 0);
});

test("registration-specific issue rate limit is enforced independently of peer limit", async () => {
  const bootstrap = new Bootstrap(
    new DistributedMachineAuthenticationBootstrapError(
      "missing",
      "registration_not_current",
    ),
  );
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(NOW),
    peerIssueLimitPerMinute: 12,
    registrationIssueLimitPerMinute: 1,
  });

  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID,
      { peerAddress: "10.0.0.20" },
    )),
    404,
  );
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID_2,
      { peerAddress: "10.0.0.21" },
    )),
    429,
  );
  assert.equal(bootstrap.issueCalls.length, 1);
});

test("expired rate buckets are pruned and do not permanently retain request pressure", async () => {
  const now = { value: new Date(NOW) };
  const bootstrap = new Bootstrap(
    new DistributedMachineAuthenticationBootstrapError(
      "missing",
      "registration_not_current",
    ),
  );
  const route = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: ORIGIN,
    bootstrap,
    now: () => new Date(now.value),
    peerIssueLimitPerMinute: 1,
    registrationIssueLimitPerMinute: 1,
  });

  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID,
    )),
    404,
  );
  now.value = new Date(NOW.getTime() + 60_001);
  bodyless(
    await route.handle(request(
      "/v1/distributed/auth/challenge",
      challengeBody(),
      REQUEST_ID_2,
    )),
    404,
  );
  assert.equal(bootstrap.issueCalls.length, 2);
});
