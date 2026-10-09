import type { ProductConfigEnvironment, ResolvedProductConfigV1 } from "./product-config.js";

export const PRODUCT_EXECUTION_CONFIG_CONTRACT = Object.freeze({
  delegatesExistingDispatcher: true,
  doesNotResolveCredentialValues: true,
  doesNotGrantTaskAuthority: true,
  grantsAuthority: false,
});

// These are settings, never authorization. The existing dispatcher continues
// to enforce the current workspace/Safety/task/runtime boundaries.
export function productExecutionEnvironment(
  config: ResolvedProductConfigV1,
  inherited: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...inherited };
  // Remove legacy secret/alias/source selectors. Preserve unrelated controls,
  // including existing diff-safety restrictions, which remain authoritative.
  delete env.ORCH_API_KEY;
  delete env.ORCH_API_KEY_SECRET_REF;
  delete env.ORCH_CONFIG_FILE;
  delete env.ORCH_MAX_OUTPUT_TOKENS;
  const runtimeKeys: Record<keyof ResolvedProductConfigV1["runtime"], keyof ProductConfigEnvironment> = {
    contextWindow: "ORCH_CONTEXT_WINDOW",
    maxInputTokens: "ORCH_MAX_INPUT_TOKENS",
    maxTokensPerTurn: "ORCH_MAX_TOKENS_PER_TURN",
    contextRotateAtTokens: "ORCH_CONTEXT_ROTATE_AT_TOKENS",
    maxContextRotations: "ORCH_MAX_CONTEXT_ROTATIONS",
    reasoningEffort: "ORCH_REASONING_EFFORT",
    timeoutMs: "ORCH_TIMEOUT_MS",
    preflightTimeoutMs: "ORCH_PREFLIGHT_TIMEOUT_MS",
    validationTimeoutMs: "ORCH_VALIDATION_TIMEOUT_MS",
    maxValidationOutputChars: "ORCH_MAX_VALIDATION_OUTPUT_CHARS",
    maxValidationRepairs: "ORCH_MAX_VALIDATION_REPAIRS",
    checkpointMaxUntrackedFiles: "ORCH_CHECKPOINT_MAX_UNTRACKED_FILES",
    checkpointMaxUntrackedBytes: "ORCH_CHECKPOINT_MAX_UNTRACKED_BYTES",
    maxIterations: "ORCH_MAX_ITERATIONS",
    stallTimeoutMs: "ORCH_STALL_TIMEOUT_MS",
    maxRetries: "ORCH_MAX_RETRIES",
    retryDelayMs: "ORCH_RETRY_DELAY_MS",
    autoApproveCommands: "ORCH_AUTO_APPROVE_COMMANDS",
    autoApproveEdits: "ORCH_AUTO_APPROVE_EDITS",
  };
  for (const [field, name] of Object.entries(runtimeKeys)) {
    env[name] = String(config.runtime[field as keyof typeof config.runtime]);
  }
  env.ORCH_PROVIDER = config.provider.providerId;
  env.ORCH_MODEL = config.provider.modelId;
  env.ORCH_BASE_URL = config.provider.baseUrl;
  env.ORCH_DAEMON_HOST = config.daemon.host === "[::1]" ? "::1" : config.daemon.host;
  env.ORCH_DAEMON_PORT = String(config.daemon.port);
  env.ORCH_DAEMON_URL = config.daemon.url;
  return env;
}
