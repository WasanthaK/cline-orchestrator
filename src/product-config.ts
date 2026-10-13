export interface ProductConfigFileV1 {
  schemaVersion: 1;
  provider?: {
    providerId?: string;
    modelId?: string;
    baseUrl?: string;
    apiKeySecretRef?: string;
  };
  runtime?: {
    contextWindow?: number;
    maxInputTokens?: number;
    maxTokensPerTurn?: number;
    contextRotateAtTokens?: number;
    maxContextRotations?: number;
    reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
    timeoutMs?: number;
    preflightTimeoutMs?: number;
    validationTimeoutMs?: number;
    maxValidationOutputChars?: number;
    maxValidationRepairs?: number;
    checkpointMaxUntrackedFiles?: number;
    checkpointMaxUntrackedBytes?: number;
    maxIterations?: number;
    stallTimeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    autoApproveCommands?: boolean;
    autoApproveEdits?: boolean;
  };
  daemon?: {
    host?: string;
    port?: number;
    url?: string;
  };
}

export interface ProductConfigEnvironment {
  ORCH_PROVIDER?: string;
  ORCH_MODEL?: string;
  ORCH_BASE_URL?: string;
  ORCH_API_KEY_SECRET_REF?: string;
  ORCH_CONTEXT_WINDOW?: string;
  ORCH_MAX_INPUT_TOKENS?: string;
  ORCH_MAX_TOKENS_PER_TURN?: string;
  ORCH_CONTEXT_ROTATE_AT_TOKENS?: string;
  ORCH_MAX_CONTEXT_ROTATIONS?: string;
  ORCH_REASONING_EFFORT?: string;
  ORCH_TIMEOUT_MS?: string;
  ORCH_PREFLIGHT_TIMEOUT_MS?: string;
  ORCH_VALIDATION_TIMEOUT_MS?: string;
  ORCH_MAX_VALIDATION_OUTPUT_CHARS?: string;
  ORCH_MAX_VALIDATION_REPAIRS?: string;
  ORCH_CHECKPOINT_MAX_UNTRACKED_FILES?: string;
  ORCH_CHECKPOINT_MAX_UNTRACKED_BYTES?: string;
  ORCH_MAX_ITERATIONS?: string;
  ORCH_STALL_TIMEOUT_MS?: string;
  ORCH_MAX_RETRIES?: string;
  ORCH_RETRY_DELAY_MS?: string;
  ORCH_AUTO_APPROVE_COMMANDS?: string;
  ORCH_AUTO_APPROVE_EDITS?: string;
  ORCH_DAEMON_HOST?: string;
  ORCH_DAEMON_PORT?: string;
  ORCH_DAEMON_URL?: string;
}

export interface ResolvedProductConfigV1 {
  schemaVersion: 1;
  provider: {
    providerId: string;
    modelId: string;
    baseUrl: string;
    apiKeySecretRef?: string;
  };
  runtime: {
    contextWindow: number;
    maxInputTokens: number;
    maxTokensPerTurn: number;
    contextRotateAtTokens: number;
    maxContextRotations: number;
    reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
    timeoutMs: number;
    preflightTimeoutMs: number;
    validationTimeoutMs: number;
    maxValidationOutputChars: number;
    maxValidationRepairs: number;
    checkpointMaxUntrackedFiles: number;
    checkpointMaxUntrackedBytes: number;
    maxIterations: number;
    stallTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    autoApproveCommands: boolean;
    autoApproveEdits: boolean;
  };
  daemon: {
    host: string;
    port: number;
    url: string;
  };
  authority: "product_config_observation_only";
  writesConfig: false;
  usesSecretMaterial: false;
  mutatesRuntimeState: false;
  performsNetworkMutation: false;
  grantsAuthority: false;
}

export const PRODUCT_CONFIG_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "product_config_observation_only" as const,
  environmentOverridesFile: true as const,
  explicitSafeDefaults: true as const,
  rawSecretPersistenceAllowed: false as const,
  secretReferencesOnly: true as const,
  writesConfig: false as const,
  mutatesRuntimeState: false as const,
  performsNetworkMutation: false as const,
  grantsAuthority: false as const,
});

