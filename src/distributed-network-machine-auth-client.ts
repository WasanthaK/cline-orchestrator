import crypto from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import type { TLSSocket } from "node:tls";
import { TextDecoder } from "node:util";
import {
  assertDistributedMachineAuthenticationChallenge,
  distributedMachineAuthenticationChallengePayload,
  type DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import type { DistributedMachineCapabilityV1 } from "./distributed-control-contract.js";
import {
  assertDistributedMachineTransportSessionClaims,
  DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT,
  type DistributedMachineTransportIssueResultV1,
} from "./distributed-machine-transport.js";
import {
  assertDistributedSecureTransportProfile,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";
import { assertDistributedSecureTargetPullRuntime } from "./distributed-secure-target-pull-client.js";

const CHALLENGE_PATH = "/v1/distributed/auth/challenge";
const SESSION_PATH = "/v1/distributed/auth/session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BEARER = /^[A-Za-z0-9._~+\/-]+=*$/;
const MAX_CHALLENGE_RESPONSE = 4096;
const MAX_SESSION_RESPONSE = 8192;
const PIN_ERROR_CODE = "M12U_SERVER_IDENTITY_MISMATCH";
const MACHINE_CAPABILITIES = new Set<DistributedMachineCapabilityV1>([
  "accept_writer_candidates",
  "report_status",
]);

export const DISTRIBUTED_NETWORK_MACHINE_AUTH_CLIENT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  usesM12PServerAuthentication: true as const,
  fixedChallengePath: CHALLENGE_PATH,
  fixedSessionPath: SESSION_PATH,
  privateKeyAccepted: false as const,
  signerOnlyPrivateKeyBoundary: true as const,
  validatesChallengeBeforeSigner: true as const,
  usesExistingM12QChallengePayload: true as const,
  automaticChallengeRetryAllowed: false as const,
  automaticCompletionRetryAllowed: false as const,
  tokenPersistenceIncluded: false as const,
  startsM12SPolling: false as const,
  redirectsAllowed: false as const,
  environmentProxyAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedMachineBootstrapSigner {
  publicKeyFingerprint: string;
  sign(payload: Buffer): Promise<Buffer>;
}

export interface DistributedNetworkMachineAuthClientInput {
  profile: DistributedSecureTransportProfileV1;
  registrationId: string;
  capabilities: DistributedMachineCapabilityV1[];
  sessionTtlMs: number;
  signer: DistributedMachineBootstrapSigner;
}

export interface DistributedNetworkMachineAuthRawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface DistributedNetworkMachineAuthRequestPlan {
  url: URL;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  systemCaCertificates: readonly string[];
  minVersion: "TLSv1.2";
  rejectUnauthorized: true;
  agent: false;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  maxResponseBytes: number;
  checkServerIdentity: typeof tls.checkServerIdentity;
}

export interface DistributedNetworkMachineAuthClientTransport {
  post(
    plan: DistributedNetworkMachineAuthRequestPlan,
  ): Promise<DistributedNetworkMachineAuthRawResponse>;
}

export interface DistributedNetworkMachineAuthClientDependencies {
  transport?: DistributedNetworkMachineAuthClientTransport;
  systemCaProvider?: () => string[];
  requestIdFactory?: () => string;
}

export class DistributedNetworkMachineAuthClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "profile_invalid"
      | "request_invalid"
      | "signer_invalid"
      | "unsupported_runtime"
      | "system_ca_unavailable"
      | "transport_failed"
      | "tls_validation_failed"
      | "server_identity_mismatch"
      | "connect_timeout"
      | "response_timeout"
      | "response_too_large"
      | "ambiguous_outcome"
      | "unexpected_status"
      | "response_invalid"
      | "challenge_mismatch"
      | "signature_invalid"
      | "session_mismatch",
  ) {
    super(message);
    this.name = "DistributedNetworkMachineAuthClientError";
  }
}

export class DistributedNetworkMachineAuthTransportError extends Error {
  constructor(
    public readonly code:
      | "transport_failed"
      | "tls_validation_failed"
      | "server_identity_mismatch"
      | "connect_timeout"
      | "response_timeout"
      | "response_too_large"
      | "ambiguous_outcome",
  ) {
    super("network machine-auth transport failed");
    this.name = "DistributedNetworkMachineAuthTransportError";
  }
}

