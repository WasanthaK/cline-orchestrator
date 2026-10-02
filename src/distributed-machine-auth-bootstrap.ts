import crypto from "node:crypto";
import {
  assertDistributedMachineRegistration,
  type DistributedMachineCapabilityV1,
  type DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";
import {
  DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT,
  type DistributedMachineTransportIssueResultV1,
  type DistributedMachineTransportSessionRequestV1,
} from "./distributed-machine-transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MIN_CHALLENGE_TTL_MS = 5_000;
const MAX_CHALLENGE_TTL_MS = 60_000;
const DEFAULT_CHALLENGE_TTL_MS = 30_000;
const MAX_ACTIVE_CHALLENGES = 256;
const DOMAIN = "cline-orchestrator:m12q:machine-auth:v1";
const MACHINE_CAPABILITIES = new Set<DistributedMachineCapabilityV1>([
  "report_status",
  "accept_writer_candidates",
]);

export const DISTRIBUTED_MACHINE_AUTH_BOOTSTRAP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  algorithm: "Ed25519" as const,
  minChallengeTtlMs: MIN_CHALLENGE_TTL_MS,
  maxChallengeTtlMs: MAX_CHALLENGE_TTL_MS,
  defaultChallengeTtlMs: DEFAULT_CHALLENGE_TTL_MS,
  maxActiveChallenges: MAX_ACTIVE_CHALLENGES,
  privateKeyAccepted: false as const,
  challengeStateProcessLocalOnly: true as const,
  challengeReplayAllowed: false as const,
  registrationIdAloneCanIssueSession: false as const,
  delegatesSessionIssuanceToM12C: true as const,
  networkIoIncluded: false as const,
  listenerIncluded: false as const,
  credentialProvisioningIncluded: false as const,
  privateKeyGenerationIncluded: false as const,
  controllerPushEnabled: false as const,
  distributedTakeoverEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedMachineAuthenticationBindingV1 {
  schemaVersion: 1;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  algorithm: "Ed25519";
  publicKeySpkiDerBase64: string;
  publicKeyFingerprint: string;
  authority: "authentication_metadata_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedMachineAuthenticationChallengeV1 {
  schemaVersion: 1;
  challengeId: string;
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  publicKeyFingerprint: string;
  capabilities: DistributedMachineCapabilityV1[];
  sessionTtlMs: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  authority: "authentication_challenge_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedMachineAuthenticationBindingLookup {
  get(registrationId: string): Promise<DistributedMachineAuthenticationBindingV1>;
}

export interface DistributedMachineAuthenticationRegistrationLookup {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedMachineTransportSessionIssuer {
  issue(
    registrationId: string,
    request: DistributedMachineTransportSessionRequestV1,
  ): Promise<DistributedMachineTransportIssueResultV1>;
}

export interface DistributedMachineAuthenticationChallengeRequestV1 {
  registrationId: string;
  capabilities: DistributedMachineCapabilityV1[];
  sessionTtlMs: number;
}

export interface DistributedMachineAuthenticationChallengeResponseV1 {
  challengeId: string;
  signatureBase64Url: string;
}

export interface DistributedMachineAuthenticationBootstrapOptions {
  now?: () => Date;
  idFactory?: () => string;
  nonceFactory?: () => string;
  challengeTtlMs?: number;
  maxActiveChallenges?: number;
}

export class DistributedMachineAuthenticationBootstrapError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "request_invalid"
      | "registration_not_current"
      | "binding_invalid"
      | "binding_not_current"
      | "capability_not_allowed"
      | "challenge_not_found"
      | "challenge_expired"
      | "challenge_replayed"
      | "signature_invalid"
      | "capacity_exceeded"
      | "session_issue_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedMachineAuthenticationBootstrapError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  code: DistributedMachineAuthenticationBootstrapError["code"],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedMachineAuthenticationBootstrapError(`${label} must be an object`, code);
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedMachineAuthenticationBootstrapError(
      `${label} contains unsupported or missing fields`,
      code,
    );
  }
}