export class ProductConfigError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "schema_unsupported"
      | "config_invalid"
      | "secret_material_rejected",
  ) {
    super(message);
    this.name = "ProductConfigError";
  }
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SAFE_SECRET_REF = /^[A-Z][A-Z0-9_]{2,127}$/;
const SAFE_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const REASONING = new Set(["none", "low", "medium", "high", "xhigh"]);

const DEFAULTS = Object.freeze({
  providerId: "ollama-openai",
  modelId: "qwen38-27b-192k:latest",
  baseUrl: "http://localhost:11434",
  contextWindow: 196608,
  maxInputTokens: 180000,
  maxTokensPerTurn: 4096,
  contextRotateAtTokens: 150000,
  maxContextRotations: 8,
  reasoningEffort: "none" as const,
  timeoutMs: 0,
  preflightTimeoutMs: 5000,
  validationTimeoutMs: 600000,
  maxValidationOutputChars: 20000,
  maxValidationRepairs: 1,
  checkpointMaxUntrackedFiles: 10000,
  checkpointMaxUntrackedBytes: 268435456,
  maxIterations: 0,
  stallTimeoutMs: 300000,
  maxRetries: 2,
  retryDelayMs: 5000,
  autoApproveCommands: false,
  autoApproveEdits: false,
  daemonHost: "127.0.0.1",
  daemonPort: 4317,
});

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseIntField(value: unknown, fallback: number, min = 0): number {
  const input = value === undefined ? fallback : value;
  if (typeof input !== "number" && (typeof input !== "string" || !/^[0-9]+$/.test(input))) {
    throw new ProductConfigError("numeric configuration field is invalid", "config_invalid");
  }
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new ProductConfigError("numeric configuration field is invalid", "config_invalid");
  }
  return parsed;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ProductConfigError("boolean configuration field is invalid", "config_invalid");
}

function choose<T>(envValue: T | undefined, fileValue: T | undefined, fallback: T): T {
  return envValue !== undefined ? envValue : fileValue !== undefined ? fileValue : fallback;
}

function rejectSecretMaterial(value: unknown, fieldName: string): void {
  if (value === undefined) return;
  if (typeof value === "string" && value.trim()) {
    throw new ProductConfigError(
      `${fieldName} must not contain raw secret material; use apiKeySecretRef instead`,
      "secret_material_rejected",
    );
  }
}

function validateFileShape(input: unknown): ProductConfigFileV1 {
  if (input === undefined) return { schemaVersion: 1 };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProductConfigError("product configuration must be an object", "config_invalid");
  }
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== 1) {
    throw new ProductConfigError("unsupported product configuration schema", "schema_unsupported");
  }

  const allowedTop = new Set(["schemaVersion", "provider", "runtime", "daemon"]);
  for (const key of Object.keys(raw)) {
    if (!allowedTop.has(key)) {
      throw new ProductConfigError(`unknown product configuration field: ${key}`, "config_invalid");
    }
  }

  const provider = raw.provider as Record<string, unknown> | undefined;
  if (provider) {
    const allowed = new Set(["providerId", "modelId", "baseUrl", "apiKeySecretRef"]);
    for (const key of Object.keys(provider)) {
      if (!allowed.has(key)) {
        if (/api.?key|token|secret|password|credential/i.test(key)) {
          throw new ProductConfigError(
            "raw secret fields are not allowed in product configuration",
            "secret_material_rejected",
          );
        }
        throw new ProductConfigError(`unknown provider configuration field: ${key}`, "config_invalid");
      }
    }
    rejectSecretMaterial((provider as any).apiKey, "apiKey");
  }

  return input as ProductConfigFileV1;
}

