import crypto, {
  createPrivateKey,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import {
  assertDistributedMachineRegistration,
  type DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";
import {
  createDistributedMachineAuthenticationBinding,
  type DistributedMachineAuthenticationBindingV1,
} from "./distributed-machine-auth-bootstrap.js";
import type {
  FileDistributedMachineAuthenticationBindingStore,
} from "./distributed-machine-auth-binding-store.js";
import {
  assertDistributedSecureTransportProfile,
  type DistributedSecureTransportProfileV1,
} from "./distributed-secure-transport-profile.js";
import type {
  DistributedSharedTlsIdentity,
  DistributedSharedTlsIdentityPreflightReceiptV1,
} from "./distributed-shared-unbound-https.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRIVATE_KEY_BYTES = 64 * 1024;
const MAX_CERTIFICATE_CHAIN_BYTES = 256 * 1024;
const MIN_PERMIT_TTL_MS = 30_000;
const MAX_PERMIT_TTL_MS = 300_000;
const DEFAULT_PERMIT_TTL_MS = 120_000;

export const DISTRIBUTED_DEPLOYMENT_LISTENER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  durableMachineBindingStoreIncluded: true as const,
  machineBindingStoresPrivateKey: false as const,
  machineKeyRotationBumpsRegistrationRevision: true as const,
  tlsIdentityLoaderIsReadOnly: true as const,
  tlsProvisioningIncluded: false as const,
  automaticCertificateRenewalIncluded: false as const,
  selfSignedFallbackAllowed: false as const,
  bindAddressMustBeExplicitIp: true as const,
  wildcardBindAllowed: false as const,
  publicBindAllowed: false as const,
  bindPortMustMatchControllerOrigin: true as const,
  listenerActivationRequiresOneShotPermit: true as const,
  permitProcessLocalOnly: true as const,
  permitConsumedBeforeBind: true as const,
  hostedProofUsesRealNetworkBind: false as const,
  firewallMutationIncluded: false as const,
  dnsMutationIncluded: false as const,
  tunnelMutationIncluded: false as const,
  reverseProxyTrustEnabled: false as const,
  controllerPushEnabled: false as const,
  distributedTakeoverEnabled: false as const,
  invokesTargetRuntime: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedLocalTlsIdentityConfigV1 {
  schemaVersion: 1;
  privateKeyPath: string;
  certificateChainPath: string;
  authority: "local_deployment_configuration_only";
  grantsCredentialAuthority: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedListenerBindingConfigV1 {
  schemaVersion: 1;
  profileId: string;
  controllerOrigin: string;
  bindAddress: string;
  port: number;
  exposure: "loopback" | "private_network";
  authority: "listener_configuration_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedListenerActivationPermitV1 {
  schemaVersion: 1;
  permitId: string;
  profileId: string;
  controllerOrigin: string;
  bindAddress: string;
  port: number;
  leafSpkiSha256Pin: string;
  issuedAt: string;
  expiresAt: string;
  authority: "listener_activation_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedListenerActivationReceiptV1 {
  schemaVersion: 1;
  profileId: string;
  controllerOrigin: string;
  bindAddress: string;
  port: number;
  leafSpkiSha256Pin: string;
  listening: true;
  authority: "listener_state_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedRegistrationRevisionStore {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
  update(
    registrationId: string,
    request: {
      expectedRevision: number;
      allowedCapabilities: DistributedMachineRegistrationV1["allowedCapabilities"];
    },
  ): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedMachineBindingMutationStore {
  get(registrationId: string): Promise<DistributedMachineAuthenticationBindingV1>;
  put(
    binding: DistributedMachineAuthenticationBindingV1,
    expected?: {
      absent?: true;
      publicKeyFingerprint?: string;
      registrationRevision?: number;
    },
  ): Promise<DistributedMachineAuthenticationBindingV1>;
}

export interface DistributedListenerBindPrimitive {
  bind(
    server: https.Server,
    request: { host: string; port: number; exclusive: true },
  ): Promise<void>;
}

export interface DistributedListenerActivationInput {
  server: https.Server;
  bindConfig: DistributedListenerBindingConfigV1;
  preflight: DistributedSharedTlsIdentityPreflightReceiptV1;
  permit: DistributedListenerActivationPermitV1;
}

export class DistributedDeploymentListenerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "configuration_invalid"
      | "credential_path_invalid"
      | "credential_file_invalid"
      | "private_key_invalid"
      | "certificate_chain_invalid"
      | "registration_not_current"
      | "binding_rotation_failed"
      | "bind_invalid"
      | "permit_invalid"
      | "permit_expired"
      | "permit_replayed"
      | "server_already_listening"
      | "bind_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedDeploymentListenerError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  code: DistributedDeploymentListenerError["code"],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedDeploymentListenerError(`${label} must be an object`, code);
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedDeploymentListenerError(
      `${label} contains unsupported or missing fields`,
      code,
    );
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedDeploymentListenerError(
      `${field} must be a canonical UUID`,
      "configuration_invalid",
    );
  }
  return value;
}

function canonicalAbsolutePath(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) {
    throw new DistributedDeploymentListenerError(
      `${field} must be an absolute canonical local path`,
      "credential_path_invalid",
    );
  }
  return value;
}

async function strictReadRegularFile(
  filePath: string,
  maxBytes: number,
  privateMaterial: boolean,
): Promise<Buffer> {
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    throw new DistributedDeploymentListenerError(
      "credential file is unavailable",
      "credential_file_invalid",
    );
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new DistributedDeploymentListenerError(
      "credential path must be a bounded regular non-symlink file",
      "credential_file_invalid",
    );
  }
  if (
    privateMaterial
    && process.platform !== "win32"
    && (info.mode & 0o077) !== 0
  ) {
    throw new DistributedDeploymentListenerError(
      "private key file must not grant group or other permissions",
      "credential_file_invalid",
    );
  }
  let value: Buffer;
  try {
    value = await readFile(filePath);
  } catch {
    throw new DistributedDeploymentListenerError(
      "credential file could not be read",
      "credential_file_invalid",
    );
  }
  if (value.length < 1 || value.length > maxBytes) {
    throw new DistributedDeploymentListenerError(
      "credential file changed outside byte bounds",
      "credential_file_invalid",
    );
  }
  return value;
}

