import crypto from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import type { TLSSocket } from "node:tls";
import { TextDecoder } from "node:util";
import {
  assertDistributedDeliveryAdmissionAcknowledgement,
  type DistributedDeliveryAdmissionAcknowledgementV1,
  type DistributedDeliveryStateRecordV1,
} from "./distributed-delivery-reconciliation.js";
import type { DistributedMachineAuthorizedRequestV1 } from "./distributed-machine-transport.js";
import { DistributedMachineTransportError } from "./distributed-machine-transport.js";
import {
  assertDistributedSecureTransportProfile,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";
import { assertDistributedSecureTargetPullRuntime } from "./distributed-secure-target-pull-client.js";

export const DISTRIBUTED_DELIVERY_ACK_PATH = "/v1/distributed/execution/ack";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER = /^[A-Za-z0-9._~+\/-]+=*$/;
const MAX_BEARER_LENGTH = 4096;
const MAX_ACK_BYTES = 4096;
const PIN_ERROR_CODE = "M12Y_ACK_SERVER_IDENTITY_MISMATCH";

export const DISTRIBUTED_DELIVERY_ACK_TRANSPORT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  fixedPath: DISTRIBUTED_DELIVERY_ACK_PATH,
  requiresM12CBearer: true as const,
  requiredCapability: "report_status" as const,
  bodyIsExistingDurableAcknowledgementOnly: true as const,
  exactMachineRevisionBindingRequired: true as const,
  controllerTransitionOnly: "delivered_unconfirmed_to_admission_acknowledged" as const,
  automaticAckRetryAllowed: false as const,
  explicitIdempotentAckRetryAllowed: true as const,
  workDeliveryRetryAllowed: false as const,
  workRequeueAllowed: false as const,
  usesM12PServerAuthentication: true as const,
  newListenerIncluded: false as const,
  targetRuntimeIncluded: false as const,
  writerExecutionIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedDeliveryAckAuthorizer {
  authorize(
    token: string,
    requestId: string,
    capability: "report_status",
  ): Promise<DistributedMachineAuthorizedRequestV1>;
}

export interface DistributedDeliveryAckStateStore {
  acknowledge(
    deliveryId: string,
    acknowledgement: DistributedDeliveryAdmissionAcknowledgementV1,
  ): Promise<DistributedDeliveryStateRecordV1>;
}

export interface DistributedDeliveryAckRequestV1 {
  method?: string;
  url?: string;
  httpVersion: string;
  rawHeaders: readonly string[];
  body: Buffer;
}

export interface DistributedDeliveryAckResponseV1 {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}

export interface DistributedDeliveryAckRouteOptions {
  controllerOrigin: string;
  authorizer: DistributedDeliveryAckAuthorizer;
  stateStore: DistributedDeliveryAckStateStore;
}

export class DistributedDeliveryAckTransportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "request_invalid"
      | "authentication_rejected"
      | "binding_mismatch"
      | "state_conflict"
      | "state_unavailable"
      | "profile_invalid"
      | "bearer_invalid"
      | "request_id_invalid"
      | "system_ca_unavailable"
      | "tls_validation_failed"
      | "server_identity_mismatch"
      | "connect_failed"
      | "response_timeout"
      | "ambiguous_outcome"
      | "unexpected_status"
      | "response_invalid",
  ) {
    super(message);
    this.name = "DistributedDeliveryAckTransportError";
  }
}

function bodyless(statusCode: number): DistributedDeliveryAckResponseV1 {
  return {
    statusCode,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Length": "0",
    }),
    body: Buffer.alloc(0),
  };
}

function canonicalOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DistributedDeliveryAckTransportError("controller origin is invalid", "profile_invalid");
  }
  if (
    url.protocol !== "https:"
    || url.origin !== value
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || url.username !== ""
    || url.password !== ""
  ) {
    throw new DistributedDeliveryAckTransportError("controller origin is invalid", "profile_invalid");
  }
  return url;
}

