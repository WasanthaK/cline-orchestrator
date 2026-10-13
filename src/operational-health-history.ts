import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";
import type { OperationalEventV1 } from "./operational-event.js";

export const OPERATIONAL_HEALTH_HISTORY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "operational_health_history_observation_only" as const,
  storesSanitizedReadinessOnly: true as const,
  storesSanitizedOperationalEventsOnly: true as const,
  boundedRetention: true as const,
  crashSafeReplace: true as const,
  failClosedOnCorruption: true as const,
  mutatesTaskState: false as const,
  mutatesRuntimeState: false as const,
  performsNetworkMutation: false as const,
  usesCredentials: false as const,
  grantsAuthority: false as const,
});

export type OperationalHealthHistoryRecordV1 =
  | {
      schemaVersion: 1;
      recordId: string;
      recordedAt: string;
      kind: "readiness";
      ready: boolean;
      healthyCount: number;
      staleCount: number;
      unavailableCount: number;
      failedCount: number;
      securityReady: boolean;
      reliabilityReady: boolean;
      observabilityReady: boolean;
      authority: "operational_health_history_record";
      grantsAuthority: false;
    }
  | {
      schemaVersion: 1;
      recordId: string;
      recordedAt: string;
      kind: "event";
      event: OperationalEventV1;
      authority: "operational_health_history_record";
      grantsAuthority: false;
    };

export interface OperationalHealthHistoryFileV1 {
  schemaVersion: 1;
  updatedAt: string;
  maxRecords: number;
  records: OperationalHealthHistoryRecordV1[];
  authority: "operational_health_history_observation_only";
  grantsAuthority: false;
}

export interface OperationalHealthHistoryOptions {
  maxRecords?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export class OperationalHealthHistoryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "configuration_invalid"
      | "history_corrupt"
      | "record_invalid"
      | "store_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OperationalHealthHistoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_RECORDS = 500;
const MAX_MAX_RECORDS = 10_000;

function assertEvent(event: OperationalEventV1): void {
  if (
    event.schemaVersion !== 1
    || event.authority !== "operational_event_observation_only"
    || event.grantsAuthority !== false
  ) {
    throw new OperationalHealthHistoryError(
      "operational event is not a sanitized M16B event",
      "record_invalid",
    );
  }
}

function assertRecord(record: OperationalHealthHistoryRecordV1): void {
  if (
    record.schemaVersion !== 1
    || !UUID.test(record.recordId)
    || !Number.isFinite(Date.parse(record.recordedAt))
    || record.authority !== "operational_health_history_record"
    || record.grantsAuthority !== false
  ) {
    throw new OperationalHealthHistoryError(
      "operational health history record is invalid",
      "history_corrupt",
    );
  }
  if (record.kind === "readiness") {
    for (const value of [
      record.healthyCount,
      record.staleCount,
      record.unavailableCount,
      record.failedCount,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new OperationalHealthHistoryError(
          "readiness history counters are invalid",
          "history_corrupt",
        );
      }
    }
  } else {
    assertEvent(record.event);
  }
}

function assertHistory(
  value: OperationalHealthHistoryFileV1,
  expectedMaxRecords: number,
): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "operational_health_history_observation_only"
    || value.grantsAuthority !== false
    || value.maxRecords !== expectedMaxRecords
    || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.records)
    || value.records.length > expectedMaxRecords
  ) {
    throw new OperationalHealthHistoryError(
      "operational health history file is malformed",
      "history_corrupt",
    );
  }
  for (const record of value.records) assertRecord(record);
}

export class FileOperationalHealthHistoryStore {
  private readonly maxRecords: number;