function uuid(value: unknown, field: string, code: DistributedMachineAuthenticationBootstrapError["code"]): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedMachineAuthenticationBootstrapError(`${field} must be an opaque UUID`, code);
  }
  return value;
}

function positiveInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: DistributedMachineAuthenticationBootstrapError["code"],
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedMachineAuthenticationBootstrapError(
      `${field} must be an integer between ${min} and ${max}`,
      code,
    );
  }
  return value;
}

function canonicalCapabilities(
  value: unknown,
  code: DistributedMachineAuthenticationBootstrapError["code"],
): DistributedMachineCapabilityV1[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new DistributedMachineAuthenticationBootstrapError("capabilities must be a non-empty array", code);
  }
  const capabilities = value.map((item) => {
    if (typeof item !== "string" || !MACHINE_CAPABILITIES.has(item as DistributedMachineCapabilityV1)) {
      throw new DistributedMachineAuthenticationBootstrapError("unsupported machine capability", code);
    }
    return item as DistributedMachineCapabilityV1;
  });
  if (new Set(capabilities).size !== capabilities.length) {
    throw new DistributedMachineAuthenticationBootstrapError("capabilities must be unique", code);
  }
  return [...capabilities].sort();
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedMachineAuthenticationBootstrapError(`${field} must be an ISO timestamp`, "request_invalid");
  }
  const canonical = new Date(Date.parse(value)).toISOString();
  if (canonical !== value) {
    throw new DistributedMachineAuthenticationBootstrapError(`${field} must be canonical ISO`, "request_invalid");
  }
  return value;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) {
    throw new DistributedMachineAuthenticationBootstrapError("bootstrap clock is invalid", "request_invalid");
  }
  return value;
}

function parsePublicKey(spkiBase64: unknown): { key: crypto.KeyObject; der: Buffer; canonicalBase64: string } {
  if (typeof spkiBase64 !== "string" || spkiBase64 !== spkiBase64.trim() || !BASE64.test(spkiBase64)) {
    throw new DistributedMachineAuthenticationBootstrapError("public key SPKI must be canonical base64", "binding_invalid");
  }
  const der = Buffer.from(spkiBase64, "base64");
  if (der.length === 0 || der.toString("base64") !== spkiBase64) {
    throw new DistributedMachineAuthenticationBootstrapError("public key SPKI is not canonical base64", "binding_invalid");
  }
  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch (error) {
    throw new DistributedMachineAuthenticationBootstrapError("public key SPKI is invalid", "binding_invalid", { cause: error });
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new DistributedMachineAuthenticationBootstrapError("machine authentication key must be Ed25519", "binding_invalid");
  }
  const canonicalDer = key.export({ format: "der", type: "spki" });
  if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) {
    throw new DistributedMachineAuthenticationBootstrapError("public key SPKI is not canonical Ed25519 DER", "binding_invalid");
  }
  return { key, der, canonicalBase64: der.toString("base64") };
}

function fingerprint(der: Buffer): string {
  return `sha256/${crypto.createHash("sha256").update(der).digest("base64")}`;
}

