import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureGitSnapshot } from "./git-state.js";
import {
  ProjectMemoryStore,
  type ProjectMetadata,
  type ProjectMemoryUpdateReference,
} from "./project-memory.js";
import { TaskSummaryStore, type TaskStructuredSummary } from "./task-summary.js";
import type {
  ContextHandoffArtifact,
  ContextHandoffReference,
  OrchestratorTask,
  SessionRecoveryReason,
} from "./types.js";

const MAX_PREVIOUS_PROMPT_CHARS = 6000;
const MAX_RECENT_OUTPUT_CHARS = 12000;
const MAX_PROMPT_GOAL_CHARS = 6000;
const MAX_PROMPT_PENDING_ACTION_CHARS = 6000;
const MAX_PROMPT_STATUS_LINES = 50;
const MAX_PROJECT_MEMORY_RATIONALE_CHARS = 1000;

export interface ContextHandoffProjectMemoryEvidence {
  schemaVersion: ProjectMetadata["schemaVersion"];
  projectId: string;
  updatedAt: string;
  memorySchemaVersion: ProjectMetadata["memorySchemaVersion"];
  memoryFiles: ProjectMetadata["memoryFiles"];
  memoryUpdateCount: number;
  lastMemoryUpdate?: ProjectMemoryUpdateReference;
}

export interface ContextHandoffDurableMemoryContext {
  taskSummary: TaskStructuredSummary;
  project: ContextHandoffProjectMemoryEvidence;
}

export type ContextHandoffArtifactWithMemory = ContextHandoffArtifact & {
  durableMemory?: ContextHandoffDurableMemoryContext;
};

export interface CreateContextHandoffInput {
  reason: SessionRecoveryReason;
  pendingAction: string;
  previousPrompt?: string;
  recentWorkerOutput?: string;
  sourceSessionId?: string;
  targetGeneration?: number;
}

export interface CreatedContextHandoff {
  artifact: ContextHandoffArtifactWithMemory;
  reference: ContextHandoffReference;
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized === "." || normalized === ".." || normalized.length === 0
    ? "_"
    : normalized;
}

function clipHead(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated by orchestrator]`;
}

function clipTail(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxChars) return value;
  return `[truncated by orchestrator]...\n${value.slice(value.length - maxChars)}`;
}

function reasonDescription(reason: SessionRecoveryReason, task: OrchestratorTask): string {
  if (reason === "watchdog_stall") {
    return "The previous Cline turn stopped producing activity and was aborted by the orchestrator watchdog.";
  }
  if (reason === "context_threshold") {
    return `The previous Cline session reached the planned context-rotation threshold after a request of about ${task.lastContextRotationInputTokens ?? "unknown"} input tokens. Rotation occurred at an iteration boundary before another tool-driven model iteration.`;
  }
  if (reason === "missing_session_id") {
    return "The task has durable orchestrator state but no usable Cline session ID, so a replacement session was created.";
  }
  return "The previously recorded Cline runtime session was not available, so a replacement session was created.";
}

function boundedLastMemoryUpdate(
  value: ProjectMemoryUpdateReference | undefined,
): ProjectMemoryUpdateReference | undefined {
  if (!value) return undefined;
  return {
    ...value,
    rationale:
      clipHead(value.rationale, MAX_PROJECT_MEMORY_RATIONALE_CHARS) ?? value.rationale,
  };
}

async function createDurableMemoryContext(
  workspace: string,
  task: OrchestratorTask,
): Promise<ContextHandoffDurableMemoryContext> {
  const project = await new ProjectMemoryStore(workspace).ensure();
  const taskSummary = await new TaskSummaryStore(workspace).record(task);
  return {
    taskSummary,
    project: {
      schemaVersion: project.schemaVersion,
      projectId: project.projectId,
      updatedAt: project.updatedAt,
      memorySchemaVersion: project.memorySchemaVersion,
      memoryFiles: project.memoryFiles,
      memoryUpdateCount: project.memoryUpdateCount ?? 0,
      lastMemoryUpdate: boundedLastMemoryUpdate(project.lastMemoryUpdate),
    },
  };
}

export async function createContextHandoff(
  workspace: string,
  task: OrchestratorTask,
  input: CreateContextHandoffInput,
): Promise<CreatedContextHandoff> {
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const sourceGeneration = task.sessionGeneration ?? (input.sourceSessionId ? 1 : 0);
  const targetGeneration = input.targetGeneration ?? sourceGeneration + 1;
  const git = await captureGitSnapshot(workspace);
  const durableMemory = await createDurableMemoryContext(workspace, task);

  const checkpoint = task.lastRunCheckpoint
    ? {
        createdAt: task.lastRunCheckpoint.createdAt,
        available: task.lastRunCheckpoint.available,
        runCount: task.lastRunCheckpoint.runCount,
        branch: task.lastRunCheckpoint.branch,
        head: task.lastRunCheckpoint.head,
        beforeFingerprintDigest: task.lastRunCheckpoint.beforeFingerprint?.digest,
        afterFingerprintDigest: task.lastRunCheckpoint.afterFingerprint?.digest,
        error: task.lastRunCheckpoint.error,
      }
    : undefined;

  const lastValidation = task.lastValidation
    ? {
        completedAt: task.lastValidation.completedAt,
        passed: task.lastValidation.passed,
        commandsRequested: task.lastValidation.commandsRequested,
        commandsRun: task.lastValidation.commandsRun,
      }
    : undefined;

  const lastDiffSafety = task.lastDiffSafety
    ? {
        checkedAt: task.lastDiffSafety.checkedAt,
        passed: task.lastDiffSafety.passed,
        finalDiffSummary: task.lastDiffSafety.finalDiffSummary,
      }
    : undefined;

  const runMetrics = task.lastRunMetrics
    ? {
        startedAt: task.lastRunMetrics.startedAt,
        iterations: task.lastRunMetrics.iterations,
        toolCalls: task.lastRunMetrics.toolCalls,
        totalInputTokens: task.lastRunMetrics.totalInputTokens,
        totalOutputTokens: task.lastRunMetrics.totalOutputTokens,
        attempts: task.lastRunMetrics.attempts,
        retries: task.lastRunMetrics.retries,
        stalls: task.lastRunMetrics.stalls,
      }
    : undefined;

  const artifact: ContextHandoffArtifactWithMemory = {
    schemaVersion: 1,
    id,
    createdAt,
    taskId: task.id,
    reason: input.reason,
    reasonDescription: reasonDescription(input.reason, task),
    sourceSessionId: input.sourceSessionId,
    sourceGeneration,
    targetGeneration,
    workspace: task.workspace,
    originalGoal: task.goal,
    pendingAction: input.pendingAction,
    taskState: {
      status: task.status,
      runCount: task.runCount ?? 0,
      sessionGeneration: task.sessionGeneration ?? 0,
      recoveryCount: task.recoveryCount ?? 0,
      contextRotationCount: task.contextRotationCount ?? 0,
      validationRunCount: task.validationRunCount ?? 0,
      validationRepairCount: task.validationRepairCount ?? 0,
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      validationCommands: task.validationCommands ?? [],
      expectedChangedPaths: task.expectedChangedPaths ?? [],
      finishReason: task.finishReason,
      error: task.error,
    },
    workspaceEvidence: {
      git,
      checkpoint,
      lastValidation,
      lastDiffSafety,
      runMetrics,
    },
    durableMemory,
    supportingContext: {
      previousPrompt: clipHead(input.previousPrompt, MAX_PREVIOUS_PROMPT_CHARS),
      recentWorkerOutput: clipTail(input.recentWorkerOutput, MAX_RECENT_OUTPUT_CHARS),
    },
  };

  const taskSegment = safeSegment(task.id);
  const filename = `${targetGeneration}-${id}.json`;
  const relativePath = [".orchestrator", "handoffs", taskSegment, filename].join("/");
  const absolutePath = path.join(workspace, ".orchestrator", "handoffs", taskSegment, filename);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return {
    artifact,
    reference: {
      id,
      createdAt,
      relativePath,
      reason: input.reason,
      sourceSessionId: input.sourceSessionId,
      sourceGeneration,
      targetGeneration,
    },
  };
}

export async function loadContextHandoff(
  workspace: string,
  reference: ContextHandoffReference,
): Promise<ContextHandoffArtifactWithMemory> {
  const handoffRoot = path.resolve(workspace, ".orchestrator", "handoffs");
  const absolutePath = path.resolve(workspace, ...reference.relativePath.split("/"));
  const relative = path.relative(handoffRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Context handoff path escapes handoff root: ${reference.relativePath}`);
  }
  return JSON.parse(await readFile(absolutePath, "utf8")) as ContextHandoffArtifactWithMemory;
}

