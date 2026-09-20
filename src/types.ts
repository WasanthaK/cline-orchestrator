export type TaskStatus =
  | "created"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "aborted";

export interface OrchestratorTask {
  id: string;
  goal: string;
  workspace: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  clineSessionId?: string;
  lastPrompt?: string;
  finishReason?: string;
  error?: string;
}

export interface WorkerConfig {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  autoApproveCommands: boolean;
  autoApproveEdits: boolean;
}
