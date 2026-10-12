import {
  getTaskCompletionPacket,
  type TaskCompletionPacketV1,
} from "./task-completion-packet.js";
import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { TaskStatus } from "./types.js";

export type ReviewEvidenceState = "passed" | "failed" | "unavailable";
export type TaskReviewDisposition = "in_progress" | "inspection_required" | "closed_without_completion_review";

export interface TaskReviewProjectionV1 {
  schemaVersion: 1;
  authority: "trusted_completion_packet_projection_only";
  readOnly: true;
  actions: readonly [];
  grantsAuthority: false;
  taskId: string;
  projectId: string;
  workspaceId: string;
  capturedAt: string;
  taskStatus: TaskStatus;
  disposition: TaskReviewDisposition;
  workerTestimony: {
    available: boolean;
    trust: "untrusted_worker_claims";
    reportExposed: false;
  };
  evidence: {
    validation: {
      source: "orchestrator_validation";
      state: ReviewEvidenceState;
      commandsRequested?: number;
      commandsRun?: number;
      completedAt?: string;
    };
    diffSafety: {
      source: "orchestrator_diff_safety";
      state: ReviewEvidenceState;
      changedFiles?: number;
      warnings?: number;
      failures?: number;
      checkedAt?: string;
    };
    git: {
      source: "orchestrator_git_snapshot";
      beforeAvailable: boolean;
      afterAvailable: boolean;
    };
    checkpoint: {
      source: "orchestrator_checkpoint";
      available: boolean;
      restored: boolean;
      runCount?: number;
    };
    recovery: {
      source: "orchestrator_runtime_state";
      runs: number;
      recoveries: number;
      retries: number;
      stalls: number;
    };
  };
  caution: "independent_evidence_not_supervisor_decision";
}

const STATUSES = new Set<TaskStatus>([
  "created", "running", "waiting", "waiting_for_human", "stalled",
  "validating", "repairing", "safety_checking", "completed",
  "validation_failed", "failed", "aborted", "rolled_back",
]);
const TERMINAL = new Set<TaskStatus>(["completed", "validation_failed", "failed", "aborted", "rolled_back"]);
const CLOSED = new Set<TaskStatus>(["aborted", "rolled_back"]);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class TaskReviewProjectionError extends Error {
  constructor() {
    super("trusted task completion evidence is unavailable or inconsistent");
    this.name = "TaskReviewProjectionError";
  }
}

function fail(): never {
  throw new TaskReviewProjectionError();
}

