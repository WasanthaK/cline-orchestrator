import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeRemoteControlRegistration,
  RemoteControlContractError,
  type RemoteControlPlaneCapabilityV1,
  type RemoteControlRegistrationV1,
} from "./remote-control-contract.js";
import type {
  OperatorMutationActionV1,
  OperatorReadOnlyCapabilityV1,
} from "./operator-capabilities.js";

const STORE_SCHEMA_VERSION = 1 as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REGISTRATIONS = 256;

interface RemoteRegistrationSnapshotV1 {
  schemaVersion: 1;
  registrations: RemoteControlRegistrationV1[];
}

export interface RemoteRegistrationCreateRequestV1 {
  machineId: string;
  remotePrincipalId: string;
  allowedMutationActions: OperatorMutationActionV1[];
  allowedReadOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  allowedControlCapabilities?: RemoteControlPlaneCapabilityV1[];
}

export interface RemoteRegistrationUpdateRequestV1 {
  expectedRevision: number;
  allowedMutationActions: OperatorMutationActionV1[];
  allowedReadOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  allowedControlCapabilities?: RemoteControlPlaneCapabilityV1[];
}

export interface RemoteRegistrationRevokeRequestV1 {
  expectedRevision: number;
}

export interface RemoteRegistrationPublicViewV1 {
  schemaVersion: 1;
  registrationId: string;
  machineId: string;
  remotePrincipalId: string;
  revision: number;
  createdAt: string;
  status: "active" | "revoked";
  revokedAt?: string;
  allowedMutationActions: OperatorMutationActionV1[];
  allowedReadOnlyCapabilities: OperatorReadOnlyCapabilityV1[];
  allowedControlCapabilities: RemoteControlPlaneCapabilityV1[];
}

export interface RemoteRegistrationStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class RemoteRegistrationStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "registration_not_found"
      | "registration_conflict"
      | "registration_revoked"
      | "store_corrupt"
      | "store_capacity_exceeded",
  ) {
    super(message);
    this.name = "RemoteRegistrationStoreError";
  }
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) {
    throw new RemoteControlContractError(`${field} must be an opaque UUID`, "registration_invalid");
  }
  return value;
}

function publicView(registration: RemoteControlRegistrationV1): RemoteRegistrationPublicViewV1 {
  return {
    schemaVersion: 1,
    registrationId: registration.registrationId,
    machineId: registration.machineId,
    remotePrincipalId: registration.remotePrincipalId,
    revision: registration.revision,
    createdAt: registration.createdAt,
    status: registration.revokedAt ? "revoked" : "active",
    ...(registration.revokedAt ? { revokedAt: registration.revokedAt } : {}),
    allowedMutationActions: [...registration.allowedMutationActions],
    allowedReadOnlyCapabilities: [...registration.allowedReadOnlyCapabilities],
    allowedControlCapabilities: [...(registration.allowedControlCapabilities ?? [])],
  };
}

function validateSnapshot(value: unknown): RemoteRegistrationSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteRegistrationStoreError("remote registration store root is invalid", "store_corrupt");
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(snapshot.registrations)) {
    throw new RemoteRegistrationStoreError("unsupported remote registration store schema", "store_corrupt");
  }
  if (snapshot.registrations.length > MAX_REGISTRATIONS) {
    throw new RemoteRegistrationStoreError("remote registration store exceeds capacity", "store_corrupt");
  }

  const registrations: RemoteControlRegistrationV1[] = [];
  const ids = new Set<string>();
  try {
    for (const raw of snapshot.registrations) {
      const normalized = normalizeRemoteControlRegistration(raw as RemoteControlRegistrationV1);
      if (ids.has(normalized.registrationId)) {
        throw new RemoteRegistrationStoreError("duplicate remote registration id", "store_corrupt");
      }
      ids.add(normalized.registrationId);
      registrations.push(normalized);
    }
  } catch (error) {
    if (error instanceof RemoteRegistrationStoreError) throw error;
    throw new RemoteRegistrationStoreError(
      `remote registration store contains invalid registration: ${error instanceof Error ? error.message : String(error)}`,
      "store_corrupt",
    );
  }
  return { schemaVersion: 1, registrations };
}

/**
 * Machine-local source of truth for remote control registrations.
 *
 * The store persists no bearer/session token, tunnel credential, Hub credential,
 * workspace path or Safety Plan. Mutations are serialized in-process, use
 * optimistic expectedRevision checks, and replace one snapshot atomically so a
 * partial write cannot become the next authority source.
 */
