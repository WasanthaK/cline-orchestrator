import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, TaskEvent, TaskEventType } from "./types.js";

const MAX_SUMMARY_CHARS = 2_000;
const MAX_REFS = 50;

export type SentinelIncidentKind =
  | "task_failure"
  | "provider_failure"
  | "gateway_failure"
  | "runtime_stall"
  | "session_recovery"
  | "validation_failure"
  | "diff_safety_failure"
  | "rollback_failure"
  | "checkpoint_unavailable"
  | "human_escalation";

export type SentinelSeverity = "info" | "warning" | "error" | "critical";
export type SentinelIncidentStatus = "open" | "resolved";

export interface SentinelObservationV1 {
  schemaVersion: 1;
  observationId: string;
  observedAt: string;
  workspaceId: string;
  fingerprint: string;
  kind: SentinelIncidentKind;
  severity: SentinelSeverity;
  state: SentinelIncidentStatus;
  summary: string;
  humanActionRequired: boolean;
  failClosed: boolean;
  taskId?: string;
  eventId?: string;
  recoveryAttempts?: number;
  resolutionEvidenceEventId?: string;
}

export interface SentinelIncidentV1 {
  schemaVersion: 1;
  incidentId: string;
  workspaceId: string;
  fingerprint: string;
  kind: SentinelIncidentKind;
  severity: SentinelSeverity;
  status: SentinelIncidentStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  summary: string;
  humanActionRequired: boolean;
  failClosed: boolean;
  recoveryAttempts: number;
  taskIds: string[];
  eventIds: string[];
  resolutionEvidenceEventId?: string;
}

export interface SentinelOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class SentinelError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_observation"
      | "incident_not_found"
      | "resolution_evidence_invalid",
  ) {
    super(message);
    this.name = "SentinelError";
  }
}

const SEVERITY_RANK: Record<SentinelSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

const RESOLUTION_EVENTS: Partial<Record<SentinelIncidentKind, Set<TaskEventType>>> = {
  task_failure: new Set(["run_started", "completed"]),
  provider_failure: new Set(["run_started", "completed"]),
  gateway_failure: new Set(["run_started", "session_recovered", "completed"]),
  runtime_stall: new Set(["retrying", "session_recovered", "completed"]),
  session_recovery: new Set(["completed"]),
  validation_failure: new Set(["validation_passed", "completed"]),
  diff_safety_failure: new Set(["diff_safety_passed", "completed"]),
  rollback_failure: new Set(["rollback_completed"]),
  checkpoint_unavailable: new Set(["checkpoint_created"]),
  human_escalation: new Set(["human_escalation_approved", "human_escalation_rejected"]),
};

