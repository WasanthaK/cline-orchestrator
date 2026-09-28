import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./atomic-write.js";
import {
  assertDistributedMachineRegistration,
  assertDistributedPlacementCurrent,
  assertDistributedWorkspacePlacement,
  DistributedControlContractError,
  type DistributedMachineRegistrationV1,
  type DistributedWorkspacePlacementV1,
} from "./distributed-control-contract.js";

const STORE_SCHEMA_VERSION = 1 as const;
const MAX_PLACEMENTS = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DistributedPlacementSnapshotV1 {
  schemaVersion: 1;
  placements: DistributedWorkspacePlacementV1[];
}

export interface DistributedMachineRegistrationLookup {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedPlacementCreateRequestV1 {
  workspaceId: string;
  machineRegistrationId: string;
  expectedMachineRegistrationRevision: number;
}

export interface DistributedPlacementUpdateRequestV1 {
  expectedRevision: number;
  machineRegistrationId: string;
  expectedMachineRegistrationRevision: number;
}

export interface DistributedPlacementDisableRequestV1 {
  expectedRevision: number;
}

export interface DistributedPlacementStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedPlacementStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "placement_not_found"
      | "placement_conflict"
      | "placement_disabled"
      | "registration_not_current"
      | "store_corrupt"
      | "store_capacity_exceeded",
  ) {
    super(message);
    this.name = "DistributedPlacementStoreError";
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DistributedControlContractError(`${field} must be an opaque UUID`, "placement_invalid");
  }
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new DistributedControlContractError(`${field} must be an opaque UUID`, "placement_invalid");
  }
  return normalized;
}

function requirePositiveInteger(
  value: unknown,
  field: string,
  code: DistributedPlacementStoreError["code"],
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedPlacementStoreError(`${field} must be a positive integer`, code);
  }
  return value;
}

function exactRequestKeys(
  value: unknown,
  required: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControlContractError(`${label} must be an object`, "placement_invalid");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== required.length || keys.some((key) => !required.includes(key))) {
    throw new DistributedControlContractError(
      `${label} contains unsupported or missing fields`,
      "placement_invalid",
    );
  }
}

function exactSnapshotKeys(snapshot: Record<string, unknown>): void {
  const keys = Object.keys(snapshot);
  if (
    keys.length !== 2
    || !keys.includes("schemaVersion")
    || !keys.includes("placements")
  ) {
    throw new DistributedPlacementStoreError(
      "distributed placement store contains unsupported fields",
      "store_corrupt",
    );
  }
}

function validateSnapshot(value: unknown): DistributedPlacementSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedPlacementStoreError(
      "distributed placement store root is invalid",
      "store_corrupt",
    );
  }

  const snapshot = value as Record<string, unknown>;
  exactSnapshotKeys(snapshot);
  if (snapshot.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(snapshot.placements)) {
    throw new DistributedPlacementStoreError(
      "unsupported distributed placement store schema",
      "store_corrupt",
    );
  }
  if (snapshot.placements.length > MAX_PLACEMENTS) {
    throw new DistributedPlacementStoreError(
      "distributed placement store exceeds capacity",
      "store_corrupt",
    );
  }

  const placements: DistributedWorkspacePlacementV1[] = [];
  const placementIds = new Set<string>();
  const activeWorkspaceIds = new Set<string>();
  try {
    for (const raw of snapshot.placements) {
      assertDistributedWorkspacePlacement(raw);
      const placement = structuredClone(raw);
      if (placementIds.has(placement.placementId)) {
        throw new DistributedPlacementStoreError(
          "duplicate distributed placement id",
          "store_corrupt",
        );
      }
      placementIds.add(placement.placementId);

      if (!placement.disabledAt) {
        if (activeWorkspaceIds.has(placement.workspaceId)) {
          throw new DistributedPlacementStoreError(
            "multiple active placements exist for one workspace",
            "store_corrupt",
          );
        }
        activeWorkspaceIds.add(placement.workspaceId);
      }
      placements.push(placement);
    }
  } catch (error) {
    if (error instanceof DistributedPlacementStoreError) throw error;
    throw new DistributedPlacementStoreError(
      `distributed placement store contains invalid placement: ${error instanceof Error ? error.message : String(error)}`,
      "store_corrupt",
    );
  }

  return { schemaVersion: 1, placements };
}