  constructor(
    private readonly stateRoot: string,
    private readonly options: OperationalHealthHistoryOptions = {},
  ) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (
      !Number.isSafeInteger(this.maxRecords)
      || this.maxRecords < 1
      || this.maxRecords > MAX_MAX_RECORDS
    ) {
      throw new OperationalHealthHistoryError(
        "operational history retention bound is invalid",
        "configuration_invalid",
      );
    }
  }

  private dir(): string {
    return path.join(this.stateRoot, "operational-health");
  }

  private file(): string {
    return path.join(this.dir(), "history.json");
  }

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new OperationalHealthHistoryError(
        "operational history clock is invalid",
        "configuration_invalid",
      );
    }
    return now;
  }

  private id(): string {
    const value = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(value)) {
      throw new OperationalHealthHistoryError(
        "operational history record ID is invalid",
        "configuration_invalid",
      );
    }
    return value;
  }

  async load(): Promise<OperationalHealthHistoryFileV1> {
    try {
      const raw = await readFile(this.file(), "utf8");
      const value = JSON.parse(raw) as OperationalHealthHistoryFileV1;
      assertHistory(value, this.maxRecords);
      return structuredClone(value);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const empty: OperationalHealthHistoryFileV1 = {
          schemaVersion: 1,
          updatedAt: this.now().toISOString(),
          maxRecords: this.maxRecords,
          records: [],
          authority: "operational_health_history_observation_only",
          grantsAuthority: false,
        };
        return empty;
      }
      if (error instanceof OperationalHealthHistoryError) throw error;
      throw new OperationalHealthHistoryError(
        "operational health history could not be read safely",
        "history_corrupt",
        { cause: error },
      );
    }
  }

  private async persist(value: OperationalHealthHistoryFileV1): Promise<void> {
    assertHistory(value, this.maxRecords);
    await mkdir(this.dir(), { recursive: true });
    const temp = path.join(
      this.dir(),
      `.history-${process.pid}-${crypto.randomUUID()}.tmp`,
    );
    try {
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temp, this.file());
    } catch (error) {
      throw new OperationalHealthHistoryError(
        "operational health history could not be persisted",
        "store_failed",
        { cause: error },
      );
    }
  }

  private async appendRecord(
    record: OperationalHealthHistoryRecordV1,
  ): Promise<OperationalHealthHistoryRecordV1> {
    assertRecord(record);
    const current = await this.load();
    const records = [...current.records, structuredClone(record)];
    const retained = records.slice(Math.max(0, records.length - this.maxRecords));
    const next: OperationalHealthHistoryFileV1 = {
      schemaVersion: 1,
      updatedAt: record.recordedAt,
      maxRecords: this.maxRecords,
      records: retained,
      authority: "operational_health_history_observation_only",
      grantsAuthority: false,
    };
    await this.persist(next);
    return Object.freeze(structuredClone(record));
  }

  async appendReadiness(
    summary: ProductionReadinessSummaryV1,
  ): Promise<OperationalHealthHistoryRecordV1> {
    if (
      summary.schemaVersion !== 1
      || summary.authority !== "production_readiness_observation_only"
      || summary.readOnly !== true
      || summary.sanitized !== true
      || summary.grantsReleaseAuthority !== false
    ) {
      throw new OperationalHealthHistoryError(
        "readiness summary is not sanitized M16A evidence",
        "record_invalid",
      );
    }
    const recordedAt = this.now().toISOString();
    return await this.appendRecord({
      schemaVersion: 1,
      recordId: this.id(),
      recordedAt,
      kind: "readiness",
      ready: summary.ready,
      healthyCount: summary.healthyCount,
      staleCount: summary.staleCount,
      unavailableCount: summary.unavailableCount,
      failedCount: summary.failedCount,
      securityReady: summary.securityReady,
      reliabilityReady: summary.reliabilityReady,
      observabilityReady: summary.observabilityReady,
      authority: "operational_health_history_record",
      grantsAuthority: false,
    });
  }

  async appendEvent(
    event: OperationalEventV1,
  ): Promise<OperationalHealthHistoryRecordV1> {
    assertEvent(event);
    const recordedAt = this.now().toISOString();
    return await this.appendRecord({
      schemaVersion: 1,
      recordId: this.id(),
      recordedAt,
      kind: "event",
      event: structuredClone(event),
      authority: "operational_health_history_record",
      grantsAuthority: false,
    });
  }
}