export function createDistributedMachineAuthenticationBinding(input: {
  registrationId: string;
  machineId: string;
  registrationRevision: number;
  publicKeySpkiDerBase64: string;
}): DistributedMachineAuthenticationBindingV1 {
  const parsed = parsePublicKey(input.publicKeySpkiDerBase64);
  const binding: DistributedMachineAuthenticationBindingV1 = {
    schemaVersion: 1,
    registrationId: uuid(input.registrationId, "registrationId", "binding_invalid"),
    machineId: uuid(input.machineId, "machineId", "binding_invalid"),
    registrationRevision: positiveInteger(input.registrationRevision, "registrationRevision", 1, Number.MAX_SAFE_INTEGER, "binding_invalid"),
    algorithm: "Ed25519",
    publicKeySpkiDerBase64: parsed.canonicalBase64,
    publicKeyFingerprint: fingerprint(parsed.der),
    authority: "authentication_metadata_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedMachineAuthenticationBinding(binding);
  return binding;
}

export function assertDistributedMachineAuthenticationBinding(
  value: unknown,
): asserts value is DistributedMachineAuthenticationBindingV1 {
  exactKeys(value, [
    "schemaVersion",
    "registrationId",
    "machineId",
    "registrationRevision",
    "algorithm",
    "publicKeySpkiDerBase64",
    "publicKeyFingerprint",
    "authority",
    "grantsTaskAuthority",
    "grantsFilesystemAuthority",
    "grantsSafetyPlanAuthority",
    "grantsWriterLeaseAuthority",
    "grantsCredentialAuthority",
    "grantsReleaseAuthority",
  ], "machine authentication binding", "binding_invalid");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.algorithm !== "Ed25519"
    || record.authority !== "authentication_metadata_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedMachineAuthenticationBootstrapError("machine authentication binding cannot grant authority", "binding_invalid");
  }
  uuid(record.registrationId, "registrationId", "binding_invalid");
  uuid(record.machineId, "machineId", "binding_invalid");
  positiveInteger(record.registrationRevision, "registrationRevision", 1, Number.MAX_SAFE_INTEGER, "binding_invalid");
  const parsed = parsePublicKey(record.publicKeySpkiDerBase64);
  if (record.publicKeyFingerprint !== fingerprint(parsed.der)) {
    throw new DistributedMachineAuthenticationBootstrapError("machine authentication public-key fingerprint does not match", "binding_invalid");
  }
}

export function assertDistributedMachineAuthenticationChallenge(
  value: unknown,
): asserts value is DistributedMachineAuthenticationChallengeV1 {
  exactKeys(value, [
    "schemaVersion",
    "challengeId",
    "registrationId",
    "machineId",
    "registrationRevision",
    "publicKeyFingerprint",
    "capabilities",
    "sessionTtlMs",
    "nonce",
    "issuedAt",
    "expiresAt",
    "authority",
    "grantsTaskAuthority",
    "grantsFilesystemAuthority",
    "grantsSafetyPlanAuthority",
    "grantsWriterLeaseAuthority",
    "grantsCredentialAuthority",
    "grantsReleaseAuthority",
  ], "machine authentication challenge", "request_invalid");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.authority !== "authentication_challenge_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedMachineAuthenticationBootstrapError("machine authentication challenge cannot grant authority", "request_invalid");
  }
  uuid(record.challengeId, "challengeId", "request_invalid");
  uuid(record.registrationId, "registrationId", "request_invalid");
  uuid(record.machineId, "machineId", "request_invalid");
  positiveInteger(record.registrationRevision, "registrationRevision", 1, Number.MAX_SAFE_INTEGER, "request_invalid");
  if (typeof record.publicKeyFingerprint !== "string" || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(record.publicKeyFingerprint)) {
    throw new DistributedMachineAuthenticationBootstrapError("publicKeyFingerprint is invalid", "request_invalid");
  }
  canonicalCapabilities(record.capabilities, "request_invalid");
  positiveInteger(
    record.sessionTtlMs,
    "sessionTtlMs",
    DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.minSessionTtlMs,
    DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.maxSessionTtlMs,
    "request_invalid",
  );
  if (typeof record.nonce !== "string" || !BASE64URL.test(record.nonce)) {
    throw new DistributedMachineAuthenticationBootstrapError("challenge nonce is invalid", "request_invalid");
  }
  let nonceBytes: Buffer;
  try {
    nonceBytes = Buffer.from(record.nonce, "base64url");
  } catch (error) {
    throw new DistributedMachineAuthenticationBootstrapError(
      "challenge nonce is invalid",
      "request_invalid",
      { cause: error },
    );
  }
  if (nonceBytes.length !== 32 || nonceBytes.toString("base64url") !== record.nonce) {
    throw new DistributedMachineAuthenticationBootstrapError(
      "challenge nonce must be canonical base64url for exactly 32 bytes",
      "request_invalid",
    );
  }
  const issuedAt = iso(record.issuedAt, "issuedAt");
  const expiresAt = iso(record.expiresAt, "expiresAt");
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttl < MIN_CHALLENGE_TTL_MS || ttl > MAX_CHALLENGE_TTL_MS) {
    throw new DistributedMachineAuthenticationBootstrapError("challenge TTL is outside the allowed bound", "request_invalid");
  }
}

