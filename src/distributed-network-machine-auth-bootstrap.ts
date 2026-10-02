import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import {
  assertDistributedMachineAuthenticationChallenge,
  DistributedMachineAuthenticationBootstrapError,
  type DistributedMachineAuthenticationChallengeRequestV1,
  type DistributedMachineAuthenticationChallengeResponseV1,
  type DistributedMachineAuthenticationChallengeV1,
} from "./distributed-machine-auth-bootstrap.js";
import type { DistributedMachineCapabilityV1 } from "./distributed-control-contract.js";
import {
  assertDistributedMachineTransportSessionClaims,
  DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT,
  DistributedMachineTransportError,
  type DistributedMachineTransportIssueResultV1,
} from "./distributed-machine-transport.js";

const CHALLENGE_PATH = "/v1/distributed/auth/challenge";
const SESSION_PATH = "/v1/distributed/auth/session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BEARER = /^[A-Za-z0-9._~+\/-]+=*$/;
const CHALLENGE_BODY_MAX = 1024;
const SESSION_BODY_MAX = 512;
const CHALLENGE_RESPONSE_MAX = 4096;
const SESSION_RESPONSE_MAX = 8192;
const DEFAULT_CONCURRENCY = 16;
const HARD_MAX_CONCURRENCY = 32;
const DEFAULT_PEER_ISSUE_LIMIT = 12;
const DEFAULT_REGISTRATION_ISSUE_LIMIT = 4;
const DEFAULT_PEER_COMPLETION_LIMIT = 24;
const HARD_MAX_PEER_ISSUE_LIMIT = 120;
const HARD_MAX_REGISTRATION_ISSUE_LIMIT = 30;
const HARD_MAX_PEER_COMPLETION_LIMIT = 240;
const RATE_WINDOW_MS = 60_000;
const MACHINE_CAPABILITIES = new Set<DistributedMachineCapabilityV1>([
  "accept_writer_candidates",
  "report_status",
]);

const REQUIRED_HEADERS = Object.freeze([
  "host",
  "x-cline-request-id",
  "accept",
  "accept-encoding",
  "cache-control",
  "connection",
  "content-type",
  "content-encoding",
  "content-length",
] as const);

export const DISTRIBUTED_NETWORK_MACHINE_AUTH_BOOTSTRAP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  routes: Object.freeze([CHALLENGE_PATH, SESSION_PATH] as const),
  protocol: "https_http_1_1" as const,
  sharesCanonicalControllerOriginWithM12T: true as const,
  registrationIdIsCredential: false as const,
  requiresExistingMachineRegistration: true as const,
  requiresExistingEd25519Binding: true as const,
  privateKeyAcceptedByAdapter: false as const,
  privateKeyProvisioningIncluded: false as const,
  delegatesChallengeToM12Q: true as const,
  delegatesCompletionToM12Q: true as const,
  exposesM12CIssueDirectly: false as const,
  challengeRequestIdempotentUntilExpiry: true as const,
  oneActiveChallengePerRegistration: true as const,
  completionReplayAllowed: false as const,
  automaticCompletionRetryAllowed: false as const,
  networkedEnrollmentIncluded: false as const,
  automaticListen: false as const,
  tlsIdentityProvisioningIncluded: false as const,
  controllerPushEnabled: false as const,
  invokesTargetRuntime: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedNetworkMachineAuthBootstrap {
  issueChallenge(
    request: DistributedMachineAuthenticationChallengeRequestV1,
  ): Promise<DistributedMachineAuthenticationChallengeV1>;
  completeChallenge(
    response: DistributedMachineAuthenticationChallengeResponseV1,
  ): Promise<DistributedMachineTransportIssueResultV1>;
}

export interface DistributedNetworkMachineAuthRequestV1 {
  method?: string;
  url?: string;
  httpVersion: string;
  rawHeaders: readonly string[];
  body: Buffer;
  peerAddress: string;
}

export interface DistributedNetworkMachineAuthResponseV1 {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}

export interface DistributedNetworkMachineAuthRouteOptions {
  controllerOrigin: string;
  bootstrap: DistributedNetworkMachineAuthBootstrap;
  now?: () => Date;
  maxConcurrent?: number;
  peerIssueLimitPerMinute?: number;
  registrationIssueLimitPerMinute?: number;
  peerCompletionLimitPerMinute?: number;
}

