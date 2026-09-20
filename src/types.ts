export type TaskStatus =
  | "created"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "aborted";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface OrchestratorTask {
  id: string;
  goal: string;
  workspace: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  clineSessionId?: string;
  lastPrompt?: string;
  lastOutput?: string;
  finishReason?: string;
  error?: string;
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