function normalizeId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID.test(trimmed)) {
    throw new ProductConfigError(`${field} is invalid`, "config_invalid");
  }
  return trimmed;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProductConfigError("provider baseUrl is invalid", "config_invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ProductConfigError("provider baseUrl must use http or https", "config_invalid");
  }
  if (parsed.username || parsed.password) {
    throw new ProductConfigError(
      "provider baseUrl must not embed credentials",
      "secret_material_rejected",
    );
  }
  return stripTrailingSlash(parsed.toString());
}

function normalizeSecretRef(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!SAFE_SECRET_REF.test(trimmed)) {
    throw new ProductConfigError("apiKeySecretRef must be an environment-style secret reference", "config_invalid");
  }
  return trimmed;
}

export function resolveProductConfig(
  fileInput: unknown,
  env: ProductConfigEnvironment = {},
): ResolvedProductConfigV1 {
  const file = validateFileShape(fileInput);

  // Deliberately reject legacy/raw ORCH_API_KEY if it is accidentally included
  // in a widened environment object. M17B resolves references only.
  rejectSecretMaterial((env as Record<string, unknown>).ORCH_API_KEY, "ORCH_API_KEY");

  const providerId = normalizeId(
    choose(env.ORCH_PROVIDER, file.provider?.providerId, DEFAULTS.providerId),
    "providerId",
  );
  const modelId = normalizeId(
    choose(env.ORCH_MODEL, file.provider?.modelId, DEFAULTS.modelId),
    "modelId",
  );
  const baseUrl = normalizeBaseUrl(
    choose(env.ORCH_BASE_URL, file.provider?.baseUrl, DEFAULTS.baseUrl),
  );
  const apiKeySecretRef = normalizeSecretRef(
    choose(env.ORCH_API_KEY_SECRET_REF, file.provider?.apiKeySecretRef, undefined),
  );

  const envInt = (name: keyof ProductConfigEnvironment): string | undefined => env[name];
  const runtime = file.runtime ?? {};
  const contextWindow = parseIntField(envInt("ORCH_CONTEXT_WINDOW"), runtime.contextWindow ?? DEFAULTS.contextWindow, 1);
  const maxInputTokens = parseIntField(envInt("ORCH_MAX_INPUT_TOKENS"), runtime.maxInputTokens ?? DEFAULTS.maxInputTokens, 1);
  const maxTokensPerTurn = parseIntField(envInt("ORCH_MAX_TOKENS_PER_TURN"), runtime.maxTokensPerTurn ?? DEFAULTS.maxTokensPerTurn, 1);
  const contextRotateAtTokens = parseIntField(envInt("ORCH_CONTEXT_ROTATE_AT_TOKENS"), runtime.contextRotateAtTokens ?? DEFAULTS.contextRotateAtTokens, 0);
  const maxContextRotations = parseIntField(envInt("ORCH_MAX_CONTEXT_ROTATIONS"), runtime.maxContextRotations ?? DEFAULTS.maxContextRotations, 0);
  const reasoningRaw = choose(env.ORCH_REASONING_EFFORT, runtime.reasoningEffort, DEFAULTS.reasoningEffort);
  if (!REASONING.has(reasoningRaw)) {
    throw new ProductConfigError("reasoningEffort is invalid", "config_invalid");
  }

  const daemon = file.daemon ?? {};
  const host = choose(env.ORCH_DAEMON_HOST, daemon.host, DEFAULTS.daemonHost).trim();
  if (!SAFE_HOST.test(host)) {
    throw new ProductConfigError(
      "daemon host must remain loopback in product configuration",
      "config_invalid",
    );
  }
  const port = parseIntField(env.ORCH_DAEMON_PORT, daemon.port ?? DEFAULTS.daemonPort, 1);
  if (port > 65535) throw new ProductConfigError("daemon port is invalid", "config_invalid");

  const defaultUrl = `http://${host}:${port}`;
  const url = choose(env.ORCH_DAEMON_URL, daemon.url, defaultUrl);
  let parsedDaemonUrl: URL;
  try {
    parsedDaemonUrl = new URL(url);
  } catch {
    throw new ProductConfigError("daemon url is invalid", "config_invalid");
  }
  if (
    parsedDaemonUrl.protocol !== "http:"
    || parsedDaemonUrl.username || parsedDaemonUrl.password
    || parsedDaemonUrl.search || parsedDaemonUrl.hash
    || parsedDaemonUrl.pathname !== "/"
    || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsedDaemonUrl.hostname)
  ) {
    throw new ProductConfigError(
      "daemon url must remain loopback in product configuration",
      "config_invalid",
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    provider: {
      providerId,
      modelId,
      baseUrl,
      ...(apiKeySecretRef ? { apiKeySecretRef } : {}),
    },
    runtime: {
      contextWindow,
      maxInputTokens,
      maxTokensPerTurn,
      contextRotateAtTokens,
      maxContextRotations,
      reasoningEffort: reasoningRaw as ResolvedProductConfigV1["runtime"]["reasoningEffort"],
      timeoutMs: parseIntField(envInt("ORCH_TIMEOUT_MS"), runtime.timeoutMs ?? DEFAULTS.timeoutMs, 0),
      preflightTimeoutMs: parseIntField(envInt("ORCH_PREFLIGHT_TIMEOUT_MS"), runtime.preflightTimeoutMs ?? DEFAULTS.preflightTimeoutMs, 250),
      validationTimeoutMs: parseIntField(envInt("ORCH_VALIDATION_TIMEOUT_MS"), runtime.validationTimeoutMs ?? DEFAULTS.validationTimeoutMs, 1000),
      maxValidationOutputChars: parseIntField(envInt("ORCH_MAX_VALIDATION_OUTPUT_CHARS"), runtime.maxValidationOutputChars ?? DEFAULTS.maxValidationOutputChars, 1000),
      maxValidationRepairs: parseIntField(envInt("ORCH_MAX_VALIDATION_REPAIRS"), runtime.maxValidationRepairs ?? DEFAULTS.maxValidationRepairs, 0),
      checkpointMaxUntrackedFiles: parseIntField(envInt("ORCH_CHECKPOINT_MAX_UNTRACKED_FILES"), runtime.checkpointMaxUntrackedFiles ?? DEFAULTS.checkpointMaxUntrackedFiles, 0),
      checkpointMaxUntrackedBytes: parseIntField(envInt("ORCH_CHECKPOINT_MAX_UNTRACKED_BYTES"), runtime.checkpointMaxUntrackedBytes ?? DEFAULTS.checkpointMaxUntrackedBytes, 0),
      maxIterations: parseIntField(envInt("ORCH_MAX_ITERATIONS"), runtime.maxIterations ?? DEFAULTS.maxIterations, 0),
      stallTimeoutMs: parseIntField(envInt("ORCH_STALL_TIMEOUT_MS"), runtime.stallTimeoutMs ?? DEFAULTS.stallTimeoutMs, 0),
      maxRetries: parseIntField(envInt("ORCH_MAX_RETRIES"), runtime.maxRetries ?? DEFAULTS.maxRetries, 0),
      retryDelayMs: parseIntField(envInt("ORCH_RETRY_DELAY_MS"), runtime.retryDelayMs ?? DEFAULTS.retryDelayMs, 0),
      autoApproveCommands: parseBool(env.ORCH_AUTO_APPROVE_COMMANDS, runtime.autoApproveCommands ?? DEFAULTS.autoApproveCommands),
      autoApproveEdits: parseBool(env.ORCH_AUTO_APPROVE_EDITS, runtime.autoApproveEdits ?? DEFAULTS.autoApproveEdits),
    },
    daemon: {
      host,
      port,
      url: stripTrailingSlash(parsedDaemonUrl.toString()),
    },
    authority: "product_config_observation_only",
    writesConfig: false,
    usesSecretMaterial: false,
    mutatesRuntimeState: false,
    performsNetworkMutation: false,
    grantsAuthority: false,
  });
}