function parseCertificateChain(raw: Buffer): string[] {
  const text = raw.toString("utf8");
  const matches = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!matches || matches.length < 1) {
    throw new DistributedDeploymentListenerError(
      "certificate chain contains no PEM certificate",
      "certificate_chain_invalid",
    );
  }
  const remainder = text.replace(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    "",
  );
  if (remainder.trim() !== "") {
    throw new DistributedDeploymentListenerError(
      "certificate chain contains unsupported material",
      "certificate_chain_invalid",
    );
  }
  try {
    for (const pem of matches) new X509Certificate(pem);
  } catch {
    throw new DistributedDeploymentListenerError(
      "certificate chain contains invalid certificate",
      "certificate_chain_invalid",
    );
  }
  return matches.map((pem) => `${pem}\n`);
}

export async function loadDistributedLocalTlsIdentity(
  config: DistributedLocalTlsIdentityConfigV1,
): Promise<DistributedSharedTlsIdentity> {
  exactKeys(
    config,
    [
      "schemaVersion",
      "privateKeyPath",
      "certificateChainPath",
      "authority",
      "grantsCredentialAuthority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsReleaseAuthority",
    ],
    "configuration_invalid",
    "TLS identity config",
  );
  if (
    config.schemaVersion !== 1
    || config.authority !== "local_deployment_configuration_only"
    || config.grantsCredentialAuthority !== false
    || config.grantsTaskAuthority !== false
    || config.grantsFilesystemAuthority !== false
    || config.grantsSafetyPlanAuthority !== false
    || config.grantsWriterLeaseAuthority !== false
    || config.grantsReleaseAuthority !== false
  ) {
    throw new DistributedDeploymentListenerError(
      "TLS identity config cannot grant authority",
      "configuration_invalid",
    );
  }
  const privateKeyPath = canonicalAbsolutePath(config.privateKeyPath, "privateKeyPath");
  const certificateChainPath = canonicalAbsolutePath(
    config.certificateChainPath,
    "certificateChainPath",
  );
  if (privateKeyPath === certificateChainPath) {
    throw new DistributedDeploymentListenerError(
      "private key and certificate chain paths must differ",
      "credential_path_invalid",
    );
  }

  const [keyRaw, certRaw] = await Promise.all([
    strictReadRegularFile(privateKeyPath, MAX_PRIVATE_KEY_BYTES, true),
    strictReadRegularFile(certificateChainPath, MAX_CERTIFICATE_CHAIN_BYTES, false),
  ]);

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(keyRaw);
  } catch {
    keyRaw.fill(0);
    throw new DistributedDeploymentListenerError(
      "private key must be an unencrypted supported private key",
      "private_key_invalid",
    );
  }
  keyRaw.fill(0);
  if (privateKey.type !== "private") {
    throw new DistributedDeploymentListenerError(
      "loaded key is not private key material",
      "private_key_invalid",
    );
  }
  const certificates = parseCertificateChain(certRaw);
  certRaw.fill(0);

  return {
    privateKey,
    certificates,
  };
}

