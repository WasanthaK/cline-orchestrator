export type TaskStatus =
  | "created"
  | "running"
  | "waiting"
  | "stalled"
  | "validating"
  | "repairing"
  | "safety_checking"
  | "completed"
  | "validation_failed"
  | "failed"
  | "aborted"
  | "rolled_back";

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

export interface WorkspaceFingerprint {
  capturedAt: string;
  available: boolean;
  digest?: string;
  root?: string;
  branch?: string;
  head?: string;
  stagedHash?: string;
  unstagedHash?: string;
  untrackedHash?: string;
  untrackedFiles?: number;
  untrackedBytes?: number;
  error?: string;
}

export interface GitRollbackCheckpoint {
  createdAt: string;
  available: boolean;
  taskId: string;
  runCount: number;
  root?: string;
  branch?: string;
  head?: string;
  stashRef?: string;
  privateRef?: string;
  backupDir?: string;
  manifestPath?: string;
  untrackedFiles?: number;
  untrackedBytes?: number;
  beforeFingerprint?: WorkspaceFingerprint;
  afterFingerprint?: WorkspaceFingerprint;
  restoredAt?: string;
  error?: string;
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

export interface ValidationCommandResult {
  command: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode?: number;
  signal?: string;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  outputTruncated?: boolean;
}

export interface ValidationRun {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  passed: boolean;
  commandsRequested: number;
  commandsRun: number;
  results: ValidationCommandResult[];
}

export type DiffPathStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "unmerged"
  | "unknown";

export interface DiffChangedPath {
  path: string;
  previousPath?: string;
  status: DiffPathStatus;
  source: "tracked" | "untracked";
}

export type DiffSafetyIssueCode =
  | "checkpoint_unavailable"
  | "repository_mismatch"
  | "branch_moved"
  | "head_moved"
  | "protected_path"
  | "unexpected_path"
  | "excessive_diff"
  | "deployment_sensitive_path"
  | "scope_unconfigured"
  | "diff_unavailable";

export interface DiffSafetyIssue {
  code: DiffSafetyIssueCode;
  message: string;
  path?: string;
  pattern?: string;
}

export interface DiffSafetySummary {
  changedFiles: number;
  trackedFiles: number;
  untrackedFiles: number;
  trackedAdditions: number;
  trackedDeletions: number;
}

export interface DiffSafetyResult {
  checkedAt: string;
  passed: boolean;
  checkpointCreatedAt?: string;
  baselineRef?: string;
  baselineBranch?: string;
  baselineHead?: string;
  currentBranch?: string;
  currentHead?: string;
  finalDiffSummary: string;
  summary: DiffSafetySummary;
  changedPaths: DiffChangedPath[];
  warnings: DiffSafetyIssue[];
  failures: DiffSafetyIssue[];
}

export type SessionRecoveryReason =
  | "session_not_found"
  | "missing_session_id"
  | "watchdog_stall"
  | "context_threshold";

export interface ContextHandoffCheckpointEvidence {
  createdAt: string;
  available: boolean;
  runCount: number;
  branch?: string;
  head?: string;
  beforeFingerprintDigest?: string;
  afterFingerprintDigest?: string;
  error?: string;
}

export interface ContextHandoffValidationEvidence {
  completedAt: string;
  passed: boolean;
  commandsRequested: number;
  commandsRun: number;
}

export interface ContextHandoffDiffSafetyEvidence {
  checkedAt: string;
  passed: boolean;
  finalDiffSummary: string;
}

export interface ContextHandoffRunMetricsEvidence {
  startedAt: string;
  iterations: number;
  toolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  attempts?: number;
  retries?: number;
  stalls?: number;
}

export interface ContextHandoffArtifact {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  taskId: string;
  reason: SessionRecoveryReason;
  reasonDescription: string;
  sourceSessionId?: string;
  sourceGeneration: number;
  targetGeneration: number;
  workspace: string;
  originalGoal: string;
  pendingAction: string;
  taskState: {
    status: TaskStatus;
    runCount: number;
    sessionGeneration: number;
    recoveryCount: number;
    contextRotationCount: number;
    validationRunCount: number;
    validationRepairCount: number;
    acceptanceCriteria: string[];
    validationCommands: string[];
    expectedChangedPaths: string[];
    finishReason?: string;
    error?: string;
  };
  workspaceEvidence: {
    git: GitSnapshot;
    checkpoint?: ContextHandoffCheckpointEvidence;
    lastValidation?: ContextHandoffValidationEvidence;
    lastDiffSafety?: ContextHandoffDiffSafetyEvidence;
    runMetrics?: ContextHandoffRunMetricsEvidence;
  };
  supportingContext: {
    previousPrompt?: string;
    recentWorkerOutput?: string;
  };
}

export interface ContextHandoffReference {
  id: string;
  createdAt: string;
  relativePath: string;
  reason: SessionRecoveryReason;
  sourceSessionId?: string;
  sourceGeneration: number;
  targetGeneration: number;
}

export type RetryReason = "watchdog_stall";

export type TaskEventType =
  | "queued"
  | "resume_queued"
  | "git_snapshot"
  | "checkpoint_created"
  | "checkpoint_unavailable"
  | "run_started"
  | "session_started"
  | "session_recovered"
  | "context_handoff_created"
  | "context_rotating"
  | "stalled"
  | "retrying"
  | "validation_started"
  | "validation_passed"
  | "validation_failed"
  | "validation_repairing"
  | "diff_safety_started"
  | "diff_safety_warning"
  | "diff_safety_passed"
  | "diff_safety_failed"
  | "abort_requested"
  | "rollback_requested"
  | "rollback_completed"
  | "rollback_failed"
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
  acceptanceCriteria?: string[];
  validationCommands?: string[];
  expectedChangedPaths?: string[];
  validationRunCount?: number;
  validationRepairCount?: number;
  lastValidation?: ValidationRun;
  lastDiffSafety?: DiffSafetyResult;
  contextRotationCount?: number;
  lastContextRotationAt?: string;
  lastContextRotationInputTokens?: number;
  lastContextRotationThreshold?: number;
  contextHandoffCount?: number;
  lastContextHandoff?: ContextHandoffReference;
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
  lastRunCheckpoint?: GitRollbackCheckpoint;
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
  validationTimeoutMs: number;
  maxValidationOutputChars: number;
  maxValidationRepairs: number;
  checkpointMaxUntrackedFiles: number;
  checkpointMaxUntrackedBytes: number;
  contextRotateAtTokens: number;
  maxContextRotations: number;
  maxIterations: number;
  stallTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  autoApproveCommands: boolean;
  autoApproveEdits: boolean;
}
