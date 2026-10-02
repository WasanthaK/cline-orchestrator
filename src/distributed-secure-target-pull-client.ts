import crypto from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import type { IncomingHttpHeaders } from "node:http";
import type { ClientRequest } from "node:http";
import type { TLSSocket } from "node:tls";
import { TextDecoder } from "node:util";
import {
  assertDistributedExecutionDeliveryBundle,
  type DistributedExecutionDeliveryBundleV1,
} from "./distributed-execution-delivery.js";
import {
  assertDistributedSecureTransportProfile,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 15;
const FIXED_PATH = "/v1/distributed/execution/pull";
const MAX_BEARER_LENGTH = 4096;
const PIN_ERROR_CODE = "M12S_SERVER_IDENTITY_MISMATCH";

export const DISTRIBUTED_SECURE_TARGET_PULL_CLIENT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  direction: "target_to_controller" as const,
  method: "POST" as const,
  fixedPath: FIXED_PATH,
  minimumNodeVersion: "22.15.0" as const,
  requestContainsWorkSelectors: false as const,
  requiresValidatedM12PProfile: true as const,
  requiresM12CBearer: true as const,
  issuesOrRefreshesBearer: false as const,
  requiresSystemCaValidation: true as const,
  requiresHostnameValidation: true as const,
  requiresLeafSpkiSha256Pin: true as const,
  redirectsAllowed: false as const,
  environmentProxyAllowed: false as const,
  automaticRetryAllowed: false as const,
  connectionReuseAllowed: false as const,
  requestBodyAllowed: false as const,
  acceptsNoWork204: true as const,
  acceptsM12JBundle200: true as const,
  invokesTargetRuntime: false as const,
  outboundNetworkIoIncluded: true as const,
  listenerIncluded: false as const,
  controllerPushEnabled: false as const,
  credentialProvisioningIncluded: false as const,
  distributedTakeoverEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type DistributedSecureTargetPullClientErrorCode =
  | "profile_invalid"
  | "bearer_invalid"
  | "request_id_invalid"
  | "unsupported_runtime"
  | "system_ca_unavailable"
  | "dns_or_connect_failed"
  | "connect_timeout"
  | "tls_validation_failed"
  | "server_identity_mismatch"
  | "response_timeout"
  | "redirect_rejected"
  | "authentication_rejected"
  | "request_state_conflict"
  | "unexpected_status"
  | "response_headers_invalid"
  | "response_encoding_rejected"
  | "response_too_large"
  | "response_json_invalid"
  | "delivery_invalid"
  | "ambiguous_outcome";

export class DistributedSecureTargetPullClientError extends Error {
  constructor(
    message: string,
    public readonly code: DistributedSecureTargetPullClientErrorCode,
  ) {
    super(message);
    this.name = "DistributedSecureTargetPullClientError";
  }
}

export interface DistributedSecureTargetPullClientInput {
  profile: DistributedSecureTransportProfileV1;
  bearerToken: string;
  requestId: string;
}

export interface DistributedSecureTargetPullRawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface DistributedSecureTargetPullRequestPlan {
  url: URL;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  systemCaCertificates: readonly string[];
  minVersion: "TLSv1.2";
  rejectUnauthorized: true;
  agent: false;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  maxResponseBytes: number;
  checkServerIdentity: typeof tls.checkServerIdentity;
}

export interface DistributedSecureTargetPullRequestTransport {
  request(
    plan: DistributedSecureTargetPullRequestPlan,
  ): Promise<DistributedSecureTargetPullRawResponse>;
}

export interface DistributedSecureTargetPullClientDependencies {
  transport?: DistributedSecureTargetPullRequestTransport;
  systemCaProvider?: () => string[];
}

export class DistributedSecureTargetPullTransportError extends Error {
  constructor(
    public readonly code:
      | "dns_or_connect_failed"
      | "connect_timeout"
      | "tls_validation_failed"
      | "server_identity_mismatch"
      | "response_timeout"
      | "response_too_large"
      | "ambiguous_outcome",
    message: string,
  ) {
    super(message);
    this.name = "DistributedSecureTargetPullTransportError";
  }
}

function publicError(
  code: DistributedSecureTargetPullClientErrorCode,
): DistributedSecureTargetPullClientError {
  const messages: Record<DistributedSecureTargetPullClientErrorCode, string> = {
    profile_invalid: "secure target-pull transport profile is invalid",
    bearer_invalid: "secure target-pull bearer is invalid",
    request_id_invalid: "secure target-pull request id is invalid",
    unsupported_runtime: "secure target-pull runtime does not support required system CA APIs",
    system_ca_unavailable: "secure target-pull system CA roots are unavailable",
    dns_or_connect_failed: "secure target-pull connection failed before a trusted response",
    connect_timeout: "secure target-pull connection timed out",
    tls_validation_failed: "secure target-pull TLS validation failed",
    server_identity_mismatch: "secure target-pull server identity pin did not match",
    response_timeout: "secure target-pull response timed out",
    redirect_rejected: "secure target-pull redirect was rejected",
    authentication_rejected: "secure target-pull authentication was rejected",
    request_state_conflict: "secure target-pull request state conflicted with controller state",
    unexpected_status: "secure target-pull controller returned an unexpected status",
    response_headers_invalid: "secure target-pull response headers are invalid",
    response_encoding_rejected: "secure target-pull response encoding is not allowed",
    response_too_large: "secure target-pull response exceeded the configured size bound",
    response_json_invalid: "secure target-pull response is not valid UTF-8 JSON",
    delivery_invalid: "secure target-pull response is not a valid M12J delivery bundle",
    ambiguous_outcome: "secure target-pull outcome is ambiguous and must not be retried automatically",
  };
  return new DistributedSecureTargetPullClientError(messages[code], code);
}

export function assertDistributedSecureTargetPullRuntime(
  version: string = process.versions.node,
): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw publicError("unsupported_runtime");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    throw publicError("unsupported_runtime");
  }
  if (typeof (tls as typeof tls & { getCACertificates?: unknown }).getCACertificates !== "function") {
    throw publicError("unsupported_runtime");
  }
}

