import type { OperationalAlertV1 } from "./operational-alert-classification.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";
import type { ResourceBackpressureSummaryV1 } from "./resource-backpressure.js";

export type ProductionOperatorStatusHealth =
  | "healthy"
  | "attention"
  | "critical"
  | "unknown";

export const PRODUCTION_OPERATOR_STATUS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "production_operator_status_observation_only" as const,
  readOnly: true as const,
  bounded: true as const,
  rawEventsExposed: false as const,
  promptsExposed: false as const,
  pathsExposed: false as const,
  credentialsExposed: false as const,
  actionsExposed: false as const,
  mutatesTaskState: false as const,
  mutatesRuntimeState: false as const,
  performsNetworkMutation: false as const,
  grantsAuthority: false as const,
});

export interface ProductionOperatorStatusInputV1 {
  readiness: ProductionReadinessSummaryV1;
  backpressure: ResourceBackpressureSummaryV1;
  alerts: OperationalAlertV1[];
}

export interface ProductionOperatorStatusV1 {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  actions: readonly [];
  health: ProductionOperatorStatusHealth;
  readiness: {
    ready: boolean;
    securityReady: boolean;
    reliabilityReady: boolean;
    observabilityReady: boolean;
    staleCount: number;
    unavailableCount: number;
    failedCount: number;
  };
  backpressure: {
    saturated: boolean;
    nearCapacity: boolean;
    nearCapacityCount: number;
    saturatedCount: number;
    unavailableCount: number;
  };
  notices: Array<{
    severity: "info" | "warning" | "critical";
    source: "readiness" | "backpressure" | "alert";
    code: string;
    at: string;
    taskId?: string;
    workspaceId?: string;
    projectId?: string;
  }>;
  truncation: {
    alerts: boolean;
    notices: boolean;
  };
  authority: "production_operator_status_observation_only";
  mutatesTaskState: false;
  mutatesRuntimeState: false;
  performsNetworkMutation: false;
  grantsAuthority: false;
}

export interface ProductionOperatorStatusOptions {
  now?: () => Date;
  maxAlerts?: number;
  maxNotices?: number;
}

export class ProductionOperatorStatusError extends Error {
  constructor(
    message: string,
    public readonly code: "input_invalid" | "configuration_invalid" | "clock_invalid",
  ) {
    super(message);
    this.name = "ProductionOperatorStatusError";
  }
}

const DEFAULT_MAX_ALERTS = 50;
const DEFAULT_MAX_NOTICES = 100;
const MAX_BOUND = 500;

function validateInput(input: ProductionOperatorStatusInputV1): void {
  if (
    input.readiness.schemaVersion !== 1
    || input.readiness.authority !== "production_readiness_observation_only"
    || input.readiness.readOnly !== true
    || input.readiness.sanitized !== true
    || input.readiness.grantsReleaseAuthority !== false
    || input.backpressure.schemaVersion !== 1
    || input.backpressure.authority !== "resource_backpressure_observation_only"
    || input.backpressure.readOnly !== true
    || input.backpressure.grantsAuthority !== false
  ) {
    throw new ProductionOperatorStatusError(
      "production operator status requires sanitized authority-free readiness/backpressure evidence",
      "input_invalid",
    );
  }
  for (const alert of input.alerts) {
    if (
      alert.schemaVersion !== 1
      || alert.authority !== "operational_alert_classification_only"
      || alert.grantsAuthority !== false
      || alert.mutatesTaskState !== false
      || alert.mutatesRuntimeState !== false
    ) {
      throw new ProductionOperatorStatusError(
        "production operator status requires sanitized authority-free alerts",
        "input_invalid",
      );
    }
  }
}

function severity(alert: OperationalAlertV1): "info" | "warning" | "critical" {
  if (alert.classification === "blocking" || alert.classification === "urgent") return "critical";
  if (alert.classification === "warning") return "warning";
  return "info";
}

