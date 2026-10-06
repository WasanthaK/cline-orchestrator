import crypto from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./atomic-write.js";
import type { DistributedExecutionAdmissionReceiptV1 } from "./distributed-execution-admission.js";
import type { DistributedExecutionDeliveryBundleV1 } from "./distributed-execution-delivery.js";
import type { DistributedTargetRuntimeHandoffEvidenceV1 } from "./distributed-target-runtime-handoff.js";

const STORE_SCHEMA_VERSION = 1 as const;
const MAX_RECORDS = 1024;
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISTRIBUTED_DELIVERY_RECONCILIATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  acknowledgementMeansDurableM12GAdmissionOnly: true as const,
  controllerStateIsDurable: true as const,
  ambiguousOutcomeRemainsUnconfirmed: true as const,
  automaticRetryAllowed: false as const,
  automaticRequeueAllowed: false as const,
  acknowledgementGrantsExecutionAuthority: false as const,
  networkRouteIncluded: false as const,
  listenerIncluded: false as const,
  targetRuntimeIncluded: false as const,
  writerExecutionIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type DistributedDeliveryStateV1 =
  | "pending"
  | "claimed"
  | "delivered_unconfirmed"
  | "admission_acknowledged";

export interface DistributedDeliveryAdmissionAcknowledgementV1 {
  schemaVersion: 1;
  acknowledgementId: string;
  deliveryId: string;
  dispatchId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  admittedAt: string;
  acknowledgedAt: string;
  authority: "delivery_admission_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedDeliveryStateRecordV1 {
  schemaVersion: 1;
  deliveryId: string;
  dispatchId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  state: DistributedDeliveryStateV1;
  createdAt: string;
  updatedAt: string;
  acknowledgement?: DistributedDeliveryAdmissionAcknowledgementV1;
  authority: "delivery_reconciliation_state_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

interface DistributedDeliveryStateSnapshotV1 {
  schemaVersion: 1;
  records: DistributedDeliveryStateRecordV1[];
}

export class DistributedDeliveryReconciliationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "record_invalid"
      | "acknowledgement_invalid"
      | "binding_mismatch"
      | "state_not_found"
      | "state_conflict"
      | "store_path_invalid"
      | "store_corrupt"
      | "store_capacity_exceeded",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedDeliveryReconciliationError";
  }
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[], label: string, code: DistributedDeliveryReconciliationError["code"]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedDeliveryReconciliationError(`${label} must be an object`, code);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const allowed = new Set([...required, ...optional]);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !keys.includes(key))) {
    throw new DistributedDeliveryReconciliationError(`${label} contains unsupported or missing fields`, code);
  }
}

function uuid(value: unknown, field: string, code: DistributedDeliveryReconciliationError["code"]): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedDeliveryReconciliationError(`${field} must be an opaque UUID`, code);
  }
  return value;
}

function revision(value: unknown, field: string, code: DistributedDeliveryReconciliationError["code"]): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedDeliveryReconciliationError(`${field} must be a positive integer`, code);
  }
  return value;
}

function iso(value: unknown, field: string, code: DistributedDeliveryReconciliationError["code"]): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedDeliveryReconciliationError(`${field} must be an ISO timestamp`, code);
  }
  const canonical = new Date(Date.parse(value)).toISOString();
  if (canonical !== value) {
    throw new DistributedDeliveryReconciliationError(`${field} must be canonical ISO`, code);
  }
  return value;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedDeliveryReconciliationError("delivery reconciliation clock is invalid", "record_invalid");
  }
  return value;
}

function authorityFree(record: Record<string, unknown>, authority: string): boolean {
  return record.authority === authority
    && record.grantsTaskAuthority === false
    && record.grantsFilesystemAuthority === false
    && record.grantsSafetyPlanAuthority === false
    && record.grantsWriterLeaseAuthority === false
    && record.grantsCredentialAuthority === false
    && record.grantsReleaseAuthority === false;
}

