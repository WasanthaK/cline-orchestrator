import crypto from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  assertRemoteControlSessionCurrent,
  createRemoteControlSessionClaims,
  type RemoteControlSessionClaimsV1,
  type RemoteControlSessionRequestV1,
} from "./remote-control-contract.js";
import type {
  OperatorMutationActionV1,
  OperatorReadOnlyCapabilityV1,
} from "./operator-capabilities.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RemoteSessionSecurityLimits {
  maxActiveSessions: number;
  maxReplayEntries: number;
  sessionRequestsPerMinute: number;
  registrationRequestsPerMinute: number;
}

export const REMOTE_SESSION_SECURITY_LIMITS: Readonly<RemoteSessionSecurityLimits> = Object.freeze({
  maxActiveSessions: 64,
  maxReplayEntries: 4096,
  sessionRequestsPerMinute: 60,
  registrationRequestsPerMinute: 120,
});

export type RemoteSessionAccessV1 =
  | { kind: "read"; capability: OperatorReadOnlyCapabilityV1 }
  | { kind: "mutation"; action: OperatorMutationActionV1 };

export interface RemoteSessionIssueResultV1 {
  schemaVersion: 1;
  token: string;
  claims: RemoteControlSessionClaimsV1;
}

export interface RemoteSessionAuthorizedRequestV1 {
  schemaVersion: 1;
  requestId: string;
  sessionId: string;
  registrationId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  access: RemoteSessionAccessV1;
}

export interface RemoteSessionAuditV1 {
  schemaVersion: 1;
  auditId: string;
  recordedAt: string;
  kind: "session_issued" | "session_revoked" | "request_authorized" | "request_denied";
  registrationId: string;
  sessionId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  requestId?: string;
  accessKind?: RemoteSessionAccessV1["kind"];
  capability?: string;
  outcome: "allowed" | "denied";
  reasonCode?: string;
}

export interface RemoteSessionGatewayOptions {
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
  limits?: Partial<RemoteSessionSecurityLimits>;
}

export class RemoteSessionGatewayError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "session_not_found"
      | "capability_not_allowed"
      | "request_replayed"
      | "rate_limited"
      | "capacity_exceeded"
      | "request_invalid",
  ) {
    super(message);
    this.name = "RemoteSessionGatewayError";
  }
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) {
    throw new RemoteSessionGatewayError(`${field} must be an opaque UUID`, "request_invalid");
  }
  return value;
}

function tokenDigest(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function accessName(access: RemoteSessionAccessV1): string {
  return access.kind === "read" ? access.capability : access.action;
}

class RemoteReplayGuard {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries: number) {}

  consume(sessionId: string, requestId: string, expiresAt: string, nowMs: number): void {
    for (const [key, expiry] of this.entries) {
      if (expiry <= nowMs) this.entries.delete(key);
    }
    const key = `${sessionId}:${requestId}`;
    if (this.entries.has(key)) {
      throw new RemoteSessionGatewayError("remote request id was already consumed", "request_replayed");
    }
    if (this.entries.size >= this.maxEntries) {
      throw new RemoteSessionGatewayError("remote replay cache capacity exceeded", "capacity_exceeded");
    }
    this.entries.set(key, Date.parse(expiresAt));
  }
}

interface RateWindow {
  minute: number;
  count: number;
}

class RemoteRateLimiter {
  private readonly sessionWindows = new Map<string, RateWindow>();
  private readonly registrationWindows = new Map<string, RateWindow>();

  constructor(
    private readonly sessionLimit: number,
    private readonly registrationLimit: number,
  ) {}

  consume(registrationId: string, sessionId: string, nowMs: number): void {
    const minute = Math.floor(nowMs / 60_000);
    const consumeWindow = (map: Map<string, RateWindow>, key: string, limit: number) => {
      const existing = map.get(key);
      const next = !existing || existing.minute !== minute
        ? { minute, count: 1 }
        : { minute, count: existing.count + 1 };
      if (next.count > limit) {
        throw new RemoteSessionGatewayError("remote request rate limit exceeded", "rate_limited");
      }
      map.set(key, next);
    };

    consumeWindow(this.registrationWindows, registrationId, this.registrationLimit);
    try {
      consumeWindow(this.sessionWindows, sessionId, this.sessionLimit);
    } catch (error) {
      const registration = this.registrationWindows.get(registrationId);
      if (registration?.minute === minute) registration.count -= 1;
      throw error;
    }
  }
}

