import {
  selectRunnableWorkflowNodes,
  type UnattendedWorkflowV1,
  type WorkflowTaskEvidence,
} from "./unattended-workflow.js";

export interface UnattendedTaskStarter {
  startApprovedTask(taskId: string): Promise<void>;
}

export interface WorkflowAdvanceResult {
  workflowId: string;
  runnableTaskIds: string[];
  startedTaskIds: string[];
  blockedTaskIds: string[];
}

/**
 * Advances already-approved workflow tasks in deterministic order. The coordinator
 * carries no workspace path, scope, Safety Plan mutation, shell, provider, or Hub
 * authority. It can only hand an opaque task ID to an injected starter, which must
 * independently enforce the task's existing durable authority before execution.
 */
export async function advanceUnattendedWorkflow(
  workflow: UnattendedWorkflowV1,
  evidence: WorkflowTaskEvidence[],
  starter: UnattendedTaskStarter,
  options: { maxStarts?: number } = {},
): Promise<WorkflowAdvanceResult> {
  const maxStarts = Math.max(0, Math.min(100, options.maxStarts ?? 1));
  const selection = selectRunnableWorkflowNodes(workflow, evidence);
  const startedTaskIds: string[] = [];

  for (const node of selection.runnable.slice(0, maxStarts)) {
    await starter.startApprovedTask(node.taskId);
    startedTaskIds.push(node.taskId);
  }

  return {
    workflowId: workflow.workflowId,
    runnableTaskIds: selection.runnable.map((node) => node.taskId),
    startedTaskIds,
    blockedTaskIds: selection.blocked.map((item) => item.node.taskId),
  };
}