export function assertDistributedDeliveryAdmissionAcknowledgement(
  value: unknown,
): asserts value is DistributedDeliveryAdmissionAcknowledgementV1 {
  exactKeys(value, [
    "schemaVersion", "acknowledgementId", "deliveryId", "dispatchId", "taskId", "workspaceId",
    "machineId", "machineRegistrationId", "machineRegistrationRevision", "admittedAt",
    "acknowledgedAt", "authority", "grantsTaskAuthority", "grantsFilesystemAuthority",
    "grantsSafetyPlanAuthority", "grantsWriterLeaseAuthority", "grantsCredentialAuthority",
    "grantsReleaseAuthority",
  ], [], "delivery admission acknowledgement", "acknowledgement_invalid");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !authorityFree(record, "delivery_admission_evidence_only")) {
    throw new DistributedDeliveryReconciliationError("delivery acknowledgement cannot grant authority", "acknowledgement_invalid");
  }
  uuid(record.acknowledgementId, "acknowledgementId", "acknowledgement_invalid");
  uuid(record.deliveryId, "deliveryId", "acknowledgement_invalid");
  uuid(record.dispatchId, "dispatchId", "acknowledgement_invalid");
  uuid(record.taskId, "taskId", "acknowledgement_invalid");
  uuid(record.workspaceId, "workspaceId", "acknowledgement_invalid");
  uuid(record.machineId, "machineId", "acknowledgement_invalid");
  uuid(record.machineRegistrationId, "machineRegistrationId", "acknowledgement_invalid");
  revision(record.machineRegistrationRevision, "machineRegistrationRevision", "acknowledgement_invalid");
  const admittedAt = iso(record.admittedAt, "admittedAt", "acknowledgement_invalid");
  const acknowledgedAt = iso(record.acknowledgedAt, "acknowledgedAt", "acknowledgement_invalid");
  if (Date.parse(acknowledgedAt) < Date.parse(admittedAt)) {
    throw new DistributedDeliveryReconciliationError("acknowledgement cannot predate admission", "acknowledgement_invalid");
  }
}

export function assertDistributedDeliveryStateRecord(
  value: unknown,
): asserts value is DistributedDeliveryStateRecordV1 {
  exactKeys(value, [
    "schemaVersion", "deliveryId", "dispatchId", "taskId", "workspaceId", "machineId",
    "machineRegistrationId", "machineRegistrationRevision", "state", "createdAt", "updatedAt",
    "authority", "grantsTaskAuthority", "grantsFilesystemAuthority", "grantsSafetyPlanAuthority",
    "grantsWriterLeaseAuthority", "grantsCredentialAuthority", "grantsReleaseAuthority",
  ], ["acknowledgement"], "delivery reconciliation record", "record_invalid");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !authorityFree(record, "delivery_reconciliation_state_only")) {
    throw new DistributedDeliveryReconciliationError("delivery reconciliation state cannot grant authority", "record_invalid");
  }
  uuid(record.deliveryId, "deliveryId", "record_invalid");
  uuid(record.dispatchId, "dispatchId", "record_invalid");
  uuid(record.taskId, "taskId", "record_invalid");
  uuid(record.workspaceId, "workspaceId", "record_invalid");
  uuid(record.machineId, "machineId", "record_invalid");
  uuid(record.machineRegistrationId, "machineRegistrationId", "record_invalid");
  revision(record.machineRegistrationRevision, "machineRegistrationRevision", "record_invalid");
  if (!["pending", "claimed", "delivered_unconfirmed", "admission_acknowledged"].includes(record.state as string)) {
    throw new DistributedDeliveryReconciliationError("delivery reconciliation state is invalid", "record_invalid");
  }
  const createdAt = iso(record.createdAt, "createdAt", "record_invalid");
  const updatedAt = iso(record.updatedAt, "updatedAt", "record_invalid");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DistributedDeliveryReconciliationError("delivery state update predates creation", "record_invalid");
  }
  if (record.state === "admission_acknowledged") {
    assertDistributedDeliveryAdmissionAcknowledgement(record.acknowledgement);
    if (!ackMatchesRecord(record.acknowledgement, record as unknown as DistributedDeliveryStateRecordV1)) {
      throw new DistributedDeliveryReconciliationError("delivery acknowledgement is cross-bound", "binding_mismatch");
    }
  } else if ("acknowledgement" in record) {
    throw new DistributedDeliveryReconciliationError("only acknowledged delivery state may contain acknowledgement evidence", "record_invalid");
  }
}

function ackMatchesRecord(
  ack: DistributedDeliveryAdmissionAcknowledgementV1,
  record: DistributedDeliveryStateRecordV1,
): boolean {
  return ack.deliveryId === record.deliveryId
    && ack.dispatchId === record.dispatchId
    && ack.taskId === record.taskId
    && ack.workspaceId === record.workspaceId
    && ack.machineId === record.machineId
    && ack.machineRegistrationId === record.machineRegistrationId
    && ack.machineRegistrationRevision === record.machineRegistrationRevision;
}

