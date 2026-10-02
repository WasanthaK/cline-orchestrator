import crypto from "node:crypto";
import {
  getOperatorCapabilityManifest,
  type OperatorMutationActionV1,
  type OperatorReadOnlyCapabilityV1,
} from "./operator-capabilities.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REMOTE_SESSION_TTL_MS = 15 * 60 * 1000;
const MIN_REMOTE_SESSION_TTL_MS = 30 * 1000;

export type RemoteControlPlaneCapabilityV1 = "propose_new_task";

const REMOTE_CONTROL_CAPABILITIES = [
  "propose_new_task",
] as const satisfies readonly RemoteControlPlaneCapabilityV1[];

export const REMOTE_CONTROL_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  maxSessionTtlMs: MAX_REMOTE_SESSION_TTL_MS,
  minSessionTtlMs: MIN_REMOTE_SESSION_TTL_MS,
  requiresReplayProtection: true as const,
  requiresRateLimiting: true as const,
  requiresAudit: true as const,
  requiresLocalRegistration: true as const,
  transportGrantsTaskAuthority: false as const,
  transportGrantsHumanConfirmation: false as const,
});

export interface RemoteControlRegistrationV1 {
  schemaVersion: 1;
  registrationId: string;
  machineId: string;
  remotePrincipalId: string;
  revision: number;
  createdAt: string;
  revokedAt?: string;
  allowedMutationActions: OperatorMutationActionV1[];
  allowedReadOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  /** Milestone 11-only proposal capabilities. Omitted legacy state normalizes to none. */
  allowedControlCapabilities?: RemoteControlPlaneCapabilityV1[];
}

export interface RemoteControlSessionClaimsV1 {
  schemaVersion: 1;
  sessionId: string;
  registrationId: string;
  machineId: string;
  remotePrincipalId: string;
  registrationRevision: number;
  operatorCapabilitySchemaVersion: 1;
  issuedAt: string;
  expiresAt: string;
  mutationActions: OperatorMutationActionV1[];
  readOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  controlCapabilities: RemoteControlPlaneCapabilityV1[];
  transportAuthority: "authenticated_session_only";
  humanConfirmationAuthority: "none";
  safetyPlanAuthority: "none";
  credentialAuthority: "none";
  releaseAuthority: "none";
}

export interface RemoteControlSessionRequestV1 {
  mutationActions: OperatorMutationActionV1[];
  readOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  /** Must be explicitly requested and locally registered; defaults to none. */
  controlCapabilities?: RemoteControlPlaneCapabilityV1[];
  ttlMs: number;
}

export class RemoteControlContractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "registration_invalid"
      | "registration_revoked"
      | "capability_not_allowed"
      | "session_invalid"
      | "session_expired"
      | "session_stale",
  ) {
    super(message);
    this.name = "RemoteControlContractError";
  }
}

function requireUuid(value: string, field: string, code: RemoteControlContractError["code"]): string {
  if (!UUID.test(value)) throw new RemoteControlContractError(`${field} must be an opaque UUID`, code);
  return value;
}

function requireIso(value: string, field: string, code: RemoteControlContractError["code"]): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RemoteControlContractError(`${field} must be an ISO timestamp`, code);
  return new Date(ms).toISOString();
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Validates and normalizes one machine-local remote registration against the
 * current Milestone 10 operator capability manifest plus the small explicit set
 * of Milestone 11-only remote proposal capabilities. This function does not
 * create a session or grant authority; it is the shared admission boundary used
 * by the local registration store and session-issuance path.
 */
export function normalizeRemoteControlRegistration(
  registration: RemoteControlRegistrationV1,
): RemoteControlRegistrationV1 {
  if (registration.schemaVersion !== 1) {
    throw new RemoteControlContractError("Unsupported remote registration schema", "registration_invalid");
  }
  requireUuid(registration.registrationId, "registrationId", "registration_invalid");
  requireUuid(registration.machineId, "machineId", "registration_invalid");
  requireUuid(registration.remotePrincipalId, "remotePrincipalId", "registration_invalid");
  if (!Number.isSafeInteger(registration.revision) || registration.revision < 1) {
    throw new RemoteControlContractError("registration revision must be a positive integer", "registration_invalid");
  }
  const createdAt = requireIso(registration.createdAt, "createdAt", "registration_invalid");
  const revokedAt = registration.revokedAt
    ? requireIso(registration.revokedAt, "revokedAt", "registration_invalid")
    : undefined;

  const manifest = getOperatorCapabilityManifest();
  const mutationOrder = manifest.mutationActions.map((item) => item.action);
  const readOrder = [...manifest.readOnlyCapabilities];
  const controlOrder = [...REMOTE_CONTROL_CAPABILITIES];
  const mutations = new Set(mutationOrder);
  const reads = new Set(readOrder);
  const controls = new Set<RemoteControlPlaneCapabilityV1>(controlOrder);
  const registrationControls = registration.allowedControlCapabilities ?? [];
  if (registration.allowedMutationActions.some((item) => !mutations.has(item))) {
    throw new RemoteControlContractError("registration contains unsupported mutation capability", "registration_invalid");
  }
  if (registration.allowedReadOnlyCapabilities.some((item) => !reads.has(item))) {
    throw new RemoteControlContractError("registration contains unsupported read-only capability", "registration_invalid");
  }
  if (registrationControls.some((item) => !controls.has(item))) {
    throw new RemoteControlContractError("registration contains unsupported remote control capability", "registration_invalid");
  }

  const requestedMutations = new Set(unique(registration.allowedMutationActions));
  const requestedReads = new Set(unique(registration.allowedReadOnlyCapabilities));
  const requestedControls = new Set(unique(registrationControls));
  return {
    schemaVersion: 1,
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    remotePrincipalId: registration.remotePrincipalId,
    revision: registration.revision,
    createdAt,
    ...(revokedAt ? { revokedAt } : {}),
    allowedMutationActions: mutationOrder.filter((item) => requestedMutations.has(item)),
    allowedReadOnlyCapabilities: readOrder.filter((item) => requestedReads.has(item)),
    allowedControlCapabilities: controlOrder.filter((item) => requestedControls.has(item)),
  };
}