function defaultSystemCaProvider(): string[] {
  assertDistributedSecureTargetPullRuntime();
  const getCACertificates = (
    tls as typeof tls & { getCACertificates(type?: "system"): string[] }
  ).getCACertificates;
  let roots: string[];
  try {
    roots = getCACertificates("system");
  } catch {
    throw publicError("system_ca_unavailable");
  }
  return validateSystemCaCertificates(roots);
}

function validateSystemCaCertificates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw publicError("system_ca_unavailable");
  }
  const roots: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string"
      || item.length === 0
      || !item.includes("-----BEGIN CERTIFICATE-----")
      || !item.includes("-----END CERTIFICATE-----")
    ) {
      throw publicError("system_ca_unavailable");
    }
    roots.push(item);
  }
  return roots;
}

function assertPullInputShape(
  value: unknown,
): asserts value is DistributedSecureTargetPullClientInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw publicError("profile_invalid");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const allowed = ["profile", "bearerToken", "requestId"];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw publicError("profile_invalid");
  }
}

function requireBearer(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 32
    || value.length > MAX_BEARER_LENGTH
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw publicError("bearer_invalid");
  }
  return value;
}

function requireRequestId(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw publicError("request_id_invalid");
  }
  return value;
}

function requestUrl(profile: DistributedSecureTransportProfileV1): URL {
  const url = new URL(FIXED_PATH, profile.controllerOrigin);
  if (
    url.origin !== profile.controllerOrigin
    || url.protocol !== "https:"
    || url.pathname !== FIXED_PATH
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw publicError("profile_invalid");
  }
  return url;
}

function createPinnedServerIdentityVerifier(
  pins: readonly string[],
): typeof tls.checkServerIdentity {
  const expected = new Set(pins);
  return (hostname, cert) => {
    const hostnameError = tls.checkServerIdentity(hostname, cert);
    if (hostnameError) {
      const error = new Error("TLS hostname verification failed") as Error & { code?: string };
      error.code = "M12S_TLS_HOSTNAME_MISMATCH";
      return error;
    }
    if (!Buffer.isBuffer(cert.pubkey) || cert.pubkey.length === 0) {
      const error = new Error("TLS peer public key is unavailable") as Error & { code?: string };
      error.code = PIN_ERROR_CODE;
      return error;
    }
    const pin = `sha256/${crypto.createHash("sha256").update(cert.pubkey).digest("base64")}`;
    if (!expected.has(pin)) {
      const error = new Error("TLS peer public key pin mismatch") as Error & { code?: string };
      error.code = PIN_ERROR_CODE;
      return error;
    }
    return undefined;
  };
}