interface ChallengeWireRequest {
  schemaVersion: 1;
  registrationId: string;
  capabilities: DistributedMachineCapabilityV1[];
  sessionTtlMs: number;
}

interface SessionWireRequest {
  schemaVersion: 1;
  challengeId: string;
  signatureBase64Url: string;
}

interface CachedChallenge {
  requestDigest: string;
  registrationId: string;
  challenge: DistributedMachineAuthenticationChallengeV1;
}

interface ActiveChallenge {
  requestId: string;
  challengeId: string;
  expiresAt: string;
}

export class DistributedNetworkMachineAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "configuration_invalid",
  ) {
    super(message);
    this.name = "DistributedNetworkMachineAuthError";
  }
}

function bodyless(
  statusCode: number,
  extra: Record<string, string> = {},
): DistributedNetworkMachineAuthResponseV1 {
  return {
    statusCode,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Length": "0",
      ...extra,
    }),
    body: Buffer.alloc(0),
  };
}

function jsonResponse(
  value: unknown,
  maxBytes: number,
): DistributedNetworkMachineAuthResponseV1 {
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    return bodyless(500);
  }
  if (body.length > maxBytes) return bodyless(500);
  return {
    statusCode: 200,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Connection: "close",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "identity",
      "Content-Length": String(body.length),
      "X-Content-Type-Options": "nosniff",
    }),
    body,
  };
}

function canonicalOrigin(value: unknown): URL {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new DistributedNetworkMachineAuthError(
      "controllerOrigin must be canonical HTTPS origin",
      "configuration_invalid",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DistributedNetworkMachineAuthError(
      "controllerOrigin must be canonical HTTPS origin",
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
    throw new DistributedNetworkMachineAuthError(
      "controllerOrigin must be origin-only HTTPS",
      "configuration_invalid",
    );
  }
  return parsed;
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
    throw new DistributedNetworkMachineAuthError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) return null;
  return value;
}

function canonicalCapabilities(value: unknown): DistributedMachineCapabilityV1[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const result: DistributedMachineCapabilityV1[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !MACHINE_CAPABILITIES.has(item as DistributedMachineCapabilityV1)) {
      return null;
    }
    result.push(item as DistributedMachineCapabilityV1);
  }
  if (new Set(result).size !== result.length) return null;
  const sorted = [...result].sort();
  if (sorted.some((item, index) => item !== result[index])) return null;
  return result;
}

function parseRawHeaders(
  rawHeaders: readonly string[],
  expectedAuthority: string,
  bodyLength: number,
): { requestId: string } | null {
  if (rawHeaders.length % 2 !== 0) return null;
  const headers = new Map<string, string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const nameRaw = rawHeaders[i];
    const valueRaw = rawHeaders[i + 1];
    if (
      typeof nameRaw !== "string"
      || typeof valueRaw !== "string"
      || nameRaw.length === 0
      || valueRaw.includes("\0")
    ) {
      return null;
    }
    const name = nameRaw.toLowerCase();
    if (!REQUIRED_HEADERS.includes(name as typeof REQUIRED_HEADERS[number])) return null;
    if (headers.has(name)) return null;
    headers.set(name, valueRaw);
  }
  if (headers.size !== REQUIRED_HEADERS.length) return null;
  if (headers.get("host") !== expectedAuthority) return null;
  if (headers.get("accept") !== "application/json") return null;
  if (headers.get("accept-encoding") !== "identity") return null;
  if (headers.get("cache-control") !== "no-store") return null;
  if (headers.get("connection")?.toLowerCase() !== "close") return null;
  if (headers.get("content-type")?.toLowerCase() !== "application/json; charset=utf-8") return null;
  if (headers.get("content-encoding")?.toLowerCase() !== "identity") return null;
  const contentLength = headers.get("content-length");
  if (contentLength === undefined || !/^[1-9]\d*$/.test(contentLength)) return null;
  if (Number(contentLength) !== bodyLength) return null;
  const requestId = canonicalUuid(headers.get("x-cline-request-id"));
  if (requestId === null) return null;
  return { requestId };
}