export function buildContextHandoffPrompt(
  handoff: ContextHandoffArtifactWithMemory,
  reference: ContextHandoffReference,
): string {
  const git = handoff.workspaceEvidence.git;
  const promptEvidence = {
    git: {
      available: git.available,
      root: git.root,
      branch: git.branch,
      head: git.head,
      detached: git.detached,
      dirty: git.dirty,
      changedFiles: git.changedFiles,
      stagedFiles: git.stagedFiles,
      unstagedFiles: git.unstagedFiles,
      untrackedFiles: git.untrackedFiles,
      statusLines: git.statusLines?.slice(0, MAX_PROMPT_STATUS_LINES),
      statusTruncated:
        git.statusTruncated || (git.statusLines?.length ?? 0) > MAX_PROMPT_STATUS_LINES,
      error: git.error,
    },
    checkpoint: handoff.workspaceEvidence.checkpoint,
    lastValidation: handoff.workspaceEvidence.lastValidation,
    lastDiffSafety: handoff.workspaceEvidence.lastDiffSafety,
    runMetrics: handoff.workspaceEvidence.runMetrics,
  };

  const structured = {
    schemaVersion: handoff.schemaVersion,
    handoffId: handoff.id,
    reason: handoff.reason,
    sourceSessionId: handoff.sourceSessionId,
    sourceGeneration: handoff.sourceGeneration,
    targetGeneration: handoff.targetGeneration,
    workspace: handoff.workspace,
    originalGoal: clipHead(handoff.originalGoal, MAX_PROMPT_GOAL_CHARS),
    pendingAction: clipHead(handoff.pendingAction, MAX_PROMPT_PENDING_ACTION_CHARS),
    taskState: handoff.taskState,
    workspaceEvidence: promptEvidence,
    durableMemory: handoff.durableMemory,
    supportingContext: handoff.supportingContext,
  };

  return `You are continuing an orchestrated coding task in a replacement Cline session.\n\n${handoff.reasonDescription}\n\nA durable structured handoff was written before session replacement. Do not assume hidden conversation context survived. Treat the current workspace and the handoff data as the source of truth, and re-inspect files when needed.\n\nDurable handoff artifact:\n${reference.relativePath}\n\nStructured handoff:\n${JSON.stringify(structured, null, 2)}\n\nContinue the pending action from this durable state. Preserve existing valid work, verify assumptions against the workspace, and do not broaden the task beyond the original goal.`;
}