function currentRegistration(
  registration: DistributedMachineRegistrationV1,
): DistributedMachineRegistrationV1 {
  try {
    assertDistributedMachineRegistration(registration);
  } catch {
    throw new DistributedDeploymentListenerError(
      "machine registration is invalid",
      "registration_not_current",
    );
  }
  if (registration.revokedAt) {
    throw new DistributedDeploymentListenerError(
      "machine registration is revoked",
      "registration_not_current",
    );
  }
  return structuredClone(registration);
}

export async function enrollDistributedMachineAuthenticationPublicKey(
  registrationId: string,
  publicKeySpkiDerBase64: string,
  dependencies: {
    registrations: Pick<DistributedRegistrationRevisionStore, "get">;
    bindings: Pick<FileDistributedMachineAuthenticationBindingStore, "put">;
  },
): Promise<DistributedMachineAuthenticationBindingV1> {
  registrationId = uuid(registrationId, "registrationId");
  const registration = currentRegistration(await dependencies.registrations.get(registrationId));
  const binding = createDistributedMachineAuthenticationBinding({
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    registrationRevision: registration.revision,
    publicKeySpkiDerBase64,
  });
  return dependencies.bindings.put(binding, { absent: true });
}

export async function rotateDistributedMachineAuthenticationPublicKey(
  input: {
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedCurrentFingerprint: string;
    newPublicKeySpkiDerBase64: string;
  },
  dependencies: {
    registrations: DistributedRegistrationRevisionStore;
    bindings: DistributedMachineBindingMutationStore;
  },
): Promise<DistributedMachineAuthenticationBindingV1> {
  exactKeys(
    input,
    [
      "registrationId",
      "expectedRegistrationRevision",
      "expectedCurrentFingerprint",
      "newPublicKeySpkiDerBase64",
    ],
    "configuration_invalid",
    "machine key rotation input",
  );
  const registrationId = uuid(input.registrationId, "registrationId");
  if (
    !Number.isSafeInteger(input.expectedRegistrationRevision)
    || input.expectedRegistrationRevision < 1
    || typeof input.expectedCurrentFingerprint !== "string"
    || input.expectedCurrentFingerprint.length < 1
    || typeof input.newPublicKeySpkiDerBase64 !== "string"
  ) {
    throw new DistributedDeploymentListenerError(
      "machine key rotation input is invalid",
      "configuration_invalid",
    );
  }

  const current = currentRegistration(await dependencies.registrations.get(registrationId));
  if (current.revision !== input.expectedRegistrationRevision) {
    throw new DistributedDeploymentListenerError(
      "machine registration revision changed",
      "registration_not_current",
    );
  }
  const currentBinding = await dependencies.bindings.get(registrationId);
  if (
    currentBinding.registrationRevision !== current.revision
    || currentBinding.publicKeyFingerprint !== input.expectedCurrentFingerprint
  ) {
    throw new DistributedDeploymentListenerError(
      "machine authentication binding changed",
      "registration_not_current",
    );
  }

  const revised = currentRegistration(await dependencies.registrations.update(
    registrationId,
    {
      expectedRevision: current.revision,
      allowedCapabilities: [...current.allowedCapabilities],
    },
  ));

  const replacement = createDistributedMachineAuthenticationBinding({
    registrationId: revised.registrationId,
    machineId: revised.machineId,
    registrationRevision: revised.revision,
    publicKeySpkiDerBase64: input.newPublicKeySpkiDerBase64,
  });

  try {
    return await dependencies.bindings.put(replacement, {
      publicKeyFingerprint: currentBinding.publicKeyFingerprint,
      registrationRevision: currentBinding.registrationRevision,
    });
  } catch (error) {
    throw new DistributedDeploymentListenerError(
      "registration revision was bumped but new public binding could not be installed",
      "binding_rotation_failed",
      { cause: error },
    );
  }
}