function decodeJson(body: Buffer, maxBytes: number): unknown | null {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > maxBytes) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseChallengeBody(body: Buffer): ChallengeWireRequest | null {
  const parsed = decodeJson(body, CHALLENGE_BODY_MAX);
  if (!exactObject(parsed, ["schemaVersion", "registrationId", "capabilities", "sessionTtlMs"])) {
    return null;
  }
  const registrationId = canonicalUuid(parsed.registrationId);
  const capabilities = canonicalCapabilities(parsed.capabilities);
  if (
    parsed.schemaVersion !== 1
    || registrationId === null
    || capabilities === null
    || typeof parsed.sessionTtlMs !== "number"
    || !Number.isSafeInteger(parsed.sessionTtlMs)
    || parsed.sessionTtlMs < DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.minSessionTtlMs
    || parsed.sessionTtlMs > DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.maxSessionTtlMs
  ) {
    return null;
  }
  const result: ChallengeWireRequest = {
    schemaVersion: 1,
    registrationId,
    capabilities,
    sessionTtlMs: parsed.sessionTtlMs,
  };
  const canonical = Buffer.from(JSON.stringify(result), "utf8");
  if (!canonical.equals(body)) return null;
  return result;
}

function parseSessionBody(body: Buffer): SessionWireRequest | null {
  const parsed = decodeJson(body, SESSION_BODY_MAX);
  if (!exactObject(parsed, ["schemaVersion", "challengeId", "signatureBase64Url"])) {
    return null;
  }
  const challengeId = canonicalUuid(parsed.challengeId);
  if (
    parsed.schemaVersion !== 1
    || challengeId === null
    || typeof parsed.signatureBase64Url !== "string"
    || !BASE64URL.test(parsed.signatureBase64Url)
  ) {
    return null;
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(parsed.signatureBase64Url, "base64url");
  } catch {
    return null;
  }
  if (
    signature.length !== 64
    || signature.toString("base64url") !== parsed.signatureBase64Url
  ) {
    return null;
  }
  const result: SessionWireRequest = {
    schemaVersion: 1,
    challengeId,
    signatureBase64Url: parsed.signatureBase64Url,
  };
  const canonical = Buffer.from(JSON.stringify(result), "utf8");
  if (!canonical.equals(body)) return null;
  return result;
}

function digest(body: Buffer): string {
  return crypto.createHash("sha256").update(body).digest("base64url");
}

function issueResultValid(value: unknown): value is DistributedMachineTransportIssueResultV1 {
  if (!exactObject(value, ["schemaVersion", "token", "claims"])) return false;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || typeof record.token !== "string"
    || record.token.length < 32
    || record.token.length > 4096
    || !BEARER.test(record.token)
  ) {
    return false;
  }
  try {
    assertDistributedMachineTransportSessionClaims(record.claims);
    return true;
  } catch {
    return false;
  }
}

function machineTransportCause(
  error: unknown,
  depth = 0,
): DistributedMachineTransportError | undefined {
  if (depth > 4) return undefined;
  if (error instanceof DistributedMachineTransportError) return error;
  if (error instanceof Error && "cause" in error) {
    return machineTransportCause(error.cause, depth + 1);
  }
  return undefined;
}

function issueErrorResponse(error: unknown): DistributedNetworkMachineAuthResponseV1 {
  if (!(error instanceof DistributedMachineAuthenticationBootstrapError)) return bodyless(500);
  switch (error.code) {
    case "registration_not_current":
    case "binding_invalid":
    case "binding_not_current":
    case "capability_not_allowed":
      return bodyless(404);
    case "request_invalid":
      return bodyless(400);
    case "capacity_exceeded":
      return bodyless(503);
    default:
      return bodyless(500);
  }
}

function completionErrorResponse(error: unknown): DistributedNetworkMachineAuthResponseV1 {
  if (!(error instanceof DistributedMachineAuthenticationBootstrapError)) return bodyless(500);
  switch (error.code) {
    case "challenge_not_found":
    case "challenge_expired":
    case "challenge_replayed":
    case "signature_invalid":
    case "registration_not_current":
    case "binding_invalid":
    case "binding_not_current":
    case "capability_not_allowed":
      return bodyless(401);
    case "request_invalid":
      return bodyless(400);
    case "capacity_exceeded":
      return bodyless(503);
    case "session_issue_failed": {
      const nested = machineTransportCause(error);
      return nested?.code === "capacity_exceeded" ? bodyless(503) : bodyless(500);
    }
    default:
      return bodyless(500);
  }
}

