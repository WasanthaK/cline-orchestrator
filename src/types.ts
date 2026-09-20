export type TaskStatus =
  | "created"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "aborted";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface RunIterationMetrics {
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
  turns: RunIterationMetrics[];
}

export type SessionRecoveryReason = "session_not_found" | "missing_session_id";

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
  lastPrompt?: string;
  lastOutput?: string;
  finishReason?: string;
  error?: string;
  runCount?: number;
  lastRunMetrics?: RunMetrics;
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
  maxIterations: number;
  autoApproveCommands: boolean;
  autoApproveEdits: boolean;
}