function assertAdmissionReceipt(receipt: DistributedExecutionAdmissionReceiptV1, record: DistributedDeliveryStateRecordV1): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.dispatchId !== record.dispatchId
    || receipt.taskId !== record.taskId
    || receipt.workspaceId !== record.workspaceId
    || receipt.machineId !== record.machineId
    || receipt.authority !== "admission_evidence_only"
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new DistributedDeliveryReconciliationError("M12G admission receipt does not match delivery state", "binding_mismatch");
  }
  iso(receipt.admittedAt, "admittedAt", "acknowledgement_invalid");
}

export function createDistributedDeliveryStateRecord(
  input: {
    deliveryId: string;
    dispatchId: string;
    taskId: string;
    workspaceId: string;
    machineId: string;
    machineRegistrationId: string;
    machineRegistrationRevision: number;
  },
  options: { now?: () => Date } = {},
): DistributedDeliveryStateRecordV1 {
  const now = currentTime(options.now).toISOString();
  const record: DistributedDeliveryStateRecordV1 = {
    schemaVersion: 1,
    deliveryId: uuid(input.deliveryId, "deliveryId", "record_invalid"),
    dispatchId: uuid(input.dispatchId, "dispatchId", "record_invalid"),
    taskId: uuid(input.taskId, "taskId", "record_invalid"),
    workspaceId: uuid(input.workspaceId, "workspaceId", "record_invalid"),
    machineId: uuid(input.machineId, "machineId", "record_invalid"),
    machineRegistrationId: uuid(input.machineRegistrationId, "machineRegistrationId", "record_invalid"),
    machineRegistrationRevision: revision(input.machineRegistrationRevision, "machineRegistrationRevision", "record_invalid"),
    state: "pending",
    createdAt: now,
    updatedAt: now,
    authority: "delivery_reconciliation_state_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedDeliveryStateRecord(record);
  return record;
}

export function createDistributedDeliveryAdmissionAcknowledgement(
  recordInput: DistributedDeliveryStateRecordV1,
  admission: DistributedExecutionAdmissionReceiptV1,
  options: { now?: () => Date; idFactory?: () => string } = {},
): DistributedDeliveryAdmissionAcknowledgementV1 {
  assertDistributedDeliveryStateRecord(recordInput);
  const record = structuredClone(recordInput);
  assertAdmissionReceipt(admission, record);
  const acknowledgedAt = currentTime(options.now).toISOString();
  if (Date.parse(acknowledgedAt) < Date.parse(admission.admittedAt)) {
    throw new DistributedDeliveryReconciliationError("acknowledgement cannot predate admission", "acknowledgement_invalid");
  }
  const ack: DistributedDeliveryAdmissionAcknowledgementV1 = {
    schemaVersion: 1,
    acknowledgementId: uuid((options.idFactory ?? (() => crypto.randomUUID()))(), "acknowledgementId", "acknowledgement_invalid"),
    deliveryId: record.deliveryId,
    dispatchId: record.dispatchId,
    taskId: record.taskId,
    workspaceId: record.workspaceId,
    machineId: record.machineId,
    machineRegistrationId: record.machineRegistrationId,
    machineRegistrationRevision: record.machineRegistrationRevision,
    admittedAt: admission.admittedAt,
    acknowledgedAt,
    authority: "delivery_admission_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedDeliveryAdmissionAcknowledgement(ack);
  return ack;
}

function exactSnapshot(value: unknown): DistributedDeliveryStateSnapshotV1 {
  exactKeys(value, ["schemaVersion", "records"], [], "delivery reconciliation store", "store_corrupt");
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(root.records) || root.records.length > MAX_RECORDS) {
    throw new DistributedDeliveryReconciliationError("delivery reconciliation store schema is invalid", "store_corrupt");
  }
  const seenDelivery = new Set<string>();
  const seenDispatch = new Set<string>();
  const records: DistributedDeliveryStateRecordV1[] = [];
  for (const raw of root.records) {
    try {
      assertDistributedDeliveryStateRecord(raw);
    } catch (error) {
      if (error instanceof DistributedDeliveryReconciliationError) {
        throw new DistributedDeliveryReconciliationError("delivery reconciliation store contains invalid record", "store_corrupt", { cause: error });
      }
      throw error;
    }
    const record = structuredClone(raw);
    if (seenDelivery.has(record.deliveryId) || seenDispatch.has(record.dispatchId)) {
      throw new DistributedDeliveryReconciliationError("delivery reconciliation store contains duplicate identity", "store_corrupt");
    }
    seenDelivery.add(record.deliveryId);
    seenDispatch.add(record.dispatchId);
    records.push(record);
  }
  records.sort((a, b) => a.deliveryId.localeCompare(b.deliveryId));
  return { schemaVersion: 1, records };
}

const NEXT_STATE: Record<Exclude<DistributedDeliveryStateV1, "admission_acknowledged">, DistributedDeliveryStateV1> = {
  pending: "claimed",
  claimed: "delivered_unconfirmed",
  delivered_unconfirmed: "admission_acknowledged",
};

export class FileDistributedDeliveryStateStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (
      typeof filePath !== "string"
      || !path.isAbsolute(filePath)
      || path.normalize(filePath) !== filePath
      || path.basename(filePath) !== "distributed-delivery-state.json"
    ) {
      throw new DistributedDeliveryReconciliationError(
        "delivery state store path must be an absolute canonical distributed-delivery-state.json path",
        "store_path_invalid",
      );
    }
  }

  private async assertParent(): Promise<void> {
    let info;
    try {
      info = await stat(path.dirname(this.filePath));
    } catch {
      throw new DistributedDeliveryReconciliationError("delivery state store parent is unavailable", "store_path_invalid");
    }
    if (!info.isDirectory()) {
      throw new DistributedDeliveryReconciliationError("delivery state store parent must be a directory", "store_path_invalid");
    }
  }

  private async readSnapshot(): Promise<DistributedDeliveryStateSnapshotV1> {
    await this.assertParent();
    let info;
    try {
      info = await lstat(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, records: [] };
      throw new DistributedDeliveryReconciliationError("delivery state store cannot be inspected", "store_corrupt");
    }
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_STORE_BYTES) {
      throw new DistributedDeliveryReconciliationError("delivery state store must be a bounded regular non-symlink file", "store_corrupt");
    }
    let raw: Buffer;
    try {
      raw = await readFile(this.filePath);
    } catch {
      throw new DistributedDeliveryReconciliationError("delivery state store cannot be read", "store_corrupt");
    }
    if (raw.length > MAX_STORE_BYTES) {
      throw new DistributedDeliveryReconciliationError("delivery state store exceeds byte limit", "store_corrupt");
    }
    try {
      return exactSnapshot(JSON.parse(raw.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof DistributedDeliveryReconciliationError) throw error;
      throw new DistributedDeliveryReconciliationError("delivery state store is not valid JSON", "store_corrupt");
    }
  }

  private async writeSnapshot(snapshot: DistributedDeliveryStateSnapshotV1): Promise<void> {
    const canonical = exactSnapshot(snapshot);
    const body = `${JSON.stringify(canonical, null, 2)}\n`;
    if (Buffer.byteLength(body, "utf8") > MAX_STORE_BYTES) {
      throw new DistributedDeliveryReconciliationError("delivery state store exceeds capacity", "store_capacity_exceeded");
    }
    try {
      await atomicWriteUtf8(this.filePath, body, { mode: 0o600 });
    } catch (error) {
      throw new DistributedDeliveryReconciliationError("delivery state store atomic write failed", "store_corrupt", { cause: error });
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async create(recordInput: DistributedDeliveryStateRecordV1): Promise<DistributedDeliveryStateRecordV1> {
    assertDistributedDeliveryStateRecord(recordInput);
    const record = structuredClone(recordInput);
    if (record.state !== "pending" || record.acknowledgement !== undefined) {
      throw new DistributedDeliveryReconciliationError("new delivery reconciliation state must begin pending", "state_conflict");
    }
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.records.length >= MAX_RECORDS) {
        throw new DistributedDeliveryReconciliationError("delivery state store capacity exceeded", "store_capacity_exceeded");
      }
      if (snapshot.records.some((item) => item.deliveryId === record.deliveryId || item.dispatchId === record.dispatchId)) {
        throw new DistributedDeliveryReconciliationError("delivery or dispatch identity already exists", "state_conflict");
      }
      snapshot.records.push(record);
      await this.writeSnapshot(snapshot);
      return structuredClone(record);
    });
  }

  async get(deliveryIdInput: string): Promise<DistributedDeliveryStateRecordV1> {
    const deliveryId = uuid(deliveryIdInput, "deliveryId", "state_not_found");
    const snapshot = await this.readSnapshot();
    const record = snapshot.records.find((item) => item.deliveryId === deliveryId);
    if (!record) throw new DistributedDeliveryReconciliationError("delivery state was not found", "state_not_found");
    return structuredClone(record);
  }

  async list(): Promise<DistributedDeliveryStateRecordV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.records.map((record) => structuredClone(record));
  }

  async advance(
    deliveryIdInput: string,
    expectedState: Exclude<DistributedDeliveryStateV1, "admission_acknowledged">,
    nextState: Exclude<DistributedDeliveryStateV1, "pending" | "admission_acknowledged">,
    options: { now?: () => Date } = {},
  ): Promise<DistributedDeliveryStateRecordV1> {
    const deliveryId = uuid(deliveryIdInput, "deliveryId", "state_not_found");
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.records.findIndex((item) => item.deliveryId === deliveryId);
      if (index < 0) throw new DistributedDeliveryReconciliationError("delivery state was not found", "state_not_found");
      const current = snapshot.records[index]!;
      if (current.state !== expectedState || NEXT_STATE[expectedState] !== nextState) {
        throw new DistributedDeliveryReconciliationError("delivery state transition is not monotonic", "state_conflict");
      }
      const updated: DistributedDeliveryStateRecordV1 = {
        ...current,
        state: nextState,
        updatedAt: currentTime(options.now).toISOString(),
      };
      assertDistributedDeliveryStateRecord(updated);
      snapshot.records[index] = updated;
      await this.writeSnapshot(snapshot);
      return structuredClone(updated);
    });
  }

  async acknowledge(
    deliveryIdInput: string,
    acknowledgementInput: DistributedDeliveryAdmissionAcknowledgementV1,
  ): Promise<DistributedDeliveryStateRecordV1> {
    const deliveryId = uuid(deliveryIdInput, "deliveryId", "state_not_found");
    assertDistributedDeliveryAdmissionAcknowledgement(acknowledgementInput);
    const acknowledgement = structuredClone(acknowledgementInput);
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.records.findIndex((item) => item.deliveryId === deliveryId);
      if (index < 0) throw new DistributedDeliveryReconciliationError("delivery state was not found", "state_not_found");
      const current = snapshot.records[index]!;
      if (!ackMatchesRecord(acknowledgement, current)) {
        throw new DistributedDeliveryReconciliationError("delivery acknowledgement does not match durable delivery identity", "binding_mismatch");
      }
      if (current.state === "admission_acknowledged") {
        if (JSON.stringify(current.acknowledgement) !== JSON.stringify(acknowledgement)) {
          throw new DistributedDeliveryReconciliationError("conflicting acknowledgement for admitted delivery", "state_conflict");
        }
        return structuredClone(current);
      }
      if (current.state !== "delivered_unconfirmed") {
        throw new DistributedDeliveryReconciliationError("delivery cannot be acknowledged before delivered_unconfirmed", "state_conflict");
      }
      const updated: DistributedDeliveryStateRecordV1 = {
        ...current,
        state: "admission_acknowledged",
        updatedAt: acknowledgement.acknowledgedAt,
        acknowledgement,
      };
      assertDistributedDeliveryStateRecord(updated);
      snapshot.records[index] = updated;
      await this.writeSnapshot(snapshot);
      return structuredClone(updated);
    });
  }
}