function parseIpv4(address: string): number[] {
  return address.split(".").map((value) => Number(value));
}

function isLoopback(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return parseIpv4(address)[0] === 127;
  if (family === 6) return address.toLowerCase() === "::1";
  return false;
}

function isPrivateLocal(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = parseIpv4(address);
    return a === 10
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

function effectiveOriginPort(origin: string): number {
  const parsed = new URL(origin);
  return parsed.port === "" ? 443 : Number(parsed.port);
}

export function createDistributedListenerBindingConfig(
  profile: DistributedSecureTransportProfileV1,
  input: {
    bindAddress: string;
    port: number;
    exposure: "loopback" | "private_network";
  },
): DistributedListenerBindingConfigV1 {
  try {
    assertDistributedSecureTransportProfile(profile);
  } catch {
    throw new DistributedDeploymentListenerError(
      "M12P profile is invalid",
      "bind_invalid",
    );
  }
  exactKeys(
    input,
    ["bindAddress", "port", "exposure"],
    "bind_invalid",
    "listener bind input",
  );
  if (
    typeof input.bindAddress !== "string"
    || input.bindAddress !== input.bindAddress.trim()
    || isIP(input.bindAddress) === 0
    || input.bindAddress === "0.0.0.0"
    || input.bindAddress === "::"
    || !Number.isSafeInteger(input.port)
    || input.port < 1
    || input.port > 65_535
    || (input.exposure !== "loopback" && input.exposure !== "private_network")
  ) {
    throw new DistributedDeploymentListenerError(
      "listener bind address/port/exposure is invalid",
      "bind_invalid",
    );
  }
  if (input.port !== effectiveOriginPort(profile.controllerOrigin)) {
    throw new DistributedDeploymentListenerError(
      "listener port must match controller origin",
      "bind_invalid",
    );
  }
  if (input.exposure === "loopback" && !isLoopback(input.bindAddress)) {
    throw new DistributedDeploymentListenerError(
      "loopback exposure requires loopback address",
      "bind_invalid",
    );
  }
  if (input.exposure === "private_network" && !isPrivateLocal(input.bindAddress)) {
    throw new DistributedDeploymentListenerError(
      "private-network exposure requires private/local unicast address",
      "bind_invalid",
    );
  }

  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    controllerOrigin: profile.controllerOrigin,
    bindAddress: input.bindAddress,
    port: input.port,
    exposure: input.exposure,
    authority: "listener_configuration_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function assertBindConfig(value: DistributedListenerBindingConfigV1): void {
  exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "controllerOrigin",
      "bindAddress",
      "port",
      "exposure",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    "bind_invalid",
    "listener bind config",
  );
  let origin: URL;
  try {
    origin = new URL(value.controllerOrigin);
  } catch {
    throw new DistributedDeploymentListenerError(
      "listener bind config is invalid",
      "bind_invalid",
    );
  }
  if (
    value.schemaVersion !== 1
    || !UUID.test(value.profileId)
    || origin.protocol !== "https:"
    || origin.origin !== value.controllerOrigin
    || origin.pathname !== "/"
    || origin.search !== ""
    || origin.hash !== ""
    || origin.username !== ""
    || origin.password !== ""
    || isIP(value.bindAddress) === 0
    || value.bindAddress === "0.0.0.0"
    || value.bindAddress === "::"
    || !Number.isSafeInteger(value.port)
    || value.port < 1
    || value.port > 65_535
    || value.port !== effectiveOriginPort(value.controllerOrigin)
    || (value.exposure !== "loopback" && value.exposure !== "private_network")
    || (value.exposure === "loopback" && !isLoopback(value.bindAddress))
    || (value.exposure === "private_network" && !isPrivateLocal(value.bindAddress))
    || value.authority !== "listener_configuration_only"
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new DistributedDeploymentListenerError(
      "listener bind config is invalid",
      "bind_invalid",
    );
  }
}

