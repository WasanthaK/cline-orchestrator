import crypto from "node:crypto";
import {
  assertDistributedMachineRegistration,
  type DistributedMachineCapabilityV1,
  type DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_SESSION_TTL_MS = 30_000;
const MAX_SESSION_TTL_MS = 5 * 60_000;
const MIN_LIVENESS_TTL_MS = 5_000;
const MAX_LIVENESS_TTL_MS = 2 * 60_000;
const DEFAULT_LIVENESS_TTL_MS = 30_000;
const MAX_ACTIVE_SESSIONS = 256;
const MAX_REPLAY_ENTRIES = 8_192;
const MACHINE_CAPABILITIES = new Set<DistributedMachineCapabilityV1>([
  "report_status",
  "accept_writer_candidates",
]);

export const DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  minSessionTtlMs: MIN_SESSION_TTL_MS,
  maxSessionTtlMs: MAX_SESSION_TTL_MS,
  minLivenessTtlMs: MIN_LIVENESS_TTL_MS,
  maxLivenessTtlMs: MAX_LIVENESS_TTL_MS,
  defaultLivenessTtlMs: DEFAULT_LIVENESS_TTL_MS,
  tokensAreProcessLocalOnly: true as const,
  sessionIssuanceControllerLocalOnly: true as const,
  requiresReplayProtection: true as const,
  requiresRegistrationRevalidation: true as const,
  livenessIsObservationOnly: true as const,
  livenessCannotOutliveSession: true as const,
  networkListenerIncluded: false as const,
  crossMachineWriteDispatchEnabled: false as const,
  distributedWriteExecutionEnabled: false as const,
  transportGrantsTaskAuthority: false as const,
  transportGrantsFilesystemAuthority: false as const,
  transportGrantsSafetyPlanAuthority: false as const,
  transportGrantsWriterLeaseAuthority: false as const,
  transportGrantsCredentialAuthority: false as const,
  transportGrantsReleaseAuthority: false as const,
});

export interface DistributedMachineRegistrationLookup {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedMachineTransportSessionRequestV1 {
  capabilities: DistributedMachineCapabilityV1[];
  ttlMs: number;
}

export interface DistributedMachineTransportSessionClaimsV1 {
  schemaVersion: 1;
  sessionId: string;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  issuedAt: string;
  expiresAt: string;
  capabilities: DistributedMachineCapabilityV1[];
  authority: "authenticated_machine_identity_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedMachineTransportIssueResultV1 {
  schemaVersion: 1;
  token: string;
  claims: DistributedMachineTransportSessionClaimsV1;
}

export interface DistributedMachineAuthorizedRequestV1 {
  schemaVersion: 1;
  requestId: string;
  sessionId: string;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  capability: DistributedMachineCapabilityV1;
  authority: "transport_identity_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export type DistributedMachineReportedStatusV1 = "ready" | "busy" | "draining";

export interface DistributedMachineStatusPayloadV1 {
  status: DistributedMachineReportedStatusV1;
  acceptingWriterCandidates: boolean;
}

export interface DistributedMachineLivenessViewV1 {
  schemaVersion: 1;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  state: "live" | "stale" | "unknown";
  observedAt?: string;
  validUntil?: string;
  reportedStatus?: DistributedMachineReportedStatusV1;
  acceptingWriterCandidates: boolean;
  authority: "observation_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

interface DistributedMachineLivenessObservationV1 {
  sessionId: string;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  observedAt: string;
  validUntil: string;
  reportedStatus: DistributedMachineReportedStatusV1;
  acceptingWriterCandidates: boolean;
}

export interface DistributedMachineTransportOptions {
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
  livenessTtlMs?: number;
  maxActiveSessions?: number;
  maxReplayEntries?: number;
}

export class DistributedMachineTransportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "registration_not_current"
      | "session_not_found"
      | "session_invalid"
      | "session_expired"
      | "session_stale"
      | "capability_not_allowed"
      | "request_invalid"
      | "request_replayed"
      | "capacity_exceeded",
  ) {
    super(message);
    this.name = "DistributedMachineTransportError";
  }
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  label: string,
  code: DistributedMachineTransportError["code"],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedMachineTransportError(`${label} must be an object`, code);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== required.length || keys.some((key) => !required.includes(key))) {
    throw new DistributedMachineTransportError(
      `${label} contains unsupported or missing fields`,
      code,
    );
  }
}

