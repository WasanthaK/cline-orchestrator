import type { OperationalEventV1 } from "./operational-event.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";

export type OperationalAlertClass =
  | "informational"
  | "warning"
  | "urgent"
  | "blocking";

export const OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "operational_alert_classification_only" as const,
  deterministic: true as const,
  consumesSanitizedEvidenceOnly: true as const,
  blockingRequiresOperatorAttention: true as const,
  blockingFailClosed: true as const,
  pausesTask: false as const,
  abortsTask: false as const,
  retriesTask: false as const,
  repairsTask: false as const,
  mutatesRuntimeState: false as const,
  mutatesTaskState: false as const,
  grantsAuthority: false as const,
});

export interface OperationalAlertV1 {
  schemaVersion: 1;
  source: "readiness" | "event";
  classification: OperationalAlertClass;
  code: string;
  observedAt: string;
  taskId?: string;
  workspaceId?: string;
  projectId?: string;
  operatorAttentionRequired: boolean;
  failClosed: boolean;
  authority: "operational_alert_classification_only";
  pausesTask: false;
  abortsTask: false;
  retriesTask: false;
  repairsTask: false;
  mutatesRuntimeState: false;
  mutatesTaskState: false;
  grantsAuthority: false;
}

export class OperationalAlertClassificationError extends Error {
  constructor(
    message: string,
    public readonly code: "evidence_invalid",
  ) {
    super(message);
    this.name = "OperationalAlertClassificationError";
  }
}

function makeAlert(input: {
  source: "readiness" | "event";
  classification: OperationalAlertClass;
  code: string;
  observedAt: string;
  taskId?: string;
  workspaceId?: string;
  projectId?: string;
}): OperationalAlertV1 {
  return Object.freeze({
    schemaVersion: 1,
    source: input.source,
    classification: input.classification,
    code: input.code,
    observedAt: input.observedAt,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    operatorAttentionRequired: input.classification !== "informational",
    failClosed: input.classification === "blocking",
    authority: "operational_alert_classification_only",
    pausesTask: false,
    abortsTask: false,
    retriesTask: false,
    repairsTask: false,
    mutatesRuntimeState: false,
    mutatesTaskState: false,
    grantsAuthority: false,
  });
}

export function classifyReadinessAlert(
  summary: ProductionReadinessSummaryV1,
): OperationalAlertV1 {
  if (
    summary.schemaVersion !== 1
    || summary.authority !== "production_readiness_observation_only"
    || summary.readOnly !== true
    || summary.sanitized !== true
    || summary.grantsReleaseAuthority !== false
    || !Number.isFinite(Date.parse(summary.evaluatedAt))
  ) {
    throw new OperationalAlertClassificationError(
      "readiness evidence is invalid or authority-widened",
      "evidence_invalid",
    );
  }

  if (summary.ready) {
    return makeAlert({
      source: "readiness",
      classification: "informational",
      code: "production_ready",
      observedAt: summary.evaluatedAt,
    });
  }
  if (summary.failedCount > 0 || summary.unavailableCount > 0) {
    return makeAlert({
      source: "readiness",
      classification: "blocking",
      code: "production_required_control_unavailable_or_failed",
      observedAt: summary.evaluatedAt,
    });
  }
  if (summary.staleCount > 0) {
    return makeAlert({
      source: "readiness",
      classification: "blocking",
      code: "production_required_control_stale",
      observedAt: summary.evaluatedAt,
    });
  }
  return makeAlert({
    source: "readiness",
    classification: "blocking",
    code: "production_not_ready",
    observedAt: summary.evaluatedAt,
  });
}

const EVENT_CLASSIFICATION: Readonly<Record<OperationalEventV1["code"], {
  classification: OperationalAlertClass;
  alertCode: string;
}>> = Object.freeze({
  readiness_evaluated: { classification: "informational", alertCode: "readiness_evaluated" },
  readiness_control_failed: { classification: "blocking", alertCode: "readiness_control_failed" },
  readiness_control_stale: { classification: "blocking", alertCode: "readiness_control_stale" },
  runtime_started: { classification: "informational", alertCode: "runtime_started" },
  runtime_completed: { classification: "informational", alertCode: "runtime_completed" },
  runtime_failed: { classification: "urgent", alertCode: "runtime_failed" },
  runtime_stalled: { classification: "warning", alertCode: "runtime_stalled" },
  runtime_recovered: { classification: "informational", alertCode: "runtime_recovered" },
  writer_lease_lost: { classification: "blocking", alertCode: "writer_lease_lost" },
  writer_fence_rejected: { classification: "blocking", alertCode: "writer_fence_rejected" },
  audit_sink_unavailable: { classification: "blocking", alertCode: "audit_sink_unavailable" },
  remote_rate_limited: { classification: "warning", alertCode: "remote_rate_limited" },
  remote_replay_rejected: { classification: "warning", alertCode: "remote_replay_rejected" },
  delivery_recovery_ambiguous: { classification: "blocking", alertCode: "delivery_recovery_ambiguous" },
});

export function classifyOperationalEventAlert(
  event: OperationalEventV1,
): OperationalAlertV1 {
  if (
    event.schemaVersion !== 1
    || event.authority !== "operational_event_observation_only"
    || event.grantsAuthority !== false
    || !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    throw new OperationalAlertClassificationError(
      "operational event evidence is invalid or authority-widened",
      "evidence_invalid",
    );
  }

  const mapped = EVENT_CLASSIFICATION[event.code];
  if (!mapped) {
    throw new OperationalAlertClassificationError(
      "operational event code has no deterministic alert mapping",
      "evidence_invalid",
    );
  }

  return makeAlert({
    source: "event",
    classification: mapped.classification,
    code: mapped.alertCode,
    observedAt: event.occurredAt,
    taskId: event.taskId,
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
}