function exactHeaders(rawHeaders: readonly string[], expectedHost: string): {
  token: string;
  requestId: string;
} | null {
  if (rawHeaders.length % 2 !== 0) return null;
  const map = new Map<string, string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string" || value.includes("\0")) return null;
    const lower = name.toLowerCase();
    if (map.has(lower)) return null;
    map.set(lower, value);
  }
  const exact = [
    "host", "authorization", "x-cline-request-id", "accept", "accept-encoding",
    "cache-control", "connection", "content-type", "content-encoding", "content-length",
  ];
  if (map.size !== exact.length || exact.some((key) => !map.has(key))) return null;
  if (map.get("host") !== expectedHost) return null;
  if (map.get("accept") !== "application/json") return null;
  if (map.get("accept-encoding") !== "identity") return null;
  if (map.get("cache-control") !== "no-store") return null;
  if (map.get("connection")?.toLowerCase() !== "close") return null;
  if (map.get("content-type")?.toLowerCase() !== "application/json; charset=utf-8") return null;
  if (map.get("content-encoding")?.toLowerCase() !== "identity") return null;
  const length = map.get("content-length");
  if (!length || !/^[1-9]\d*$/.test(length) || Number(length) > MAX_ACK_BYTES) return null;
  const auth = map.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  if (token.length < 32 || token.length > MAX_BEARER_LENGTH || !BEARER.test(token)) return null;
  const requestId = map.get("x-cline-request-id");
  if (!requestId || requestId !== requestId.trim() || !UUID.test(requestId)) return null;
  return { token, requestId };
}

function decodeAck(body: Buffer): DistributedDeliveryAdmissionAcknowledgementV1 | null {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > MAX_ACK_BYTES) return null;
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    parsed = JSON.parse(text);
    assertDistributedDeliveryAdmissionAcknowledgement(parsed);
  } catch {
    return null;
  }
  return structuredClone(parsed);
}

function transportStatus(error: unknown): number {
  if (error instanceof DistributedMachineTransportError) {
    switch (error.code) {
      case "session_not_found":
      case "session_invalid":
      case "session_expired":
      case "session_stale":
      case "registration_not_current":
        return 401;
      case "capability_not_allowed":
        return 403;
      case "request_invalid":
        return 400;
      case "request_replayed":
        return 409;
      case "capacity_exceeded":
        return 503;
    }
  }
  return 500;
}

export class DistributedDeliveryAckRoute {
  private readonly expectedHost: string;

  constructor(private readonly options: DistributedDeliveryAckRouteOptions) {
    this.expectedHost = canonicalOrigin(options.controllerOrigin).host;
  }

  async handle(input: DistributedDeliveryAckRequestV1): Promise<DistributedDeliveryAckResponseV1> {
    if (input.url !== DISTRIBUTED_DELIVERY_ACK_PATH) return bodyless(404);
    if (input.method !== "POST") return bodyless(405);
    if (input.httpVersion !== "1.1") return bodyless(400);
    const headers = exactHeaders(input.rawHeaders, this.expectedHost);
    if (!headers || Number(new Map(
      Array.from({length: input.rawHeaders.length / 2}, (_, i) => [
        input.rawHeaders[i * 2]!.toLowerCase(),
        input.rawHeaders[i * 2 + 1]!,
      ]),
    ).get("content-length")) !== input.body.length) return bodyless(400);
    const acknowledgement = decodeAck(input.body);
    if (!acknowledgement) return bodyless(400);

    let authorized: DistributedMachineAuthorizedRequestV1;
    try {
      authorized = await this.options.authorizer.authorize(
        headers.token,
        headers.requestId,
        "report_status",
      );
    } catch (error) {
      return bodyless(transportStatus(error));
    }
    if (
      authorized.requestId !== headers.requestId
      || authorized.capability !== "report_status"
      || authorized.machineId !== acknowledgement.machineId
      || authorized.registrationId !== acknowledgement.machineRegistrationId
      || authorized.registrationRevision !== acknowledgement.machineRegistrationRevision
    ) {
      return bodyless(403);
    }

    try {
      const reconciled = await this.options.stateStore.acknowledge(
        acknowledgement.deliveryId,
        acknowledgement,
      );
      if (
        reconciled.state !== "admission_acknowledged"
        || JSON.stringify(reconciled.acknowledgement) !== JSON.stringify(acknowledgement)
      ) {
        return bodyless(500);
      }
      return bodyless(204);
    } catch (error) {
      const code = (error as { code?: unknown } | undefined)?.code;
      if (code === "binding_mismatch" || code === "state_conflict") return bodyless(409);
      if (code === "state_not_found") return bodyless(404);
      return bodyless(500);
    }
  }
}