function requireUuid(
  value: unknown,
  field: string,
  code: DistributedMachineTransportError["code"] = "request_invalid",
): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedMachineTransportError(
      `${field} must be an opaque UUID`,
      code,
    );
  }
  return value.trim();
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedMachineTransportError(
      `${field} must be an ISO timestamp`,
      "session_invalid",
    );
  }
  return new Date(Date.parse(value)).toISOString();
}

function positiveRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedMachineTransportError(
      `${field} must be a positive integer`,
      "session_invalid",
    );
  }
  return value;
}

function uniqueCapabilities(
  value: unknown,
  code: DistributedMachineTransportError["code"],
): DistributedMachineCapabilityV1[] {
  if (!Array.isArray(value)) {
    throw new DistributedMachineTransportError("capabilities must be an array", code);
  }
  const result: DistributedMachineCapabilityV1[] = [];
  const seen = new Set<string>();
  for (const capability of value) {
    if (typeof capability !== "string" || !MACHINE_CAPABILITIES.has(capability as DistributedMachineCapabilityV1)) {
      throw new DistributedMachineTransportError(
        "transport requested an unsupported machine capability",
        code,
      );
    }
    if (seen.has(capability)) {
      throw new DistributedMachineTransportError(
        "transport requested duplicate machine capabilities",
        code,
      );
    }
    seen.add(capability);
    result.push(capability as DistributedMachineCapabilityV1);
  }
  return result;
}

function requireBoundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedMachineTransportError(
      `${field} must be an integer between ${min} and ${max}`,
      "request_invalid",
    );
  }
  return value;
}

function activeRegistration(registration: DistributedMachineRegistrationV1): DistributedMachineRegistrationV1 {
  try {
    assertDistributedMachineRegistration(registration);
  } catch {
    throw new DistributedMachineTransportError(
      "machine registration is invalid",
      "registration_not_current",
    );
  }
  if (registration.revokedAt) {
    throw new DistributedMachineTransportError(
      "machine registration is revoked",
      "registration_not_current",
    );
  }
  return structuredClone(registration);
}

export function assertDistributedMachineTransportSessionClaims(
  value: unknown,
): asserts value is DistributedMachineTransportSessionClaimsV1 {
  exactKeys(
    value,
    [
      "schemaVersion",
      "sessionId",
      "registrationId",
      "machineId",
      "registrationRevision",
      "issuedAt",
      "expiresAt",
      "capabilities",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    "distributed machine transport session",
    "session_invalid",
  );
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.authority !== "authenticated_machine_identity_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedMachineTransportError(
      "distributed machine transport session cannot grant execution authority",
      "session_invalid",
    );
  }
  requireUuid(record.sessionId, "sessionId", "session_invalid");
  requireUuid(record.registrationId, "registrationId", "session_invalid");
  requireUuid(record.machineId, "machineId", "session_invalid");
  positiveRevision(record.registrationRevision, "registrationRevision");
  const issuedAt = iso(record.issuedAt, "issuedAt");
  const expiresAt = iso(record.expiresAt, "expiresAt");
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttl < MIN_SESSION_TTL_MS || ttl > MAX_SESSION_TTL_MS) {
    throw new DistributedMachineTransportError(
      "distributed machine transport session TTL is outside the allowed bound",
      "session_invalid",
    );
  }
  uniqueCapabilities(record.capabilities, "session_invalid");
}

