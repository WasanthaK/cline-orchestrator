import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import {
  DistributedControllerPendingWorkError,
} from "./distributed-controller-pending-work.js";
import type { DistributedExecutionDeliveryBundleV1 } from "./distributed-execution-delivery.js";
import {
  assertDistributedExecutionDeliveryBundle,
} from "./distributed-execution-delivery.js";
import {
  DistributedMachineTransportError,
} from "./distributed-machine-transport.js";

const FIXED_PATH = "/v1/distributed/execution/pull";
const MAX_HEADER_SIZE = 8 * 1024;
const MAX_HEADERS_COUNT = 16;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 32;
const MAX_CONCURRENT_LIMIT = 64;
const MAX_BEARER_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER = /^[A-Za-z0-9._~+\/-]+=*$/;

const REQUIRED_HEADERS = Object.freeze([
  "host",
  "authorization",
  "x-cline-request-id",
  "accept",
  "accept-encoding",
  "cache-control",
  "connection",
  "content-length",
] as const);

export const DISTRIBUTED_CONTROLLER_HTTPS_PULL_SERVER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  protocol: "https_http_1_1" as const,
  method: "POST" as const,
  fixedPath: FIXED_PATH,
  directConnectionOnly: true as const,
  requestBodyAllowed: false as const,
  requestContainsWorkSelectors: false as const,
  duplicateCriticalHeadersAllowed: false as const,
  transferEncodingAllowed: false as const,
  expectContinueAllowed: false as const,
  protocolUpgradeAllowed: false as const,
  requiresM12CBearer: true as const,
  delegatesExactlyOnceToM12R: true as const,
  separatelyPreauthorizesWithM12C: false as const,
  returnsOnlyM12JBundleOrNoWork: true as const,
  invokesTargetRuntime: false as const,
  http2Enabled: false as const,
  automaticListen: false as const,
  publicBindDefault: false as const,
  certificateProvisioningIncluded: false as const,
  privateKeyGenerationIncluded: false as const,
  networkedM12QBootstrapIncluded: false as const,
  deliveryAcknowledgementIncluded: false as const,
  controllerPushEnabled: false as const,
  distributedTakeoverEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedControllerHttpsPullSelector {
  pullNext(
    token: string,
    requestId: string,
  ): Promise<DistributedExecutionDeliveryBundleV1 | null>;
}

export interface DistributedControllerHttpsPullRequestV1 {
  method?: string;
  url?: string;
  httpVersion: string;
  rawHeaders: readonly string[];
}

export interface DistributedControllerHttpsPullResponseV1 {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}

export interface DistributedControllerHttpsPullRouteOptions {
  controllerOrigin: string;
  selector: DistributedControllerHttpsPullSelector;
  maxConcurrent?: number;
}

export interface DistributedControllerHttpsTlsIdentity {
  key: https.ServerOptions["key"];
  cert: https.ServerOptions["cert"];
}

export interface DistributedControllerHttpsPullServerOptions
extends DistributedControllerHttpsPullRouteOptions {
  tlsIdentityProvider: () => DistributedControllerHttpsTlsIdentity;
  handshakeTimeoutMs?: number;
  headersTimeoutMs?: number;
  requestTimeoutMs?: number;
  socketTimeoutMs?: number;
}

export interface DistributedControllerHttpsPullServerBuilder {
  create(
    options: https.ServerOptions,
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ): https.Server;
}

export interface DistributedControllerHttpsPullServerDependencies {
  serverBuilder?: DistributedControllerHttpsPullServerBuilder;
}

export class DistributedControllerHttpsPullServerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "configuration_invalid"
      | "tls_identity_invalid"
      | "server_construction_failed",
  ) {
    super(message);
    this.name = "DistributedControllerHttpsPullServerError";
  }
}

interface ParsedPullRequest {
  bearerToken: string;
  requestId: string;
}

function boundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < min
    || value > max
  ) {
    throw new DistributedControllerHttpsPullServerError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

function canonicalControllerOrigin(value: unknown): URL {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    throw new DistributedControllerHttpsPullServerError(
      "controllerOrigin must be a canonical HTTPS origin",
      "configuration_invalid",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DistributedControllerHttpsPullServerError(
      "controllerOrigin must be an absolute HTTPS origin",
      "configuration_invalid",
    );
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.origin !== value
  ) {
    throw new DistributedControllerHttpsPullServerError(
      "controllerOrigin must be origin-only HTTPS without userinfo, path, query or fragment",
      "configuration_invalid",
    );
  }
  return parsed;
}

function bodyless(
  statusCode: number,
  extraHeaders: Record<string, string> = {},
): DistributedControllerHttpsPullResponseV1 {
  return {
    statusCode,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Length": "0",
      ...extraHeaders,
    }),
    body: Buffer.alloc(0),
  };
}

