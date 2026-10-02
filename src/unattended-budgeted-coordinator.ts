import {
  buildUnattendedBudgetUsage,
  evaluateUnattendedStartGuard,
  type UnattendedExecutionBudgetV1,
  type UnattendedStartGuardResult,
} from "./unattended-budget.js";
import { UnattendedBudgetDecisionStore } from "./unattended-budget-store.js";
import {
  selectRunnableWorkflowNodes,
  type UnattendedWorkflowV1,
  type WorkflowTaskEvidence,
} from "./unattended-workflow.js";
import type { OrchestratorTask } from "./types.js";

export interface BudgetedUnattendedTaskStarter {
  readonly checkpointMode: "existing_task_pre_run";
  startApprovedTask(taskId: string): Promise<void>;
}

export interface BudgetedWorkflowAdvanceResult {
  workflowId: string;
  candidateTaskId?: string;
  startedTaskId?: string;
  guard?: UnattendedStartGuardResult;
  runnableTaskIds: string[];
}

/**
 * Starts at most one unattended task per durable accounting pass. This prevents
 * multiple starts from racing ahead using the same stale token/tool/run totals.
 */
export async function advanceUnattendedWorkflowWithBudget(
  workflow: UnattendedWorkflowV1,
  evidence: WorkflowTaskEvidence[],
  durableTasks: OrchestratorTask[],
  budget: UnattendedExecutionBudgetV1,
  starter: BudgetedUnattendedTaskStarter,
  options: {
    now?: Date;
    decisionStore?: UnattendedBudgetDecisionStore;
  } = {},
): Promise<BudgetedWorkflowAdvanceResult> {
  const selection = selectRunnableWorkflowNodes(workflow, evidence);
  const candidate = selection.runnable[0];
  if (!candidate) {
    return {
      workflowId: workflow.workflowId,
      runnableTaskIds: [],
    };
  }

  const usage = buildUnattendedBudgetUsage(
    workflow,
    durableTasks,
    options.now ?? new Date(),
  );
  const guard = evaluateUnattendedStartGuard(
    workflow,
    candidate.taskId,
    usage,
    budget,
    {
      starterCheckpointMode: starter.checkpointMode,
      projectedAdditionalRuns: 1,
    },
  );

  await options.decisionStore?.append(workflow.workflowId, candidate.taskId, guard);
  if (!guard.allowed) {
    return {
      workflowId: workflow.workflowId,
      candidateTaskId: candidate.taskId,
      guard,
      runnableTaskIds: selection.runnable.map((node) => node.taskId),
    };
  }

  await starter.startApprovedTask(candidate.taskId);
  return {
    workflowId: workflow.workflowId,
    candidateTaskId: candidate.taskId,
    startedTaskId: candidate.taskId,
    guard,
    runnableTaskIds: selection.runnable.map((node) => node.taskId),
  };
}
