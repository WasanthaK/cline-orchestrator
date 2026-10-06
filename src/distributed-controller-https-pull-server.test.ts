import assert from "node:assert/strict";
import https from "node:https";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  DistributedControllerPendingWorkError,
} from "./distributed-controller-pending-work.js";
import {
  DISTRIBUTED_CONTROLLER_HTTPS_PULL_SERVER_CONTRACT,
  DistributedControllerHttpsPullRoute,
  createUnboundDistributedControllerHttpsPullServer,
  type DistributedControllerHttpsPullRequestV1,
  type DistributedControllerHttpsPullResponseV1,
  type DistributedControllerHttpsPullServerBuilder,
} from "./distributed-controller-https-pull-server.js";
import type { DistributedExecutionDeliveryBundleV1 } from "./distributed-execution-delivery.js";
import { DistributedMachineTransportError } from "./distributed-machine-transport.js";

const ORIGIN = "https://controller.example.com:8443";
const TOKEN = `dmt_${"x".repeat(48)}`;
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
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

function delivery(): DistributedExecutionDeliveryBundleV1 {
  const issuedAt = "2026-10-02T00:00:00.000Z";
  const expiresAt = "2026-10-02T00:00:20.000Z";
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

function rawHeaders(
  requestId = REQUEST_ID,
  overrides: Record<string, string> = {},
): string[] {
  const headers: Array<[string, string]> = [
    ["Host", "controller.example.com:8443"],
    ["Authorization", `Bearer ${TOKEN}`],
    ["X-Cline-Request-Id", requestId],
    ["Accept", "application/json"],
    ["Accept-Encoding", "identity"],
    ["Cache-Control", "no-store"],
    ["Connection", "close"],
    ["Content-Length", "0"],
  ];
  return headers.flatMap(([name, value]) => [
    name,
    overrides[name.toLowerCase()] ?? value,
  ]);
}

function request(
  overrides: Partial<DistributedControllerHttpsPullRequestV1> = {},
): DistributedControllerHttpsPullRequestV1 {
  return {
    method: "POST",
    url: "/v1/distributed/execution/pull",
    httpVersion: "1.1",
    rawHeaders: rawHeaders(),
    ...overrides,
  };
}

class Selector {
  calls: Array<{ token: string; requestId: string }> = [];

  constructor(
    private readonly behavior:
      | DistributedExecutionDeliveryBundleV1
      | null
      | Error
      | ((token: string, requestId: string) => Promise<DistributedExecutionDeliveryBundleV1 | null>),
  ) {}

  async pullNext(
    token: string,
    requestId: string,
  ): Promise<DistributedExecutionDeliveryBundleV1 | null> {
    this.calls.push({ token, requestId });
    if (typeof this.behavior === "function") return this.behavior(token, requestId);
    if (this.behavior instanceof Error) throw this.behavior;
    return this.behavior;
  }
}

function assertBodyless(
  output: DistributedControllerHttpsPullResponseV1,
  statusCode: number,
): void {
  assert.equal(output.statusCode, statusCode);
  assert.equal(output.body.length, 0);
  assert.equal(output.headers.Connection, "close");
  assert.equal(output.headers["Cache-Control"], "no-store");
  assert.equal(output.headers["Content-Length"], "0");
  assert.equal(Object.hasOwn(output.headers, "Content-Type"), false);
}

test("M12T contract is unbound, pull-only and non-authorizing", () => {
  assert.deepEqual(DISTRIBUTED_CONTROLLER_HTTPS_PULL_SERVER_CONTRACT, {
    schemaVersion: 1,
    protocol: "https_http_1_1",
    method: "POST",
    fixedPath: "/v1/distributed/execution/pull",
    directConnectionOnly: true,
    requestBodyAllowed: false,
    requestContainsWorkSelectors: false,
    duplicateCriticalHeadersAllowed: false,
    transferEncodingAllowed: false,
    expectContinueAllowed: false,
    protocolUpgradeAllowed: false,
    requiresM12CBearer: true,
    delegatesExactlyOnceToM12R: true,
    separatelyPreauthorizesWithM12C: false,
    returnsOnlyM12JBundleOrNoWork: true,
    invokesTargetRuntime: false,
    http2Enabled: false,
    automaticListen: false,
    publicBindDefault: false,
    certificateProvisioningIncluded: false,
    privateKeyGenerationIncluded: false,
    networkedM12QBootstrapIncluded: false,
    deliveryAcknowledgementIncluded: false,
    controllerPushEnabled: false,
    distributedTakeoverEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
});

test("valid pull delegates exactly once to M12R and null produces zero-byte 204", async () => {
  const selector = new Selector(null);
  const route = new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector,
  });

  const output = await route.handle(request());
  assertBodyless(output, 204);
  assert.deepEqual(selector.calls, [{ token: TOKEN, requestId: REQUEST_ID }]);
});

test("valid delivery is revalidated and returned as bounded exact UTF-8 JSON", async () => {
  const value = delivery();
  const selector = new Selector(value);
  const route = new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector,
  });

  const output = await route.handle(request());
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(output.headers["Content-Encoding"], "identity");
  assert.equal(output.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(output.headers.Connection, "close");
  assert.equal(output.headers["Cache-Control"], "no-store");
  assert.equal(output.headers["Content-Length"], String(output.body.length));
  assert.deepEqual(JSON.parse(output.body.toString("utf8")), value);
  assert.equal(selector.calls.length, 1);
});