function clientError(
  code: DistributedNetworkMachineAuthClientError["code"],
): DistributedNetworkMachineAuthClientError {
  return new DistributedNetworkMachineAuthClientError(
    `network machine-auth bootstrap failed: ${code}`,
    code,
  );
}

function exactInput(value: unknown): asserts value is DistributedNetworkMachineAuthClientInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("request_invalid");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const expected = ["profile", "registrationId", "capabilities", "sessionTtlMs", "signer"];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw clientError("request_invalid");
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw clientError("request_invalid");
  }
  return value;
}

function requireCapabilities(value: unknown): DistributedMachineCapabilityV1[] {
  if (!Array.isArray(value) || value.length < 1) throw clientError("request_invalid");
  const result: DistributedMachineCapabilityV1[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !MACHINE_CAPABILITIES.has(item as DistributedMachineCapabilityV1)) {
      throw clientError("request_invalid");
    }
    result.push(item as DistributedMachineCapabilityV1);
  }
  if (new Set(result).size !== result.length) throw clientError("request_invalid");
  const sorted = [...result].sort();
  if (sorted.some((item, index) => item !== result[index])) throw clientError("request_invalid");
  return result;
}

function requireSessionTtl(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.minSessionTtlMs
    || value > DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.maxSessionTtlMs
  ) {
    throw clientError("request_invalid");
  }
  return value;
}

function requireFingerprint(value: unknown): string {
  if (typeof value !== "string" || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw clientError("signer_invalid");
  }
  const encoded = value.slice("sha256/".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== encoded) {
    throw clientError("signer_invalid");
  }
  return value;
}

function validateSigner(value: unknown): DistributedMachineBootstrapSigner {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("signer_invalid");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (
    keys.length !== 2
    || !keys.includes("publicKeyFingerprint")
    || !keys.includes("sign")
    || typeof (value as DistributedMachineBootstrapSigner).sign !== "function"
  ) {
    throw clientError("signer_invalid");
  }
  requireFingerprint((value as DistributedMachineBootstrapSigner).publicKeyFingerprint);
  return value as DistributedMachineBootstrapSigner;
}

function validateSystemRoots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw clientError("system_ca_unavailable");
  const roots: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string"
      || !item.includes("-----BEGIN CERTIFICATE-----")
      || !item.includes("-----END CERTIFICATE-----")
    ) {
      throw clientError("system_ca_unavailable");
    }
    roots.push(item);
  }
  return roots;
}

function defaultSystemCaProvider(): string[] {
  try {
    assertDistributedSecureTargetPullRuntime();
  } catch {
    throw clientError("unsupported_runtime");
  }
  const getCACertificates = (
    tls as typeof tls & { getCACertificates(type?: "system"): string[] }
  ).getCACertificates;
  try {
    return validateSystemRoots(getCACertificates("system"));
  } catch (error) {
    if (error instanceof DistributedNetworkMachineAuthClientError) throw error;
    throw clientError("system_ca_unavailable");
  }
}

