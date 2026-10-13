export type ProductionReadinessControlId =
  | "security.remote_session_replay_protection"
  | "security.remote_session_rate_limiting"
  | "security.sanitized_audit"
  | "security.local_operator_boundary"
  | "reliability.durable_task_state"
  | "reliability.checkpoint_state"
  | "reliability.restart_recovery"
  | "reliability.writer_fencing"
  | "observability.sentinel_incidents"
  | "observability.operator_visualization"
  | "observability.run_metrics";

export type ProductionReadinessDomain =
  | "security"
  | "reliability"
  | "observability";

export type ProductionReadinessStatus =
  | "healthy"
  | "stale"
  | "unavailable"
  | "failed";

export const PRODUCTION_READINESS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "production_readiness_observation_only" as const,
  readOnly: true as const,
  sanitized: true as const,
  failClosedOnRequiredControlLoss: true as const,
  mutatesTaskState: false as const,
  mutatesRuntimeState: false as const,
  startsListener: false as const,
  performsNetworkMutation: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface ProductionReadinessProbeObservationV1 {
  schemaVersion: 1;
  controlId: ProductionReadinessControlId;
  observedAt: string;
  ok: boolean;
  authority: "production_readiness_probe_observation";
  grantsAuthority: false;
}

export interface ProductionReadinessProbe {
  observe(): Promise<ProductionReadinessProbeObservationV1>;
}

export interface ProductionReadinessControlResultV1 {
  schemaVersion: 1;
  controlId: ProductionReadinessControlId;
  domain: ProductionReadinessDomain;
  required: true;
  status: ProductionReadinessStatus;
  observedAt?: string;
  issueCode?:
    | "probe_unavailable"
    | "probe_invalid"
    | "probe_failed"
    | "probe_stale";
  authority: "production_readiness_control_result";
  grantsAuthority: false;
}

export interface ProductionReadinessSummaryV1 {
  schemaVersion: 1;
  evaluatedAt: string;
  ready: boolean;
  healthyCount: number;
  staleCount: number;
  unavailableCount: number;
  failedCount: number;
  securityReady: boolean;
  reliabilityReady: boolean;
  observabilityReady: boolean;
  controls: ProductionReadinessControlResultV1[];
  authority: "production_readiness_observation_only";
  readOnly: true;
  sanitized: true;
  mutatesTaskState: false;
  mutatesRuntimeState: false;
  startsListener: false;
  performsNetworkMutation: false;
  usesCredentials: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface ProductionReadinessEvaluatorOptions {
  now?: () => Date;
  maxObservationAgeMs?: number;
}

export class ProductionReadinessError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "configuration_invalid"
      | "clock_invalid",
  ) {
    super(message);
    this.name = "ProductionReadinessError";
  }
}

const REQUIRED_CONTROLS: readonly ProductionReadinessControlId[] = Object.freeze([
  "security.remote_session_replay_protection",
  "security.remote_session_rate_limiting",
  "security.sanitized_audit",
  "security.local_operator_boundary",
  "reliability.durable_task_state",
  "reliability.checkpoint_state",
  "reliability.restart_recovery",
  "reliability.writer_fencing",
  "observability.sentinel_incidents",
  "observability.operator_visualization",
  "observability.run_metrics",
]);

function domain(controlId: ProductionReadinessControlId): ProductionReadinessDomain {
  if (controlId.startsWith("security.")) return "security";
  if (controlId.startsWith("reliability.")) return "reliability";
  return "observability";
}

function countStatus(
  controls: ProductionReadinessControlResultV1[],
  status: ProductionReadinessStatus,
): number {
  return controls.filter((item) => item.status === status).length;
}

function domainReady(
  controls: ProductionReadinessControlResultV1[],
  value: ProductionReadinessDomain,
): boolean {
  return controls
    .filter((item) => item.domain === value)
    .every((item) => item.status === "healthy");
}

