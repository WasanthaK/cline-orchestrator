import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./atomic-write.js";
import {
  assertDistributedMachineRegistration,
  DistributedControlContractError,
  type DistributedMachineCapabilityV1,
  type DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";

const STORE_SCHEMA_VERSION = 1 as const;
const MAX_REGISTRATIONS = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DistributedRegistrationSnapshotV1 {
  schemaVersion: 1;
  registrations: DistributedMachineRegistrationV1[];
}

export interface DistributedRegistrationCreateRequestV1 {
  machineId: string;
  allowedCapabilities: DistributedMachineCapabilityV1[];
}

export interface DistributedRegistrationUpdateRequestV1 {
  expectedRevision: number;
  allowedCapabilities: DistributedMachineCapabilityV1[];
}

export interface DistributedRegistrationRevokeRequestV1 {
  expectedRevision: number;
}

export interface DistributedRegistrationStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedRegistrationStoreError extends Error {
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
    this.name = "DistributedRegistrationStoreError";
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DistributedControlContractError(
      `${field} must be an opaque UUID`,
      "registration_invalid",
    );
  }
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new DistributedControlContractError(
      `${field} must be an opaque UUID`,
      "registration_invalid",
    );
  }
  return normalized;
}

function requireExpectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedRegistrationStoreError(
      "expectedRevision must be a positive integer",
      "registration_conflict",
    );
  }
  return value;
}

function exactRequestKeys(
  value: unknown,
  required: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControlContractError(
      `${label} must be an object`,
      "registration_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== required.length || keys.some((key) => !required.includes(key))) {
    throw new DistributedControlContractError(
      `${label} contains unsupported or missing fields`,
      "registration_invalid",
    );
  }
}

function requestCapabilities(value: unknown): DistributedMachineCapabilityV1[] {
  if (!Array.isArray(value)) {
    throw new DistributedControlContractError(
      "allowedCapabilities must be an array",
      "registration_invalid",
    );
  }
  return [...value] as DistributedMachineCapabilityV1[];
}

function exactSnapshotKeys(snapshot: Record<string, unknown>): void {
  const keys = Object.keys(snapshot);
  if (
    keys.length !== 2
    || !keys.includes("schemaVersion")
    || !keys.includes("registrations")
  ) {
    throw new DistributedRegistrationStoreError(
      "distributed registration store contains unsupported fields",
      "store_corrupt",
    );
  }
}

function validateSnapshot(value: unknown): DistributedRegistrationSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedRegistrationStoreError(
      "distributed registration store root is invalid",
      "store_corrupt",
    );
  }

  const snapshot = value as Record<string, unknown>;
  exactSnapshotKeys(snapshot);
  if (snapshot.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(snapshot.registrations)) {
    throw new DistributedRegistrationStoreError(
      "unsupported distributed registration store schema",
      "store_corrupt",
    );
  }
  if (snapshot.registrations.length > MAX_REGISTRATIONS) {
    throw new DistributedRegistrationStoreError(
      "distributed registration store exceeds capacity",
      "store_corrupt",
    );
  }

  const registrations: DistributedMachineRegistrationV1[] = [];
  const registrationIds = new Set<string>();
  const activeMachineIds = new Set<string>();
  try {
    for (const raw of snapshot.registrations) {
      assertDistributedMachineRegistration(raw);
      const registration = structuredClone(raw);
      if (registrationIds.has(registration.registrationId)) {
        throw new DistributedRegistrationStoreError(
          "duplicate distributed registration id",
          "store_corrupt",
        );
      }
      registrationIds.add(registration.registrationId);

      if (!registration.revokedAt) {
        if (activeMachineIds.has(registration.machineId)) {
          throw new DistributedRegistrationStoreError(
            "multiple active registrations exist for one machine",
            "store_corrupt",
          );
        }
        activeMachineIds.add(registration.machineId);
      }
      registrations.push(registration);
    }
  } catch (error) {
    if (error instanceof DistributedRegistrationStoreError) throw error;
    throw new DistributedRegistrationStoreError(
      `distributed registration store contains invalid registration: ${error instanceof Error ? error.message : String(error)}`,
      "store_corrupt",
    );
  }

  return { schemaVersion: 1, registrations };
}

/**
 * Controller-local durable identity state for M12 machine registrations.
 *
 * This store persists only the M12A identity-only registration schema. It never
 * stores workspace paths, endpoints, commands, Safety Plans, credentials, Hub
 * tokens, release authority, or distributed writer authority. Mutations are
 * serialized in-process, require exact expectedRevision values, and replace the
 * snapshot atomically with restrictive file permissions.
 */