export function distributedMachineAuthenticationChallengePayload(
  challengeInput: DistributedMachineAuthenticationChallengeV1,
): Buffer {
  assertDistributedMachineAuthenticationChallenge(challengeInput);
  const challenge = structuredClone(challengeInput);
  const capabilities = canonicalCapabilities(challenge.capabilities, "request_invalid");
  return Buffer.from(`${DOMAIN}\n${JSON.stringify([
    challenge.schemaVersion,
    challenge.challengeId,
    challenge.registrationId,
    challenge.machineId,
    challenge.registrationRevision,
    challenge.publicKeyFingerprint,
    capabilities,
    challenge.sessionTtlMs,
    challenge.nonce,
    challenge.issuedAt,
    challenge.expiresAt,
  ])}`, "utf8");
}

export class DistributedMachineAuthenticationBootstrap {
  private readonly challenges = new Map<string, DistributedMachineAuthenticationChallengeV1>();
  private readonly challengeTtlMs: number;
  private readonly maxActiveChallenges: number;

  constructor(
    private readonly registrations: DistributedMachineAuthenticationRegistrationLookup,
    private readonly bindings: DistributedMachineAuthenticationBindingLookup,
    private readonly transport: DistributedMachineTransportSessionIssuer,
    private readonly options: DistributedMachineAuthenticationBootstrapOptions = {},
  ) {
    this.challengeTtlMs = positiveInteger(
      options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS,
      "challengeTtlMs",
      MIN_CHALLENGE_TTL_MS,
      MAX_CHALLENGE_TTL_MS,
      "request_invalid",
    );
    this.maxActiveChallenges = positiveInteger(
      options.maxActiveChallenges ?? MAX_ACTIVE_CHALLENGES,
      "maxActiveChallenges",
      1,
      MAX_ACTIVE_CHALLENGES,
      "request_invalid",
    );
  }

  private now(): Date {
    return currentTime(this.options.now);
  }

  private prune(nowMs: number): void {
    for (const [challengeId, challenge] of this.challenges) {
      if (Date.parse(challenge.expiresAt) <= nowMs) this.challenges.delete(challengeId);
    }
  }

  private async currentRegistration(registrationId: string): Promise<DistributedMachineRegistrationV1> {
    try {
      const registration = await this.registrations.get(registrationId);
      assertDistributedMachineRegistration(registration);
      if (registration.revokedAt) throw new Error("registration revoked");
      return registration;
    } catch (error) {
      throw new DistributedMachineAuthenticationBootstrapError(
        "machine registration is not current",
        "registration_not_current",
        { cause: error },
      );
    }
  }