function pinnedServerIdentity(
  pins: readonly string[],
): typeof tls.checkServerIdentity {
  const expected = new Set(pins);
  return (hostname, cert) => {
    const hostnameError = tls.checkServerIdentity(hostname, cert);
    if (hostnameError) {
      const error = new Error("TLS hostname verification failed") as Error & { code?: string };
      error.code = "M12U_TLS_HOSTNAME_MISMATCH";
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

function requestPlan(
  profile: DistributedSecureTransportProfileV1,
  path: string,
  requestId: string,
  body: Buffer,
  roots: readonly string[],
  maxResponseBytes: number,
): DistributedNetworkMachineAuthRequestPlan {
  const url = new URL(path, profile.controllerOrigin);
  if (
    url.origin !== profile.controllerOrigin
    || url.protocol !== "https:"
    || url.pathname !== path
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw clientError("profile_invalid");
  }
  return {
    url,
    method: "POST",
    headers: Object.freeze({
      Host: url.host,
      "X-Cline-Request-Id": requestId,
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "identity",
      "Content-Length": String(body.length),
    }),
    body,
    systemCaCertificates: [...roots],
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    agent: false,
    connectTimeoutMs: profile.connectTimeoutMs,
    responseTimeoutMs: profile.connectTimeoutMs,
    maxResponseBytes,
    checkServerIdentity: pinnedServerIdentity(profile.serverSpkiSha256Pins),
  };
}

function responseHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw clientError("response_invalid");
  return value;
}

function validateJsonResponse(
  response: DistributedNetworkMachineAuthRawResponse,
  maxBytes: number,
): unknown {
  if (response.statusCode !== 200) throw clientError("unexpected_status");
  if (!Buffer.isBuffer(response.body) || response.body.length < 1 || response.body.length > maxBytes) {
    throw clientError("response_invalid");
  }
  const contentType = responseHeader(response.headers, "content-type");
  if (contentType?.toLowerCase() !== "application/json; charset=utf-8") {
    throw clientError("response_invalid");
  }
  const contentEncoding = responseHeader(response.headers, "content-encoding");
  if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
    throw clientError("response_invalid");
  }
  const contentLength = responseHeader(response.headers, "content-length");
  if (
    contentLength === undefined
    || !/^[1-9]\d*$/.test(contentLength)
    || Number(contentLength) !== response.body.length
  ) {
    throw clientError("response_invalid");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch {
    throw clientError("response_invalid");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw clientError("response_invalid");
  }
}

function validateChallengeResponse(
  response: DistributedNetworkMachineAuthRawResponse,
  registrationId: string,
  capabilities: readonly DistributedMachineCapabilityV1[],
  sessionTtlMs: number,
  fingerprint: string,
): DistributedMachineAuthenticationChallengeV1 {
  const parsed = validateJsonResponse(response, MAX_CHALLENGE_RESPONSE);
  try {
    assertDistributedMachineAuthenticationChallenge(parsed);
  } catch {
    throw clientError("response_invalid");
  }
  if (
    parsed.registrationId !== registrationId
    || parsed.sessionTtlMs !== sessionTtlMs
    || parsed.publicKeyFingerprint !== fingerprint
    || parsed.capabilities.length !== capabilities.length
    || parsed.capabilities.some((value, index) => value !== capabilities[index])
  ) {
    throw clientError("challenge_mismatch");
  }
  return structuredClone(parsed);
}

function exactIssueResult(
  value: unknown,
  registrationId: string,
  capabilities: readonly DistributedMachineCapabilityV1[],
): DistributedMachineTransportIssueResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("response_invalid");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3
    || !keys.includes("schemaVersion")
    || !keys.includes("token")
    || !keys.includes("claims")
    || record.schemaVersion !== 1
    || typeof record.token !== "string"
    || record.token.length < 32
    || record.token.length > 4096
    || !BEARER.test(record.token)
  ) {
    throw clientError("response_invalid");
  }
  try {
    assertDistributedMachineTransportSessionClaims(record.claims);
  } catch {
    throw clientError("response_invalid");
  }
  const claims = record.claims;
  if (
    claims.registrationId !== registrationId
    || claims.capabilities.length !== capabilities.length
    || claims.capabilities.some((value, index) => value !== capabilities[index])
  ) {
    throw clientError("session_mismatch");
  }
  return {
    schemaVersion: 1,
    token: record.token,
    claims: structuredClone(claims),
  };
}

function transportFailure(error: unknown): never {
  if (error instanceof DistributedNetworkMachineAuthTransportError) {
    throw clientError(error.code);
  }
  throw clientError("transport_failed");
}

function classifyTlsError(error: unknown): DistributedNetworkMachineAuthTransportError["code"] | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === PIN_ERROR_CODE) return "server_identity_mismatch";
  if (
    code === "M12U_TLS_HOSTNAME_MISMATCH"
    || code === "ERR_TLS_CERT_ALTNAME_INVALID"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "UNABLE_TO_GET_ISSUER_CERT"
    || code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "CERT_HAS_EXPIRED"
    || code === "CERT_NOT_YET_VALID"
  ) {
    return "tls_validation_failed";
  }
  return undefined;
}

export class NodeDistributedNetworkMachineAuthClientTransport
implements DistributedNetworkMachineAuthClientTransport {
  async post(
    plan: DistributedNetworkMachineAuthRequestPlan,
  ): Promise<DistributedNetworkMachineAuthRawResponse> {
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
      const fail = (code: DistributedNetworkMachineAuthTransportError["code"]) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (request && !request.destroyed) request.destroy();
        reject(new DistributedNetworkMachineAuthTransportError(code));
      };

      connectTimer = setTimeout(() => fail("connect_timeout"), plan.connectTimeoutMs);

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
                fail("response_too_large");
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
            response.on("error", () => fail("ambiguous_outcome"));
          },
        );
      } catch {
        clearTimers();
        reject(new DistributedNetworkMachineAuthTransportError("transport_failed"));
        return;
      }

      request.on("socket", (socket) => {
        const tlsSocket = socket as TLSSocket;
        tlsSocket.once("secureConnect", () => {
          if (settled) return;
          secureConnected = true;
          if (connectTimer) clearTimeout(connectTimer);
          responseTimer = setTimeout(() => {
            fail(requestFinished ? "ambiguous_outcome" : "response_timeout");
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
          fail(tlsCode);
          return;
        }
        if (responseStarted || (secureConnected && requestFinished)) {
          fail("ambiguous_outcome");
          return;
        }
        fail("transport_failed");
      });

      request.end(plan.body);
    });
  }
}