function assertPreflight(
  value: DistributedSharedTlsIdentityPreflightReceiptV1,
): void {
  exactKeys(
    value,
    [
      "schemaVersion",
      "profileId",
      "controllerOrigin",
      "leafSpkiSha256Pin",
      "certificateValidFrom",
      "certificateValidTo",
      "hostnameOrIpMatched",
      "privateKeyMatched",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    "permit_invalid",
    "TLS preflight receipt",
  );
  if (
    value.schemaVersion !== 1
    || !UUID.test(value.profileId)
    || value.hostnameOrIpMatched !== true
    || value.privateKeyMatched !== true
    || value.authority !== "deployment_readiness_evidence_only"
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new DistributedDeploymentListenerError(
      "TLS preflight receipt is invalid",
      "permit_invalid",
    );
  }
}

function nowDate(factory: (() => Date) | undefined): Date {
  const value = (factory ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedDeploymentListenerError(
      "listener activation clock is invalid",
      "configuration_invalid",
    );
  }
  return value;
}

function canonicalPermit(
  permit: DistributedListenerActivationPermitV1,
): string {
  return JSON.stringify(permit);
}

export class DistributedListenerActivationPermitIssuer {
  private readonly permits = new Map<string, DistributedListenerActivationPermitV1>();

  constructor(
    private readonly options: {
      now?: () => Date;
      idFactory?: () => string;
      defaultTtlMs?: number;
    } = {},
  ) {
    const ttl = options.defaultTtlMs ?? DEFAULT_PERMIT_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl < MIN_PERMIT_TTL_MS || ttl > MAX_PERMIT_TTL_MS) {
      throw new DistributedDeploymentListenerError(
        "default activation permit TTL is invalid",
        "configuration_invalid",
      );
    }
  }

  issue(
    bindConfig: DistributedListenerBindingConfigV1,
    preflight: DistributedSharedTlsIdentityPreflightReceiptV1,
    ttlMs = this.options.defaultTtlMs ?? DEFAULT_PERMIT_TTL_MS,
  ): DistributedListenerActivationPermitV1 {
    assertBindConfig(bindConfig);
    assertPreflight(preflight);
    if (
      preflight.profileId !== bindConfig.profileId
      || preflight.controllerOrigin !== bindConfig.controllerOrigin
    ) {
      throw new DistributedDeploymentListenerError(
        "preflight does not match listener bind config",
        "permit_invalid",
      );
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_PERMIT_TTL_MS || ttlMs > MAX_PERMIT_TTL_MS) {
      throw new DistributedDeploymentListenerError(
        "activation permit TTL is invalid",
        "configuration_invalid",
      );
    }
    const issued = nowDate(this.options.now);
    const permitId = uuid(
      (this.options.idFactory ?? (() => crypto.randomUUID()))(),
      "permitId",
    );
    const permit: DistributedListenerActivationPermitV1 = {
      schemaVersion: 1,
      permitId,
      profileId: bindConfig.profileId,
      controllerOrigin: bindConfig.controllerOrigin,
      bindAddress: bindConfig.bindAddress,
      port: bindConfig.port,
      leafSpkiSha256Pin: preflight.leafSpkiSha256Pin,
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + ttlMs).toISOString(),
      authority: "listener_activation_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    this.permits.set(permitId, structuredClone(permit));
    return structuredClone(permit);
  }

  consume(
    permit: DistributedListenerActivationPermitV1,
    bindConfig: DistributedListenerBindingConfigV1,
    preflight: DistributedSharedTlsIdentityPreflightReceiptV1,
  ): DistributedListenerActivationPermitV1 {
    assertBindConfig(bindConfig);
    assertPreflight(preflight);
    if (!permit || typeof permit !== "object" || !UUID.test(permit.permitId ?? "")) {
      throw new DistributedDeploymentListenerError(
        "activation permit is invalid",
        "permit_invalid",
      );
    }
    const stored = this.permits.get(permit.permitId);
    if (!stored) {
      throw new DistributedDeploymentListenerError(
        "activation permit is unavailable or already consumed",
        "permit_replayed",
      );
    }
    if (canonicalPermit(stored) !== canonicalPermit(permit)) {
      throw new DistributedDeploymentListenerError(
        "activation permit does not match issued permit",
        "permit_invalid",
      );
    }
    if (
      stored.profileId !== bindConfig.profileId
      || stored.controllerOrigin !== bindConfig.controllerOrigin
      || stored.bindAddress !== bindConfig.bindAddress
      || stored.port !== bindConfig.port
      || stored.profileId !== preflight.profileId
      || stored.controllerOrigin !== preflight.controllerOrigin
      || stored.leafSpkiSha256Pin !== preflight.leafSpkiSha256Pin
    ) {
      throw new DistributedDeploymentListenerError(
        "activation permit is not bound to current deployment evidence",
        "permit_invalid",
      );
    }
    const now = nowDate(this.options.now);
    if (now.getTime() >= Date.parse(stored.expiresAt)) {
      this.permits.delete(stored.permitId);
      throw new DistributedDeploymentListenerError(
        "activation permit expired",
        "permit_expired",
      );
    }

    this.permits.delete(stored.permitId);
    return structuredClone(stored);
  }
}