export function createDistributedMachineTransportSessionClaims(
  registrationInput: DistributedMachineRegistrationV1,
  request: DistributedMachineTransportSessionRequestV1,
  options: Pick<DistributedMachineTransportOptions, "now" | "idFactory"> = {},
): DistributedMachineTransportSessionClaimsV1 {
  exactKeys(
    request,
    ["capabilities", "ttlMs"],
    "distributed machine transport session request",
    "request_invalid",
  );
  const registration = activeRegistration(registrationInput);
  const capabilities = uniqueCapabilities(request.capabilities, "request_invalid");
  const allowed = new Set(registration.allowedCapabilities);
  if (capabilities.some((capability) => !allowed.has(capability))) {
    throw new DistributedMachineTransportError(
      "transport requested a capability outside the machine registration",
      "capability_not_allowed",
    );
  }
  const ttlMs = requireBoundedInteger(
    request.ttlMs,
    "ttlMs",
    MIN_SESSION_TTL_MS,
    MAX_SESSION_TTL_MS,
  );
  const now = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) {
    throw new DistributedMachineTransportError(
      "distributed machine transport clock is invalid",
      "request_invalid",
    );
  }
  const claims: DistributedMachineTransportSessionClaimsV1 = {
    schemaVersion: 1,
    sessionId: requireUuid(
      (options.idFactory ?? (() => crypto.randomUUID()))(),
      "sessionId",
      "session_invalid",
    ),
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    registrationRevision: registration.revision,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    capabilities,
    authority: "authenticated_machine_identity_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedMachineTransportSessionClaims(claims);
  return claims;
}

export function assertDistributedMachineTransportSessionCurrent(
  claims: DistributedMachineTransportSessionClaimsV1,
  registrationInput: DistributedMachineRegistrationV1,
  now: Date = new Date(),
): void {
  assertDistributedMachineTransportSessionClaims(claims);
  const registration = activeRegistration(registrationInput);
  if (!Number.isFinite(now.getTime())) {
    throw new DistributedMachineTransportError(
      "distributed machine transport clock is invalid",
      "session_invalid",
    );
  }
  if (now.getTime() < Date.parse(claims.issuedAt)) {
    throw new DistributedMachineTransportError(
      "distributed machine transport clock moved behind session issuance",
      "session_stale",
    );
  }
  if (Date.parse(claims.expiresAt) <= now.getTime()) {
    throw new DistributedMachineTransportError(
      "distributed machine transport session expired",
      "session_expired",
    );
  }
  if (
    claims.registrationId !== registration.registrationId
    || claims.machineId !== registration.machineId
    || claims.registrationRevision !== registration.revision
  ) {
    throw new DistributedMachineTransportError(
      "distributed machine transport session no longer matches the current registration",
      "session_stale",
    );
  }
  const allowed = new Set(registration.allowedCapabilities);
  if (claims.capabilities.some((capability) => !allowed.has(capability))) {
    throw new DistributedMachineTransportError(
      "distributed machine transport capability projection is stale",
      "session_stale",
    );
  }
}

