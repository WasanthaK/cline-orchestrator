export type TaskStatus =
  | "created"
  | "running"
  | "waiting"
  | "stalled"
  | "completed"
  | "failed"
  | "aborted";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface RunIterationMetrics {
  attempt?: number;
  iteration: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunMetrics {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  iterations: number;
  toolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  attempts?: number;
  retries?: number;
  stalls?: number;
  turns: RunIterationMetrics[];
}

export interface GitSnapshot {
  capturedAt: string;
  available: boolean;
  root?: string;
  branch?: string;
  head?: string;
  detached?: boolean;
  dirty?: boolean;
  changedFiles?: number;
  stagedFiles?: number;
  unstagedFiles?: number;
  untrackedFiles?: number;
  statusLines?: string[];
  statusTruncated?: boolean;
  diffShortStat?: string;
  stagedDiffShortStat?: string;
  error?: string;
}

export interface RunGitState {
  before?: GitSnapshot;
  after?: GitSnapshot;
}

export type ProviderPreflightCode =
  | "ok"
  | "unsupported_provider"
  | "provider_unreachable"
  | "model_not_found"
  | "invalid_response";

export interface ProviderPreflightResult {
  checkedAt: string;
  ok: boolean;
  supported: boolean;
  providerId: string;
  modelId: string;
  code: ProviderPreflightCode;
  message: string;
  endpoint?: string;
  latencyMs?: number;
  availableModels?: string[];
}

export type SessionRecoveryReason =
  | "session_not_found"
  | "missing_session_id"
  | "watchdog_stall";

export type RetryReason = "watchdog_stall";

export type TaskEventType =
  | "queued"
  | "resume_queued"
  | "git_snapshot"
  | "run_started"
  | "session_started"
  | "session_recovered"
  | "stalled"
  | "retrying"
  | "abort_requested"
  | "completed"
  | "failed"
  | "aborted";

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  timestamp: string;
  status?: TaskStatus;
  message?: string;
  data?: Record<string, unknown>;
}

export interface OrchestratorTask {
  id: string;
  goal: string;
  workspace: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  clineSessionId?: string;
  sessionGeneration?: number;
  recoveryCount?: number;
  lastRecoveryAt?: string;
  lastRecoveryReason?: SessionRecoveryReason;
  lastRecoveredFromSessionId?: string;
  retryCount?: number;
  stallCount?: number;
  lastStallAt?: string;
  lastStallSilenceMs?: number;
  lastRetryAt?: string;
  lastRetryReason?: RetryReason;
  abortRequestedAt?: string;
  abortReason?: string;
  lastPrompt?: string;
  lastOutput?: string;
  finishReason?: string;
  error?: string;
  runCount?: number;
  lastRunMetrics?: RunMetrics;
  lastRunGit?: RunGitState;
}

export interface WorkerConfig {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  contextWindow: number;
  maxInputTokens: number;
  maxTokensPerTurn: number;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
  preflightTimeoutMs: number;
  maxIterations: number;
  stallTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  autoApproveCommands: boolean;
  autoApproveEdits: boolean;
}
