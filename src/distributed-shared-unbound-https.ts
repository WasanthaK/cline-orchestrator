import crypto, {
  KeyObject,
  X509Certificate,
} from "node:crypto";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import {
  DistributedControllerHttpsPullRoute,
  type DistributedControllerHttpsPullRequestV1,
  type DistributedControllerHttpsPullResponseV1,
  type DistributedControllerHttpsPullSelector,
} from "./distributed-controller-https-pull-server.js";
import {
  DistributedNetworkMachineAuthRoute,
  type DistributedNetworkMachineAuthBootstrap,
  type DistributedNetworkMachineAuthRequestV1,
  type DistributedNetworkMachineAuthResponseV1,
} from "./distributed-network-machine-auth-bootstrap.js";
import {
  assertDistributedSecureTransportProfile,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";
import {
  DISTRIBUTED_DELIVERY_ACK_PATH,
  DistributedDeliveryAckRoute,
  type DistributedDeliveryAckAuthorizer,
  type DistributedDeliveryAckRequestV1,
  type DistributedDeliveryAckResponseV1,
  type DistributedDeliveryAckStateStore,
} from "./distributed-delivery-ack-transport.js";

const PULL_PATH = "/v1/distributed/execution/pull";
const CHALLENGE_PATH = "/v1/distributed/auth/challenge";
const SESSION_PATH = "/v1/distributed/auth/session";
const ACK_PATH = DISTRIBUTED_DELIVERY_ACK_PATH;
const MAX_HEADER_SIZE = 8 * 1024;
const MAX_HEADERS_COUNT = 16;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_BODY_COLLECTORS = 16;
const HARD_MAX_BODY_COLLECTORS = 32;
const CHALLENGE_BODY_MAX = 1024;
const SESSION_BODY_MAX = 512;

export const DISTRIBUTED_SHARED_UNBOUND_HTTPS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  routes: Object.freeze([
    PULL_PATH,
    CHALLENGE_PATH,
    SESSION_PATH,
    ACK_PATH,
  ] as const),
  protocol: "https_http_1_1" as const,
  singleCanonicalOrigin: true as const,
  consumesM12PProfile: true as const,
  reusesM12TRoute: true as const,
  reusesM12URoute: true as const,
  fallbackRouteChainingAllowed: false as const,
  duplicatesM12CAuthorization: false as const,
  exposesM12CIssueDirectly: false as const,
  performsM12QDirectly: false as const,
  localTlsIdentityPreflightRequired: true as const,
  verifiesTlsHostnameOrIp: true as const,
  verifiesLeafSpkiPin: true as const,
  verifiesPrivateKeyMatchesLeaf: true as const,
  fullSystemCaChainValidationClaimed: false as const,
  reverseProxyTrustEnabled: false as const,
  http2Enabled: false as const,
  automaticListen: false as const,
  publicBindDefault: false as const,
  tlsIdentityProvisioningIncluded: false as const,
  machineKeyProvisioningIncluded: false as const,
  deliveryAcknowledgementIncluded: true as const,
  controllerPushEnabled: false as const,
  invokesTargetRuntime: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedSharedTlsIdentity {
  privateKey: KeyObject;
  certificates: readonly (string | Buffer)[];
}

export interface DistributedSharedTlsIdentityPreflightReceiptV1 {
  schemaVersion: 1;
  profileId: string;
  controllerOrigin: string;
  leafSpkiSha256Pin: string;
  certificateValidFrom: string;
  certificateValidTo: string;
  hostnameOrIpMatched: true;
  privateKeyMatched: true;
  authority: "deployment_readiness_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedSharedHttpsRouterRequestV1 {
  method?: string;
  url?: string;
  httpVersion: string;
  rawHeaders: readonly string[];
  body?: Buffer;
  peerAddress?: string;
}

export type DistributedSharedHttpsRouterResponseV1 =
  | DistributedControllerHttpsPullResponseV1
  | DistributedNetworkMachineAuthResponseV1
  | DistributedDeliveryAckResponseV1;

export interface DistributedSharedHttpsPullRoute {
  handle(
    input: DistributedControllerHttpsPullRequestV1,
  ): Promise<DistributedControllerHttpsPullResponseV1>;
}

export interface DistributedSharedHttpsAuthRoute {
  handle(
    input: DistributedNetworkMachineAuthRequestV1,
  ): Promise<DistributedNetworkMachineAuthResponseV1>;
}

export interface DistributedSharedHttpsAckRoute {
  handle(
    input: DistributedDeliveryAckRequestV1,
  ): Promise<DistributedDeliveryAckResponseV1>;
}

export interface DistributedSharedHttpsRouterDependencies {
  pullRoute: DistributedSharedHttpsPullRoute;
  authRoute: DistributedSharedHttpsAuthRoute;
  ackRoute?: DistributedSharedHttpsAckRoute;
}

export interface DistributedSharedUnboundHttpsServerOptions {
  profile: DistributedSecureTransportProfileV1;
  selector: DistributedControllerHttpsPullSelector;
  bootstrap: DistributedNetworkMachineAuthBootstrap;
  ackAuthorizer?: DistributedDeliveryAckAuthorizer;
  ackStateStore?: DistributedDeliveryAckStateStore;
  tlsIdentityProvider: () => DistributedSharedTlsIdentity;
  now?: () => Date;
  pullMaxConcurrent?: number;
  authMaxConcurrent?: number;
  peerIssueLimitPerMinute?: number;
  registrationIssueLimitPerMinute?: number;
  peerCompletionLimitPerMinute?: number;
  maxConcurrentBodyCollectors?: number;
  handshakeTimeoutMs?: number;
  headersTimeoutMs?: number;
  requestTimeoutMs?: number;
  socketTimeoutMs?: number;
}

export interface DistributedSharedHttpsServerBuilder {
  create(
    options: https.ServerOptions,
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ): https.Server;
}

export interface DistributedSharedUnboundHttpsServerDependencies {
  serverBuilder?: DistributedSharedHttpsServerBuilder;
}

export interface DistributedSharedUnboundHttpsServerResult {
  server: https.Server;
  preflight: DistributedSharedTlsIdentityPreflightReceiptV1;
}

export class DistributedSharedUnboundHttpsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "profile_invalid"
      | "configuration_invalid"
      | "tls_identity_invalid"
      | "tls_certificate_invalid"
      | "tls_certificate_expired"
      | "tls_certificate_not_yet_valid"
      | "tls_hostname_mismatch"
      | "tls_spki_pin_mismatch"
      | "tls_private_key_mismatch"
      | "server_construction_failed",
  ) {
    super(message);
    this.name = "DistributedSharedUnboundHttpsError";
  }
}

