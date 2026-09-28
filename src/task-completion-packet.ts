import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, TaskStatus } from "./types.js";

export const TASK_COMPLETION_PACKET_SCHEMA_VERSION = 1 as const;
export const TASK_COMPLETION_REPORT_MAX_CHARS = 40_000 as const;

const TERMINAL_STATUSES = new Set<TaskStatus>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

export type TaskCompletionReviewState =
  | "worker_in_progress"
  | "ready_for_supervisor_review"
  | "closed_without_completion_review";

export interface TaskCompletionPacketIdentity {
  taskId: string;
  projectId: string;
  workspaceId: string;
}

export interface TaskCompletionWorkerReport {
  source: "cline_result";
  trust: "untrusted_worker_claims";
  report: string;
  truncated: boolean;
  rawReportPreservedLocally: true;
}

export interface TaskCompletionPacketV1 {
  schemaVersion: typeof TASK_COMPLETION_PACKET_SCHEMA_VERSION;
  taskId: string;
  projectId: string;
  workspaceId: string;
  capturedAt: string;
  status: TaskStatus;
  reviewState: TaskCompletionReviewState;
  completionSignal: {
    terminal: boolean;
    finishReason?: string;
    workerReportAvailable: boolean;
  };
  workerCompletion?: TaskCompletionWorkerReport;
  independentEvidence: {
    validation: {
      available: boolean;
      passed?: boolean;
      commandsRequested?: number;
      commandsRun?: number;
      completedAt?: string;
      source: "orchestrator_validation";
    };
    diffSafety: {
      available: boolean;
      passed?: boolean;
      changedFiles?: number;
      warningCount?: number;
      failureCount?: number;
      summary?: string;
      checkedAt?: string;
      source: "orchestrator_diff_safety";
    };
    git: {
      before?: {
        capturedAt: string;
        available: boolean;
        branch?: string;
        head?: string;
        dirty?: boolean;
        changedFiles?: number;
      };
      after?: {
        capturedAt: string;
        available: boolean;
        branch?: string;
        head?: string;
        dirty?: boolean;
        changedFiles?: number;
      };
      source: "orchestrator_git_snapshot";
    };
    checkpoint: {
      available: boolean;
      createdAt?: string;
      runCount?: number;
      restored: boolean;
      source: "orchestrator_checkpoint";
    };
    recovery: {
      runCount: number;
      sessionGeneration: number;
      recoveryCount: number;
      contextRotationCount: number;
      contextHandoffCount: number;
      retryCount: number;
      stallCount: number;
      source: "orchestrator_runtime_state";
    };
  };
}