export function createDistributedSecureTargetPullRequestPlan(
  input: DistributedSecureTargetPullClientInput,
  systemCaCertificates: readonly string[],
): DistributedSecureTargetPullRequestPlan {
  assertPullInputShape(input);
  try {
    assertDistributedSecureTransportProfile(input.profile);
  } catch {
    throw publicError("profile_invalid");
  }
  const bearerToken = requireBearer(input.bearerToken);
  const requestId = requireRequestId(input.requestId);
  const roots = validateSystemCaCertificates([...systemCaCertificates]);
  const url = requestUrl(input.profile);
  const headers = Object.freeze({
    Authorization: `Bearer ${bearerToken}`,
    "X-Cline-Request-Id": requestId,
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Length": "0",
  });
  return {
    url,
    method: "POST",
    headers,
    systemCaCertificates: roots,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    agent: false,
    connectTimeoutMs: input.profile.connectTimeoutMs,
    responseTimeoutMs: input.profile.connectTimeoutMs,
    maxResponseBytes: input.profile.maxResponseBytes,
    checkServerIdentity: createPinnedServerIdentityVerifier(
      input.profile.serverSpkiSha256Pins,
    ),
  };
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw publicError("response_headers_invalid");
  return value;
}

function validateContentLength(
  headers: IncomingHttpHeaders,
  maxResponseBytes: number,
): void {
  const value = headerValue(headers, "content-length");
  if (value === undefined) return;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw publicError("response_headers_invalid");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw publicError("response_headers_invalid");
  }
  if (length > maxResponseBytes) {
    throw publicError("response_too_large");
  }
}

function validateJsonContentType(headers: IncomingHttpHeaders): void {
  const raw = headerValue(headers, "content-type");
  if (raw === undefined) throw publicError("response_headers_invalid");
  const parts = raw.split(";").map((value) => value.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 2 || parts[0]!.toLowerCase() !== "application/json") {
    throw publicError("response_headers_invalid");
  }
  if (
    parts.length === 2
    && parts[1]!.toLowerCase() !== "charset=utf-8"
  ) {
    throw publicError("response_headers_invalid");
  }
}

function validateContentEncoding(headers: IncomingHttpHeaders): void {
  const raw = headerValue(headers, "content-encoding");
  if (raw !== undefined && raw.trim().toLowerCase() !== "identity") {
    throw publicError("response_encoding_rejected");
  }
}

function decodeJson(body: Buffer): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw publicError("response_json_invalid");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw publicError("response_json_invalid");
  }
}

function validateResponse(
  response: DistributedSecureTargetPullRawResponse,
  maxResponseBytes: number,
): DistributedExecutionDeliveryBundleV1 | null {
  if (!Number.isSafeInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    throw publicError("unexpected_status");
  }
  if (!Buffer.isBuffer(response.body)) {
    throw publicError("response_headers_invalid");
  }
  if (response.body.length > maxResponseBytes) {
    throw publicError("response_too_large");
  }

  if (response.statusCode >= 300 && response.statusCode <= 399) {
    throw publicError("redirect_rejected");
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    throw publicError("authentication_rejected");
  }
  if (response.statusCode === 409) {
    throw publicError("request_state_conflict");
  }
  if (response.statusCode === 204) {
    validateContentLength(response.headers, maxResponseBytes);
    if (response.body.length !== 0) {
      throw publicError("response_headers_invalid");
    }
    return null;
  }
  if (response.statusCode !== 200) {
    throw publicError("unexpected_status");
  }

  validateContentLength(response.headers, maxResponseBytes);
  validateContentEncoding(response.headers);
  validateJsonContentType(response.headers);
  const parsed = decodeJson(response.body);
  try {
    assertDistributedExecutionDeliveryBundle(parsed);
  } catch {
    throw publicError("delivery_invalid");
  }
  return structuredClone(parsed);
}

function classifyTlsError(error: unknown): DistributedSecureTargetPullTransportError["code"] | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === PIN_ERROR_CODE) return "server_identity_mismatch";
  if (
    code === "M12S_TLS_HOSTNAME_MISMATCH"
    || code === "ERR_TLS_CERT_ALTNAME_INVALID"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "UNABLE_TO_GET_ISSUER_CERT"
    || code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "CERT_HAS_EXPIRED"
    || code === "CERT_NOT_YET_VALID"
    || code === "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED"
  ) {
    return "tls_validation_failed";
  }
  return undefined;
}