/**
 * Controller-local durable routing state for M12 workspace placements.
 *
 * Placements are routing evidence only. Creation/update always bind to one
 * currently active machine registration at its exact durable revision. Stored
 * placement state never contains workspace filesystem paths, endpoints, commands,
 * Safety Plans, credentials, Hub tokens, release authority, or writer authority.
 * Mutations are serialized in-process, revision checked, and atomically replace
 * the snapshot with restrictive file permissions.
 */
export class DistributedPlacementStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly registrations: DistributedMachineRegistrationLookup,
    private readonly options: DistributedPlacementStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "distributed-control");
  }

  private file(): string {
    return path.join(this.dir(), "workspace-placements.json");
  }

  private nowIso(notBefore?: string): string {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedControlContractError(
        "distributed placement clock is invalid",
        "placement_invalid",
      );
    }
    if (notBefore !== undefined && now.getTime() < Date.parse(notBefore)) {
      throw new DistributedControlContractError(
        "distributed placement clock moved backwards",
        "placement_invalid",
      );
    }
    return now.toISOString();
  }

  private nextPlacementId(): string {
    return requireUuid(
      (this.options.idFactory ?? (() => crypto.randomUUID()))(),
      "placementId",
    );
  }

  private async readSnapshot(): Promise<DistributedPlacementSnapshotV1> {
    try {
      const raw = await readFile(this.file(), "utf8");
      return validateSnapshot(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: 1, placements: [] };
      }
      if (error instanceof DistributedPlacementStoreError) throw error;
      throw new DistributedPlacementStoreError(
        `failed to read distributed placement store: ${error instanceof Error ? error.message : String(error)}`,
        "store_corrupt",
      );
    }
  }

  private async writeSnapshot(snapshot: DistributedPlacementSnapshotV1): Promise<void> {
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

  private async requireCurrentRegistration(
    registrationId: string,
    expectedRevision: number,
  ): Promise<DistributedMachineRegistrationV1> {
    let registration: DistributedMachineRegistrationV1;
    try {
      registration = await this.registrations.get(registrationId);
      assertDistributedMachineRegistration(registration);
    } catch {
      throw new DistributedPlacementStoreError(
        "machine registration is unavailable or invalid",
        "registration_not_current",
      );
    }
    if (registration.revokedAt || registration.revision !== expectedRevision) {
      throw new DistributedPlacementStoreError(
        "machine registration is revoked or its revision changed",
        "registration_not_current",
      );
    }
    return structuredClone(registration);
  }

  async list(): Promise<DistributedWorkspacePlacementV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.placements
      .map((placement) => structuredClone(placement))
      .sort((a, b) => a.placementId.localeCompare(b.placementId));
  }

  async get(placementId: string): Promise<DistributedWorkspacePlacementV1> {
    placementId = requireUuid(placementId, "placementId");
    const snapshot = await this.readSnapshot();
    const placement = snapshot.placements.find((item) => item.placementId === placementId);
    if (!placement) {
      throw new DistributedPlacementStoreError(
        "distributed placement was not found",
        "placement_not_found",
      );
    }
    return structuredClone(placement);
  }

  async create(
    request: DistributedPlacementCreateRequestV1,
  ): Promise<DistributedWorkspacePlacementV1> {
    exactRequestKeys(
      request,
      ["workspaceId", "machineRegistrationId", "expectedMachineRegistrationRevision"],
      "distributed placement create request",
    );
    const workspaceId = requireUuid(request.workspaceId, "workspaceId");
    const registrationId = requireUuid(request.machineRegistrationId, "machineRegistrationId");
    const registrationRevision = requirePositiveInteger(
      request.expectedMachineRegistrationRevision,
      "expectedMachineRegistrationRevision",
      "registration_not_current",
    );

    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.placements.length >= MAX_PLACEMENTS) {
        throw new DistributedPlacementStoreError(
          "distributed placement store capacity exceeded",
          "store_capacity_exceeded",
        );
      }
      if (snapshot.placements.some(
        (item) => item.workspaceId === workspaceId && !item.disabledAt,
      )) {
        throw new DistributedPlacementStoreError(
          "workspace already has an active distributed placement",
          "placement_conflict",
        );
      }

      const registration = await this.requireCurrentRegistration(
        registrationId,
        registrationRevision,
      );
      const now = this.nowIso();
      const placement: DistributedWorkspacePlacementV1 = {
        schemaVersion: 1,
        placementId: this.nextPlacementId(),
        workspaceId,
        machineId: registration.machineId,
        machineRegistrationId: registration.registrationId,
        machineRegistrationRevision: registration.revision,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        authority: "routing_only",
      };
      assertDistributedWorkspacePlacement(placement);
      assertDistributedPlacementCurrent(placement, registration);
      if (snapshot.placements.some((item) => item.placementId === placement.placementId)) {
        throw new DistributedPlacementStoreError(
          "distributed placement id already exists",
          "placement_conflict",
        );
      }

      snapshot.placements.push(placement);
      await this.writeSnapshot(snapshot);
      return structuredClone(placement);
    });
  }

  async update(
    placementId: string,
    request: DistributedPlacementUpdateRequestV1,
  ): Promise<DistributedWorkspacePlacementV1> {
    exactRequestKeys(
      request,
      ["expectedRevision", "machineRegistrationId", "expectedMachineRegistrationRevision"],
      "distributed placement update request",
    );
    placementId = requireUuid(placementId, "placementId");
    const expectedRevision = requirePositiveInteger(
      request.expectedRevision,
      "expectedRevision",
      "placement_conflict",
    );
    const registrationId = requireUuid(request.machineRegistrationId, "machineRegistrationId");
    const registrationRevision = requirePositiveInteger(
      request.expectedMachineRegistrationRevision,
      "expectedMachineRegistrationRevision",
      "registration_not_current",
    );

    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.placements.findIndex((item) => item.placementId === placementId);
      if (index < 0) {
        throw new DistributedPlacementStoreError(
          "distributed placement was not found",
          "placement_not_found",
        );
      }

      const current = snapshot.placements[index]!;
      if (current.disabledAt) {
        throw new DistributedPlacementStoreError(
          "distributed placement is disabled",
          "placement_disabled",
        );
      }
      if (current.revision !== expectedRevision) {
        throw new DistributedPlacementStoreError(
          "distributed placement revision changed",
          "placement_conflict",
        );
      }

      const registration = await this.requireCurrentRegistration(
        registrationId,
        registrationRevision,
      );
      const next: DistributedWorkspacePlacementV1 = {
        ...current,
        machineId: registration.machineId,
        machineRegistrationId: registration.registrationId,
        machineRegistrationRevision: registration.revision,
        revision: current.revision + 1,
        updatedAt: this.nowIso(current.updatedAt),
      };
      assertDistributedWorkspacePlacement(next);
      assertDistributedPlacementCurrent(next, registration);
      snapshot.placements[index] = next;
      await this.writeSnapshot(snapshot);
      return structuredClone(next);
    });
  }

  async disable(
    placementId: string,
    request: DistributedPlacementDisableRequestV1,
  ): Promise<DistributedWorkspacePlacementV1> {
    exactRequestKeys(request, ["expectedRevision"], "distributed placement disable request");
    placementId = requireUuid(placementId, "placementId");
    const expectedRevision = requirePositiveInteger(
      request.expectedRevision,
      "expectedRevision",
      "placement_conflict",
    );

    return await this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.placements.findIndex((item) => item.placementId === placementId);
      if (index < 0) {
        throw new DistributedPlacementStoreError(
          "distributed placement was not found",
          "placement_not_found",
        );
      }

      const current = snapshot.placements[index]!;
      if (current.disabledAt) {
        throw new DistributedPlacementStoreError(
          "distributed placement is disabled",
          "placement_disabled",
        );
      }
      if (current.revision !== expectedRevision) {
        throw new DistributedPlacementStoreError(
          "distributed placement revision changed",
          "placement_conflict",
        );
      }

      const now = this.nowIso(current.updatedAt);
      const next: DistributedWorkspacePlacementV1 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        disabledAt: now,
      };
      assertDistributedWorkspacePlacement(next);
      snapshot.placements[index] = next;
      await this.writeSnapshot(snapshot);
      return structuredClone(next);
    });
  }
}
