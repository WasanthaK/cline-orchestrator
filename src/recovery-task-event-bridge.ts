/**
 * M19R2B: read-only recovery incidents from the existing trusted TaskStore
 * append-only event log. Never use message/data/source code/worker output.
 *
 * This projection only proves durable orchestration observations. It cannot
 * claim that a tool completed, a Git diff advanced, or a model was idle.
 */
import crypto from "node:crypto";
import type { OrchestratorTask, TaskEvent, TaskEventType, TaskStatus } from "./types.js";
import { triageRecovery, type RecoverySignal, type RecoveryTriageV1 } from "./recovery-supervisor-triage.js";

export const RECOVERY_EVENT_LIMITS = Object.freeze({
  maxSourceEvents: 1000 as const,
  maxShownIncidents: 40 as const,
});
type RelevantSignal = "context_pressure" | "watchdog_stall" |
  "human_approval" | "validation_failure";

export interface DurableRecoveryIncidentV1 {
  schemaVersion: 1;
  incidentId: string;
  signal: RelevantSignal;
  state: "open" | "resolved";
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  occurrences: number;
  triage: RecoveryTriageV1;
  evidence: "durable_task_events";
  grantsAuthority: false;
}
export interface DurableRecoveryProjectionV1 {
  schemaVersion: 1;
  readOnly: true;
  source: "trusted_task_store";
  coverage: "durable_events_only";
  availability: "available" | "unavailable";
  reason?: "invalid_task" | "invalid_event_source" | "history_over_limit" | "read_failed" | "not_connected" | "task_changed";
  taskId?: string;
  taskStatus?: TaskStatus;
  capturedAt?: string;
  totalEvents?: number;
  totalIncidents?: number;
  truncated: boolean;
  /** Successful independent check events, not equivalent to code progress. */
  validationPassedEvents?: number;
  diffSafetyPassedEvents?: number;
  lastIndependentCheckAt?: string;
  toolCompletionEvidenceAvailable: boolean;
  toolProgressMilestonesRecorded?: number;
  lastToolProgressAt?: string;
  noProgressFingerprintVerified: false;
  incidents: DurableRecoveryIncidentV1[];
  grantsAuthority: false;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validTypes: readonly TaskEventType[] = [
  "queued", "resume_queued", "git_snapshot", "checkpoint_created",
  "checkpoint_unavailable", "run_started", "session_started", "session_recovered",
  "context_handoff_created", "context_rotating", "recovery_tool_progress", "stalled", "retrying",
  "human_escalation_requested", "human_escalation_approved", "human_escalation_rejected",
  "validation_started", "validation_passed", "validation_failed",
  "validation_repairing", "diff_safety_started", "diff_safety_warning",
  "diff_safety_passed", "diff_safety_failed", "abort_requested",
  "rollback_requested", "rollback_completed", "rollback_failed",
  "completed", "failed", "aborted",
];
const validStatuses: readonly TaskStatus[] = [
  "created", "running", "waiting", "waiting_for_human", "stalled",
  "validating", "repairing", "safety_checking", "completed",
  "validation_failed", "failed", "aborted", "rolled_back",
];
const signalForEvent: Partial<Record<TaskEventType, RelevantSignal>> = {
  context_rotating: "context_pressure",
  stalled: "watchdog_stall",
  human_escalation_requested: "human_approval",
  validation_failed: "validation_failure",
};
const resolutionEvents: Record<RelevantSignal, readonly TaskEventType[]> = {
  context_pressure: ["context_handoff_created", "completed", "aborted"],
  watchdog_stall: ["session_recovered", "completed", "aborted"],
  human_approval: ["human_escalation_approved", "human_escalation_rejected", "completed", "aborted"],
  validation_failure: ["validation_passed", "completed", "aborted"],
};
function validIso(value: unknown, capturedMs: number): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) && timestampMs <= capturedMs
    && new Date(timestampMs).toISOString() === value;
}
export function unavailableRecoveryEvidence(reason: NonNullable<DurableRecoveryProjectionV1["reason"]>): DurableRecoveryProjectionV1 {
  return {
    schemaVersion: 1, readOnly: true, source: "trusted_task_store",
    coverage: "durable_events_only", availability: "unavailable", reason,
    truncated: false, toolCompletionEvidenceAvailable: false,
    noProgressFingerprintVerified: false, incidents: [], grantsAuthority: false,
  };
}
function triageStatus(status: TaskStatus): "running" | "waiting_for_human" | "stalled" | "failed" | "unknown" {
  if (status === "waiting_for_human") return "waiting_for_human";
  if (status === "stalled") return "stalled";
  if (status === "running" || status === "repairing" || status === "validating") return "running";
  if (status === "failed" || status === "validation_failed" || status === "aborted") return "failed";
  return "unknown";
}
function incidentId(taskId: string, signal: RelevantSignal, eventId: string): string {
  return crypto.createHash("sha256").update("m19r2b\0")
    .update(taskId).update("\0").update(signal).update("\0")
    .update(eventId).digest("hex");
}