function bodyless(
  statusCode: number,
  extraHeaders: Record<string, string> = {},
): DistributedSharedHttpsRouterResponseV1 {
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
    throw new DistributedSharedUnboundHttpsError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

function exactIdentity(
  value: unknown,
): asserts value is DistributedSharedTlsIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity provider must return an exact identity object",
      "tls_identity_invalid",
    );
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (
    keys.length !== 2
    || !keys.includes("privateKey")
    || !keys.includes("certificates")
  ) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity provider returned unsupported fields",
      "tls_identity_invalid",
    );
  }
  const identity = value as DistributedSharedTlsIdentity;
  if (!(identity.privateKey instanceof KeyObject) || identity.privateKey.type !== "private") {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity privateKey must be a private KeyObject",
      "tls_identity_invalid",
    );
  }
  if (!Array.isArray(identity.certificates) || identity.certificates.length < 1) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity requires a leaf-first certificate chain",
      "tls_identity_invalid",
    );
  }
  for (const certificate of identity.certificates) {
    if (
      !(
        typeof certificate === "string"
        || Buffer.isBuffer(certificate)
      )
      || certificate.length === 0
    ) {
      throw new DistributedSharedUnboundHttpsError(
        "TLS identity certificate chain contains invalid material",
        "tls_identity_invalid",
      );
    }
  }
}

function parseCertificate(
  value: string | Buffer,
): X509Certificate {
  try {
    return new X509Certificate(value);
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "TLS certificate material is malformed",
      "tls_certificate_invalid",
    );
  }
}

function validClock(now: () => Date): Date {
  let value: Date;
  try {
    value = now();
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "TLS preflight clock failed",
      "configuration_invalid",
    );
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS preflight clock is invalid",
      "configuration_invalid",
    );
  }
  return value;
}