  private async currentBinding(
    registration: DistributedMachineRegistrationV1,
  ): Promise<DistributedMachineAuthenticationBindingV1> {
    let binding: DistributedMachineAuthenticationBindingV1;
    try {
      binding = await this.bindings.get(registration.registrationId);
      assertDistributedMachineAuthenticationBinding(binding);
    } catch (error) {
      if (error instanceof DistributedMachineAuthenticationBootstrapError) throw error;
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication binding is unavailable", "binding_not_current", { cause: error });
    }
    if (
      binding.registrationId !== registration.registrationId
      || binding.machineId !== registration.machineId
      || binding.registrationRevision !== registration.revision
    ) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication binding is stale", "binding_not_current");
    }
    return binding;
  }

  async issueChallenge(
    requestInput: DistributedMachineAuthenticationChallengeRequestV1,
  ): Promise<DistributedMachineAuthenticationChallengeV1> {
    exactKeys(requestInput, ["registrationId", "capabilities", "sessionTtlMs"], "machine authentication challenge request", "request_invalid");
    const registrationId = uuid(requestInput.registrationId, "registrationId", "request_invalid");
    const capabilities = canonicalCapabilities(requestInput.capabilities, "request_invalid");
    const sessionTtlMs = positiveInteger(
      requestInput.sessionTtlMs,
      "sessionTtlMs",
      DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.minSessionTtlMs,
      DISTRIBUTED_MACHINE_TRANSPORT_CONTRACT.maxSessionTtlMs,
      "request_invalid",
    );
    const registration = await this.currentRegistration(registrationId);
    if (capabilities.some((capability) => !registration.allowedCapabilities.includes(capability))) {
      throw new DistributedMachineAuthenticationBootstrapError("requested capability is not allowed by the current registration", "capability_not_allowed");
    }
    const binding = await this.currentBinding(registration);
    const now = this.now();
    this.prune(now.getTime());
    if (this.challenges.size >= this.maxActiveChallenges) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication challenge capacity exceeded", "capacity_exceeded");
    }
    const challenge: DistributedMachineAuthenticationChallengeV1 = {
      schemaVersion: 1,
      challengeId: uuid((this.options.idFactory ?? (() => crypto.randomUUID()))(), "challengeId", "request_invalid"),
      registrationId: registration.registrationId,
      machineId: registration.machineId,
      registrationRevision: registration.revision,
      publicKeyFingerprint: binding.publicKeyFingerprint,
      capabilities,
      sessionTtlMs,
      nonce: (this.options.nonceFactory ?? (() => crypto.randomBytes(32).toString("base64url")))(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.challengeTtlMs).toISOString(),
      authority: "authentication_challenge_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertDistributedMachineAuthenticationChallenge(challenge);
    if (this.challenges.has(challenge.challengeId)) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication challenge id collision", "capacity_exceeded");
    }
    this.challenges.set(challenge.challengeId, structuredClone(challenge));
    return structuredClone(challenge);
  }

  async completeChallenge(
    responseInput: DistributedMachineAuthenticationChallengeResponseV1,
  ): Promise<DistributedMachineTransportIssueResultV1> {
    exactKeys(responseInput, ["challengeId", "signatureBase64Url"], "machine authentication challenge response", "request_invalid");
    const challengeId = uuid(responseInput.challengeId, "challengeId", "request_invalid");
    if (typeof responseInput.signatureBase64Url !== "string" || responseInput.signatureBase64Url.length < 64 || !BASE64URL.test(responseInput.signatureBase64Url)) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication signature is malformed", "signature_invalid");
    }

    const now = this.now();
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication challenge was not found or was already consumed", "challenge_replayed");
    }
    this.challenges.delete(challengeId);
    if (Date.parse(challenge.expiresAt) <= now.getTime()) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication challenge expired", "challenge_expired");
    }

    const registration = await this.currentRegistration(challenge.registrationId);
    if (
      registration.machineId !== challenge.machineId
      || registration.revision !== challenge.registrationRevision
      || challenge.capabilities.some((capability) => !registration.allowedCapabilities.includes(capability))
    ) {
      throw new DistributedMachineAuthenticationBootstrapError("machine registration changed after challenge issuance", "registration_not_current");
    }
    const binding = await this.currentBinding(registration);
    if (binding.publicKeyFingerprint !== challenge.publicKeyFingerprint) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication binding changed after challenge issuance", "binding_not_current");
    }

    const parsed = parsePublicKey(binding.publicKeySpkiDerBase64);
    let signature: Buffer;
    try {
      signature = Buffer.from(responseInput.signatureBase64Url, "base64url");
    } catch (error) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication signature is invalid", "signature_invalid", { cause: error });
    }
    if (signature.length !== 64 || signature.toString("base64url") !== responseInput.signatureBase64Url) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication signature must be canonical Ed25519", "signature_invalid");
    }
    const verified = crypto.verify(
      null,
      distributedMachineAuthenticationChallengePayload(challenge),
      parsed.key,
      signature,
    );
    if (!verified) {
      throw new DistributedMachineAuthenticationBootstrapError("machine authentication signature did not verify", "signature_invalid");
    }

    try {
      return await this.transport.issue(challenge.registrationId, {
        capabilities: [...challenge.capabilities],
        ttlMs: challenge.sessionTtlMs,
      });
    } catch (error) {
      throw new DistributedMachineAuthenticationBootstrapError("M12C session issuance rejected the authenticated machine", "session_issue_failed", { cause: error });
    }
  }
}