/** All unexpected or missing events fail closed, never become a synthetic zero. */
export function projectDurableRecoveryEvents(
  task: Pick<OrchestratorTask, "id" | "status" | "runCount">,
  rawEvents: unknown,
  capturedAt: string,
): DurableRecoveryProjectionV1 {
  const now = Date.parse(capturedAt);
  if (!Number.isFinite(now) || !validIso(capturedAt, now)
    || !task || !uuid.test(task.id) || !validStatuses.includes(task.status)
    || (task.runCount !== undefined && (!Number.isSafeInteger(task.runCount)
      || task.runCount < 0 || task.runCount > 100000))) return unavailableRecoveryEvidence("invalid_task");
  if (!Array.isArray(rawEvents)) return unavailableRecoveryEvidence("invalid_event_source");
  if (rawEvents.length > RECOVERY_EVENT_LIMITS.maxSourceEvents) {
    return unavailableRecoveryEvidence("history_over_limit");
  }
  const events: Array<Pick<TaskEvent, "id" | "type" | "timestamp">> = [];
  const seen = new Set<string>();
  let prevMs = -1;
  for (const raw of rawEvents as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailableRecoveryEvidence("invalid_event_source");
    const e = raw as Partial<TaskEvent>;
    if (!uuid.test(e.id ?? "") || e.taskId !== task.id
      || typeof e.type !== "string" || !validTypes.includes(e.type as TaskEventType)
      || !validIso(e.timestamp, now) || seen.has(e.id!)) {
      return unavailableRecoveryEvidence("invalid_event_source");
    }
    const ms = Date.parse(e.timestamp!);
    if (ms < prevMs) return unavailableRecoveryEvidence("invalid_event_source");
    prevMs = ms;
    seen.add(e.id!);
    // Strict projection: never retain source data/message/paths/approval detail.
    events.push({ id: e.id!, type: e.type as TaskEventType, timestamp: e.timestamp! });
  }

  const incidents: DurableRecoveryIncidentV1[] = [];
  const open = new Map<RelevantSignal, DurableRecoveryIncidentV1>();
  let validationPassedEvents = 0, diffSafetyPassedEvents = 0;
  let toolProgressMilestonesRecorded = 0;
  let lastToolProgressAt: string | undefined;
  let lastIndependentCheckAt: string | undefined;
  for (const e of events) {
    if (e.type === "recovery_tool_progress") {
      toolProgressMilestonesRecorded++;
      lastToolProgressAt = e.timestamp;
    }
    if (e.type === "validation_passed" || e.type === "diff_safety_passed") {
      if (e.type === "validation_passed") validationPassedEvents++;
      else diffSafetyPassedEvents++;
      lastIndependentCheckAt = e.timestamp;
    }
    // Resolving evidence must predate any new incident at the same event.
    for (const [signal, active] of open.entries()) {
      if (resolutionEvents[signal].includes(e.type)) {
        active.state = "resolved";
        active.resolvedAt = e.timestamp;
        open.delete(signal);
      }
    }
    const signal = signalForEvent[e.type];
    if (!signal) continue;
    const current = open.get(signal);
    if (current) {
      current.lastSeenAt = e.timestamp;
      current.occurrences++;
      continue;
    }
    const triage = triageRecovery({
      schemaVersion: 1,
      signal: signal as RecoverySignal,
      taskStatus: triageStatus(task.status),
      attemptCount: Math.min(task.runCount ?? 0, 100000),
      ...(signal === "human_approval" ? { humanApprovalRequired: true } : {}),
      // contextTokens/threshold and tool-in-flight are NOT present in TaskStore
      // event envelopes; never infer them from free-form event messages.
    });
    const item: DurableRecoveryIncidentV1 = {
      schemaVersion: 1, incidentId: incidentId(task.id, signal, e.id),
      signal, state: "open", firstSeenAt: e.timestamp,
      lastSeenAt: e.timestamp, occurrences: 1, triage,
      evidence: "durable_task_events", grantsAuthority: false,
    };
    incidents.push(item);
    open.set(signal, item);
  }
  const shown = incidents.slice(-RECOVERY_EVENT_LIMITS.maxShownIncidents).reverse();
  return {
    schemaVersion: 1, readOnly: true, source: "trusted_task_store",
    coverage: "durable_events_only", availability: "available",
    taskId: task.id, taskStatus: task.status, capturedAt,
    totalEvents: events.length, totalIncidents: incidents.length,
    truncated: incidents.length > shown.length,
    validationPassedEvents, diffSafetyPassedEvents,
    ...(lastIndependentCheckAt ? { lastIndependentCheckAt } : {}),
    toolCompletionEvidenceAvailable: toolProgressMilestonesRecorded > 0,
    toolProgressMilestonesRecorded,
    ...(lastToolProgressAt ? { lastToolProgressAt } : {}),
    noProgressFingerprintVerified: false,
    incidents: shown.map(i => Object.freeze({...i})), grantsAuthority: false,
  };
}

/** Only a trusted server-side loader can make this projection about real state. */
export interface TrustedRecoveryTaskEventSource {
  load(taskId: string): Promise<OrchestratorTask>;
  events(taskId: string): Promise<TaskEvent[]>;
}
export async function readTrustedRecoveryEvents(
  taskId: string, source: TrustedRecoveryTaskEventSource,
  capturedAt = new Date().toISOString(),
): Promise<DurableRecoveryProjectionV1> {
  if (!uuid.test(taskId)) return unavailableRecoveryEvidence("invalid_task");
  try {
    const task = await source.load(taskId);
    if (task.id !== taskId) return unavailableRecoveryEvidence("invalid_task");
    return projectDurableRecoveryEvents(task, await source.events(taskId), capturedAt);
  } catch {
    // No filesystem path, upstream text, error stack or message can leak.
    return unavailableRecoveryEvidence("read_failed");
  }
}