function parseRawHeaders(rawHeaders: readonly string[]): Map<string, string> | null {
  if (rawHeaders.length % 2 !== 0) return null;
  const headers = new Map<string, string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const rawName = rawHeaders[i];
    const rawValue = rawHeaders[i + 1];
    if (
      typeof rawName !== "string"
      || typeof rawValue !== "string"
      || rawName.length === 0
      || rawValue.includes("\0")
    ) {
      return null;
    }
    const name = rawName.toLowerCase();
    if (!REQUIRED_HEADERS.includes(name as typeof REQUIRED_HEADERS[number])) return null;
    if (headers.has(name)) return null;
    headers.set(name, rawValue);
  }
  if (headers.size !== REQUIRED_HEADERS.length) return null;
  if (REQUIRED_HEADERS.some((name) => !headers.has(name))) return null;
  return headers;
}

function bearerFromAuthorization(value: string | undefined): string | null {
  if (value === undefined || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  if (
    token.length < 32
    || token.length > MAX_BEARER_LENGTH
    || !BEARER.test(token)
  ) {
    return null;
  }
  return token;
}

function parseValidPullRequest(
  input: DistributedControllerHttpsPullRequestV1,
  expectedAuthority: string,
): ParsedPullRequest | DistributedControllerHttpsPullResponseV1 {
  if (input.url !== FIXED_PATH) return bodyless(404);
  if (input.method !== "POST") return bodyless(405, { Allow: "POST" });
  if (input.httpVersion !== "1.1") return bodyless(400);

  const headers = parseRawHeaders(input.rawHeaders);
  if (headers === null) return bodyless(400);

  if (headers.get("host") !== expectedAuthority) return bodyless(400);
  if (headers.get("accept") !== "application/json") return bodyless(400);
  if (headers.get("accept-encoding") !== "identity") return bodyless(400);
  if (headers.get("cache-control") !== "no-store") return bodyless(400);
  if (headers.get("connection")?.toLowerCase() !== "close") return bodyless(400);
  if (headers.get("content-length") !== "0") return bodyless(400);

  const bearerToken = bearerFromAuthorization(headers.get("authorization"));
  if (bearerToken === null) return bodyless(400);

  const requestId = headers.get("x-cline-request-id");
  if (
    requestId === undefined
    || requestId !== requestId.trim()
    || !UUID.test(requestId)
  ) {
    return bodyless(400);
  }

  return { bearerToken, requestId };
}

function findMachineTransportError(
  error: unknown,
  depth = 0,
): DistributedMachineTransportError | undefined {
  if (depth > 4) return undefined;
  if (error instanceof DistributedMachineTransportError) return error;
  if (error instanceof Error && "cause" in error) {
    return findMachineTransportError(error.cause, depth + 1);
  }
  return undefined;
}

function selectorFailureResponse(error: unknown): DistributedControllerHttpsPullResponseV1 {
  const transport = findMachineTransportError(error);
  if (transport) {
    switch (transport.code) {
      case "request_replayed":
        return bodyless(409);
      case "request_invalid":
        return bodyless(400);
      case "capability_not_allowed":
        return bodyless(403);
      case "session_not_found":
      case "session_invalid":
      case "session_expired":
      case "session_stale":
      case "registration_not_current":
        return bodyless(401);
      case "capacity_exceeded":
        return bodyless(503);
    }
  }

  if (error instanceof DistributedControllerPendingWorkError) {
    switch (error.code) {
      case "candidate_not_current":
      case "fence_not_current":
        return bodyless(409);
      case "capacity_exceeded":
        return bodyless(503);
      case "pending_work_invalid":
      case "pending_work_target_mismatch":
      case "delivery_failed":
      case "transport_identity_invalid":
        return bodyless(500);
    }
  }

  return bodyless(500);
}

function deliveryResponse(
  delivery: DistributedExecutionDeliveryBundleV1,
): DistributedControllerHttpsPullResponseV1 {
  try {
    assertDistributedExecutionDeliveryBundle(delivery);
  } catch {
    return bodyless(500);
  }

  let encoded: Buffer;
  try {
    encoded = Buffer.from(JSON.stringify(delivery), "utf8");
  } catch {
    return bodyless(500);
  }
  if (encoded.length > MAX_RESPONSE_BYTES) return bodyless(500);

  return {
    statusCode: 200,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "identity",
      "Content-Length": String(encoded.length),
      "X-Content-Type-Options": "nosniff",
    }),
    body: encoded,
  };
}

export class DistributedControllerHttpsPullRoute {
  private readonly expectedAuthority: string;
  private readonly maxConcurrent: number;
  private inFlight = 0;