interface CreatePacketOptions {
  workspaceRoot?: string;
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactExact(value: string, sensitive: string | undefined): string {
  if (!sensitive?.trim()) return value;
  return value.replace(new RegExp(escapeRegExp(sensitive), "gi"), "[REDACTED]");
}

function sanitizeWorkerReport(
  report: string,
  task: OrchestratorTask,
  workspaceRoot?: string,
): { value: string; truncated: boolean } {
  let value = redactSecrets(report);

  for (const sensitive of [task.clineSessionId, task.lastRecoveredFromSessionId]) {
    value = redactExact(value, sensitive);
  }

  if (workspaceRoot?.trim()) {
    const variants = new Set([
      workspaceRoot,
      workspaceRoot.replaceAll("\\", "/"),
      workspaceRoot.replaceAll("/", "\\"),
    ]);
    for (const variant of variants) {
      value = redactExact(value, variant);
    }
  }

  if (value.length <= TASK_COMPLETION_REPORT_MAX_CHARS) {
    return { value, truncated: false };
  }
  return {
    value: value.slice(0, TASK_COMPLETION_REPORT_MAX_CHARS),
    truncated: true,
  };
}

function gitEvidence(snapshot: OrchestratorTask["lastRunGit"] extends infer T ? any : never) {
  if (!snapshot) return undefined;
  return {
    capturedAt: snapshot.capturedAt,
    available: snapshot.available,
    ...(snapshot.branch !== undefined ? { branch: snapshot.branch } : {}),
    ...(snapshot.head !== undefined ? { head: snapshot.head } : {}),
    ...(snapshot.dirty !== undefined ? { dirty: snapshot.dirty } : {}),
    ...(snapshot.changedFiles !== undefined ? { changedFiles: snapshot.changedFiles } : {}),
  };
}

function reviewState(task: OrchestratorTask): TaskCompletionReviewState {
  if (!TERMINAL_STATUSES.has(task.status)) return "worker_in_progress";
  if (task.status === "aborted" || task.status === "rolled_back") {
    return "closed_without_completion_review";
  }
  return "ready_for_supervisor_review";
}

/**
 * Build the model-facing completion packet from durable task state.
 * Cline output is preserved as an explicitly untrusted claim; validation,
 * diff-safety, Git snapshots and recovery counters remain independent evidence.
 * Raw workspace paths, Hub session identifiers and obvious secret material are
 * removed from the model-facing report copy.
 */
export function createTaskCompletionPacket(
  task: OrchestratorTask,
  identity: TaskCompletionPacketIdentity,
  options: CreatePacketOptions = {},
): TaskCompletionPacketV1 {
  if (identity.taskId !== task.id) {
    throw new Error("Completion packet identity does not match task id");
  }

  const rawReport = typeof task.lastOutput === "string" && task.lastOutput.trim()
    ? task.lastOutput
    : undefined;
  const workerReport = rawReport
    ? sanitizeWorkerReport(rawReport, task, options.workspaceRoot)
    : undefined;
  const validation = task.lastValidation;
  const diff = task.lastDiffSafety;
  const checkpoint = task.lastRunCheckpoint;

  return {
    schemaVersion: TASK_COMPLETION_PACKET_SCHEMA_VERSION,
    taskId: identity.taskId,
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    capturedAt: new Date().toISOString(),
    status: task.status,
    reviewState: reviewState(task),
    completionSignal: {
      terminal: TERMINAL_STATUSES.has(task.status),
      ...(task.finishReason !== undefined ? { finishReason: task.finishReason } : {}),
      workerReportAvailable: workerReport !== undefined,
    },
    ...(workerReport
      ? {
          workerCompletion: {
            source: "cline_result",
            trust: "untrusted_worker_claims",
            report: workerReport.value,
            truncated: workerReport.truncated,
            rawReportPreservedLocally: true,
          },
        }
      : {}),
    independentEvidence: {
      validation: {
        available: validation !== undefined,
        ...(validation
          ? {
              passed: validation.passed,
              commandsRequested: validation.commandsRequested,
              commandsRun: validation.commandsRun,
              completedAt: validation.completedAt,
            }
          : {}),
        source: "orchestrator_validation",
      },
      diffSafety: {
        available: diff !== undefined,
        ...(diff
          ? {
              passed: diff.passed,
              changedFiles: diff.summary.changedFiles,
              warningCount: diff.warnings.length,
              failureCount: diff.failures.length,
              summary: diff.finalDiffSummary,
              checkedAt: diff.checkedAt,
            }
          : {}),
        source: "orchestrator_diff_safety",
      },
      git: {
        ...(task.lastRunGit?.before ? { before: gitEvidence(task.lastRunGit.before) } : {}),
        ...(task.lastRunGit?.after ? { after: gitEvidence(task.lastRunGit.after) } : {}),
        source: "orchestrator_git_snapshot",
      },
      checkpoint: {
        available: checkpoint?.available === true,
        ...(checkpoint?.createdAt !== undefined ? { createdAt: checkpoint.createdAt } : {}),
        ...(checkpoint?.runCount !== undefined ? { runCount: checkpoint.runCount } : {}),
        restored: Boolean(checkpoint?.restoredAt),
        source: "orchestrator_checkpoint",
      },
      recovery: {
        runCount: task.runCount ?? 0,
        sessionGeneration: task.sessionGeneration ?? 0,
        recoveryCount: task.recoveryCount ?? 0,
        contextRotationCount: task.contextRotationCount ?? 0,
        contextHandoffCount: task.contextHandoffCount ?? 0,
        retryCount: task.retryCount ?? 0,
        stallCount: task.stallCount ?? 0,
        source: "orchestrator_runtime_state",
      },
    },
  };
}

/**
 * Resolve an approved task through the existing machine service first so the
 * current registry/Safety binding is revalidated. Only then read the local raw
 * task state needed to construct the completion packet.
 */
export async function getTaskCompletionPacket(
  service: MachineOrchestratorService,
  taskId: string,
): Promise<TaskCompletionPacketV1> {
  const publicTask = await service.getTask(taskId);
  const workspace = await service.registry.resolveVerifiedWorkspace(publicTask.workspaceId);
  const task = await new TaskStore(workspace.canonicalRoot).load(publicTask.taskId);
  const bound = task as OrchestratorTask & { projectId?: string; workspaceId?: string };

  if (
    bound.projectId !== publicTask.projectId ||
    bound.workspaceId !== publicTask.workspaceId
  ) {
    throw new Error("Completion packet task binding changed after gateway validation");
  }

  return createTaskCompletionPacket(
    task,
    {
      taskId: publicTask.taskId,
      projectId: publicTask.projectId,
      workspaceId: publicTask.workspaceId,
    },
    { workspaceRoot: workspace.canonicalRoot },
  );
}