export function buildProductionOperatorStatus(
  input: ProductionOperatorStatusInputV1,
  options: ProductionOperatorStatusOptions = {},
): ProductionOperatorStatusV1 {
  validateInput(input);

  const maxAlerts = options.maxAlerts ?? DEFAULT_MAX_ALERTS;
  const maxNotices = options.maxNotices ?? DEFAULT_MAX_NOTICES;
  if (
    !Number.isSafeInteger(maxAlerts)
    || maxAlerts < 1
    || maxAlerts > MAX_BOUND
    || !Number.isSafeInteger(maxNotices)
    || maxNotices < 1
    || maxNotices > MAX_BOUND
  ) {
    throw new ProductionOperatorStatusError(
      "production operator status bounds are invalid",
      "configuration_invalid",
    );
  }

  const now = (options.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ProductionOperatorStatusError(
      "production operator status clock is invalid",
      "clock_invalid",
    );
  }

  const boundedAlerts = [...input.alerts]
    .sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt)
      || a.classification.localeCompare(b.classification)
      || a.code.localeCompare(b.code))
    .slice(0, maxAlerts);

  const notices: ProductionOperatorStatusV1["notices"] = [];

  if (!input.readiness.ready) {
    notices.push({
      severity: "critical",
      source: "readiness",
      code: input.readiness.unavailableCount > 0
        ? "required_control_unavailable"
        : input.readiness.failedCount > 0
          ? "required_control_failed"
          : input.readiness.staleCount > 0
            ? "required_control_stale"
            : "production_not_ready",
      at: input.readiness.evaluatedAt,
    });
  }

  if (input.backpressure.saturated) {
    notices.push({
      severity: "critical",
      source: "backpressure",
      code: input.backpressure.unavailableCount > 0
        ? "resource_probe_unavailable"
        : "resource_saturated",
      at: input.backpressure.evaluatedAt,
    });
  } else if (input.backpressure.nearCapacity) {
    notices.push({
      severity: "warning",
      source: "backpressure",
      code: "resource_near_capacity",
      at: input.backpressure.evaluatedAt,
    });
  }

  for (const alert of boundedAlerts) {
    notices.push({
      severity: severity(alert),
      source: "alert",
      code: alert.code,
      at: alert.observedAt,
      ...(alert.taskId ? { taskId: alert.taskId } : {}),
      ...(alert.workspaceId ? { workspaceId: alert.workspaceId } : {}),
      ...(alert.projectId ? { projectId: alert.projectId } : {}),
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const boundedNotices = notices
    .sort((a, b) =>
      rank[a.severity] - rank[b.severity]
      || b.at.localeCompare(a.at)
      || a.source.localeCompare(b.source)
      || a.code.localeCompare(b.code))
    .slice(0, maxNotices);

  const hasCriticalAlert = boundedAlerts.some(
    (alert) => alert.classification === "blocking" || alert.classification === "urgent",
  );
  const hasWarningAlert = boundedAlerts.some(
    (alert) => alert.classification === "warning",
  );

  const health: ProductionOperatorStatusHealth =
    !input.readiness.observabilityReady
      ? "unknown"
      : !input.readiness.ready || input.backpressure.saturated || hasCriticalAlert
        ? "critical"
        : input.backpressure.nearCapacity || hasWarningAlert
          ? "attention"
          : "healthy";

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    readOnly: true,
    actions: [],
    health,
    readiness: {
      ready: input.readiness.ready,
      securityReady: input.readiness.securityReady,
      reliabilityReady: input.readiness.reliabilityReady,
      observabilityReady: input.readiness.observabilityReady,
      staleCount: input.readiness.staleCount,
      unavailableCount: input.readiness.unavailableCount,
      failedCount: input.readiness.failedCount,
    },
    backpressure: {
      saturated: input.backpressure.saturated,
      nearCapacity: input.backpressure.nearCapacity,
      nearCapacityCount: input.backpressure.nearCapacityCount,
      saturatedCount: input.backpressure.saturatedCount,
      unavailableCount: input.backpressure.unavailableCount,
    },
    notices: boundedNotices,
    truncation: {
      alerts: input.alerts.length > boundedAlerts.length,
      notices: notices.length > boundedNotices.length,
    },
    authority: "production_operator_status_observation_only",
    mutatesTaskState: false,
    mutatesRuntimeState: false,
    performsNetworkMutation: false,
    grantsAuthority: false,
  });
}