export function preflightDistributedSharedTlsIdentity(
  profile: DistributedSecureTransportProfileV1,
  identity: DistributedSharedTlsIdentity,
  now: () => Date = () => new Date(),
): DistributedSharedTlsIdentityPreflightReceiptV1 {
  try {
    assertDistributedSecureTransportProfile(profile);
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "M12P transport profile is invalid",
      "profile_invalid",
    );
  }
  exactIdentity(identity);

  const certificates = identity.certificates.map((item) => parseCertificate(item));
  const leaf = certificates[0]!;
  if (leaf.ca) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS leaf certificate must not be a CA certificate",
      "tls_certificate_invalid",
    );
  }

  const validFrom = new Date(leaf.validFrom);
  const validTo = new Date(leaf.validTo);
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validTo.getTime())) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS certificate validity interval is invalid",
      "tls_certificate_invalid",
    );
  }
  const current = validClock(now);
  if (current.getTime() < validFrom.getTime()) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS certificate is not yet valid",
      "tls_certificate_not_yet_valid",
    );
  }
  if (current.getTime() > validTo.getTime()) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS certificate is expired",
      "tls_certificate_expired",
    );
  }

  const origin = new URL(profile.controllerOrigin);
  const rawHost = origin.hostname;
  const host = rawHost.startsWith("[") && rawHost.endsWith("]")
    ? rawHost.slice(1, -1)
    : rawHost;
  const matched = isIP(host) > 0
    ? leaf.checkIP(host)
    : leaf.checkHost(host);
  if (matched === undefined) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS leaf certificate does not match controller origin",
      "tls_hostname_mismatch",
    );
  }

  let publicKeyDer: Buffer;
  try {
    const exported = leaf.publicKey.export({
      format: "der",
      type: "spki",
    });
    publicKeyDer = Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "TLS leaf public key could not be exported",
      "tls_certificate_invalid",
    );
  }
  const pin = `sha256/${crypto.createHash("sha256").update(publicKeyDer).digest("base64")}`;
  if (!profile.serverSpkiSha256Pins.includes(pin)) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS leaf SPKI pin does not match M12P",
      "tls_spki_pin_mismatch",
    );
  }

  let privateKeyMatched = false;
  try {
    privateKeyMatched = leaf.checkPrivateKey(identity.privateKey);
  } catch {
    privateKeyMatched = false;
  }
  if (!privateKeyMatched) {
    throw new DistributedSharedUnboundHttpsError(
      "TLS private key does not match leaf certificate",
      "tls_private_key_mismatch",
    );
  }

  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    controllerOrigin: profile.controllerOrigin,
    leafSpkiSha256Pin: pin,
    certificateValidFrom: validFrom.toISOString(),
    certificateValidTo: validTo.toISOString(),
    hostnameOrIpMatched: true,
    privateKeyMatched: true,
    authority: "deployment_readiness_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

export class DistributedSharedHttpsRouter {
  constructor(
    private readonly dependencies: DistributedSharedHttpsRouterDependencies,
  ) {
    if (
      !dependencies.pullRoute
      || typeof dependencies.pullRoute.handle !== "function"
      || !dependencies.authRoute
      || typeof dependencies.authRoute.handle !== "function"
      || (dependencies.ackRoute !== undefined && typeof dependencies.ackRoute.handle !== "function")
    ) {
      throw new DistributedSharedUnboundHttpsError(
        "shared router requires valid M12T/M12U handlers and optional M12Y ACK handler",
        "configuration_invalid",
      );
    }
  }

  async handle(
    input: DistributedSharedHttpsRouterRequestV1,
  ): Promise<DistributedSharedHttpsRouterResponseV1> {
    if (input.url === PULL_PATH) {
      return this.dependencies.pullRoute.handle({
        method: input.method,
        url: input.url,
        httpVersion: input.httpVersion,
        rawHeaders: input.rawHeaders,
      });
    }
    if (input.url === ACK_PATH) {
      if (!this.dependencies.ackRoute) return bodyless(404);
      return this.dependencies.ackRoute.handle({
        method: input.method,
        url: input.url,
        httpVersion: input.httpVersion,
        rawHeaders: input.rawHeaders,
        body: Buffer.isBuffer(input.body) ? input.body : Buffer.alloc(0),
      });
    }
    if (input.url === CHALLENGE_PATH || input.url === SESSION_PATH) {
      return this.dependencies.authRoute.handle({
        method: input.method,
        url: input.url,
        httpVersion: input.httpVersion,
        rawHeaders: input.rawHeaders,
        body: Buffer.isBuffer(input.body) ? input.body : Buffer.alloc(0),
        peerAddress: input.peerAddress ?? "",
      });
    }
    return bodyless(404);
  }
}