function peerKey(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 255
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

export class DistributedNetworkMachineAuthRoute {
  private readonly expectedAuthority: string;
  private readonly maxConcurrent: number;
  private readonly peerIssueLimit: number;
  private readonly registrationIssueLimit: number;
  private readonly peerCompletionLimit: number;
  private readonly challengeCache = new Map<string, CachedChallenge>();
  private readonly activeByRegistration = new Map<string, ActiveChallenge>();
  private readonly registrationByChallenge = new Map<string, string>();
  private readonly peerIssueAttempts = new Map<string, number[]>();
  private readonly registrationIssueAttempts = new Map<string, number[]>();
  private readonly peerCompletionAttempts = new Map<string, number[]>();
  private inFlight = 0;

  constructor(private readonly options: DistributedNetworkMachineAuthRouteOptions) {
    const origin = canonicalOrigin(options.controllerOrigin);
    if (
      !options.bootstrap
      || typeof options.bootstrap.issueChallenge !== "function"
      || typeof options.bootstrap.completeChallenge !== "function"
    ) {
      throw new DistributedNetworkMachineAuthError(
        "bootstrap must expose M12Q issueChallenge and completeChallenge",
        "configuration_invalid",
      );
    }
    this.expectedAuthority = origin.host;
    this.maxConcurrent = boundedInteger(
      options.maxConcurrent ?? DEFAULT_CONCURRENCY,
      "maxConcurrent",
      1,
      HARD_MAX_CONCURRENCY,
    );
    this.peerIssueLimit = boundedInteger(
      options.peerIssueLimitPerMinute ?? DEFAULT_PEER_ISSUE_LIMIT,
      "peerIssueLimitPerMinute",
      1,
      HARD_MAX_PEER_ISSUE_LIMIT,
    );
    this.registrationIssueLimit = boundedInteger(
      options.registrationIssueLimitPerMinute ?? DEFAULT_REGISTRATION_ISSUE_LIMIT,
      "registrationIssueLimitPerMinute",
      1,
      HARD_MAX_REGISTRATION_ISSUE_LIMIT,
    );
    this.peerCompletionLimit = boundedInteger(
      options.peerCompletionLimitPerMinute ?? DEFAULT_PEER_COMPLETION_LIMIT,
      "peerCompletionLimitPerMinute",
      1,
      HARD_MAX_PEER_COMPLETION_LIMIT,
    );
  }

  private now(): Date {
    const value = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(value.getTime())) {
      throw new DistributedNetworkMachineAuthError(
        "bootstrap route clock is invalid",
        "configuration_invalid",
      );
    }
    return value;
  }

  private pruneAttempts(map: Map<string, number[]>, key: string, nowMs: number): number[] {
    const cutoff = nowMs - RATE_WINDOW_MS;
    const kept = (map.get(key) ?? []).filter((value) => value > cutoff);
    if (kept.length === 0) map.delete(key);
    else map.set(key, kept);
    return kept;
  }

  private consumeAttempt(
    map: Map<string, number[]>,
    key: string,
    limit: number,
    nowMs: number,
  ): boolean {
    const attempts = this.pruneAttempts(map, key, nowMs);
    if (attempts.length >= limit) return false;
    attempts.push(nowMs);
    map.set(key, attempts);
    return true;
  }

  private pruneChallenges(nowMs: number): void {
    for (const [requestId, cached] of this.challengeCache) {
      if (Date.parse(cached.challenge.expiresAt) <= nowMs) {
        this.challengeCache.delete(requestId);
      }
    }
    for (const [registrationId, active] of this.activeByRegistration) {
      if (Date.parse(active.expiresAt) <= nowMs) {
        this.activeByRegistration.delete(registrationId);
        if (this.registrationByChallenge.get(active.challengeId) === registrationId) {
          this.registrationByChallenge.delete(active.challengeId);
        }
      }
    }
  }

  private async challenge(
    requestId: string,
    body: Buffer,
    peer: string,
    nowMs: number,
  ): Promise<DistributedNetworkMachineAuthResponseV1> {
    const parsed = parseChallengeBody(body);
    if (parsed === null) return bodyless(400);

    const requestDigest = digest(body);
    const cached = this.challengeCache.get(requestId);
    if (cached) {
      if (cached.requestDigest !== requestDigest) return bodyless(409);
      try {
        assertDistributedMachineAuthenticationChallenge(cached.challenge);
      } catch {
        return bodyless(500);
      }
      return jsonResponse(cached.challenge, CHALLENGE_RESPONSE_MAX);
    }

    if (this.activeByRegistration.has(parsed.registrationId)) return bodyless(409);
    if (!this.consumeAttempt(this.peerIssueAttempts, peer, this.peerIssueLimit, nowMs)) {
      return bodyless(429);
    }
    if (!this.consumeAttempt(
      this.registrationIssueAttempts,
      parsed.registrationId,
      this.registrationIssueLimit,
      nowMs,
    )) {
      return bodyless(429);
    }

    let challenge: DistributedMachineAuthenticationChallengeV1;
    try {
      challenge = await this.options.bootstrap.issueChallenge({
        registrationId: parsed.registrationId,
        capabilities: [...parsed.capabilities],
        sessionTtlMs: parsed.sessionTtlMs,
      });
      assertDistributedMachineAuthenticationChallenge(challenge);
    } catch (error) {
      return issueErrorResponse(error);
    }

    if (
      challenge.registrationId !== parsed.registrationId
      || challenge.sessionTtlMs !== parsed.sessionTtlMs
      || challenge.capabilities.length !== parsed.capabilities.length
      || challenge.capabilities.some((value, index) => value !== parsed.capabilities[index])
    ) {
      return bodyless(500);
    }

    const cachedValue: CachedChallenge = {
      requestDigest,
      registrationId: parsed.registrationId,
      challenge: structuredClone(challenge),
    };
    this.challengeCache.set(requestId, cachedValue);
    this.activeByRegistration.set(parsed.registrationId, {
      requestId,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
    });
    this.registrationByChallenge.set(challenge.challengeId, parsed.registrationId);
    return jsonResponse(challenge, CHALLENGE_RESPONSE_MAX);
  }

  private async session(
    body: Buffer,
    peer: string,
    nowMs: number,
  ): Promise<DistributedNetworkMachineAuthResponseV1> {
    const parsed = parseSessionBody(body);
    if (parsed === null) return bodyless(400);
    if (!this.consumeAttempt(
      this.peerCompletionAttempts,
      peer,
      this.peerCompletionLimit,
      nowMs,
    )) {
      return bodyless(429);
    }

    const registrationId = this.registrationByChallenge.get(parsed.challengeId);
    try {
      const result = await this.options.bootstrap.completeChallenge({
        challengeId: parsed.challengeId,
        signatureBase64Url: parsed.signatureBase64Url,
      });
      if (!issueResultValid(result)) return bodyless(500);
      return jsonResponse({
        schemaVersion: 1,
        token: result.token,
        claims: result.claims,
      }, SESSION_RESPONSE_MAX);
    } catch (error) {
      return completionErrorResponse(error);
    } finally {
      if (registrationId !== undefined) {
        this.registrationByChallenge.delete(parsed.challengeId);
        const active = this.activeByRegistration.get(registrationId);
        if (active?.challengeId === parsed.challengeId) {
          this.activeByRegistration.delete(registrationId);
          this.challengeCache.delete(active.requestId);
        }
      }
    }
  }

  async handle(
    input: DistributedNetworkMachineAuthRequestV1,
  ): Promise<DistributedNetworkMachineAuthResponseV1> {
    if (input.url !== CHALLENGE_PATH && input.url !== SESSION_PATH) return bodyless(404);
    if (input.method !== "POST") return bodyless(405, { Allow: "POST" });
    if (input.httpVersion !== "1.1") return bodyless(400);
    const peer = peerKey(input.peerAddress);
    if (peer === null) return bodyless(400);

    const maxBody = input.url === CHALLENGE_PATH ? CHALLENGE_BODY_MAX : SESSION_BODY_MAX;
    if (!Buffer.isBuffer(input.body) || input.body.length < 1 || input.body.length > maxBody) {
      return bodyless(400);
    }
    const headers = parseRawHeaders(input.rawHeaders, this.expectedAuthority, input.body.length);
    if (headers === null) return bodyless(400);

    if (this.inFlight >= this.maxConcurrent) return bodyless(503);
    this.inFlight += 1;
    try {
      const nowMs = this.now().getTime();
      this.pruneChallenges(nowMs);
      return input.url === CHALLENGE_PATH
        ? await this.challenge(headers.requestId, input.body, peer, nowMs)
        : await this.session(input.body, peer, nowMs);
    } catch {
      return bodyless(500);
    } finally {
      this.inFlight -= 1;
    }
  }
}