export const DISTRIBUTED_DELIVERY_ADMISSION_OUTBOX_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  createdOnlyAfterM12GAdmission: true as const,
  persistedBeforeM12IRuntimeStart: true as const,
  targetLocalDurableOutbox: true as const,
  networkTransmissionIncluded: false as const,
  automaticRetryAllowed: false as const,
  automaticRequeueAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

interface DistributedDeliveryAdmissionOutboxSnapshotV1 {
  schemaVersion: 1;
  acknowledgements: DistributedDeliveryAdmissionAcknowledgementV1[];
}

const MAX_OUTBOX_ACKNOWLEDGEMENTS = 1024;
const MAX_OUTBOX_BYTES = 2 * 1024 * 1024;

export function createDistributedDeliveryAdmissionAcknowledgementFromHandoff(
  bundle: DistributedExecutionDeliveryBundleV1,
  handoff: DistributedTargetRuntimeHandoffEvidenceV1,
  options: { now?: () => Date; idFactory?: () => string } = {},
): DistributedDeliveryAdmissionAcknowledgementV1 {
  if (
    handoff.schemaVersion !== 1
    || handoff.authority !== "local_runtime_handoff_evidence_only"
    || handoff.dispatchId !== bundle.dispatch.dispatchId
    || handoff.taskId !== bundle.dispatch.taskId
    || handoff.workspaceId !== bundle.dispatch.workspaceId
    || handoff.machineId !== bundle.dispatch.machineId
    || handoff.fenceGeneration !== bundle.dispatch.fenceGeneration
    || handoff.grantsTaskAuthority !== false
    || handoff.grantsFilesystemAuthority !== false
    || handoff.grantsSafetyPlanAuthority !== false
    || handoff.grantsWriterLeaseAuthority !== false
    || handoff.grantsCredentialAuthority !== false
    || handoff.grantsReleaseAuthority !== false
  ) {
    throw new DistributedDeliveryReconciliationError(
      "M12H handoff evidence does not prove admission for this delivery",
      "binding_mismatch",
    );
  }
  const admittedAt = iso(handoff.admittedAt, "admittedAt", "acknowledgement_invalid");
  const acknowledgedAt = currentTime(options.now).toISOString();
  if (Date.parse(acknowledgedAt) < Date.parse(admittedAt)) {
    throw new DistributedDeliveryReconciliationError(
      "acknowledgement cannot predate admission",
      "acknowledgement_invalid",
    );
  }
  const acknowledgement: DistributedDeliveryAdmissionAcknowledgementV1 = {
    schemaVersion: 1,
    acknowledgementId: uuid(
      (options.idFactory ?? (() => crypto.randomUUID()))(),
      "acknowledgementId",
      "acknowledgement_invalid",
    ),
    deliveryId: uuid(bundle.deliveryId, "deliveryId", "acknowledgement_invalid"),
    dispatchId: uuid(bundle.dispatch.dispatchId, "dispatchId", "acknowledgement_invalid"),
    taskId: uuid(bundle.dispatch.taskId, "taskId", "acknowledgement_invalid"),
    workspaceId: uuid(bundle.dispatch.workspaceId, "workspaceId", "acknowledgement_invalid"),
    machineId: uuid(bundle.dispatch.machineId, "machineId", "acknowledgement_invalid"),
    machineRegistrationId: uuid(
      bundle.dispatch.machineRegistrationId,
      "machineRegistrationId",
      "acknowledgement_invalid",
    ),
    machineRegistrationRevision: revision(
      bundle.dispatch.machineRegistrationRevision,
      "machineRegistrationRevision",
      "acknowledgement_invalid",
    ),
    admittedAt,
    acknowledgedAt,
    authority: "delivery_admission_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedDeliveryAdmissionAcknowledgement(acknowledgement);
  return acknowledgement;
}

function exactOutboxSnapshot(value: unknown): DistributedDeliveryAdmissionOutboxSnapshotV1 {
  exactKeys(
    value,
    ["schemaVersion", "acknowledgements"],
    [],
    "delivery admission acknowledgement outbox",
    "store_corrupt",
  );
  const root = value as Record<string, unknown>;
  if (
    root.schemaVersion !== 1
    || !Array.isArray(root.acknowledgements)
    || root.acknowledgements.length > MAX_OUTBOX_ACKNOWLEDGEMENTS
  ) {
    throw new DistributedDeliveryReconciliationError(
      "delivery acknowledgement outbox schema is invalid",
      "store_corrupt",
    );
  }
  const seenDelivery = new Set<string>();
  const seenDispatch = new Set<string>();
  const acknowledgements: DistributedDeliveryAdmissionAcknowledgementV1[] = [];
  for (const raw of root.acknowledgements) {
    try {
      assertDistributedDeliveryAdmissionAcknowledgement(raw);
    } catch (error) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox contains invalid evidence",
        "store_corrupt",
        { cause: error },
      );
    }
    const ack = structuredClone(raw);
    if (seenDelivery.has(ack.deliveryId) || seenDispatch.has(ack.dispatchId)) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox contains duplicate delivery or dispatch identity",
        "store_corrupt",
      );
    }
    seenDelivery.add(ack.deliveryId);
    seenDispatch.add(ack.dispatchId);
    acknowledgements.push(ack);
  }
  acknowledgements.sort((a, b) => a.deliveryId.localeCompare(b.deliveryId));
  return { schemaVersion: 1, acknowledgements };
}