export class RemoteSessionAuditStore {
  constructor(
    private readonly rootDir: string,
    private readonly options: Pick<RemoteSessionGatewayOptions, "now" | "idFactory"> = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "remote-control");
  }

  private file(): string {
    return path.join(this.dir(), "audit.jsonl");
  }

  async append(
    event: Omit<RemoteSessionAuditV1, "schemaVersion" | "auditId" | "recordedAt">,
  ): Promise<RemoteSessionAuditV1> {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new RemoteSessionGatewayError("remote audit clock is invalid", "request_invalid");
    }
    const auditId = requireUuid(
      (this.options.idFactory ?? (() => crypto.randomUUID()))(),
      "auditId",
    );
    const record: RemoteSessionAuditV1 = {
      schemaVersion: 1,
      auditId,
      recordedAt: now.toISOString(),
      ...event,
    };
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.file(), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    return record;
  }
}

/**
 * Local-only security boundary for future remote transport.
 *
 * Tokens are random opaque bearer values kept only in process memory. Durable
 * state contains sanitized registration/audit evidence only. This service never
 * invokes an operator mutation; a mutation capability merely permits a future
 * transport request to reach the existing M10 preview/confirmation boundary.
 */
export class RemoteSessionGateway {
  private readonly sessions = new Map<string, RemoteControlSessionClaimsV1>();
  private readonly replay: RemoteReplayGuard;
  private readonly rate: RemoteRateLimiter;
  private readonly audit: RemoteSessionAuditStore;
  private readonly limits: RemoteSessionSecurityLimits;