function bootstrapBodyMaximum(path: string): number {
  if (path === CHALLENGE_PATH) return CHALLENGE_BODY_MAX;
  if (path === SESSION_PATH) return SESSION_BODY_MAX;
  if (path === ACK_PATH) return 4096;
  return 0;
}

function framingContentLength(
  rawHeaders: readonly string[],
  maxBytes: number,
): number | null {
  if (rawHeaders.length % 2 !== 0) return null;
  let contentLength: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string") return null;
    const lower = name.toLowerCase();
    if (lower === "transfer-encoding") return null;
    if (lower === "content-length") {
      if (contentLength !== undefined) return null;
      contentLength = value;
    }
  }
  if (
    contentLength === undefined
    || !/^[1-9]\d*$/.test(contentLength)
  ) {
    return null;
  }
  const length = Number(contentLength);
  if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) return null;
  return length;
}

interface BootstrapBodyStream extends AsyncIterable<Buffer | string> {
  destroyed?: boolean;
  destroy?(error?: Error): void;
}

export class DistributedBootstrapBodyCollector {
  private inFlight = 0;

  constructor(private readonly maxConcurrent = DEFAULT_BODY_COLLECTORS) {
    boundedInteger(
      maxConcurrent,
      "maxConcurrentBodyCollectors",
      1,
      HARD_MAX_BODY_COLLECTORS,
    );
  }

  async collect(
    stream: BootstrapBodyStream,
    declaredLength: number,
    maxBytes: number,
  ): Promise<Buffer | null | "saturated"> {
    if (this.inFlight >= this.maxConcurrent) return "saturated";
    this.inFlight += 1;
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > declaredLength || total > maxBytes) {
            stream.destroy?.();
            return null;
          }
          chunks.push(buffer);
        }
      } catch {
        return null;
      }
      if (total !== declaredLength) return null;
      return Buffer.concat(chunks, total);
    } finally {
      this.inFlight -= 1;
    }
  }
}

function writeNodeResponse(
  response: ServerResponse,
  output: DistributedSharedHttpsRouterResponseV1,
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

function loadIdentity(
  provider: DistributedSharedUnboundHttpsServerOptions["tlsIdentityProvider"],
): DistributedSharedTlsIdentity {
  if (typeof provider !== "function") {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity provider is required",
      "tls_identity_invalid",
    );
  }
  let identity: DistributedSharedTlsIdentity;
  try {
    identity = provider();
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "TLS identity provider failed",
      "tls_identity_invalid",
    );
  }
  exactIdentity(identity);
  return identity;
}