export class DistributedRegistrationStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly options: DistributedRegistrationStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "distributed-control");
  }

  private file(): string {
    return path.join(this.dir(), "machine-registrations.json");
  }

  private nowIso(notBefore?: string): string {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedControlContractError(
        "distributed registration clock is invalid",
        "registration_invalid",
      );
    }
    if (notBefore !== undefined && now.getTime() < Date.parse(notBefore)) {
      throw new DistributedControlContractError(
        "distributed registration clock moved backwards",
        "registration_invalid",
      );
    }
    return now.toISOString();
  }

  private nextRegistrationId(): string {
    return requireUuid(
      (this.options.idFactory ?? (() => crypto.randomUUID()))(),
      "registrationId",
    );
  }

  private async readSnapshot(): Promise<DistributedRegistrationSnapshotV1> {
    try {
      const raw = await readFile(this.file(), "utf8");
      return validateSnapshot(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: 1, registrations: [] };
      }
      if (error instanceof DistributedRegistrationStoreError) throw error;
      throw new DistributedRegistrationStoreError(
        `failed to read distributed registration store: ${error instanceof Error ? error.message : String(error)}`,
        "store_corrupt",
      );
    }
  }

  private async writeSnapshot(snapshot: DistributedRegistrationSnapshotV1): Promise<void> {
    const validated = validateSnapshot(snapshot);
    await mkdir(this.dir(), { recursive: true });
    await atomicWriteUtf8(
      this.file(),
      `${JSON.stringify(validated, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async list(): Promise<DistributedMachineRegistrationV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.registrations
      .map((registration) => structuredClone(registration))
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  }

  async get(registrationId: string): Promise<DistributedMachineRegistrationV1> {
    registrationId = requireUuid(registrationId, "registrationId");
    const snapshot = await this.readSnapshot();
    const registration = snapshot.registrations.find(
      (item) => item.registrationId === registrationId,
    );
    if (!registration) {
      throw new DistributedRegistrationStoreError(
        "distributed registration was not found",
        "registration_not_found",
      );
    }
    return structuredClone(registration);
  }

  async create(
    request: DistributedRegistrationCreateRequestV1,
  ): Promise<DistributedMachineRegistrationV1> {
    exactRequestKeys(request, ["machineId", "allowedCapabilities"], "distributed registration create request");
    const machineId = requireUuid(request.machineId, "machineId");
    const allowedCapabilities = requestCapabilities(request.allowedCapabilities);
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.registrations.length >= MAX_REGISTRATIONS) {
        throw new DistributedRegistrationStoreError(
          "distributed registration store capacity exceeded",
          "store_capacity_exceeded",
        );
      }

      if (snapshot.registrations.some(
        (item) => item.machineId === machineId && !item.revokedAt,
      )) {
        throw new DistributedRegistrationStoreError(
          "machine already has an active distributed registration",
          "registration_conflict",
        );
      }

      const now = this.nowIso();
      const registration: DistributedMachineRegistrationV1 = {
        schemaVersion: 1,
        registrationId: this.nextRegistrationId(),
        machineId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        allowedCapabilities,
        authority: "identity_only",
      };
      assertDistributedMachineRegistration(registration);
      if (snapshot.registrations.some(
        (item) => item.registrationId === registration.registrationId,
      )) {
        throw new DistributedRegistrationStoreError(
          "distributed registration id already exists",
          "registration_conflict",
        );
      }

      snapshot.registrations.push(registration);
      await this.writeSnapshot(snapshot);
      return structuredClone(registration);
    });
  }

  async update(
    registrationId: string,
    request: DistributedRegistrationUpdateRequestV1,
  ): Promise<DistributedMachineRegistrationV1> {
    exactRequestKeys(request, ["expectedRevision", "allowedCapabilities"], "distributed registration update request");
    registrationId = requireUuid(registrationId, "registrationId");
    const expectedRevision = requireExpectedRevision(request.expectedRevision);
    const allowedCapabilities = requestCapabilities(request.allowedCapabilities);
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.registrations.findIndex(
        (item) => item.registrationId === registrationId,
      );
      if (index < 0) {
        throw new DistributedRegistrationStoreError(
          "distributed registration was not found",
          "registration_not_found",
        );
      }

      const current = snapshot.registrations[index]!;
      if (current.revokedAt) {
        throw new DistributedRegistrationStoreError(
          "distributed registration is revoked",
          "registration_revoked",
        );
      }
      if (current.revision !== expectedRevision) {
        throw new DistributedRegistrationStoreError(
          "distributed registration revision changed",
          "registration_conflict",
        );
      }

      const next: DistributedMachineRegistrationV1 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: this.nowIso(current.updatedAt),
        allowedCapabilities,
      };
      assertDistributedMachineRegistration(next);
      snapshot.registrations[index] = next;
      await this.writeSnapshot(snapshot);
      return structuredClone(next);
    });
  }

  async revoke(
    registrationId: string,
    request: DistributedRegistrationRevokeRequestV1,
  ): Promise<DistributedMachineRegistrationV1> {
    exactRequestKeys(request, ["expectedRevision"], "distributed registration revoke request");
    registrationId = requireUuid(registrationId, "registrationId");
    const expectedRevision = requireExpectedRevision(request.expectedRevision);
    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.registrations.findIndex(
        (item) => item.registrationId === registrationId,
      );
      if (index < 0) {
        throw new DistributedRegistrationStoreError(
          "distributed registration was not found",
          "registration_not_found",
        );
      }

      const current = snapshot.registrations[index]!;
      if (current.revokedAt) {
        throw new DistributedRegistrationStoreError(
          "distributed registration is revoked",
          "registration_revoked",
        );
      }
      if (current.revision !== expectedRevision) {
        throw new DistributedRegistrationStoreError(
          "distributed registration revision changed",
          "registration_conflict",
        );
      }

      const now = this.nowIso(current.updatedAt);
      const next: DistributedMachineRegistrationV1 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        revokedAt: now,
      };
      assertDistributedMachineRegistration(next);
      snapshot.registrations[index] = next;
      await this.writeSnapshot(snapshot);
      return structuredClone(next);
    });
  }
}