  constructor(private readonly options: DistributedControllerHttpsPullRouteOptions) {
    const origin = canonicalControllerOrigin(options.controllerOrigin);
    if (
      !options.selector
      || typeof options.selector.pullNext !== "function"
    ) {
      throw new DistributedControllerHttpsPullServerError(
        "selector must provide pullNext(token, requestId)",
        "configuration_invalid",
      );
    }
    this.expectedAuthority = origin.host;
    this.maxConcurrent = boundedInteger(
      options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      "maxConcurrent",
      1,
      MAX_CONCURRENT_LIMIT,
    );
  }

  async handle(
    input: DistributedControllerHttpsPullRequestV1,
  ): Promise<DistributedControllerHttpsPullResponseV1> {
    const parsed = parseValidPullRequest(input, this.expectedAuthority);
    if ("statusCode" in parsed) return parsed;

    if (this.inFlight >= this.maxConcurrent) return bodyless(503);
    this.inFlight += 1;
    try {
      const delivery = await this.options.selector.pullNext(
        parsed.bearerToken,
        parsed.requestId,
      );
      if (delivery === null) return bodyless(204);
      return deliveryResponse(delivery);
    } catch (error) {
      return selectorFailureResponse(error);
    } finally {
      this.inFlight -= 1;
    }
  }
}

function requireTlsIdentity(
  provider: DistributedControllerHttpsPullServerOptions["tlsIdentityProvider"],
): DistributedControllerHttpsTlsIdentity {
  if (typeof provider !== "function") {
    throw new DistributedControllerHttpsPullServerError(
      "TLS identity provider is required",
      "tls_identity_invalid",
    );
  }
  let identity: DistributedControllerHttpsTlsIdentity;
  try {
    identity = provider();
  } catch {
    throw new DistributedControllerHttpsPullServerError(
      "TLS identity provider failed",
      "tls_identity_invalid",
    );
  }
  if (
    !identity
    || typeof identity !== "object"
    || identity.key === undefined
    || identity.cert === undefined
  ) {
    throw new DistributedControllerHttpsPullServerError(
      "TLS identity provider must return key and certificate material",
      "tls_identity_invalid",
    );
  }
  return identity;
}

function writeNodeResponse(
  response: ServerResponse,
  output: DistributedControllerHttpsPullResponseV1,
): void {
  response.statusCode = output.statusCode;
  response.shouldKeepAlive = false;
  for (const [name, value] of Object.entries(output.headers)) {
    response.setHeader(name, value);
  }
  response.end(output.body);
}

function closeSocket(socket: Duplex): void {
  if (!socket.destroyed) socket.destroy();
}

export function createUnboundDistributedControllerHttpsPullServer(
  options: DistributedControllerHttpsPullServerOptions,
  dependencies: DistributedControllerHttpsPullServerDependencies = {},
): https.Server {
  const route = new DistributedControllerHttpsPullRoute(options);
  const identity = requireTlsIdentity(options.tlsIdentityProvider);
  const handshakeTimeout = boundedInteger(
    options.handshakeTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "handshakeTimeoutMs",
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const headersTimeout = boundedInteger(
    options.headersTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "headersTimeoutMs",
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const requestTimeout = boundedInteger(
    options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "requestTimeoutMs",
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const socketTimeout = boundedInteger(
    options.socketTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "socketTimeoutMs",
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  const builder = dependencies.serverBuilder ?? {
    create(serverOptions, listener) {
      return https.createServer(serverOptions, listener);
    },
  };

  let server: https.Server;
  try {
    server = builder.create(
      {
        key: identity.key,
        cert: identity.cert,
        minVersion: "TLSv1.2",
        ALPNProtocols: ["http/1.1"],
        requestCert: false,
        insecureHTTPParser: false,
        joinDuplicateHeaders: false,
        maxHeaderSize: MAX_HEADER_SIZE,
        handshakeTimeout,
      },
      (request, response) => {
        void route.handle({
          method: request.method,
          url: request.url,
          httpVersion: request.httpVersion,
          rawHeaders: request.rawHeaders,
        }).then(
          (output) => writeNodeResponse(response, output),
          () => writeNodeResponse(response, bodyless(500)),
        );
      },
    );
  } catch {
    throw new DistributedControllerHttpsPullServerError(
      "HTTPS server construction failed",
      "server_construction_failed",
    );
  }

  server.maxHeadersCount = MAX_HEADERS_COUNT;
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = headersTimeout;
  server.requestTimeout = requestTimeout;
  server.setTimeout(socketTimeout, (socket) => closeSocket(socket));

  server.on("checkContinue", (_request, response) => {
    writeNodeResponse(response, bodyless(417));
  });
  server.on("upgrade", (_request, socket) => closeSocket(socket));
  server.on("connect", (_request, socket) => closeSocket(socket));
  server.on("clientError", (_error, socket) => closeSocket(socket));
  server.on("tlsClientError", (_error, socket: TLSSocket) => closeSocket(socket));

  if (server.listening) {
    throw new DistributedControllerHttpsPullServerError(
      "M12T server factory must return an unbound server",
      "server_construction_failed",
    );
  }

  return server;
}