function tokenDigest(token: unknown): string {
  if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
    throw new DistributedMachineTransportError(
      "distributed machine transport token is invalid",
      "session_not_found",
    );
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function livenessBase(
  registration: DistributedMachineRegistrationV1,
): Omit<DistributedMachineLivenessViewV1, "state" | "acceptingWriterCandidates"> {
  return {
    schemaVersion: 1,
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    registrationRevision: registration.revision,
    authority: "observation_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

/**
 * Controller-local authentication and liveness boundary for M12C.
 *
 * Session issuance is intentionally not a network route in this slice. A future
 * transport adapter may present the short-lived bearer token to this gateway,
 * but must not expose issue() as an unauthenticated registration-id exchange.
 * Accepted requests revalidate the exact durable machine registration revision.
 * Liveness is process-local observation only and never grants task/write authority.
 */
export class DistributedMachineTransportGateway {
  private readonly sessions = new Map<string, DistributedMachineTransportSessionClaimsV1>();
  private readonly replay = new Map<string, number>();
  private readonly liveness = new Map<string, DistributedMachineLivenessObservationV1>();
  private readonly livenessTtlMs: number;
  private readonly maxActiveSessions: number;
  private readonly maxReplayEntries: number;

  constructor(
    private readonly registrations: DistributedMachineRegistrationLookup,
    private readonly options: DistributedMachineTransportOptions = {},
  ) {
    this.livenessTtlMs = requireBoundedInteger(
      options.livenessTtlMs ?? DEFAULT_LIVENESS_TTL_MS,
      "livenessTtlMs",
      MIN_LIVENESS_TTL_MS,
      MAX_LIVENESS_TTL_MS,
    );
    this.maxActiveSessions = requireBoundedInteger(
      options.maxActiveSessions ?? MAX_ACTIVE_SESSIONS,
      "maxActiveSessions",
      1,
      MAX_ACTIVE_SESSIONS,
    );
    this.maxReplayEntries = requireBoundedInteger(
      options.maxReplayEntries ?? MAX_REPLAY_ENTRIES,
      "maxReplayEntries",
      1,
      MAX_REPLAY_ENTRIES,
    );
  }

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedMachineTransportError(
        "distributed machine transport clock is invalid",
        "request_invalid",
      );
    }
    return now;
  }

  private async currentRegistration(registrationId: string): Promise<DistributedMachineRegistrationV1> {
    try {
      return activeRegistration(await this.registrations.get(registrationId));
    } catch (error) {
      if (error instanceof DistributedMachineTransportError) throw error;
      throw new DistributedMachineTransportError(
        "machine registration is unavailable",
        "registration_not_current",
      );
    }
  }

  private prune(nowMs: number): void {
    for (const [digest, claims] of this.sessions) {
      if (Date.parse(claims.expiresAt) <= nowMs) this.sessions.delete(digest);
    }
    for (const [key, expiry] of this.replay) {
      if (expiry <= nowMs) this.replay.delete(key);
    }
  }

  private consumeReplay(
    claims: DistributedMachineTransportSessionClaimsV1,
    requestId: string,
    nowMs: number,
  ): void {
    this.prune(nowMs);
    const key = `${claims.sessionId}:${requestId}`;
    if (this.replay.has(key)) {
      throw new DistributedMachineTransportError(
        "distributed machine transport request id was already consumed",
        "request_replayed",
      );
    }
    if (this.replay.size >= this.maxReplayEntries) {
      throw new DistributedMachineTransportError(
        "distributed machine transport replay cache capacity exceeded",
        "capacity_exceeded",
      );
    }
    this.replay.set(key, Date.parse(claims.expiresAt));
  }

  private async authorizeAt(
    token: string,
    requestId: string,
    capability: DistributedMachineCapabilityV1,
    now: Date,
  ): Promise<{ claims: DistributedMachineTransportSessionClaimsV1; authorized: DistributedMachineAuthorizedRequestV1 }> {
    requestId = requireUuid(requestId, "requestId");
    if (!MACHINE_CAPABILITIES.has(capability)) {
      throw new DistributedMachineTransportError(
        "distributed machine transport capability is unsupported",
        "capability_not_allowed",
      );
    }
    const claims = this.sessions.get(tokenDigest(token));
    if (!claims) {
      throw new DistributedMachineTransportError(
        "distributed machine transport session was not found",
        "session_not_found",
      );
    }
    const registration = await this.currentRegistration(claims.registrationId);
    assertDistributedMachineTransportSessionCurrent(claims, registration, now);
    this.consumeReplay(claims, requestId, now.getTime());
    if (!claims.capabilities.includes(capability)) {
      throw new DistributedMachineTransportError(
        "distributed machine transport session does not contain requested capability",
        "capability_not_allowed",
      );
    }
    return {
      claims,
      authorized: {
        schemaVersion: 1,
        requestId,
        sessionId: claims.sessionId,
        registrationId: claims.registrationId,
        machineId: claims.machineId,
        registrationRevision: claims.registrationRevision,
        capability,
        authority: "transport_identity_only",
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      },
    };
  }

  async issue(
    registrationId: string,
    request: DistributedMachineTransportSessionRequestV1,
  ): Promise<DistributedMachineTransportIssueResultV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    const now = this.now();
    this.prune(now.getTime());
    if (this.sessions.size >= this.maxActiveSessions) {
      throw new DistributedMachineTransportError(
        "distributed machine transport active session capacity exceeded",
        "capacity_exceeded",
      );
    }
    const registration = await this.currentRegistration(registrationId);
    const claims = createDistributedMachineTransportSessionClaims(
      registration,
      request,
      { now: () => now, idFactory: this.options.idFactory },
    );
    const token = (this.options.tokenFactory
      ?? (() => `dmt_${crypto.randomBytes(32).toString("base64url")}`))();
    const digest = tokenDigest(token);
    if (this.sessions.has(digest)) {
      throw new DistributedMachineTransportError(
        "distributed machine transport token collision",
        "capacity_exceeded",
      );
    }
    if ([...this.sessions.values()].some((item) => item.sessionId === claims.sessionId)) {
      throw new DistributedMachineTransportError(
        "distributed machine transport session id collision",
        "capacity_exceeded",
      );
    }
    this.sessions.set(digest, claims);
    return { schemaVersion: 1, token, claims: structuredClone(claims) };
  }

  revokeSession(token: string): void {
    const digest = tokenDigest(token);
    const claims = this.sessions.get(digest);
    if (!claims) {
      throw new DistributedMachineTransportError(
        "distributed machine transport session was not found",
        "session_not_found",
      );
    }
    this.sessions.delete(digest);
    for (const [registrationId, observation] of this.liveness) {
      if (observation.sessionId === claims.sessionId) this.liveness.delete(registrationId);
    }
  }

  async authorize(
    token: string,
    requestId: string,
    capability: DistributedMachineCapabilityV1,
  ): Promise<DistributedMachineAuthorizedRequestV1> {
    const { authorized } = await this.authorizeAt(token, requestId, capability, this.now());
    return structuredClone(authorized);
  }

  async reportStatus(
    token: string,
    requestId: string,
    payload: DistributedMachineStatusPayloadV1,
  ): Promise<DistributedMachineLivenessViewV1> {
    exactKeys(
      payload,
      ["status", "acceptingWriterCandidates"],
      "distributed machine status payload",
      "request_invalid",
    );
    if (!( ["ready", "busy", "draining"] as const).includes(payload.status)) {
      throw new DistributedMachineTransportError(
        "distributed machine reported status is unsupported",
        "request_invalid",
      );
    }
    if (typeof payload.acceptingWriterCandidates !== "boolean") {
      throw new DistributedMachineTransportError(
        "acceptingWriterCandidates must be boolean",
        "request_invalid",
      );
    }

    const now = this.now();
    const { claims } = await this.authorizeAt(token, requestId, "report_status", now);
    if (payload.acceptingWriterCandidates && !claims.capabilities.includes("accept_writer_candidates")) {
      throw new DistributedMachineTransportError(
        "session cannot report writer-candidate acceptance without that registered capability",
        "capability_not_allowed",
      );
    }

    const observation: DistributedMachineLivenessObservationV1 = {
      sessionId: claims.sessionId,
      registrationId: claims.registrationId,
      machineId: claims.machineId,
      registrationRevision: claims.registrationRevision,
      observedAt: now.toISOString(),
      validUntil: new Date(Math.min(
        now.getTime() + this.livenessTtlMs,
        Date.parse(claims.expiresAt),
      )).toISOString(),
      reportedStatus: payload.status,
      acceptingWriterCandidates: payload.acceptingWriterCandidates,
    };
    this.liveness.set(claims.registrationId, observation);
    return {
      ...livenessBase(await this.currentRegistration(claims.registrationId)),
      state: "live",
      observedAt: observation.observedAt,
      validUntil: observation.validUntil,
      reportedStatus: observation.reportedStatus,
      acceptingWriterCandidates: observation.acceptingWriterCandidates,
    };
  }

  async getLiveness(registrationId: string): Promise<DistributedMachineLivenessViewV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    const now = this.now();
    const registration = await this.currentRegistration(registrationId);
    const observation = this.liveness.get(registrationId);
    if (!observation) {
      return {
        ...livenessBase(registration),
        state: "unknown",
        acceptingWriterCandidates: false,
      };
    }
    if (
      observation.machineId !== registration.machineId
      || observation.registrationRevision !== registration.revision
    ) {
      return {
        ...livenessBase(registration),
        state: "unknown",
        acceptingWriterCandidates: false,
      };
    }
    if (Date.parse(observation.validUntil) <= now.getTime()) {
      return {
        ...livenessBase(registration),
        state: "stale",
        observedAt: observation.observedAt,
        validUntil: observation.validUntil,
        reportedStatus: observation.reportedStatus,
        acceptingWriterCandidates: false,
      };
    }
    return {
      ...livenessBase(registration),
      state: "live",
      observedAt: observation.observedAt,
      validUntil: observation.validUntil,
      reportedStatus: observation.reportedStatus,
      acceptingWriterCandidates: observation.acceptingWriterCandidates,
    };
  }
}