test("wrong route, method or HTTP version fails before M12R", async () => {
  const cases: Array<[DistributedControllerHttpsPullRequestV1, number]> = [
    [request({ url: "/v1/distributed/execution/pull?task=x" }), 404],
    [request({ url: "/other" }), 404],
    [request({ method: "GET" }), 405],
    [request({ method: "CONNECT" }), 405],
    [request({ httpVersion: "1.0" }), 400],
    [request({ httpVersion: "2.0" }), 400],
  ];

  for (const [input, status] of cases) {
    const selector = new Selector(null);
    const output = await new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector,
    }).handle(input);
    assertBodyless(output, status);
    if (status === 405) assert.equal(output.headers.Allow, "POST");
    assert.equal(selector.calls.length, 0);
  }
});

test("exact Host and singleton M12S headers are mandatory", async () => {
  const invalid: DistributedControllerHttpsPullRequestV1[] = [
    request({ rawHeaders: rawHeaders(REQUEST_ID, { host: "controller.example.com" }) }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { accept: "*/*" }) }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { "accept-encoding": "gzip" }) }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { "cache-control": "max-age=0" }) }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { connection: "keep-alive" }) }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { "content-length": "1" }) }),
    request({ rawHeaders: rawHeaders("not-a-uuid") }),
    request({ rawHeaders: rawHeaders(REQUEST_ID, { authorization: "Bearer short" }) }),
  ];

  for (const input of invalid) {
    const selector = new Selector(null);
    const output = await new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector,
    }).handle(input);
    assertBodyless(output, 400);
    assert.equal(selector.calls.length, 0);
  }
});

test("duplicate, unknown, transfer/body, Expect and upgrade headers fail before M12R", async () => {
  const base = rawHeaders();
  const cases: string[][] = [
    [...base, "Authorization", `Bearer ${TOKEN}`],
    [...base, "Host", "controller.example.com:8443"],
    [...base, "Transfer-Encoding", "chunked"],
    [...base, "Expect", "100-continue"],
    [...base, "Upgrade", "websocket"],
    [...base, "Cookie", "x=1"],
    [...base, "Forwarded", "for=127.0.0.1"],
    [...base, "X-Forwarded-For", "127.0.0.1"],
    [...base, "Content-Type", "application/json"],
  ];

  for (const raw of cases) {
    const selector = new Selector(null);
    const output = await new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector,
    }).handle(request({ rawHeaders: raw }));
    assertBodyless(output, 400);
    assert.equal(selector.calls.length, 0);
  }
});

test("M12T maps trusted nested M12C errors to bodyless statuses", async () => {
  const mappings: Array<[DistributedMachineTransportError["code"], number]> = [
    ["request_replayed", 409],
    ["request_invalid", 400],
    ["capability_not_allowed", 403],
    ["session_not_found", 401],
    ["session_invalid", 401],
    ["session_expired", 401],
    ["session_stale", 401],
    ["registration_not_current", 401],
    ["capacity_exceeded", 503],
  ];

  for (const [code, status] of mappings) {
    const wrapped = new DistributedControllerPendingWorkError(
      "transport rejected",
      "transport_identity_invalid",
      { cause: new DistributedMachineTransportError("private internal detail", code) },
    );
    const selector = new Selector(wrapped);
    const output = await new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector,
    }).handle(request());
    assertBodyless(output, status);
    assert.equal(selector.calls.length, 1);
    assert.equal(output.body.toString().includes("private internal detail"), false);
  }
});

test("M12T maps M12R stale, saturation and invariant failures without bodies", async () => {
  const mappings: Array<[DistributedControllerPendingWorkError["code"], number]> = [
    ["candidate_not_current", 409],
    ["fence_not_current", 409],
    ["capacity_exceeded", 503],
    ["pending_work_invalid", 500],
    ["pending_work_target_mismatch", 500],
    ["delivery_failed", 500],
    ["transport_identity_invalid", 500],
  ];

  for (const [code, status] of mappings) {
    const selector = new Selector(
      new DistributedControllerPendingWorkError("sensitive internal detail", code),
    );
    const output = await new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector,
    }).handle(request());
    assertBodyless(output, status);
    assert.equal(output.body.toString().includes("sensitive"), false);
  }

  const output = await new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector: new Selector(new Error("unknown secret")),
  }).handle(request());
  assertBodyless(output, 500);
});

test("concurrency saturation returns 503 without a second M12R call", async () => {
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const selector = new Selector(async () => {
    await blocker;
    return null;
  });
  const route = new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector,
    maxConcurrent: 1,
  });

  const first = route.handle(request());
  await Promise.resolve();
  const second = await route.handle(request({
    rawHeaders: rawHeaders(OTHER_REQUEST_ID),
  }));
  assertBodyless(second, 503);
  assert.equal(selector.calls.length, 1);
  release();
  assertBodyless(await first, 204);
});