export class FileDistributedDeliveryAdmissionAcknowledgementOutbox {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (
      typeof filePath !== "string"
      || !path.isAbsolute(filePath)
      || path.normalize(filePath) !== filePath
      || path.basename(filePath) !== "distributed-delivery-ack-outbox.json"
    ) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox path must be an absolute canonical distributed-delivery-ack-outbox.json path",
        "store_path_invalid",
      );
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async assertParent(): Promise<void> {
    let info;
    try {
      info = await stat(path.dirname(this.filePath));
    } catch {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox parent is unavailable",
        "store_path_invalid",
      );
    }
    if (!info.isDirectory()) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox parent must be a directory",
        "store_path_invalid",
      );
    }
  }

  private async readSnapshot(): Promise<DistributedDeliveryAdmissionOutboxSnapshotV1> {
    await this.assertParent();
    let info;
    try {
      info = await lstat(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: 1, acknowledgements: [] };
      }
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox cannot be inspected",
        "store_corrupt",
      );
    }
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_OUTBOX_BYTES) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox must be a bounded regular non-symlink file",
        "store_corrupt",
      );
    }
    let raw: Buffer;
    try {
      raw = await readFile(this.filePath);
    } catch {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox cannot be read",
        "store_corrupt",
      );
    }
    if (raw.length > MAX_OUTBOX_BYTES) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox exceeds byte limit",
        "store_corrupt",
      );
    }
    try {
      return exactOutboxSnapshot(JSON.parse(raw.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof DistributedDeliveryReconciliationError) throw error;
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox is not valid JSON",
        "store_corrupt",
      );
    }
  }

  private async writeSnapshot(snapshot: DistributedDeliveryAdmissionOutboxSnapshotV1): Promise<void> {
    const canonical = exactOutboxSnapshot(snapshot);
    const body = `${JSON.stringify(canonical, null, 2)}\n`;
    if (Buffer.byteLength(body, "utf8") > MAX_OUTBOX_BYTES) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox exceeds capacity",
        "store_capacity_exceeded",
      );
    }
    try {
      await atomicWriteUtf8(this.filePath, body, { mode: 0o600 });
    } catch (error) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement outbox atomic write failed",
        "store_corrupt",
        { cause: error },
      );
    }
  }

  async record(
    acknowledgementInput: DistributedDeliveryAdmissionAcknowledgementV1,
  ): Promise<DistributedDeliveryAdmissionAcknowledgementV1> {
    assertDistributedDeliveryAdmissionAcknowledgement(acknowledgementInput);
    const acknowledgement = structuredClone(acknowledgementInput);
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot();
      const byDelivery = snapshot.acknowledgements.find(
        (item) => item.deliveryId === acknowledgement.deliveryId,
      );
      const byDispatch = snapshot.acknowledgements.find(
        (item) => item.dispatchId === acknowledgement.dispatchId,
      );
      const existing = byDelivery ?? byDispatch;
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(acknowledgement)) {
          throw new DistributedDeliveryReconciliationError(
            "conflicting acknowledgement already exists in durable outbox",
            "state_conflict",
          );
        }
        return structuredClone(existing);
      }
      if (snapshot.acknowledgements.length >= MAX_OUTBOX_ACKNOWLEDGEMENTS) {
        throw new DistributedDeliveryReconciliationError(
          "delivery acknowledgement outbox capacity exceeded",
          "store_capacity_exceeded",
        );
      }
      snapshot.acknowledgements.push(acknowledgement);
      await this.writeSnapshot(snapshot);
      return structuredClone(acknowledgement);
    });
  }

  async getByDeliveryId(deliveryIdInput: string): Promise<DistributedDeliveryAdmissionAcknowledgementV1> {
    const deliveryId = uuid(deliveryIdInput, "deliveryId", "state_not_found");
    const snapshot = await this.readSnapshot();
    const acknowledgement = snapshot.acknowledgements.find(
      (item) => item.deliveryId === deliveryId,
    );
    if (!acknowledgement) {
      throw new DistributedDeliveryReconciliationError(
        "delivery acknowledgement was not found in durable outbox",
        "state_not_found",
      );
    }
    return structuredClone(acknowledgement);
  }

  async list(): Promise<DistributedDeliveryAdmissionAcknowledgementV1[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.acknowledgements.map((item) => structuredClone(item));
  }
}