export class NodeDistributedListenerBindPrimitive
implements DistributedListenerBindPrimitive {
  async bind(
    server: https.Server,
    request: { host: string; port: number; exclusive: true },
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({
        host: request.host,
        port: request.port,
        exclusive: true,
      });
    });
  }
}

export class DistributedListenerActivationController {
  constructor(
    private readonly permits: DistributedListenerActivationPermitIssuer,
    private readonly binder: DistributedListenerBindPrimitive = new NodeDistributedListenerBindPrimitive(),
  ) {}

  async activate(
    input: DistributedListenerActivationInput,
  ): Promise<DistributedListenerActivationReceiptV1> {
    if (input.server.listening) {
      throw new DistributedDeploymentListenerError(
        "server is already listening",
        "server_already_listening",
      );
    }
    assertBindConfig(input.bindConfig);
    assertPreflight(input.preflight);

    const consumed = this.permits.consume(
      input.permit,
      input.bindConfig,
      input.preflight,
    );

    try {
      await this.binder.bind(input.server, {
        host: input.bindConfig.bindAddress,
        port: input.bindConfig.port,
        exclusive: true,
      });
    } catch (error) {
      throw new DistributedDeploymentListenerError(
        "listener bind failed after permit consumption",
        "bind_failed",
        { cause: error },
      );
    }

    return {
      schemaVersion: 1,
      profileId: consumed.profileId,
      controllerOrigin: consumed.controllerOrigin,
      bindAddress: consumed.bindAddress,
      port: consumed.port,
      leafSpkiSha256Pin: consumed.leafSpkiSha256Pin,
      listening: true,
      authority: "listener_state_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
  }
}
