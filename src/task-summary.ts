import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorTask, TaskStatus } from "./types.js";

export const TASK_SUMMARY_SCHEMA_VERSION = 1 as const;
export const TASK_SUMMARY_MAX_TEXT_CHARS = 2_000 as const;

export interface TaskSummaryLifecycle {
  runCount: number;
  sessionGeneration: number;
  recoveryCount: number;
  contextRotationCount: number;
  contextHandoffCount: number;
}

export interface TaskSummaryConfiguration {
  acceptanceCriteriaCount: number;
  validationCommandCount: number;
  expectedChangedPathCount: number;
}

export interface TaskSummaryValidationEvidence {
  completedAt: string;
  passed: boolean;
  commandsRequested: number;
  commandsRun: number;
  runCount: number;
  repairCount: number;
}

export interface TaskSummaryDiffSafetyEvidence {
  checkedAt: string;
  passed: boolean;
  finalDiffSummary: string;
  finalDiffSummaryTruncated: boolean;
  changedFiles: number;
  warningCount: number;
  failureCount: number;
}

export interface TaskSummaryWorkspaceEvidence {
  capturedAt: string;
  available: boolean;
  branch?: string;
  head?: string;
  dirty?: boolean;
  changedFiles?: number;
}

export interface TaskSummaryHandoffEvidence {
  id: string;
  createdAt: string;
  relativePath: string;
  reason: string;
  sourceGeneration: number;
  targetGeneration: number;
}

export interface TaskSummaryMetricsEvidence {
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
}

export interface TaskSummaryOutcome {
  finishReason?: string;
  finishReasonTruncated?: boolean;
  error?: string;
  errorTruncated?: boolean;
  abortReason?: string;
  abortReasonTruncated?: boolean;
}

export interface TaskStructuredSummary {
  schemaVersion: typeof TASK_SUMMARY_SCHEMA_VERSION;
  taskId: string;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
  sourceTaskUpdatedAt: string;
  revision: number;
  workspace: string;
  goal: string;
  goalTruncated: boolean;
  status: TaskStatus;
  lifecycle: TaskSummaryLifecycle;
  configuration: TaskSummaryConfiguration;
  validation?: TaskSummaryValidationEvidence;
  diffSafety?: TaskSummaryDiffSafetyEvidence;
  workspaceEvidence?: TaskSummaryWorkspaceEvidence;
  handoff?: TaskSummaryHandoffEvidence;
  metrics?: TaskSummaryMetricsEvidence;
  outcome?: TaskSummaryOutcome;
}

