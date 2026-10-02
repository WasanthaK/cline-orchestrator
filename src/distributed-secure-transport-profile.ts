const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_CONNECT_TIMEOUT_MS = 1_000;
const MAX_CONNECT_TIMEOUT_MS = 30_000;
const MIN_RESPONSE_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SERVER_IDENTITY_PINS = 3;
const SPKI_SHA256_PREFIX = "sha256/";

export const DISTRIBUTED_SECURE_TRANSPORT_PROFILE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  minConnectTimeoutMs: MIN_CONNECT_TIMEOUT_MS,
  maxConnectTimeoutMs: MAX_CONNECT_TIMEOUT_MS,
  minResponseBytes: MIN_RESPONSE_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxServerIdentityPins: MAX_SERVER_IDENTITY_PINS,
  requiresHttps: true as const,
  requiresSystemCaValidation: true as const,
  requiresServerSpkiSha256Pin: true as const,
  bearerTokenAllowedInProfile: false as const,
  credentialMaterialAllowedInProfile: false as const,
  taskOrExecutionMaterialAllowedInProfile: false as const,
  networkIoIncluded: false as const,
  listenerIncluded: false as const,
  dnsLookupIncluded: false as const,
  tlsHandshakeIncluded: false as const,
  httpRequestIncluded: false as const,
  controllerPushEnabled: false as const,
  distributedTakeoverEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedSecureTransportProfileV1 {
  schemaVersion: 1;
  profileId: string;
  controllerOrigin: string;
  serverSpkiSha256Pins: string[];
  connectTimeoutMs: number;
  maxResponseBytes: number;
  serverAuthentication: "system_ca_plus_spki_sha256_pin";
  authority: "transport_configuration_only";
  networkIoEnabled: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DistributedSecureTransportProfileError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "profile_invalid"
      | "endpoint_invalid"
      | "server_identity_invalid"
      | "bounds_invalid"
      | "authority_invalid",
  ) {
    super(message);
    this.name = "DistributedSecureTransportProfileError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedSecureTransportProfileError(
      "distributed secure transport profile must be an object",
      "profile_invalid",
    );
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedSecureTransportProfileError(
      "distributed secure transport profile contains unsupported or missing fields",
      "profile_invalid",
    );
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedSecureTransportProfileError(
      `${field} must be an opaque UUID`,
      "profile_invalid",
    );
  }
  return value;
}

function requireCanonicalHttpsOrigin(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    throw new DistributedSecureTransportProfileError(
      "controllerOrigin must be a canonical HTTPS origin",
      "endpoint_invalid",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DistributedSecureTransportProfileError(
      "controllerOrigin must be a valid absolute HTTPS origin",
      "endpoint_invalid",
    );
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.pathname !== "/"
    || parsed.origin !== value
  ) {
    throw new DistributedSecureTransportProfileError(
      "controllerOrigin must be HTTPS origin-only with no userinfo, path, query or fragment",
      "endpoint_invalid",
    );
  }

  return value;
}

function requireCanonicalSpkiPin(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !value.startsWith(SPKI_SHA256_PREFIX)) {
    throw new DistributedSecureTransportProfileError(
      "server SPKI pin must use canonical sha256/base64 form",
      "server_identity_invalid",
    );
  }

  const encoded = value.slice(SPKI_SHA256_PREFIX.length);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new DistributedSecureTransportProfileError(
      "server SPKI pin must contain exactly one SHA-256 digest",
      "server_identity_invalid",
    );
  }

  let digest: Buffer;
  try {
    digest = Buffer.from(encoded, "base64");
  } catch {
    throw new DistributedSecureTransportProfileError(
      "server SPKI pin is not valid base64",
      "server_identity_invalid",
    );
  }
  if (digest.length !== 32 || digest.toString("base64") !== encoded) {
    throw new DistributedSecureTransportProfileError(
      "server SPKI pin must decode to exactly 32 bytes",
      "server_identity_invalid",
    );
  }

  return value;
}

function requirePins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SERVER_IDENTITY_PINS) {
    throw new DistributedSecureTransportProfileError(
      `serverSpkiSha256Pins must contain between 1 and ${MAX_SERVER_IDENTITY_PINS} pins`,
      "server_identity_invalid",
    );
  }
  const pins = value.map(requireCanonicalSpkiPin);
  if (new Set(pins).size !== pins.length) {
    throw new DistributedSecureTransportProfileError(
      "serverSpkiSha256Pins must not contain duplicates",
      "server_identity_invalid",
    );
  }
  return pins;
}

function requireBoundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedSecureTransportProfileError(
      `${field} must be an integer between ${min} and ${max}`,
      "bounds_invalid",
    );
  }
  return value;
}

export function assertDistributedSecureTransportProfile(
  value: unknown,
): asserts value is DistributedSecureTransportProfileV1 {
  exactKeys(value, [
    "schemaVersion",
    "profileId",
    "controllerOrigin",
    "serverSpkiSha256Pins",
    "connectTimeoutMs",
    "maxResponseBytes",
    "serverAuthentication",
    "authority",
    "networkIoEnabled",
    "grantsTaskAuthority",
    "grantsFilesystemAuthority",
    "grantsSafetyPlanAuthority",
    "grantsWriterLeaseAuthority",
    "grantsCredentialAuthority",
    "grantsReleaseAuthority",
  ]);

  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new DistributedSecureTransportProfileError(
      "unsupported distributed secure transport profile schema version",
      "profile_invalid",
    );
  }

  requireUuid(record.profileId, "profileId");
  requireCanonicalHttpsOrigin(record.controllerOrigin);
  requirePins(record.serverSpkiSha256Pins);
  requireBoundedInteger(
    record.connectTimeoutMs,
    "connectTimeoutMs",
    MIN_CONNECT_TIMEOUT_MS,
    MAX_CONNECT_TIMEOUT_MS,
  );
  requireBoundedInteger(
    record.maxResponseBytes,
    "maxResponseBytes",
    MIN_RESPONSE_BYTES,
    MAX_RESPONSE_BYTES,
  );

  if (
    record.serverAuthentication !== "system_ca_plus_spki_sha256_pin"
    || record.authority !== "transport_configuration_only"
    || record.networkIoEnabled !== false
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedSecureTransportProfileError(
      "distributed secure transport profile cannot weaken server authentication or grant authority",
      "authority_invalid",
    );
  }
}
