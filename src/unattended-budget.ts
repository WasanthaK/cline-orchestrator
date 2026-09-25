import type { OrchestratorTask } from "./types.js";
import type { UnattendedWorkflowV1 } from "./unattended-workflow.js";

export interface UnattendedExecutionBudgetV1 {
  schemaVersion: 1;
  maxElapsedMs: number;
  maxModelRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxTaskRuns: number;
  maxRecoveries: number;
  maxValidationRepairs: number;
  checkpointPolicy: {
    requireExistingTaskPreRunCheckpointMechanism: true;
    requireCompletedDependencyCheckpoint: true;
  };
}

export interface UnattendedBudgetUsageV1 {
  schemaVersion: 1;
  workflowId: string;
  capturedAt: string;
  accountingComplete: boolean;
  accountingIssues: string[];
  elapsedMs: number;
  modelRequests: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  taskRuns: number;
  recoveries: number;
  validationRepairs: number;
  checkpointAvailableByTaskId: Record<string, boolean>;
}

export type UnattendedBudgetDimension =
  | "elapsed_ms"
  | "model_requests"
  | "input_tokens"
  | "output_tokens"
  | "tool_calls"
  | "task_runs"
  | "recoveries"
  | "validation_repairs";

export type UnattendedStartGuardReason =
  | "within_budget"
  | "accounting_incomplete"
  | "budget_exhausted"
  | "checkpoint_policy_failed"
  | "starter_checkpoint_mode_untrusted";

export interface UnattendedStartGuardResult {
  allowed: boolean;
  reason: UnattendedStartGuardReason;
  exhausted: UnattendedBudgetDimension[];
  accountingIssues: string[];
  dependencyTaskId?: string;
}

export class UnattendedBudgetError extends Error {
  constructor(
    message: string,
    public readonly code: "budget_invalid" | "workflow_mismatch",
  ) {
    super(message);
    this.name = "UnattendedBudgetError";
  }
}

const LIMIT_FIELDS: Array<keyof Omit<UnattendedExecutionBudgetV1, "schemaVersion" | "checkpointPolicy">> = [
  "maxElapsedMs",
  "maxModelRequests",
  "maxInputTokens",
  "maxOutputTokens",
  "maxToolCalls",
  "maxTaskRuns",
  "maxRecoveries",
  "maxValidationRepairs",
];

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new UnattendedBudgetError(`${field} must be a non-negative safe integer`, "budget_invalid");
  }
  return value as number;
}

export function validateUnattendedExecutionBudget(
  budget: UnattendedExecutionBudgetV1,
): UnattendedExecutionBudgetV1 {
  if (budget.schemaVersion !== 1) {
    throw new UnattendedBudgetError("Unsupported unattended budget schema", "budget_invalid");
  }
  for (const field of LIMIT_FIELDS) nonNegativeInteger(budget[field], field);
  if (
    budget.checkpointPolicy?.requireExistingTaskPreRunCheckpointMechanism !== true
    || budget.checkpointPolicy?.requireCompletedDependencyCheckpoint !== true
  ) {
    throw new UnattendedBudgetError(
      "Unattended checkpoint policy must require the existing task pre-run checkpoint mechanism and completed-dependency checkpoint evidence",
      "budget_invalid",
    );
  }
  return budget;
}

/**
 * Builds conservative workflow usage from durable task state. Detailed run metrics
 * currently retain only the latest run. Therefore any task with runCount > 1 makes
 * token/request/tool accounting incomplete and unattended progression fails closed.
 */
export function buildUnattendedBudgetUsage(
  workflow: UnattendedWorkflowV1,
  tasks: OrchestratorTask[],
  now: Date = new Date(),
): UnattendedBudgetUsageV1 {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const issues: string[] = [];
  const createdAtMs = Date.parse(workflow.createdAt);
  const capturedAtMs = now.getTime();
  let elapsedMs = 0;
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(capturedAtMs) || capturedAtMs < createdAtMs) {
    issues.push("workflow_elapsed_time_unavailable");
  } else {
    elapsedMs = capturedAtMs - createdAtMs;
  }

  let modelRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let taskRuns = 0;
  let recoveries = 0;
  let validationRepairs = 0;
  const checkpointAvailableByTaskId: Record<string, boolean> = {};

  for (const node of workflow.nodes) {
    const task = byId.get(node.taskId);
    if (!task) {
      issues.push(`task_state_missing:${node.taskId}`);
      checkpointAvailableByTaskId[node.taskId] = false;
      continue;
    }

    const runs = nonNegativeInteger(task.runCount ?? 0, `task.runCount:${task.id}`);
    taskRuns += runs;
    recoveries += nonNegativeInteger(task.recoveryCount ?? 0, `task.recoveryCount:${task.id}`);
    validationRepairs += nonNegativeInteger(
      task.validationRepairCount ?? 0,
      `task.validationRepairCount:${task.id}`,
    );
    checkpointAvailableByTaskId[node.taskId] = task.lastRunCheckpoint?.available === true
      && !task.lastRunCheckpoint.restoredAt;

    if (runs === 0) continue;
    if (runs > 1) {
      issues.push(`historical_run_metrics_unavailable:${task.id}`);
    }
    const metrics = task.lastRunMetrics;
    if (!metrics) {
      issues.push(`run_metrics_missing:${task.id}`);
      continue;
    }
    modelRequests += nonNegativeInteger(metrics.iterations, `metrics.iterations:${task.id}`);
    inputTokens += nonNegativeInteger(metrics.totalInputTokens, `metrics.totalInputTokens:${task.id}`);
    outputTokens += nonNegativeInteger(metrics.totalOutputTokens, `metrics.totalOutputTokens:${task.id}`);
    toolCalls += nonNegativeInteger(metrics.toolCalls, `metrics.toolCalls:${task.id}`);
  }

  return {
    schemaVersion: 1,
    workflowId: workflow.workflowId,
    capturedAt: now.toISOString(),
    accountingComplete: issues.length === 0,
    accountingIssues: issues,
    elapsedMs,
    modelRequests,
    inputTokens,
    outputTokens,
    toolCalls,
    taskRuns,
    recoveries,
    validationRepairs,
    checkpointAvailableByTaskId,
  };
}