export function createUnboundDistributedSharedHttpsServer(
  options: DistributedSharedUnboundHttpsServerOptions,
  dependencies: DistributedSharedUnboundHttpsServerDependencies = {},
): DistributedSharedUnboundHttpsServerResult {
  try {
    assertDistributedSecureTransportProfile(options.profile);
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "M12P transport profile is invalid",
      "profile_invalid",
    );
  }
  const identity = loadIdentity(options.tlsIdentityProvider);
  const preflight = preflightDistributedSharedTlsIdentity(
    options.profile,
    identity,
    options.now,
  );

  const pullRoute = new DistributedControllerHttpsPullRoute({
    controllerOrigin: options.profile.controllerOrigin,
    selector: options.selector,
    ...(options.pullMaxConcurrent === undefined
      ? {}
      : { maxConcurrent: options.pullMaxConcurrent }),
  });
  const authRoute = new DistributedNetworkMachineAuthRoute({
    controllerOrigin: options.profile.controllerOrigin,
    bootstrap: options.bootstrap,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.authMaxConcurrent === undefined
      ? {}
      : { maxConcurrent: options.authMaxConcurrent }),
    ...(options.peerIssueLimitPerMinute === undefined
      ? {}
      : { peerIssueLimitPerMinute: options.peerIssueLimitPerMinute }),
    ...(options.registrationIssueLimitPerMinute === undefined
      ? {}
      : { registrationIssueLimitPerMinute: options.registrationIssueLimitPerMinute }),
    ...(options.peerCompletionLimitPerMinute === undefined
      ? {}
      : { peerCompletionLimitPerMinute: options.peerCompletionLimitPerMinute }),
  });
  const ackRoute = options.ackAuthorizer && options.ackStateStore
    ? new DistributedDeliveryAckRoute({
        controllerOrigin: options.profile.controllerOrigin,
        authorizer: options.ackAuthorizer,
        stateStore: options.ackStateStore,
      })
    : undefined;
  if ((options.ackAuthorizer === undefined) !== (options.ackStateStore === undefined)) {
    throw new DistributedSharedUnboundHttpsError(
      "ACK authorizer and state store must be configured together",
      "configuration_invalid",
    );
  }
  const router = new DistributedSharedHttpsRouter({
    pullRoute,
    authRoute,
    ...(ackRoute === undefined ? {} : { ackRoute }),
  });
  const collector = new DistributedBootstrapBodyCollector(
    options.maxConcurrentBodyCollectors ?? DEFAULT_BODY_COLLECTORS,
  );

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

  let serverKeyPem: Buffer;
  try {
    const exported = identity.privateKey.export({
      format: "pem",
      type: "pkcs8",
    });
    serverKeyPem = Buffer.isBuffer(exported)
      ? Buffer.from(exported)
      : Buffer.from(exported, "utf8");
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "preflighted TLS private key could not be exported for server construction",
      "tls_identity_invalid",
    );
  }

  let server: https.Server;
  try {
    server = builder.create(
      {
        key: serverKeyPem,
        cert: [...identity.certificates],
        minVersion: "TLSv1.2",
        ALPNProtocols: ["http/1.1"],
        requestCert: false,
        insecureHTTPParser: false,
        joinDuplicateHeaders: false,
        maxHeaderSize: MAX_HEADER_SIZE,
        handshakeTimeout,
      },
      (request, response) => {
        const path = request.url;
        if (path === PULL_PATH) {
          void router.handle({
            method: request.method,
            url: request.url,
            httpVersion: request.httpVersion,
            rawHeaders: request.rawHeaders,
          }).then(
            (output) => writeNodeResponse(response, output),
            () => writeNodeResponse(response, bodyless(500)),
          );
          return;
        }

        if (path === CHALLENGE_PATH || path === SESSION_PATH || path === ACK_PATH) {
          if (request.method !== "POST" || request.httpVersion !== "1.1") {
            void router.handle({
              method: request.method,
              url: request.url,
              httpVersion: request.httpVersion,
              rawHeaders: request.rawHeaders,
              body: Buffer.alloc(0),
              peerAddress: request.socket.remoteAddress ?? "",
            }).then(
              (output) => writeNodeResponse(response, output),
              () => writeNodeResponse(response, bodyless(500)),
            );
            return;
          }

          const maxBytes = bootstrapBodyMaximum(path);
          const declaredLength = framingContentLength(request.rawHeaders, maxBytes);
          if (declaredLength === null) {
            writeNodeResponse(response, bodyless(400));
            return;
          }

          void collector.collect(request, declaredLength, maxBytes).then(
            (body) => {
              if (body === "saturated") {
                writeNodeResponse(response, bodyless(503));
                return;
              }
              if (body === null) {
                writeNodeResponse(response, bodyless(400));
                return;
              }
              void router.handle({
                method: request.method,
                url: request.url,
                httpVersion: request.httpVersion,
                rawHeaders: request.rawHeaders,
                body,
                peerAddress: request.socket.remoteAddress ?? "",
              }).then(
                (output) => writeNodeResponse(response, output),
                () => writeNodeResponse(response, bodyless(500)),
              );
            },
            () => writeNodeResponse(response, bodyless(400)),
          );
          return;
        }

        writeNodeResponse(response, bodyless(404));
      },
    );
  } catch {
    throw new DistributedSharedUnboundHttpsError(
      "shared HTTPS server construction failed",
      "server_construction_failed",
    );
  } finally {
    serverKeyPem.fill(0);
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
    throw new DistributedSharedUnboundHttpsError(
      "shared HTTPS server must remain unbound",
      "server_construction_failed",
    );
  }

  return {
    server,
    preflight: structuredClone(preflight),
  };
}