export class NodeDistributedSecureTargetPullRequestTransport
implements DistributedSecureTargetPullRequestTransport {
  async request(
    plan: DistributedSecureTargetPullRequestPlan,
  ): Promise<DistributedSecureTargetPullRawResponse> {
    return new Promise((resolve, reject) => {
      let request: ClientRequest;
      let settled = false;
      let secureConnected = false;
      let requestFinished = false;
      let responseStarted = false;
      let connectTimer: NodeJS.Timeout | undefined;
      let responseTimer: NodeJS.Timeout | undefined;

      const clearTimers = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (responseTimer) clearTimeout(responseTimer);
      };

      const fail = (error: DistributedSecureTargetPullTransportError) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (request && !request.destroyed) request.destroy();
        reject(error);
      };

      connectTimer = setTimeout(() => {
        fail(new DistributedSecureTargetPullTransportError(
          "connect_timeout",
          "connection establishment timed out",
        ));
      }, plan.connectTimeoutMs);

      try {
        request = https.request(
          plan.url,
          {
            method: plan.method,
            headers: plan.headers,
            ca: [...plan.systemCaCertificates],
            minVersion: plan.minVersion,
            rejectUnauthorized: plan.rejectUnauthorized,
            agent: plan.agent,
            checkServerIdentity: plan.checkServerIdentity,
          },
          (response) => {
            responseStarted = true;
            const chunks: Buffer[] = [];
            let total = 0;
            response.on("data", (chunk: Buffer | string) => {
              if (settled) return;
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              total += buffer.length;
              if (total > plan.maxResponseBytes) {
                response.destroy();
                fail(new DistributedSecureTargetPullTransportError(
                  "response_too_large",
                  "response exceeded configured size bound",
                ));
                return;
              }
              chunks.push(buffer);
            });
            response.on("end", () => {
              if (settled) return;
              settled = true;
              clearTimers();
              resolve({
                statusCode: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks, total),
              });
            });
            response.on("error", () => {
              fail(new DistributedSecureTargetPullTransportError(
                "ambiguous_outcome",
                "response stream failed after controller response began",
              ));
            });
          },
        );
      } catch {
        clearTimers();
        reject(new DistributedSecureTargetPullTransportError(
          "dns_or_connect_failed",
          "HTTPS request could not be created",
        ));
        return;
      }

      request.on("socket", (socket) => {
        const tlsSocket = socket as TLSSocket;
        tlsSocket.once("secureConnect", () => {
          if (settled) return;
          secureConnected = true;
          if (connectTimer) clearTimeout(connectTimer);
          responseTimer = setTimeout(() => {
            fail(new DistributedSecureTargetPullTransportError(
              requestFinished ? "ambiguous_outcome" : "response_timeout",
              "controller response timed out",
            ));
          }, plan.responseTimeoutMs);
        });
      });

      request.once("finish", () => {
        requestFinished = true;
      });

      request.once("error", (error) => {
        if (settled) return;
        const tlsCode = classifyTlsError(error);
        if (tlsCode) {
          fail(new DistributedSecureTargetPullTransportError(
            tlsCode,
            "TLS server authentication failed",
          ));
          return;
        }
        if (responseStarted || (secureConnected && requestFinished)) {
          fail(new DistributedSecureTargetPullTransportError(
            "ambiguous_outcome",
            "request may have reached the controller",
          ));
          return;
        }
        fail(new DistributedSecureTargetPullTransportError(
          "dns_or_connect_failed",
          "connection failed before request delivery was established",
        ));
      });

      request.end();
    });
  }
}

export class DistributedSecureTargetPullClient {
  private readonly transport: DistributedSecureTargetPullRequestTransport;
  private readonly systemCaProvider: () => string[];

  constructor(
    dependencies: DistributedSecureTargetPullClientDependencies = {},
  ) {
    this.transport = dependencies.transport
      ?? new NodeDistributedSecureTargetPullRequestTransport();
    this.systemCaProvider = dependencies.systemCaProvider
      ?? defaultSystemCaProvider;
  }

  async pull(
    input: DistributedSecureTargetPullClientInput,
  ): Promise<DistributedExecutionDeliveryBundleV1 | null> {
    assertPullInputShape(input);
    try {
      assertDistributedSecureTransportProfile(input.profile);
    } catch {
      throw publicError("profile_invalid");
    }
    assertDistributedSecureTargetPullRuntime();
    requireBearer(input.bearerToken);
    requireRequestId(input.requestId);

    let roots: string[];
    try {
      roots = validateSystemCaCertificates(this.systemCaProvider());
    } catch (error) {
      if (error instanceof DistributedSecureTargetPullClientError) throw error;
      throw publicError("system_ca_unavailable");
    }

    const plan = createDistributedSecureTargetPullRequestPlan(input, roots);
    let response: DistributedSecureTargetPullRawResponse;
    try {
      response = await this.transport.request(plan);
    } catch (error) {
      if (error instanceof DistributedSecureTargetPullTransportError) {
        throw publicError(error.code);
      }
      throw publicError("dns_or_connect_failed");
    }
    return validateResponse(response, input.profile.maxResponseBytes);
  }
}