export class DistributedNetworkMachineAuthClient {
  private readonly transport: DistributedNetworkMachineAuthClientTransport;
  private readonly systemCaProvider: () => string[];
  private readonly requestIdFactory: () => string;

  constructor(
    dependencies: DistributedNetworkMachineAuthClientDependencies = {},
  ) {
    this.transport = dependencies.transport ?? new NodeDistributedNetworkMachineAuthClientTransport();
    this.systemCaProvider = dependencies.systemCaProvider ?? defaultSystemCaProvider;
    this.requestIdFactory = dependencies.requestIdFactory ?? (() => crypto.randomUUID());
  }

  async bootstrapSession(
    input: DistributedNetworkMachineAuthClientInput,
  ): Promise<DistributedMachineTransportIssueResultV1> {
    exactInput(input);
    try {
      assertDistributedSecureTransportProfile(input.profile);
    } catch {
      throw clientError("profile_invalid");
    }
    try {
      assertDistributedSecureTargetPullRuntime();
    } catch {
      throw clientError("unsupported_runtime");
    }

    const registrationId = requireUuid(input.registrationId);
    const capabilities = requireCapabilities(input.capabilities);
    const sessionTtlMs = requireSessionTtl(input.sessionTtlMs);
    const signer = validateSigner(input.signer);
    const fingerprint = requireFingerprint(signer.publicKeyFingerprint);
    let roots: string[];
    try {
      roots = validateSystemRoots(this.systemCaProvider());
    } catch (error) {
      if (
        error instanceof DistributedNetworkMachineAuthClientError
        && (error.code === "system_ca_unavailable" || error.code === "unsupported_runtime")
      ) {
        throw error;
      }
      throw clientError("system_ca_unavailable");
    }

    const challengeRequestId = requireUuid(this.requestIdFactory());
    const challengeBody = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      registrationId,
      capabilities,
      sessionTtlMs,
    }), "utf8");
    const challengePlan = requestPlan(
      input.profile,
      CHALLENGE_PATH,
      challengeRequestId,
      challengeBody,
      roots,
      MAX_CHALLENGE_RESPONSE,
    );

    let challengeResponse: DistributedNetworkMachineAuthRawResponse;
    try {
      challengeResponse = await this.transport.post(challengePlan);
    } catch (error) {
      transportFailure(error);
    }
    const challenge = validateChallengeResponse(
      challengeResponse!,
      registrationId,
      capabilities,
      sessionTtlMs,
      fingerprint,
    );

    const payload = distributedMachineAuthenticationChallengePayload(challenge);
    let signature: Buffer;
    try {
      signature = await signer.sign(Buffer.from(payload));
    } catch {
      throw clientError("signature_invalid");
    }
    if (
      !Buffer.isBuffer(signature)
      || signature.length !== 64
    ) {
      throw clientError("signature_invalid");
    }
    const signatureBase64Url = signature.toString("base64url");
    if (!BASE64URL.test(signatureBase64Url)) throw clientError("signature_invalid");

    const sessionRequestId = requireUuid(this.requestIdFactory());
    const sessionBody = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      challengeId: challenge.challengeId,
      signatureBase64Url,
    }), "utf8");
    const sessionPlan = requestPlan(
      input.profile,
      SESSION_PATH,
      sessionRequestId,
      sessionBody,
      roots,
      MAX_SESSION_RESPONSE,
    );

    let sessionResponse: DistributedNetworkMachineAuthRawResponse;
    try {
      sessionResponse = await this.transport.post(sessionPlan);
    } catch (error) {
      transportFailure(error);
    }
    const parsed = validateJsonResponse(sessionResponse!, MAX_SESSION_RESPONSE);
    return exactIssueResult(parsed, registrationId, capabilities);
  }
}