const BUDGET_VALUES: Array<{
  dimension: UnattendedBudgetDimension;
  usage: keyof UnattendedBudgetUsageV1;
  limit: keyof UnattendedExecutionBudgetV1;
}> = [
  { dimension: "elapsed_ms", usage: "elapsedMs", limit: "maxElapsedMs" },
  { dimension: "model_requests", usage: "modelRequests", limit: "maxModelRequests" },
  { dimension: "input_tokens", usage: "inputTokens", limit: "maxInputTokens" },
  { dimension: "output_tokens", usage: "outputTokens", limit: "maxOutputTokens" },
  { dimension: "tool_calls", usage: "toolCalls", limit: "maxToolCalls" },
  { dimension: "task_runs", usage: "taskRuns", limit: "maxTaskRuns" },
  { dimension: "recoveries", usage: "recoveries", limit: "maxRecoveries" },
  { dimension: "validation_repairs", usage: "validationRepairs", limit: "maxValidationRepairs" },
];

export function evaluateUnattendedStartGuard(
  workflow: UnattendedWorkflowV1,
  taskId: string,
  usage: UnattendedBudgetUsageV1,
  budget: UnattendedExecutionBudgetV1,
  options: {
    starterCheckpointMode: "existing_task_pre_run" | "unknown";
    projectedAdditionalRuns?: number;
  },
): UnattendedStartGuardResult {
  validateUnattendedExecutionBudget(budget);
  if (usage.workflowId !== workflow.workflowId) {
    throw new UnattendedBudgetError(
      "Budget usage does not belong to the requested workflow",
      "workflow_mismatch",
    );
  }
  const node = workflow.nodes.find((item) => item.taskId === taskId);
  if (!node) {
    throw new UnattendedBudgetError("Candidate task is not part of the workflow", "workflow_mismatch");
  }

  if (!usage.accountingComplete) {
    return {
      allowed: false,
      reason: "accounting_incomplete",
      exhausted: [],
      accountingIssues: [...usage.accountingIssues],
    };
  }

  if (options.starterCheckpointMode !== "existing_task_pre_run") {
    return {
      allowed: false,
      reason: "starter_checkpoint_mode_untrusted",
      exhausted: [],
      accountingIssues: [],
    };
  }

  if (budget.checkpointPolicy.requireCompletedDependencyCheckpoint) {
    for (const dependencyTaskId of node.dependsOnTaskIds) {
      if (usage.checkpointAvailableByTaskId[dependencyTaskId] !== true) {
        return {
          allowed: false,
          reason: "checkpoint_policy_failed",
          exhausted: [],
          accountingIssues: [],
          dependencyTaskId,
        };
      }
    }
  }

  const projectedRuns = Math.max(0, Math.floor(options.projectedAdditionalRuns ?? 1));
  const exhausted: UnattendedBudgetDimension[] = [];
  for (const item of BUDGET_VALUES) {
    const rawUsage = usage[item.usage];
    const rawLimit = budget[item.limit];
    if (typeof rawUsage !== "number" || typeof rawLimit !== "number") continue;
    const value = item.dimension === "task_runs" ? rawUsage + projectedRuns : rawUsage;
    if (value >= rawLimit) exhausted.push(item.dimension);
  }

  if (exhausted.length > 0) {
    return {
      allowed: false,
      reason: "budget_exhausted",
      exhausted,
      accountingIssues: [],
    };
  }

  return {
    allowed: true,
    reason: "within_budget",
    exhausted: [],
    accountingIssues: [],
  };
}
