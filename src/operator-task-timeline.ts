import type { PublicTaskEvent } from "./machine-orchestrator.js";

export const TASK_EVENT_TIMELINE_LIMITS = Object.freeze({
  maxSourceEvents: 1000 as const,
  maxShownEvents: 40 as const,
});

const eventLabels = {
  queued: "Task queued",
  resume_queued: "Resume queued",
  git_snapshot: "Git snapshot recorded",
  checkpoint_created: "Recovery checkpoint created",
  checkpoint_unavailable: "Recovery checkpoint unavailable",
  run_started: "Run started",
  session_started: "Worker session started",
  session_recovered: "Worker session recovered",
  context_handoff_created: "Context handoff created",
  context_rotating: "Context rotating",
  stalled: "Work stalled",
  retrying: "Retry started",
  human_escalation_requested: "Human review requested",
  human_escalation_approved: "Human review approved",
  human_escalation_rejected: "Human review rejected",
  validation_started: "Validation started",
  validation_passed: "Validation passed",
  validation_failed: "Validation failed",
  validation_repairing: "Validation repair started",
  diff_safety_started: "Diff safety check started",
  diff_safety_warning: "Diff safety warning",
  diff_safety_passed: "Diff safety check passed",
  diff_safety_failed: "Diff safety check failed",
  abort_requested: "Abort requested",
  rollback_requested: "Rollback requested",
  rollback_completed: "Rollback completed",
  rollback_failed: "Rollback failed",
  completed: "Task completed",
  failed: "Task failed",
  aborted: "Task aborted",
} as const satisfies Record<PublicTaskEvent["type"], string>;

export type SanitizedTaskTimelineV1 = {
  schemaVersion: 1;
  readOnly: true;
  availability: "available" | "unavailable";
  /** Stable reason code only. No error detail, worker message or raw event data. */
  reason?: "not_connected" | "task_changed" | "read_failed" | "invalid_event_source" | "history_over_limit";
  capturedAt?: string;
  totalObserved?: number;
  truncated: boolean;
  events: Array<{ at: string; label: string; type: keyof typeof eventLabels }>;
};

export function unavailableTaskTimeline(reason: NonNullable<SanitizedTaskTimelineV1["reason"]>): SanitizedTaskTimelineV1 {
  return { schemaVersion: 1, readOnly: true, availability: "unavailable", reason, truncated: false, events: [] };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/**
 * Fail closed on malformed or unbounded source records, then project ONLY
 * allowlisted event types and ISO timestamps. In particular, never retain
 * event IDs, worker messages, raw event data, path, session or checkpoint IDs.
 */
export function projectTaskTimeline(
  taskId: string,
  rawEvents: readonly PublicTaskEvent[],
  capturedAt: string,
): SanitizedTaskTimelineV1 {
  if (!validTimestamp(capturedAt) || !Array.isArray(rawEvents)) {
    return unavailableTaskTimeline("invalid_event_source");
  }
  if (rawEvents.length > TASK_EVENT_TIMELINE_LIMITS.maxSourceEvents) {
    return unavailableTaskTimeline("history_over_limit");
  }
  const events: SanitizedTaskTimelineV1["events"] = [];
  for (const event of rawEvents) {
    if (!event || event.taskId !== taskId || !validTimestamp(event.timestamp)
      || !Object.prototype.hasOwnProperty.call(eventLabels, event.type)) {
      return unavailableTaskTimeline("invalid_event_source");
    }
    // Labels and event type are constants from our allowlist, not source text.
    events.push({ at: event.timestamp, type: event.type, label: eventLabels[event.type] });
  }
  const shown = events.slice(-TASK_EVENT_TIMELINE_LIMITS.maxShownEvents).reverse();
  return {
    schemaVersion: 1,
    readOnly: true,
    availability: "available",
    capturedAt,
    totalObserved: events.length,
    truncated: events.length > shown.length,
    events: shown,
  };
}