test("invalid M12J output fails closed and never becomes a 200 body", async () => {
  const selector = new Selector({ schemaVersion: 1 } as unknown as DistributedExecutionDeliveryBundleV1);
  const output = await new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector,
  }).handle(request());
  assertBodyless(output, 500);
});

test("serialized delivery hard-limit fails closed even after validator succeeds", async () => {
  const value = delivery() as DistributedExecutionDeliveryBundleV1 & Record<string, unknown>;
  let reads = 0;
  Object.defineProperty(value, "deliveryId", {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? DELIVERY_ID : "x".repeat(1024 * 1024 + 128);
    },
  });

  const output = await new DistributedControllerHttpsPullRoute({
    controllerOrigin: ORIGIN,
    selector: new Selector(value),
  }).handle(request());
  assertBodyless(output, 500);
});

test("unbound server factory configures strict HTTPS/HTTP bounds and never calls listen", () => {
  let capturedOptions: https.ServerOptions | undefined;
  let listenCalls = 0;
  const builder: DistributedControllerHttpsPullServerBuilder = {
    create(options, listener) {
      capturedOptions = options;
      const server = https.createServer({}, listener);
      const originalListen = server.listen.bind(server);
      server.listen = ((..._args: unknown[]) => {
        listenCalls += 1;
        return originalListen(...([] as never[]));
      }) as typeof server.listen;
      return server;
    },
  };

  const server = createUnboundDistributedControllerHttpsPullServer(
    {
      controllerOrigin: ORIGIN,
      selector: new Selector(null),
      tlsIdentityProvider: () => ({ key: "test-only-key", cert: "test-only-cert" }),
    },
    { serverBuilder: builder },
  );

  assert.equal(server.listening, false);
  assert.equal(listenCalls, 0);
  assert.equal(server.maxHeadersCount, 16);
  assert.equal(server.maxRequestsPerSocket, 1);
  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.requestTimeout, 10_000);
  assert.equal(capturedOptions?.minVersion, "TLSv1.2");
  assert.deepEqual(capturedOptions?.ALPNProtocols, ["http/1.1"]);
  assert.equal(capturedOptions?.requestCert, false);
  assert.equal(capturedOptions?.insecureHTTPParser, false);
  assert.equal(capturedOptions?.joinDuplicateHeaders, false);
  assert.equal(capturedOptions?.maxHeaderSize, 8192);
  assert.equal(capturedOptions?.handshakeTimeout, 10_000);
  assert.equal(capturedOptions?.key, "test-only-key");
  assert.equal(capturedOptions?.cert, "test-only-cert");
});

function fakeResponse(): {
  response: {
    statusCode: number;
    shouldKeepAlive: boolean;
    headers: Record<string, string>;
    body: Buffer;
    setHeader(name: string, value: string): void;
    end(body?: Buffer): void;
  };
} {
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
    },
  };
  return { response };
}

test("special server events fail closed without entering selector or opening sockets", () => {
  const selector = new Selector(null);
  const server = createUnboundDistributedControllerHttpsPullServer(
    {
      controllerOrigin: ORIGIN,
      selector,
      tlsIdentityProvider: () => ({ key: "test-only-key", cert: "test-only-cert" }),
    },
    {
      serverBuilder: {
        create(_options, listener) {
          return https.createServer({}, listener);
        },
      },
    },
  );

  const { response } = fakeResponse();
  server.emit("checkContinue", {} as never, response as never);
  assert.equal(response.statusCode, 417);
  assert.equal(response.body.length, 0);

  for (const event of ["upgrade", "connect"] as const) {
    const socket = new PassThrough();
    server.emit(event, {} as never, socket as never, Buffer.alloc(0));
    assert.equal(socket.destroyed, true);
  }

  const clientErrorSocket = new PassThrough();
  server.emit("clientError", new Error("secret parser detail"), clientErrorSocket as never);
  assert.equal(clientErrorSocket.destroyed, true);

  const tlsErrorSocket = new PassThrough();
  server.emit("tlsClientError", new Error("secret tls detail"), tlsErrorSocket as never);
  assert.equal(tlsErrorSocket.destroyed, true);

  assert.equal(selector.calls.length, 0);
  assert.equal(server.listening, false);
});

test("configuration is bounded and TLS identity remains startup-only", () => {
  assert.throws(
    () => new DistributedControllerHttpsPullRoute({
      controllerOrigin: "http://controller.example.com",
      selector: new Selector(null),
    }),
  );
  assert.throws(
    () => new DistributedControllerHttpsPullRoute({
      controllerOrigin: ORIGIN,
      selector: new Selector(null),
      maxConcurrent: 65,
    }),
  );
  assert.throws(
    () => createUnboundDistributedControllerHttpsPullServer(
      {
        controllerOrigin: ORIGIN,
        selector: new Selector(null),
        tlsIdentityProvider: () => ({ key: undefined, cert: undefined }),
      },
      {
        serverBuilder: {
          create(_options, listener) {
            return https.createServer({}, listener);
          },
        },
      },
    ),
  );
});