function controlResult(
  controlId: ProductionReadinessControlId,
  status: ProductionReadinessStatus,
  observedAt?: string,
  issueCode?: ProductionReadinessControlResultV1["issueCode"],
): ProductionReadinessControlResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    controlId,
    domain: domain(controlId),
    required: true,
    status,
    ...(observedAt ? { observedAt } : {}),
    ...(issueCode ? { issueCode } : {}),
    authority: "production_readiness_control_result",
    grantsAuthority: false,
  });
}

export class ProductionReadinessEvaluator {
  private readonly maxObservationAgeMs: number;

  constructor(
    private readonly probes: ReadonlyMap<ProductionReadinessControlId, ProductionReadinessProbe>,
    private readonly options: ProductionReadinessEvaluatorOptions = {},
  ) {
    this.maxObservationAgeMs = options.maxObservationAgeMs ?? 60_000;
    if (
      !Number.isFinite(this.maxObservationAgeMs)
      || this.maxObservationAgeMs <= 0
      || this.maxObservationAgeMs > 60 * 60 * 1000
    ) {
      throw new ProductionReadinessError(
        "production readiness observation age bound is invalid",
        "configuration_invalid",
      );
    }
  }

  async evaluate(): Promise<ProductionReadinessSummaryV1> {
    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ProductionReadinessError(
        "production readiness evaluation clock is invalid",
        "clock_invalid",
      );
    }

    const controls: ProductionReadinessControlResultV1[] = [];
    for (const controlId of REQUIRED_CONTROLS) {
      const probe = this.probes.get(controlId);
      if (!probe) {
        controls.push(controlResult(
          controlId,
          "unavailable",
          undefined,
          "probe_unavailable",
        ));
        continue;
      }

      let observation: ProductionReadinessProbeObservationV1;
      try {
        observation = await probe.observe();
      } catch {
        controls.push(controlResult(
          controlId,
          "unavailable",
          undefined,
          "probe_unavailable",
        ));
        continue;
      }

      if (
        observation.schemaVersion !== 1
        || observation.controlId !== controlId
        || observation.authority !== "production_readiness_probe_observation"
        || observation.grantsAuthority !== false
        || typeof observation.ok !== "boolean"
        || !Number.isFinite(Date.parse(observation.observedAt))
      ) {
        controls.push(controlResult(
          controlId,
          "failed",
          undefined,
          "probe_invalid",
        ));
        continue;
      }

      const observedAtMs = Date.parse(observation.observedAt);
      if (
        observedAtMs > now.getTime() + 5_000
        || now.getTime() - observedAtMs > this.maxObservationAgeMs
      ) {
        controls.push(controlResult(
          controlId,
          "stale",
          observation.observedAt,
          "probe_stale",
        ));
        continue;
      }

      controls.push(
        observation.ok
          ? controlResult(controlId, "healthy", observation.observedAt)
          : controlResult(
              controlId,
              "failed",
              observation.observedAt,
              "probe_failed",
            ),
      );
    }

    const securityReady = domainReady(controls, "security");
    const reliabilityReady = domainReady(controls, "reliability");
    const observabilityReady = domainReady(controls, "observability");

    return Object.freeze({
      schemaVersion: 1,
      evaluatedAt: now.toISOString(),
      ready: securityReady && reliabilityReady && observabilityReady,
      healthyCount: countStatus(controls, "healthy"),
      staleCount: countStatus(controls, "stale"),
      unavailableCount: countStatus(controls, "unavailable"),
      failedCount: countStatus(controls, "failed"),
      securityReady,
      reliabilityReady,
      observabilityReady,
      controls: Object.freeze([...controls]) as ProductionReadinessControlResultV1[],
      authority: "production_readiness_observation_only",
      readOnly: true,
      sanitized: true,
      mutatesTaskState: false,
      mutatesRuntimeState: false,
      startsListener: false,
      performsNetworkMutation: false,
      usesCredentials: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