  constructor(
    private readonly registrations: RemoteRegistrationStore,
    auditRootDir: string,
    private readonly options: RemoteSessionGatewayOptions = {},
  ) {
    this.limits = {
      maxActiveSessions: options.limits?.maxActiveSessions ?? REMOTE_SESSION_SECURITY_LIMITS.maxActiveSessions,
      maxReplayEntries: options.limits?.maxReplayEntries ?? REMOTE_SESSION_SECURITY_LIMITS.maxReplayEntries,
      sessionRequestsPerMinute: options.limits?.sessionRequestsPerMinute ?? REMOTE_SESSION_SECURITY_LIMITS.sessionRequestsPerMinute,
      registrationRequestsPerMinute: options.limits?.registrationRequestsPerMinute ?? REMOTE_SESSION_SECURITY_LIMITS.registrationRequestsPerMinute,
    };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RemoteSessionGatewayError(`${name} must be a positive integer`, "request_invalid");
      }
    }
    this.replay = new RemoteReplayGuard(this.limits.maxReplayEntries);
    this.rate = new RemoteRateLimiter(
      this.limits.sessionRequestsPerMinute,
      this.limits.registrationRequestsPerMinute,
    );
    this.audit = new RemoteSessionAuditStore(auditRootDir, options);
  }

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new RemoteSessionGatewayError("remote session clock is invalid", "request_invalid");
    }
    return now;
  }

  private pruneExpiredSessions(nowMs: number): void {
    for (const [digest, claims] of this.sessions) {
      if (Date.parse(claims.expiresAt) <= nowMs) this.sessions.delete(digest);
    }
  }

  private async auditDenied(
    claims: RemoteControlSessionClaimsV1,
    requestId: string,
    access: RemoteSessionAccessV1,
    reasonCode: string,
  ): Promise<void> {
    await this.audit.append({
      kind: "request_denied",
      registrationId: claims.registrationId,
      sessionId: claims.sessionId,
      remotePrincipalId: claims.remotePrincipalId,
      registrationRevision: claims.registrationRevision,
      requestId,
      accessKind: access.kind,
      capability: accessName(access),
      outcome: "denied",
      reasonCode,
    });
  }

  async issue(
    registrationId: string,
    request: RemoteControlSessionRequestV1,
  ): Promise<RemoteSessionIssueResultV1> {
    const now = this.now();
    this.pruneExpiredSessions(now.getTime());
    if (this.sessions.size >= this.limits.maxActiveSessions) {
      throw new RemoteSessionGatewayError("remote active session capacity exceeded", "capacity_exceeded");
    }
    const registration = await this.registrations.getRegistration(registrationId);
    const claims = createRemoteControlSessionClaims(registration, request, {
      now,
      idFactory: this.options.idFactory,
    });
    const token = (this.options.tokenFactory ?? (() => `rct_${crypto.randomBytes(32).toString("base64url")}`))();
    if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
      throw new RemoteSessionGatewayError("remote session token factory returned an invalid token", "request_invalid");
    }
    const digest = tokenDigest(token);
    if (this.sessions.has(digest)) {
      throw new RemoteSessionGatewayError("remote session token collision", "capacity_exceeded");
    }
    this.sessions.set(digest, claims);
    try {
      await this.audit.append({
        kind: "session_issued",
        registrationId: claims.registrationId,
        sessionId: claims.sessionId,
        remotePrincipalId: claims.remotePrincipalId,
        registrationRevision: claims.registrationRevision,
        outcome: "allowed",
      });
    } catch (error) {
      this.sessions.delete(digest);
      throw error;
    }
    return { schemaVersion: 1, token, claims: structuredClone(claims) };
  }

  async revokeSession(token: string): Promise<void> {
    const digest = tokenDigest(token);
    const claims = this.sessions.get(digest);
    if (!claims) {
      throw new RemoteSessionGatewayError("remote session was not found", "session_not_found");
    }
    this.sessions.delete(digest);
    await this.audit.append({
      kind: "session_revoked",
      registrationId: claims.registrationId,
      sessionId: claims.sessionId,
      remotePrincipalId: claims.remotePrincipalId,
      registrationRevision: claims.registrationRevision,
      outcome: "denied",
      reasonCode: "local_session_revocation",
    });
  }

  async authorize(
    token: string,
    requestId: string,
    access: RemoteSessionAccessV1,
  ): Promise<RemoteSessionAuthorizedRequestV1> {
    requestId = requireUuid(requestId, "requestId");
    const digest = tokenDigest(token);
    const claims = this.sessions.get(digest);
    if (!claims) {
      throw new RemoteSessionGatewayError("remote session was not found", "session_not_found");
    }

    const now = this.now();
    try {
      const registration = await this.registrations.getRegistration(claims.registrationId);
      assertRemoteControlSessionCurrent(claims, registration, now);
    } catch (error) {
      await this.auditDenied(
        claims,
        requestId,
        access,
        typeof (error as { code?: unknown })?.code === "string"
          ? String((error as { code: string }).code)
          : "session_not_current",
      );
      throw error;
    }

    // Every authenticated request ID is single-use, even when its requested
    // capability is denied. This prevents one request ID from being replayed with
    // a different operation after an initial denial.
    try {
      this.replay.consume(claims.sessionId, requestId, claims.expiresAt, now.getTime());
      this.rate.consume(claims.registrationId, claims.sessionId, now.getTime());
    } catch (error) {
      await this.auditDenied(
        claims,
        requestId,
        access,
        error instanceof RemoteSessionGatewayError ? error.code : "request_denied",
      );
      throw error;
    }

    const allowed = access.kind === "read"
      ? claims.readOnlyCapabilities.includes(access.capability)
      : claims.mutationActions.includes(access.action);
    if (!allowed) {
      await this.auditDenied(claims, requestId, access, "capability_not_allowed");
      throw new RemoteSessionGatewayError("remote session does not contain requested capability", "capability_not_allowed");
    }

    await this.audit.append({
      kind: "request_authorized",
      registrationId: claims.registrationId,
      sessionId: claims.sessionId,
      remotePrincipalId: claims.remotePrincipalId,
      registrationRevision: claims.registrationRevision,
      requestId,
      accessKind: access.kind,
      capability: accessName(access),
      outcome: "allowed",
    });

    return {
      schemaVersion: 1,
      requestId,
      sessionId: claims.sessionId,
      registrationId: claims.registrationId,
      remotePrincipalId: claims.remotePrincipalId,
      registrationRevision: claims.registrationRevision,
      access: structuredClone(access),
    };
  }
}