function boundedRedactedText(value: string): string {
  const redacted = value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s,;]+/gi, "[URL]")
    .replace(/\b[A-Za-z]:\\[^\s,;]+/g, "[PATH]")
    .replace(/(^|\s)\/(?:[^\s,;]+)/g, "$1[PATH]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[ID]");
  const normalized = redacted.trim() || "Incident observed";
  return normalized.length <= MAX_SUMMARY_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_SUMMARY_CHARS)}…`;
}

function stableSignature(value: string): string {
  return boundedRedactedText(value)
    .toLowerCase()
    .replace(/\b\d{3,}\b/g, "[n]")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(workspaceId: string, kind: SentinelIncidentKind, signature: string): string {
  return crypto
    .createHash("sha256")
    .update(`${workspaceId}\n${kind}\n${stableSignature(signature)}`, "utf8")
    .digest("hex");
}

function finishReason(task: OrchestratorTask): string {
  return task.finishReason?.trim().toLowerCase() ?? "";
}

function classificationForEvent(
  task: OrchestratorTask,
  event: TaskEvent,
): {
  kind: SentinelIncidentKind;
  severity: SentinelSeverity;
  signature: string;
  humanActionRequired: boolean;
  failClosed: boolean;
  recoveryAttempts?: number;
} | undefined {
  switch (event.type) {
    case "stalled":
      return {
        kind: "runtime_stall",
        severity: "warning",
        signature: "watchdog runtime stall",
        humanActionRequired: false,
        failClosed: false,
        recoveryAttempts: task.retryCount ?? 0,
      };
    case "session_recovered":
      return {
        kind: "session_recovery",
        severity: "warning",
        signature: `session recovery ${task.lastRecoveryReason ?? "unknown"}`,
        humanActionRequired: false,
        failClosed: false,
        recoveryAttempts: task.recoveryCount ?? 0,
      };
    case "validation_failed":
      return {
        kind: "validation_failure",
        severity: "error",
        signature: "external validation failed",
        humanActionRequired: false,
        failClosed: true,
      };
    case "diff_safety_failed":
      return {
        kind: "diff_safety_failure",
        severity: "critical",
        signature: "checkpoint relative diff safety failed",
        humanActionRequired: true,
        failClosed: true,
      };
    case "rollback_failed":
      return {
        kind: "rollback_failure",
        severity: "critical",
        signature: "rollback failed",
        humanActionRequired: true,
        failClosed: true,
      };
    case "checkpoint_unavailable":
      return {
        kind: "checkpoint_unavailable",
        severity: "critical",
        signature: "rollback checkpoint unavailable",
        humanActionRequired: true,
        failClosed: true,
      };
    case "human_escalation_requested":
      return {
        kind: "human_escalation",
        severity: "warning",
        signature: "human escalation requested",
        humanActionRequired: true,
        failClosed: true,
      };
    case "failed": {
      const reason = finishReason(task);
      if (reason === "diff_safety_failed") return undefined;
      if (reason === "provider_preflight_failed") {
        return {
          kind: "provider_failure",
          severity: "error",
          signature: `provider preflight failed ${task.error ?? ""}`,
          humanActionRequired: false,
          failClosed: true,
        };
      }
      if (reason === "gateway_execution_failed" || reason === "gateway_recovery_denied") {
        return {
          kind: "gateway_failure",
          severity: "critical",
          signature: `${reason} ${task.error ?? ""}`,
          humanActionRequired: true,
          failClosed: true,
        };
      }
      return {
        kind: "task_failure",
        severity: "error",
        signature: `task failure ${reason || "unknown"} ${task.error ?? ""}`,
        humanActionRequired: false,
        failClosed: true,
      };
    }
    default:
      return undefined;
  }
}

function uniqueBounded(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).slice(-MAX_REFS);
}

export class SentinelStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceId: string,
    private readonly options: SentinelOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.workspaceRoot, ".orchestrator", "sentinel");
  }

  private journal(): string {
    return path.join(this.dir(), "observations.jsonl");
  }

  async observations(): Promise<SentinelObservationV1[]> {
    try {
      const raw = await readFile(this.journal(), "utf8");
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SentinelObservationV1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }

  async append(input: Omit<SentinelObservationV1, "schemaVersion" | "observationId" | "observedAt" | "workspaceId"> & { observedAt?: string }): Promise<SentinelObservationV1> {
    await mkdir(this.dir(), { recursive: true });
    const observationId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    const observedAt = input.observedAt ?? (this.options.now ?? (() => new Date()))().toISOString();
    const observation: SentinelObservationV1 = {
      schemaVersion: 1,
      observationId,
      observedAt,
      workspaceId: this.workspaceId,
      fingerprint: input.fingerprint,
      kind: input.kind,
      severity: input.severity,
      state: input.state,
      summary: boundedRedactedText(input.summary),
      humanActionRequired: input.humanActionRequired,
      failClosed: input.failClosed,
      taskId: input.taskId,
      eventId: input.eventId,
      recoveryAttempts: input.recoveryAttempts,
      resolutionEvidenceEventId: input.resolutionEvidenceEventId,
    };
    await appendFile(this.journal(), `${JSON.stringify(observation)}\n`, "utf8");
    return observation;
  }

  async incidents(): Promise<SentinelIncidentV1[]> {
    const observations = await this.observations();
    const groups = new Map<string, SentinelObservationV1[]>();
    for (const observation of observations) {
      const list = groups.get(observation.fingerprint) ?? [];
      list.push(observation);
      groups.set(observation.fingerprint, list);
    }

    return [...groups.values()].map<SentinelIncidentV1>((group) => {
      group.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const openObservations = group.filter((item) => item.state === "open");
      const mostSevere = openObservations.reduce<SentinelSeverity>(
        (current, item) => SEVERITY_RANK[item.severity] > SEVERITY_RANK[current] ? item.severity : current,
        first.severity,
      );
      return {
        schemaVersion: 1,
        incidentId: first.observationId,
        workspaceId: first.workspaceId,
        fingerprint: first.fingerprint,
        kind: first.kind,
        severity: mostSevere,
        status: last.state,
        firstSeenAt: first.observedAt,
        lastSeenAt: last.observedAt,
        occurrenceCount: openObservations.length,
        summary: last.summary,
        humanActionRequired: last.state === "open" && openObservations.some((item) => item.humanActionRequired),
        failClosed: openObservations.some((item) => item.failClosed),
        recoveryAttempts: Math.max(0, ...openObservations.map((item) => item.recoveryAttempts ?? 0)),
        taskIds: uniqueBounded(openObservations.map((item) => item.taskId)),
        eventIds: uniqueBounded(openObservations.map((item) => item.eventId)),
        resolutionEvidenceEventId: last.resolutionEvidenceEventId,
      };
    }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}

export class OrchestratorSentinel {
  private readonly tasks: TaskStore;
  private readonly store: SentinelStore;

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceId: string,
    options: SentinelOptions = {},
  ) {
    this.tasks = new TaskStore(workspaceRoot);
    this.store = new SentinelStore(workspaceRoot, workspaceId, options);
  }

  async ingestTask(taskId: string): Promise<SentinelIncidentV1[]> {
    const [task, events, existing] = await Promise.all([
      this.tasks.load(taskId),
      this.tasks.events(taskId),
      this.store.observations(),
    ]);
    const seenEventIds = new Set(existing.map((item) => item.eventId).filter(Boolean));

    for (const event of events) {
      if (seenEventIds.has(event.id)) continue;
      const classification = classificationForEvent(task, event);
      if (!classification) continue;
      await this.store.append({
        fingerprint: fingerprint(this.workspaceId, classification.kind, classification.signature),
        kind: classification.kind,
        severity: classification.severity,
        state: "open",
        summary: event.message ?? classification.signature,
        humanActionRequired: classification.humanActionRequired,
        failClosed: classification.failClosed,
        taskId,
        eventId: event.id,
        recoveryAttempts: classification.recoveryAttempts,
        observedAt: event.timestamp,
      });
      seenEventIds.add(event.id);
    }
    return await this.store.incidents();
  }

  async listIncidents(): Promise<SentinelIncidentV1[]> {
    return await this.store.incidents();
  }

  async resolveIncident(
    incidentFingerprint: string,
    taskId: string,
    evidenceEventId: string,
  ): Promise<SentinelIncidentV1> {
    const incidents = await this.store.incidents();
    const incident = incidents.find((item) => item.fingerprint === incidentFingerprint);
    if (!incident) throw new SentinelError("Incident was not found", "incident_not_found");
    if (incident.status === "resolved") return incident;

    const event = (await this.tasks.events(taskId)).find((item) => item.id === evidenceEventId);
    const allowed = RESOLUTION_EVENTS[incident.kind];
    if (!event || !allowed?.has(event.type)) {
      throw new SentinelError(
        `Event ${evidenceEventId} is not valid resolution evidence for ${incident.kind}`,
        "resolution_evidence_invalid",
      );
    }

    await this.store.append({
      fingerprint: incident.fingerprint,
      kind: incident.kind,
      severity: "info",
      state: "resolved",
      summary: `Resolved by durable ${event.type} evidence`,
      humanActionRequired: false,
      failClosed: incident.failClosed,
      taskId,
      eventId: evidenceEventId,
      resolutionEvidenceEventId: evidenceEventId,
      observedAt: event.timestamp,
    });
    const updated = (await this.store.incidents()).find((item) => item.fingerprint === incident.fingerprint);
    if (!updated) throw new SentinelError("Incident disappeared after resolution", "incident_not_found");
    return updated;
  }
}