interface BoundedText {
  value: string;
  truncated: boolean;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function serialize(summary: TaskStructuredSummary): string {
  return JSON.stringify(summary, null, 2) + "\n";
}

function validTimestamp(label: string, value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} is not a valid timestamp: ${value}`);
  }
  return value;
}

function safeTaskId(value: string): string {
  const taskId = value.trim();
  if (!taskId) throw new Error("taskId is required");
  if (taskId === "." || taskId === ".." || /[\\/]/.test(taskId)) {
    throw new Error(`taskId must not contain path separators: ${value}`);
  }
  return taskId;
}

function boundedText(value: string): BoundedText {
  if (value.length <= TASK_SUMMARY_MAX_TEXT_CHARS) return { value, truncated: false };
  return {
    value: value.slice(0, TASK_SUMMARY_MAX_TEXT_CHARS),
    truncated: true,
  };
}

function optionalBoundedText(value: string | undefined): BoundedText | undefined {
  return value === undefined ? undefined : boundedText(value);
}

function relativeSummaryPath(taskId: string): string {
  return path.posix.join(".orchestrator", "task-summaries", `${safeTaskId(taskId)}.json`);
}

function validateSummary(value: unknown, filePath: string): TaskStructuredSummary {
  const summary = value as Partial<TaskStructuredSummary> | undefined;
  if (!summary || summary.schemaVersion !== TASK_SUMMARY_SCHEMA_VERSION) {
    throw new Error(`Unsupported or missing task summary schema in ${filePath}`);
  }
  if (typeof summary.taskId !== "string" || !summary.taskId) {
    throw new Error(`Task summary is missing taskId in ${filePath}`);
  }
  if (summary.relativePath !== relativeSummaryPath(summary.taskId)) {
    throw new Error(`Task summary relativePath is invalid in ${filePath}`);
  }
  if (!Number.isInteger(summary.revision) || (summary.revision ?? 0) < 1) {
    throw new Error(`Task summary revision is invalid in ${filePath}`);
  }
  if (
    typeof summary.createdAt !== "string" ||
    typeof summary.updatedAt !== "string" ||
    typeof summary.sourceTaskUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(summary.createdAt)) ||
    Number.isNaN(Date.parse(summary.updatedAt)) ||
    Number.isNaN(Date.parse(summary.sourceTaskUpdatedAt))
  ) {
    throw new Error(`Task summary timestamps are invalid in ${filePath}`);
  }
  if (typeof summary.goal !== "string" || typeof summary.status !== "string") {
    throw new Error(`Task summary core fields are invalid in ${filePath}`);
  }
  return summary as TaskStructuredSummary;
}

function outcomeFromTask(task: OrchestratorTask): TaskSummaryOutcome | undefined {
  const finishReason = optionalBoundedText(task.finishReason);
  const error = optionalBoundedText(task.error);
  const abortReason = optionalBoundedText(task.abortReason);
  if (!finishReason && !error && !abortReason) return undefined;

  return {
    ...(finishReason
      ? { finishReason: finishReason.value, finishReasonTruncated: finishReason.truncated }
      : {}),
    ...(error ? { error: error.value, errorTruncated: error.truncated } : {}),
    ...(abortReason
      ? { abortReason: abortReason.value, abortReasonTruncated: abortReason.truncated }
      : {}),
  };
}

function summaryFromTask(
  task: OrchestratorTask,
  previous: TaskStructuredSummary | undefined,
  now: string,
): TaskStructuredSummary {
  const taskId = safeTaskId(task.id);
  const sourceTaskUpdatedAt = validTimestamp("task.updatedAt", task.updatedAt);
  const goal = boundedText(task.goal);
  const snapshot = task.lastRunGit?.after ?? task.lastRunGit?.before;
  const diffSummary = task.lastDiffSafety
    ? boundedText(task.lastDiffSafety.finalDiffSummary)
    : undefined;

  return {
    schemaVersion: TASK_SUMMARY_SCHEMA_VERSION,
    taskId,
    relativePath: relativeSummaryPath(taskId),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    sourceTaskUpdatedAt,
    revision: (previous?.revision ?? 0) + 1,
    workspace: task.workspace,
    goal: goal.value,
    goalTruncated: goal.truncated,
    status: task.status,
    lifecycle: {
      runCount: task.runCount ?? 0,
      sessionGeneration: task.sessionGeneration ?? 0,
      recoveryCount: task.recoveryCount ?? 0,
      contextRotationCount: task.contextRotationCount ?? 0,
      contextHandoffCount: task.contextHandoffCount ?? 0,
    },
    configuration: {
      acceptanceCriteriaCount: task.acceptanceCriteria?.length ?? 0,
      validationCommandCount: task.validationCommands?.length ?? 0,
      expectedChangedPathCount: task.expectedChangedPaths?.length ?? 0,
    },
    ...(task.lastValidation
      ? {
          validation: {
            completedAt: task.lastValidation.completedAt,
            passed: task.lastValidation.passed,
            commandsRequested: task.lastValidation.commandsRequested,
            commandsRun: task.lastValidation.commandsRun,
            runCount: task.validationRunCount ?? 0,
            repairCount: task.validationRepairCount ?? 0,
          },
        }
      : {}),
    ...(task.lastDiffSafety && diffSummary
      ? {
          diffSafety: {
            checkedAt: task.lastDiffSafety.checkedAt,
            passed: task.lastDiffSafety.passed,
            finalDiffSummary: diffSummary.value,
            finalDiffSummaryTruncated: diffSummary.truncated,
            changedFiles: task.lastDiffSafety.summary.changedFiles,
            warningCount: task.lastDiffSafety.warnings.length,
            failureCount: task.lastDiffSafety.failures.length,
          },
        }
      : {}),
    ...(snapshot
      ? {
          workspaceEvidence: {
            capturedAt: snapshot.capturedAt,
            available: snapshot.available,
            ...(snapshot.branch !== undefined ? { branch: snapshot.branch } : {}),
            ...(snapshot.head !== undefined ? { head: snapshot.head } : {}),
            ...(snapshot.dirty !== undefined ? { dirty: snapshot.dirty } : {}),
            ...(snapshot.changedFiles !== undefined ? { changedFiles: snapshot.changedFiles } : {}),
          },
        }
      : {}),
    ...(task.lastContextHandoff
      ? {
          handoff: {
            id: task.lastContextHandoff.id,
            createdAt: task.lastContextHandoff.createdAt,
            relativePath: task.lastContextHandoff.relativePath,
            reason: task.lastContextHandoff.reason,
            sourceGeneration: task.lastContextHandoff.sourceGeneration,
            targetGeneration: task.lastContextHandoff.targetGeneration,
          },
        }
      : {}),
    ...(task.lastRunMetrics
      ? {
          metrics: {
            startedAt: task.lastRunMetrics.startedAt,
            ...(task.lastRunMetrics.completedAt !== undefined
              ? { completedAt: task.lastRunMetrics.completedAt }
              : {}),
            ...(task.lastRunMetrics.durationMs !== undefined
              ? { durationMs: task.lastRunMetrics.durationMs }
              : {}),
            iterations: task.lastRunMetrics.iterations,
            toolCalls: task.lastRunMetrics.toolCalls,
            totalInputTokens: task.lastRunMetrics.totalInputTokens,
            totalOutputTokens: task.lastRunMetrics.totalOutputTokens,
            ...(task.lastRunMetrics.attempts !== undefined
              ? { attempts: task.lastRunMetrics.attempts }
              : {}),
            ...(task.lastRunMetrics.retries !== undefined
              ? { retries: task.lastRunMetrics.retries }
              : {}),
            ...(task.lastRunMetrics.stalls !== undefined
              ? { stalls: task.lastRunMetrics.stalls }
              : {}),
          },
        }
      : {}),
    ...(outcomeFromTask(task) ? { outcome: outcomeFromTask(task) } : {}),
  };
}

export class TaskSummaryStore {
  constructor(private readonly rootDir: string) {}

  private summariesDir(): string {
    return path.join(this.rootDir, ".orchestrator", "task-summaries");
  }

  private summaryPath(taskId: string): string {
    return path.join(this.summariesDir(), `${safeTaskId(taskId)}.json`);
  }

  async load(taskId: string): Promise<TaskStructuredSummary> {
    const filePath = this.summaryPath(taskId);
    try {
      return validateSummary(JSON.parse(await readFile(filePath, "utf8")), filePath);
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`Task summary was not found at ${filePath}`);
      }
      throw error;
    }
  }

  async record(task: OrchestratorTask): Promise<TaskStructuredSummary> {
    await mkdir(this.summariesDir(), { recursive: true });

    let previous: TaskStructuredSummary | undefined;
    try {
      previous = await this.load(task.id);
    } catch (error) {
      if (!String((error as Error)?.message ?? error).startsWith("Task summary was not found at ")) {
        throw error;
      }
    }

    const now = new Date().toISOString();
    const summary = summaryFromTask(task, previous, now);
    await writeFile(this.summaryPath(task.id), serialize(summary), "utf8");
    return summary;
  }
}
