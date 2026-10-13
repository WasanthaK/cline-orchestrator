export type OperationalEventSeverity = "info" | "warning" | "error" | "critical";

export type OperationalEventCode =
  | "readiness_evaluated"
  | "readiness_control_failed"
  | "readiness_control_stale"
  | "runtime_started"
  | "runtime_completed"
  | "runtime_failed"
  | "runtime_stalled"
  | "runtime_recovered"
  | "writer_lease_lost"
  | "writer_fence_rejected"
  | "audit_sink_unavailable"
  | "remote_rate_limited"
  | "remote_replay_rejected"
  | "delivery_recovery_ambiguous";

export const OPERATIONAL_EVENT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "operational_event_observation_only" as const,
  structuredOnly: true as const,
  allowlistedFieldsOnly: true as const,
  arbitraryMetadataAllowed: false as const,
  freeFormPromptAllowed: false as const,
  rawWorkerOutputAllowed: false as const,
  rawStackTraceAllowed: false as const,
  workspacePathAllowed: false as const,
  credentialMaterialAllowed: false as const,
  tokenMaterialAllowed: false as const,
  mutatesRuntimeState: false as const,
  performsNetworkMutation: false as const,
  grantsAuthority: false as const,
});

export interface OperationalEventInputV1 {
  schemaVersion: 1;
  code: OperationalEventCode;
  severity: OperationalEventSeverity;
  occurredAt: string;
  taskId?: string;
  workspaceId?: string;
  projectId?: string;
  correlationId?: string;
  attempt?: number;
  retryCount?: number;
  stallCount?: number;
  durationMs?: number;
  issueCode?: string;
  outcomeCode?: string;
}

export interface OperationalEventV1 extends OperationalEventInputV1 {
  authority: "operational_event_observation_only";
  grantsAuthority: false;
}

export interface OperationalEventSink {
  append(event: OperationalEventV1): Promise<void>;
}

export class OperationalEventError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "event_invalid"
      | "field_invalid"
      | "sensitive_content_rejected"
      | "sink_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OperationalEventError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[a-z0-9_.:-]{1,96}$/;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_COUNTER = 1_000_000;

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "code",
  "severity",
  "occurredAt",
  "taskId",
  "workspaceId",
  "projectId",
  "correlationId",
  "attempt",
  "retryCount",
  "stallCount",
  "durationMs",
  "issueCode",
  "outcomeCode",
]);

const SENSITIVE_KEY = /(prompt|output|message|stack|trace|secret|token|credential|password|authorization|cookie|path|root|url|uri|body|payload|command|env|key)/i;
const SENSITIVE_VALUE = /(bearer\s+[A-Za-z0-9._~+\/-]+=*|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:^|[^A-Za-z0-9])(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|[A-Za-z]:\\|\/(?:home|Users|workspace|mnt|tmp)\/)/i;

function validateId(name: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new OperationalEventError(`${name} must be an opaque UUID`, "field_invalid");
  }
}

function validateCounter(name: string, value: unknown): void {
  if (value === undefined) return;
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > MAX_COUNTER
  ) {
    throw new OperationalEventError(`${name} is out of bounds`, "field_invalid");
  }
}

function validateCodeField(name: string, value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== "string"
    || !SAFE_CODE.test(value)
    || SENSITIVE_VALUE.test(value)
  ) {
    throw new OperationalEventError(
      `${name} contains unsafe operational content`,
      "sensitive_content_rejected",
    );
  }
}

export function sanitizeOperationalEvent(input: OperationalEventInputV1): OperationalEventV1 {
  const raw = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key) || SENSITIVE_KEY.test(key)) {
      throw new OperationalEventError(
        `operational event field ${key} is not allowlisted`,
        "sensitive_content_rejected",
      );
    }
  }

  if (
    input.schemaVersion !== 1
    || ![
      "readiness_evaluated",
      "readiness_control_failed",
      "readiness_control_stale",
      "runtime_started",
      "runtime_completed",
      "runtime_failed",
      "runtime_stalled",
      "runtime_recovered",
      "writer_lease_lost",
      "writer_fence_rejected",
      "audit_sink_unavailable",
      "remote_rate_limited",
      "remote_replay_rejected",
      "delivery_recovery_ambiguous",
    ].includes(input.code)
    || !["info", "warning", "error", "critical"].includes(input.severity)
    || !Number.isFinite(Date.parse(input.occurredAt))
  ) {
    throw new OperationalEventError("operational event envelope is invalid", "event_invalid");
  }

  validateId("taskId", input.taskId);
  validateId("workspaceId", input.workspaceId);
  validateId("projectId", input.projectId);
  validateId("correlationId", input.correlationId);
  validateCounter("attempt", input.attempt);
  validateCounter("retryCount", input.retryCount);
  validateCounter("stallCount", input.stallCount);

  if (
    input.durationMs !== undefined
    && (
      !Number.isSafeInteger(input.durationMs)
      || input.durationMs < 0
      || input.durationMs > MAX_DURATION_MS
    )
  ) {
    throw new OperationalEventError("durationMs is out of bounds", "field_invalid");
  }

  validateCodeField("issueCode", input.issueCode);
  validateCodeField("outcomeCode", input.outcomeCode);

  return Object.freeze({
    ...structuredClone(input),
    authority: "operational_event_observation_only",
    grantsAuthority: false,
  });
}

export class SecretSafeOperationalEventService {
  constructor(private readonly sink: OperationalEventSink) {}

  async emit(input: OperationalEventInputV1): Promise<OperationalEventV1> {
    const event = sanitizeOperationalEvent(input);
    try {
      await this.sink.append(event);
    } catch (error) {
      throw new OperationalEventError(
        "operational event sink failed",
        "sink_failed",
        { cause: error },
      );
    }
    return event;
  }
}
