import type { UnattendedExecutionBudgetV1 } from "./unattended-budget.js";
import { UnattendedBudgetDecisionStore } from "./unattended-budget-store.js";
import {
  advanceUnattendedWorkflowWithBudget,
  type BudgetedUnattendedTaskStarter,
} from "./unattended-budgeted-coordinator.js";
import { buildUnattendedWorkflowReport, type UnattendedWorkflowReportV1 } from "./unattended-report.js";
import type { SentinelIncidentV1 } from "./sentinel.js";
import type { OrchestratorTask } from "./types.js";
import {
  selectRunnableWorkflowNodes,
  type WorkflowTaskEvidence,
} from "./unattended-workflow.js";
import { UnattendedWorkflowStore } from "./unattended-workflow-store.js";

export interface UnattendedResumeTaskReader {
  loadTask(taskId: string): Promise<OrchestratorTask>;
}

export interface UnattendedResumeResult {
  workflowId: string;
  report: UnattendedWorkflowReportV1;
  startedTaskId?: string;
  action:
    | "started"
    | "no_runnable_task"
    | "already_active"
    | "waiting_for_human"
    | "workflow_blocked"
    | "workflow_completed"
    | "budget_or_checkpoint_blocked";
}

export class UnattendedResumeError extends Error {
  constructor(
    message: string,
    public readonly code: "expected_task_changed",
  ) {
    super(message);
    this.name = "UnattendedResumeError";
  }
}

function evidenceForTask(task: OrchestratorTask, validationRequired: boolean): WorkflowTaskEvidence {
  return {
    taskId: task.id,
    status: task.status,
    validationPassed: validationRequired ? task.lastValidation?.passed : true,
    diffSafetyPassed: task.lastDiffSafety?.passed,
    pendingHumanEscalation: task.status === "waiting_for_human"
      || task.pendingEscalation?.status === "pending",
  };
}

/**
 * Restart-safe reconciliation for one immutable workflow. It never trusts stored
 * workflow position. Every call reloads all current task states, rebuilds evidence
 * and budgets, and starts only a node that is still `created` after all gates.
 *
 * When expectedTaskId is supplied, the caller is pinning a prior read/preview to
 * the exact next runnable node. A different current candidate fails closed before
 * budget accounting or any starter invocation. The injected starter must still
 * independently revalidate current task authority immediately before execution.
 */
export async function resumeUnattendedWorkflow(
  workflowId: string,
  options: {
    workflowStore: UnattendedWorkflowStore;
    budgetDecisionStore: UnattendedBudgetDecisionStore;
    taskReader: UnattendedResumeTaskReader;
    budget: UnattendedExecutionBudgetV1;
    starter: BudgetedUnattendedTaskStarter;
    expectedTaskId?: string;
    incidents?: SentinelIncidentV1[];
    now?: Date;
  },
): Promise<UnattendedResumeResult> {
  const workflow = await options.workflowStore.load(workflowId);
  const tasks = await Promise.all(
    workflow.nodes.map((node) => options.taskReader.loadTask(node.taskId)),
  );
  const decisions = await options.budgetDecisionStore.list(workflow.workflowId);
  const report = buildUnattendedWorkflowReport(workflow, tasks, {
    budgetDecisions: decisions,
    incidents: options.incidents,
    now: options.now,
  });

  if (report.status === "completed") {
    return { workflowId, report, action: "workflow_completed" };
  }
  if (report.status === "waiting_for_human") {
    return { workflowId, report, action: "waiting_for_human" };
  }
  if (report.status === "blocked") {
    return { workflowId, report, action: "workflow_blocked" };
  }
  if (report.status === "active") {
    return { workflowId, report, action: "already_active" };
  }

  const evidence = workflow.nodes.map((node) => {
    const task = tasks.find((item) => item.id === node.taskId)!;
    return evidenceForTask(task, node.validationRequired);
  });

  if (options.expectedTaskId) {
    const currentCandidate = selectRunnableWorkflowNodes(workflow, evidence).runnable[0]?.taskId;
    if (currentCandidate !== options.expectedTaskId) {
      throw new UnattendedResumeError(
        "Workflow runnable task changed after it was previewed",
        "expected_task_changed",
      );
    }
  }

  const advanced = await advanceUnattendedWorkflowWithBudget(
    workflow,
    evidence,
    tasks,
    options.budget,
    options.starter,
    {
      now: options.now,
      decisionStore: options.budgetDecisionStore,
    },
  );

  if (advanced.startedTaskId) {
    return {
      workflowId,
      report,
      startedTaskId: advanced.startedTaskId,
      action: "started",
    };
  }
  if (advanced.guard && !advanced.guard.allowed) {
    const refreshedDecisions = await options.budgetDecisionStore.list(workflow.workflowId);
    return {
      workflowId,
      report: buildUnattendedWorkflowReport(workflow, tasks, {
        budgetDecisions: refreshedDecisions,
        incidents: options.incidents,
        now: options.now,
      }),
      action: "budget_or_checkpoint_blocked",
    };
  }
  return { workflowId, report, action: "no_runnable_task" };
}