export interface DistributedDeliveryAckClientInput {
  profile: DistributedSecureTransportProfileV1;
  bearerToken: string;
  requestId: string;
  acknowledgement: DistributedDeliveryAdmissionAcknowledgementV1;
}

export interface DistributedDeliveryAckRequestPlan {
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

export interface DistributedDeliveryAckRawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface DistributedDeliveryAckClientTransport {
  post(plan: DistributedDeliveryAckRequestPlan): Promise<DistributedDeliveryAckRawResponse>;
}

function systemRoots(): string[] {
  assertDistributedSecureTargetPullRuntime();
  const getCACertificates = (
    tls as typeof tls & { getCACertificates(type?: "system"): string[] }
  ).getCACertificates;
  const roots = getCACertificates("system");
  if (!Array.isArray(roots) || roots.length < 1) {
    throw new DistributedDeliveryAckTransportError("system CA roots unavailable", "system_ca_unavailable");
  }
  for (const root of roots) {
    if (typeof root !== "string" || !root.includes("-----BEGIN CERTIFICATE-----")) {
      throw new DistributedDeliveryAckTransportError("system CA roots unavailable", "system_ca_unavailable");
    }
  }
  return roots;
}

function pinnedIdentity(pins: readonly string[]): typeof tls.checkServerIdentity {
  const expected = new Set(pins);
  return (hostname, cert) => {
    const hostnameError = tls.checkServerIdentity(hostname, cert);
    if (hostnameError) {
      const error = new Error("TLS hostname verification failed") as Error & { code?: string };
      error.code = "M12Y_ACK_TLS_HOSTNAME_MISMATCH";
      return error;
    }
    if (!Buffer.isBuffer(cert.pubkey) || cert.pubkey.length === 0) {
      const error = new Error("TLS public key unavailable") as Error & { code?: string };
      error.code = PIN_ERROR_CODE;
      return error;
    }
    const pin = `sha256/${crypto.createHash("sha256").update(cert.pubkey).digest("base64")}`;
    if (!expected.has(pin)) {
      const error = new Error("TLS SPKI pin mismatch") as Error & { code?: string };
      error.code = PIN_ERROR_CODE;
      return error;
    }
    return undefined;
  };
}

export function createDistributedDeliveryAckRequestPlan(
  input: DistributedDeliveryAckClientInput,
  roots: readonly string[],
): DistributedDeliveryAckRequestPlan {
  try {
    assertDistributedSecureTransportProfile(input.profile);
    assertDistributedDeliveryAdmissionAcknowledgement(input.acknowledgement);
  } catch {
    throw new DistributedDeliveryAckTransportError("ACK request input is invalid", "profile_invalid");
  }
  if (
    typeof input.bearerToken !== "string"
    || input.bearerToken.length < 32
    || input.bearerToken.length > MAX_BEARER_LENGTH
    || !BEARER.test(input.bearerToken)
  ) {
    throw new DistributedDeliveryAckTransportError("ACK bearer is invalid", "bearer_invalid");
  }
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
    throw new DistributedDeliveryAckTransportError("ACK request id is invalid", "request_id_invalid");
  }
  const url = new URL(DISTRIBUTED_DELIVERY_ACK_PATH, input.profile.controllerOrigin);
  const body = Buffer.from(JSON.stringify(input.acknowledgement), "utf8");
  if (body.length < 1 || body.length > MAX_ACK_BYTES) {
    throw new DistributedDeliveryAckTransportError("ACK body is invalid", "request_invalid");
  }
  return {
    url,
    method: "POST",
    headers: Object.freeze({
      Host: url.host,
      Authorization: `Bearer ${input.bearerToken}`,
      "X-Cline-Request-Id": input.requestId,
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
    connectTimeoutMs: input.profile.connectTimeoutMs,
    responseTimeoutMs: input.profile.connectTimeoutMs,
    maxResponseBytes: 1024,
    checkServerIdentity: pinnedIdentity(input.profile.serverSpkiSha256Pins),
  };
}

function classifyTls(error: unknown): DistributedDeliveryAckTransportError["code"] | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === PIN_ERROR_CODE) return "server_identity_mismatch";
  if (
    code === "M12Y_ACK_TLS_HOSTNAME_MISMATCH"
    || code === "ERR_TLS_CERT_ALTNAME_INVALID"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "CERT_HAS_EXPIRED"
  ) return "tls_validation_failed";
  return undefined;
}

