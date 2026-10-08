export type ResourceBudgetId =
  | "remote.concurrent_sessions"
  | "remote.request_rate"
  | "remote.replay_entries"
  | "transport.request_bytes"
  | "scheduler.queued_writers"
  | "history.operational_records"
  | "recovery.scan_items";

export type ResourceBudgetStatus =
  | "healthy"
  | "near_capacity"
  | "saturated"
  | "unavailable";

export const RESOURCE_BACKPRESSURE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "resource_backpressure_observation_only" as const,
  readOnly: true as const,
  deterministic: true as const,
  hardLimitFailClosed: true as const,
  nearCapacityWarnOnly: true as const,
  pausesTask: false as const,
  abortsTask: false as const,
  retriesTask: false as const,
  mutatesQueue: false as const,
  mutatesRuntimeState: false as const,
  performsNetworkMutation: false as const,
  grantsAuthority: false as const,
});

export interface ResourceBudgetObservationV1 {
  schemaVersion: 1;
  budgetId: ResourceBudgetId;
  observedAt: string;
  used: number;
  limit: number;
  authority: "resource_budget_observation";
  grantsAuthority: false;
}

export interface ResourceBudgetProbe {
  observe(): Promise<ResourceBudgetObservationV1>;
}

export interface ResourceBudgetResultV1 {
  schemaVersion: 1;
  budgetId: ResourceBudgetId;
  status: ResourceBudgetStatus;
  used?: number;
  limit?: number;
  utilizationPercent?: number;
  observedAt?: string;
  issueCode?:
    | "probe_unavailable"
    | "probe_invalid"
    | "budget_saturated"
    | "budget_near_capacity";
  authority: "resource_budget_result";
  grantsAuthority: false;
}

export interface ResourceBackpressureSummaryV1 {
  schemaVersion: 1;
  evaluatedAt: string;
  saturated: boolean;
  nearCapacity: boolean;
  healthyCount: number;
  nearCapacityCount: number;
  saturatedCount: number;
  unavailableCount: number;
  budgets: ResourceBudgetResultV1[];
  authority: "resource_backpressure_observation_only";
  readOnly: true;
  pausesTask: false;
  abortsTask: false;
  retriesTask: false;
  mutatesQueue: false;
  mutatesRuntimeState: false;
  performsNetworkMutation: false;
  grantsAuthority: false;
}

export interface ResourceBackpressureOptions {
  now?: () => Date;
  nearCapacityRatio?: number;
  maxObservationAgeMs?: number;
}

export class ResourceBackpressureError extends Error {
  constructor(
    message: string,
    public readonly code: "configuration_invalid" | "clock_invalid",
  ) {
    super(message);
    this.name = "ResourceBackpressureError";
  }
}

const REQUIRED_BUDGETS: readonly ResourceBudgetId[] = Object.freeze([
  "remote.concurrent_sessions",
  "remote.request_rate",
  "remote.replay_entries",
  "transport.request_bytes",
  "scheduler.queued_writers",
  "history.operational_records",
  "recovery.scan_items",
]);

function result(
  budgetId: ResourceBudgetId,
  status: ResourceBudgetStatus,
  input: Partial<ResourceBudgetResultV1> = {},
): ResourceBudgetResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    budgetId,
    status,
    ...input,
    authority: "resource_budget_result",
    grantsAuthority: false,
  });
}

export class ResourceBackpressureEvaluator {
  private readonly nearCapacityRatio: number;
  private readonly maxObservationAgeMs: number;

  constructor(
    private readonly probes: ReadonlyMap<ResourceBudgetId, ResourceBudgetProbe>,
    private readonly options: ResourceBackpressureOptions = {},
  ) {
    this.nearCapacityRatio = options.nearCapacityRatio ?? 0.8;
    this.maxObservationAgeMs = options.maxObservationAgeMs ?? 60_000;
    if (
      !Number.isFinite(this.nearCapacityRatio)
      || this.nearCapacityRatio <= 0
      || this.nearCapacityRatio >= 1
      || !Number.isFinite(this.maxObservationAgeMs)
      || this.maxObservationAgeMs <= 0
      || this.maxObservationAgeMs > 60 * 60 * 1000
    ) {
      throw new ResourceBackpressureError(
        "resource backpressure configuration is invalid",
        "configuration_invalid",
      );
    }
  }

  async evaluate(): Promise<ResourceBackpressureSummaryV1> {
    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ResourceBackpressureError(
        "resource backpressure clock is invalid",
        "clock_invalid",
      );
    }

    const budgets: ResourceBudgetResultV1[] = [];
    for (const budgetId of REQUIRED_BUDGETS) {
      const probe = this.probes.get(budgetId);
      if (!probe) {
        budgets.push(result(budgetId, "unavailable", {
          issueCode: "probe_unavailable",
        }));
        continue;
      }

      let observation: ResourceBudgetObservationV1;
      try {
        observation = await probe.observe();
      } catch {
        budgets.push(result(budgetId, "unavailable", {
          issueCode: "probe_unavailable",
        }));
        continue;
      }

      const observedAtMs = Date.parse(observation.observedAt);
      if (
        observation.schemaVersion !== 1
        || observation.budgetId !== budgetId
        || observation.authority !== "resource_budget_observation"
        || observation.grantsAuthority !== false
        || !Number.isSafeInteger(observation.used)
        || observation.used < 0
        || !Number.isSafeInteger(observation.limit)
        || observation.limit < 1
        || !Number.isFinite(observedAtMs)
        || observedAtMs > now.getTime() + 5_000
        || now.getTime() - observedAtMs > this.maxObservationAgeMs
      ) {
        budgets.push(result(budgetId, "unavailable", {
          issueCode: "probe_invalid",
        }));
        continue;
      }

      const utilization = observation.used / observation.limit;
      const common = {
        used: observation.used,
        limit: observation.limit,
        utilizationPercent: Math.round(utilization * 10_000) / 100,
        observedAt: observation.observedAt,
      };

      if (observation.used >= observation.limit) {
        budgets.push(result(budgetId, "saturated", {
          ...common,
          issueCode: "budget_saturated",
        }));
      } else if (utilization >= this.nearCapacityRatio) {
        budgets.push(result(budgetId, "near_capacity", {
          ...common,
          issueCode: "budget_near_capacity",
        }));
      } else {
        budgets.push(result(budgetId, "healthy", common));
      }
    }

    const saturatedCount = budgets.filter((item) => item.status === "saturated").length;
    const nearCapacityCount = budgets.filter((item) => item.status === "near_capacity").length;
    const unavailableCount = budgets.filter((item) => item.status === "unavailable").length;
    const healthyCount = budgets.filter((item) => item.status === "healthy").length;

    return Object.freeze({
      schemaVersion: 1,
      evaluatedAt: now.toISOString(),
      saturated: saturatedCount > 0 || unavailableCount > 0,
      nearCapacity: nearCapacityCount > 0,
      healthyCount,
      nearCapacityCount,
      saturatedCount,
      unavailableCount,
      budgets: Object.freeze([...budgets]) as ResourceBudgetResultV1[],
      authority: "resource_backpressure_observation_only",
      readOnly: true,
      pausesTask: false,
      abortsTask: false,
      retriesTask: false,
      mutatesQueue: false,
      mutatesRuntimeState: false,
      performsNetworkMutation: false,
      grantsAuthority: false,
    });
  }
}