export function createRemoteControlSessionClaims(
  registrationInput: RemoteControlRegistrationV1,
  request: RemoteControlSessionRequestV1,
  options: { now?: Date; idFactory?: () => string } = {},
): RemoteControlSessionClaimsV1 {
  const registration = normalizeRemoteControlRegistration(registrationInput);
  if (registration.revokedAt) {
    throw new RemoteControlContractError("remote registration is revoked", "registration_revoked");
  }
  if (!Number.isSafeInteger(request.ttlMs)
    || request.ttlMs < MIN_REMOTE_SESSION_TTL_MS
    || request.ttlMs > MAX_REMOTE_SESSION_TTL_MS) {
    throw new RemoteControlContractError(
      `remote session ttl must be between ${MIN_REMOTE_SESSION_TTL_MS} and ${MAX_REMOTE_SESSION_TTL_MS} ms`,
      "session_invalid",
    );
  }

  const requestedMutations = unique(request.mutationActions);
  const requestedReads = unique(request.readOnlyCapabilities);
  const requestedControls = unique(request.controlCapabilities ?? []);
  const allowedMutations = new Set(registration.allowedMutationActions);
  const allowedReads = new Set(registration.allowedReadOnlyCapabilities);
  const allowedControls = new Set(registration.allowedControlCapabilities ?? []);
  if (requestedMutations.some((item) => !allowedMutations.has(item))
    || requestedReads.some((item) => !allowedReads.has(item))
    || requestedControls.some((item) => !allowedControls.has(item))) {
    throw new RemoteControlContractError(
      "remote session requested capability outside the local registration",
      "capability_not_allowed",
    );
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new RemoteControlContractError("remote session clock is invalid", "session_invalid");
  }
  const sessionId = requireUuid(
    (options.idFactory ?? (() => crypto.randomUUID()))(),
    "sessionId",
    "session_invalid",
  );

  return {
    schemaVersion: 1,
    sessionId,
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    remotePrincipalId: registration.remotePrincipalId,
    registrationRevision: registration.revision,
    operatorCapabilitySchemaVersion: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
    mutationActions: requestedMutations,
    readOnlyCapabilities: requestedReads,
    controlCapabilities: requestedControls,
    transportAuthority: "authenticated_session_only",
    humanConfirmationAuthority: "none",
    safetyPlanAuthority: "none",
    credentialAuthority: "none",
    releaseAuthority: "none",
  };
}

export function assertRemoteControlSessionCurrent(
  claims: RemoteControlSessionClaimsV1,
  registrationInput: RemoteControlRegistrationV1,
  now: Date = new Date(),
): void {
  if (claims.schemaVersion !== 1 || claims.operatorCapabilitySchemaVersion !== 1) {
    throw new RemoteControlContractError("Unsupported remote session schema", "session_invalid");
  }
  requireUuid(claims.sessionId, "sessionId", "session_invalid");
  const registration = normalizeRemoteControlRegistration(registrationInput);
  if (registration.revokedAt) {
    throw new RemoteControlContractError("remote registration is revoked", "registration_revoked");
  }
  if (!Number.isFinite(now.getTime())) {
    throw new RemoteControlContractError("remote session clock is invalid", "session_invalid");
  }
  if (Date.parse(claims.expiresAt) <= now.getTime()) {
    throw new RemoteControlContractError("remote session expired", "session_expired");
  }
  if (
    claims.registrationId !== registration.registrationId
    || claims.machineId !== registration.machineId
    || claims.remotePrincipalId !== registration.remotePrincipalId
    || claims.registrationRevision !== registration.revision
  ) {
    throw new RemoteControlContractError(
      "remote session no longer matches current local registration",
      "session_stale",
    );
  }

  const allowedMutations = new Set(registration.allowedMutationActions);
  const allowedReads = new Set(registration.allowedReadOnlyCapabilities);
  const allowedControls = new Set(registration.allowedControlCapabilities ?? []);
  if (claims.mutationActions.some((item) => !allowedMutations.has(item))
    || claims.readOnlyCapabilities.some((item) => !allowedReads.has(item))
    || claims.controlCapabilities.some((item) => !allowedControls.has(item))) {
    throw new RemoteControlContractError(
      "remote session capability projection is stale",
      "session_stale",
    );
  }
  if (
    claims.transportAuthority !== "authenticated_session_only"
    || claims.humanConfirmationAuthority !== "none"
    || claims.safetyPlanAuthority !== "none"
    || claims.credentialAuthority !== "none"
    || claims.releaseAuthority !== "none"
  ) {
    throw new RemoteControlContractError("remote session claims unauthorized authority", "session_invalid");
  }
}