function timestamp(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function optionalTimestamp(value: unknown): boolean {
  return value === undefined || timestamp(value);
}

function count(value: unknown): boolean {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 1_000_000_000;
}

function optionalCount(value: unknown): boolean {
  return value === undefined || count(value);
}

function inspectBooleanEvidence(
  evidence: { available: boolean; passed?: boolean; completedAt?: string; checkedAt?: string },
): ReviewEvidenceState {
  if (typeof evidence.available !== "boolean"
    || !optionalTimestamp(evidence.completedAt) || !optionalTimestamp(evidence.checkedAt)
    || (evidence.passed !== undefined && typeof evidence.passed !== "boolean")
    || (!evidence.available && (evidence.passed !== undefined
      || evidence.completedAt !== undefined || evidence.checkedAt !== undefined))
    || (evidence.available && evidence.passed === undefined)) fail();
  return !evidence.available ? "unavailable" : evidence.passed ? "passed" : "failed";
}

/**
 * Pure bounded projection only. Input must come from the trusted task-completion
 * packet boundary; the "source" literals are descriptive, not authentication.
 * Never copies worker report, finish reason, diff text, Git branch/head, file
 * paths, reviewer instructions or checkpoint references.
 */
export function buildTaskReviewProjection(packet: TaskCompletionPacketV1): TaskReviewProjectionV1 {
  if (!packet || packet.schemaVersion !== 1
    || !ID.test(packet.taskId) || !ID.test(packet.projectId) || !ID.test(packet.workspaceId)
    || !timestamp(packet.capturedAt) || !STATUSES.has(packet.status)
    || !packet.completionSignal || typeof packet.completionSignal.workerReportAvailable !== "boolean"
    || typeof packet.completionSignal.terminal !== "boolean"
    || packet.completionSignal.terminal !== TERMINAL.has(packet.status)
    || packet.reviewState !== (CLOSED.has(packet.status)
      ? "closed_without_completion_review"
      : TERMINAL.has(packet.status) ? "ready_for_supervisor_review" : "worker_in_progress")
    || packet.completionSignal.workerReportAvailable !== Boolean(packet.workerCompletion)
    || (packet.workerCompletion !== undefined && (
      packet.workerCompletion.source !== "cline_result"
      || packet.workerCompletion.trust !== "untrusted_worker_claims"
      || typeof packet.workerCompletion.report !== "string"
      || typeof packet.workerCompletion.truncated !== "boolean"
      || packet.workerCompletion.rawReportPreservedLocally !== true
    ))
  ) fail();
  const e = packet.independentEvidence;
  if (!e || !e.validation || !e.diffSafety || !e.git || !e.checkpoint || !e.recovery
    || e.validation.source !== "orchestrator_validation"
    || e.diffSafety.source !== "orchestrator_diff_safety"
    || e.git.source !== "orchestrator_git_snapshot"
    || e.checkpoint.source !== "orchestrator_checkpoint"
    || e.recovery.source !== "orchestrator_runtime_state") fail();

  const validationState = inspectBooleanEvidence(e.validation);
  const diffState = inspectBooleanEvidence(e.diffSafety);
  if (!optionalCount(e.validation.commandsRequested)
    || !optionalCount(e.validation.commandsRun)
    || !optionalCount(e.diffSafety.changedFiles)
    || !optionalCount(e.diffSafety.warningCount)
    || !optionalCount(e.diffSafety.failureCount)
    || !optionalCount(e.checkpoint.runCount)
    || !count(e.recovery.runCount) || !count(e.recovery.recoveryCount)
    || !count(e.recovery.retryCount) || !count(e.recovery.stallCount)
    || typeof e.checkpoint.available !== "boolean"
    || typeof e.checkpoint.restored !== "boolean"
    || !optionalTimestamp(e.checkpoint.createdAt)
    || (e.validation.commandsRequested !== undefined && e.validation.commandsRun !== undefined
        && e.validation.commandsRun > e.validation.commandsRequested)
    || (!e.validation.available && (
      e.validation.commandsRequested !== undefined || e.validation.commandsRun !== undefined))
    || (!e.diffSafety.available && (
      e.diffSafety.changedFiles !== undefined || e.diffSafety.warningCount !== undefined
      || e.diffSafety.failureCount !== undefined))
    || (diffState === "passed" && (e.diffSafety.failureCount ?? 0) > 0)
    || (e.checkpoint.restored && !e.checkpoint.available)
    || (!e.checkpoint.available && e.checkpoint.runCount !== undefined)) fail();

  for (const snapshot of [e.git.before, e.git.after]) {
    if (snapshot && (
      typeof snapshot.available !== "boolean" || !timestamp(snapshot.capturedAt)
      || !optionalCount(snapshot.changedFiles)
    )) fail();
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    authority: "trusted_completion_packet_projection_only" as const,
    readOnly: true as const,
    actions: [] as const,
    grantsAuthority: false as const,
    taskId: packet.taskId,
    projectId: packet.projectId,
    workspaceId: packet.workspaceId,
    capturedAt: packet.capturedAt,
    taskStatus: packet.status,
    disposition: CLOSED.has(packet.status)
      ? "closed_without_completion_review" as const
      : TERMINAL.has(packet.status) ? "inspection_required" as const : "in_progress" as const,
    workerTestimony: {
      available: packet.completionSignal.workerReportAvailable,
      trust: "untrusted_worker_claims" as const,
      reportExposed: false as const,
    },
    evidence: {
      validation: {
        source: "orchestrator_validation" as const,
        state: validationState,
        ...(e.validation.commandsRequested !== undefined ? { commandsRequested: e.validation.commandsRequested } : {}),
        ...(e.validation.commandsRun !== undefined ? { commandsRun: e.validation.commandsRun } : {}),
        ...(e.validation.completedAt ? { completedAt: e.validation.completedAt } : {}),
      },
      diffSafety: {
        source: "orchestrator_diff_safety" as const,
        state: diffState,
        ...(e.diffSafety.changedFiles !== undefined ? { changedFiles: e.diffSafety.changedFiles } : {}),
        ...(e.diffSafety.warningCount !== undefined ? { warnings: e.diffSafety.warningCount } : {}),
        ...(e.diffSafety.failureCount !== undefined ? { failures: e.diffSafety.failureCount } : {}),
        ...(e.diffSafety.checkedAt ? { checkedAt: e.diffSafety.checkedAt } : {}),
      },
      git: {
        source: "orchestrator_git_snapshot" as const,
        beforeAvailable: e.git.before?.available === true,
        afterAvailable: e.git.after?.available === true,
      },
      checkpoint: {
        source: "orchestrator_checkpoint" as const,
        available: e.checkpoint.available,
        restored: e.checkpoint.restored,
        ...(e.checkpoint.runCount !== undefined ? { runCount: e.checkpoint.runCount } : {}),
      },
      recovery: {
        source: "orchestrator_runtime_state" as const,
        runs: e.recovery.runCount,
        recoveries: e.recovery.recoveryCount,
        retries: e.recovery.retryCount,
        stalls: e.recovery.stallCount,
      },
    },
    caution: "independent_evidence_not_supervisor_decision" as const,
  });
}

/** Reuses existing task/Safety/workspace binding checks before projecting. */
export async function getTrustedTaskReviewProjection(
  service: MachineOrchestratorService,
  taskId: string,
): Promise<TaskReviewProjectionV1> {
  return buildTaskReviewProjection(await getTaskCompletionPacket(service, taskId));
}