export class NodeDistributedDeliveryAckClientTransport implements DistributedDeliveryAckClientTransport {
  async post(plan: DistributedDeliveryAckRequestPlan): Promise<DistributedDeliveryAckRawResponse> {
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
      const fail = (code: DistributedDeliveryAckTransportError["code"]) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (request && !request.destroyed) request.destroy();
        reject(new DistributedDeliveryAckTransportError("ACK network transport failed", code));
      };
      connectTimer = setTimeout(() => fail("connect_failed"), plan.connectTimeoutMs);
      try {
        request = https.request(plan.url, {
          method: plan.method,
          headers: plan.headers,
          ca: [...plan.systemCaCertificates],
          minVersion: plan.minVersion,
          rejectUnauthorized: plan.rejectUnauthorized,
          agent: plan.agent,
          checkServerIdentity: plan.checkServerIdentity,
        }, (response) => {
          responseStarted = true;
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > plan.maxResponseBytes) {
              response.destroy();
              fail("response_invalid");
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
        });
      } catch {
        clearTimers();
        reject(new DistributedDeliveryAckTransportError("ACK request creation failed", "connect_failed"));
        return;
      }
      request.on("socket", (socket) => {
        const tlsSocket = socket as TLSSocket;
        tlsSocket.once("secureConnect", () => {
          secureConnected = true;
          if (connectTimer) clearTimeout(connectTimer);
          responseTimer = setTimeout(
            () => fail(requestFinished ? "ambiguous_outcome" : "response_timeout"),
            plan.responseTimeoutMs,
          );
        });
      });
      request.once("finish", () => { requestFinished = true; });
      request.once("error", (error) => {
        const tlsCode = classifyTls(error);
        if (tlsCode) return fail(tlsCode);
        if (responseStarted || (secureConnected && requestFinished)) return fail("ambiguous_outcome");
        fail("connect_failed");
      });
      request.end(plan.body);
    });
  }
}

export class DistributedDeliveryAckClient {
  constructor(
    private readonly transport: DistributedDeliveryAckClientTransport = new NodeDistributedDeliveryAckClientTransport(),
    private readonly systemCaProvider: () => string[] = systemRoots,
  ) {}

  async upload(input: DistributedDeliveryAckClientInput): Promise<void> {
    let roots: string[];
    try {
      roots = this.systemCaProvider();
    } catch (error) {
      if (error instanceof DistributedDeliveryAckTransportError) throw error;
      throw new DistributedDeliveryAckTransportError("system CA roots unavailable", "system_ca_unavailable");
    }
    const plan = createDistributedDeliveryAckRequestPlan(input, roots);
    let response: DistributedDeliveryAckRawResponse;
    try {
      response = await this.transport.post(plan);
    } catch (error) {
      if (error instanceof DistributedDeliveryAckTransportError) throw error;
      throw new DistributedDeliveryAckTransportError("ACK transport failed", "connect_failed");
    }
    if (response.statusCode === 204) {
      if (response.body.length !== 0) {
        throw new DistributedDeliveryAckTransportError("ACK response must be empty", "response_invalid");
      }
      return;
    }
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new DistributedDeliveryAckTransportError("ACK authentication rejected", "authentication_rejected");
    }
    if (response.statusCode === 404 || response.statusCode === 409) {
      throw new DistributedDeliveryAckTransportError("ACK controller state conflicted", "state_conflict");
    }
    throw new DistributedDeliveryAckTransportError("ACK controller returned unexpected status", "unexpected_status");
  }
}
