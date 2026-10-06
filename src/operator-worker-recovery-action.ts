import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { OperatorActionError } from "./operator-action.js";
import type {
  ScheduledHubTargetRecoveryPreviewV1,
  ScheduledHubTargetRecoveryResultV1,
} from "./scheduled-hub-recovery.js";

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OperatorWorkerRecoveryPreview {
  action: "recover_scheduled_writer";
  taskId: string;
  workspaceId: string;
  runCount: number;
  sessionGeneration: number;
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
}

export interface OperatorWorkerRecoveryAuditV1 {
  schemaVersion: 1;
  auditId: string;
  recordedAt: string;
  kind: "scheduled_writer_recovery_confirmed";
  taskId: string;
  workspaceId: string;
  confirmationId: string;
}

export interface OperatorWorkerRecoveryAuditStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export interface OperatorWorkerRecoveryService {
  previewInterruptedTaskRecovery(taskId: string): Promise<ScheduledHubTargetRecoveryPreviewV1>;
  recoverInterruptedTask(
    taskId: string,
    expectedFingerprint: string,
  ): Promise<ScheduledHubTargetRecoveryResultV1>;
}

interface PendingWorkerRecovery {
  action: "recover_scheduled_writer";
  taskId: string;
  workspaceId: string;
  fingerprint: string;
  confirmationId: string;
  expiresAtMs: number;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new Error(`${field} must be an opaque UUID`);
  return value;
}

/** Durable local-operator provenance. Confirmation tokens are never persisted. */
export class OperatorWorkerRecoveryAuditStore {
  constructor(
    private readonly rootDir: string,
    private readonly options: OperatorWorkerRecoveryAuditStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "operator-worker-audit");
  }

  private journal(taskId: string): string {
    return path.join(this.dir(), `${requireUuid(taskId, "taskId")}.jsonl`);
  }

  async appendConfirmed(
    taskId: string,
    workspaceId: string,
    confirmationId: string,
  ): Promise<OperatorWorkerRecoveryAuditV1> {
    taskId = requireUuid(taskId, "taskId");
    workspaceId = requireUuid(workspaceId, "workspaceId");
    confirmationId = requireUuid(confirmationId, "confirmationId");
    const audit: OperatorWorkerRecoveryAuditV1 = {
      schemaVersion: 1,
      auditId: requireUuid(
        (this.options.idFactory ?? (() => crypto.randomUUID()))(),
        "auditId",
      ),
      recordedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      kind: "scheduled_writer_recovery_confirmed",
      taskId,
      workspaceId,
      confirmationId,
    };
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.journal(taskId), `${JSON.stringify(audit)}\n`, "utf8");
    return audit;
  }

  async list(taskId: string): Promise<OperatorWorkerRecoveryAuditV1[]> {
    try {
      const raw = await readFile(this.journal(taskId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OperatorWorkerRecoveryAuditV1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }
}

/**
 * Bounded operator confirmation for one interrupted orchestrator-owned scheduled
 * writer. It exposes no Hub/process/credential control. The confirmation pins the
 * exact read-only recovery fingerprint; execution remains entirely inside the
 * targeted reconciler, recovery-permit, fenced scheduler and lease-aware executor
 * boundaries.
 */
export class OperatorWorkerRecoveryActionService {
  private readonly pending = new Map<string, PendingWorkerRecovery>();

  constructor(
    private readonly service: OperatorWorkerRecoveryService,
    private readonly auditStore: OperatorWorkerRecoveryAuditStore,
    private readonly now: () => number = Date.now,
  ) {}

  private preparePending(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAtMs <= now) this.pending.delete(token);
    }
    if (this.pending.size >= MAX_PENDING) {
      throw new OperatorActionError("Too many pending operator confirmations", "capacity_exceeded");
    }
  }

  private async previewCurrent(taskId: string, stale: boolean): Promise<ScheduledHubTargetRecoveryPreviewV1> {
    try {
      return await this.service.previewInterruptedTaskRecovery(taskId);
    } catch {
      throw new OperatorActionError(
        stale
          ? "Scheduled writer recovery state or authority changed after preview"
          : "Scheduled writer is not currently eligible for bounded recovery",
        stale ? "stale_action" : "invalid_action",
      );
    }
  }

  async previewScheduledWriterRecovery(taskId: string): Promise<OperatorWorkerRecoveryPreview> {
    const current = await this.previewCurrent(taskId, false);
    const now = this.now();
    this.preparePending(now);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    const confirmationId = crypto.randomUUID();
    this.pending.set(confirmationToken, {
      action: "recover_scheduled_writer",
      taskId: current.taskId,
      workspaceId: current.workspaceId,
      fingerprint: current.fingerprint,
      confirmationId,
      expiresAtMs,
    });
    return {
      action: "recover_scheduled_writer",
      taskId: current.taskId,
      workspaceId: current.workspaceId,
      runCount: current.runCount,
      sessionGeneration: current.sessionGeneration,
      confirmationText: "Recover only this interrupted orchestrator-owned scheduled writer after rechecking its current authority and acquiring a fresh fenced lease",
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken,
    };
  }

  async recoverScheduledWriter(input: {
    taskId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<ScheduledHubTargetRecoveryResultV1> {
    if (input.confirmed !== true) {
      throw new OperatorActionError("Explicit operator confirmation is required", "invalid_action");
    }
    const entry = this.pending.get(input.confirmationToken);
    if (
      !entry
      || entry.action !== "recover_scheduled_writer"
      || entry.taskId !== input.taskId
    ) {
      throw new OperatorActionError("Operator confirmation is invalid or already used", "invalid_action");
    }

    // Burn before the first await so concurrent/replayed confirmations cannot both
    // reach the recovery-permit or fenced-scheduler boundary.
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }

    const current = await this.previewCurrent(entry.taskId, true);
    if (
      current.workspaceId !== entry.workspaceId
      || current.fingerprint !== entry.fingerprint
    ) {
      throw new OperatorActionError(
        "Scheduled writer task, checkpoint, lease state, or safety authority changed after preview",
        "stale_action",
      );
    }

    await this.auditStore.appendConfirmed(
      entry.taskId,
      entry.workspaceId,
      entry.confirmationId,
    );

    return await this.service.recoverInterruptedTask(entry.taskId, entry.fingerprint);
  }
}