export class RemoteRegistrationStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly options: RemoteRegistrationStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "remote-control");
  }

  private file(): string {
    return path.join(this.dir(), "registrations.json");
  }

  private tempFile(): string {
    return path.join(this.dir(), `.registrations-${process.pid}-${crypto.randomUUID()}.tmp`);
  }

  private nowIso(): string {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new RemoteControlContractError("remote registration clock is invalid", "registration_invalid");
    }
    return now.toISOString();
  }

  private async readSnapshot(): Promise<RemoteRegistrationSnapshotV1> {
    try {
      const raw = await readFile(this.file(), "utf8");
      return validateSnapshot(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: 1, registrations: [] };
      }
      if (error instanceof RemoteRegistrationStoreError) throw error;
      throw new RemoteRegistrationStoreError(
        `failed to read remote registration store: ${error instanceof Error ? error.message : String(error)}`,
        "store_corrupt",
      );
    }
  }

  private async writeSnapshot(snapshot: RemoteRegistrationSnapshotV1): Promise<void> {
    const normalized = validateSnapshot(snapshot);
    await mkdir(this.dir(), { recursive: true });
    const temp = this.tempFile();
    await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.file());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async list(): Promise<RemoteRegistrationPublicViewV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.registrations
      .map(publicView)
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  }

  async get(registrationId: string): Promise<RemoteRegistrationPublicViewV1> {
    return publicView(await this.getRegistration(registrationId));
  }

  async getRegistration(registrationId: string): Promise<RemoteControlRegistrationV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    const snapshot = await this.readSnapshot();
    const registration = snapshot.registrations.find((item) => item.registrationId === registrationId);
    if (!registration) {
      throw new RemoteRegistrationStoreError("remote registration was not found", "registration_not_found");
    }
    return structuredClone(registration);
  }

  async create(request: RemoteRegistrationCreateRequestV1): Promise<RemoteRegistrationPublicViewV1> {
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.registrations.length >= MAX_REGISTRATIONS) {
        throw new RemoteRegistrationStoreError("remote registration store capacity exceeded", "store_capacity_exceeded");
      }
      const registration = normalizeRemoteControlRegistration({
        schemaVersion: 1,
        registrationId: requireUuid(
          (this.options.idFactory ?? (() => crypto.randomUUID()))(),
          "registrationId",
        ),
        machineId: requireUuid(request.machineId, "machineId"),
        remotePrincipalId: requireUuid(request.remotePrincipalId, "remotePrincipalId"),
        revision: 1,
        createdAt: this.nowIso(),
        allowedMutationActions: request.allowedMutationActions,
        allowedReadOnlyCapabilities: request.allowedReadOnlyCapabilities,
        allowedControlCapabilities: request.allowedControlCapabilities ?? [],
      });
      if (snapshot.registrations.some((item) => item.registrationId === registration.registrationId)) {
        throw new RemoteRegistrationStoreError("remote registration id already exists", "registration_conflict");
      }
      snapshot.registrations.push(registration);
      await this.writeSnapshot(snapshot);
      return publicView(registration);
    });
  }

  async update(
    registrationId: string,
    request: RemoteRegistrationUpdateRequestV1,
  ): Promise<RemoteRegistrationPublicViewV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.registrations.findIndex((item) => item.registrationId === registrationId);
      if (index < 0) {
        throw new RemoteRegistrationStoreError("remote registration was not found", "registration_not_found");
      }
      const current = snapshot.registrations[index]!;
      if (current.revokedAt) {
        throw new RemoteRegistrationStoreError("remote registration is revoked", "registration_revoked");
      }
      if (request.expectedRevision !== current.revision) {
        throw new RemoteRegistrationStoreError("remote registration revision changed", "registration_conflict");
      }
      const next = normalizeRemoteControlRegistration({
        ...current,
        revision: current.revision + 1,
        allowedMutationActions: request.allowedMutationActions,
        allowedReadOnlyCapabilities: request.allowedReadOnlyCapabilities,
        allowedControlCapabilities: request.allowedControlCapabilities ?? [],
      });
      snapshot.registrations[index] = next;
      await this.writeSnapshot(snapshot);
      return publicView(next);
    });
  }

  async revoke(
    registrationId: string,
    request: RemoteRegistrationRevokeRequestV1,
  ): Promise<RemoteRegistrationPublicViewV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.registrations.findIndex((item) => item.registrationId === registrationId);
      if (index < 0) {
        throw new RemoteRegistrationStoreError("remote registration was not found", "registration_not_found");
      }
      const current = snapshot.registrations[index]!;
      if (current.revokedAt) {
        throw new RemoteRegistrationStoreError("remote registration is revoked", "registration_revoked");
      }
      if (request.expectedRevision !== current.revision) {
        throw new RemoteRegistrationStoreError("remote registration revision changed", "registration_conflict");
      }
      const next = normalizeRemoteControlRegistration({
        ...current,
        revision: current.revision + 1,
        revokedAt: this.nowIso(),
      });
      snapshot.registrations[index] = next;
      await this.writeSnapshot(snapshot);
      return publicView(next);
    });
  }
}
