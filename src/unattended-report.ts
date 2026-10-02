import type { UnattendedBudgetDecisionV1 } from "./unattended-budget-store.js";
import type { SentinelIncidentV1 } from "./sentinel.js";
import type { OrchestratorTask, TaskStatus } from "./types.js";
import type { UnattendedWorkflowV1 } from "./unattended-workflow.js";

export type UnattendedWorkflowReportStatus =
  | "ready"
  | "active"
  | "waiting_for_human"
  | "blocked"
  | "budget_blocked"
  | "completed";

export type UnattendedWorkflowAttentionKind =
  | "human_escalation"
  | "terminal_task_failure"
  | "completion_evidence_missing"
  | "budget_denied"
  | "task_state_missing";

export interface UnattendedWorkflowNodeReportV1 {
  nodeId: string;
  taskId: string;
  status: TaskStatus | "missing";
  dependencyCount: number;
  validationRequired: boolean;
  validationPassed?: boolean;
  diffSafetyPassed?: boolean;
  checkpointAvailable: boolean;
  humanEscalationPending: boolean;
}

export interface UnattendedWorkflowReportV1 {
  schemaVersion: 1;
  workflowId: string;
  generatedAt: string;
  status: UnattendedWorkflowReportStatus;
  final: boolean;
  counts: {
    totalNodes: number;
    created: number;
    active: number;
    completed: number;
    waitingForHuman: number;
    terminalNonSuccess: number;
  };
  nodes: UnattendedWorkflowNodeReportV1[];
  attention: Array<{
    kind: UnattendedWorkflowAttentionKind;
    taskId?: string;
    budgetReason?: UnattendedBudgetDecisionV1["reason"];
    exhausted?: string[];
  }>;
  budget: {
    decisions: number;
    latestDeniedReason?: UnattendedBudgetDecisionV1["reason"];
    latestDeniedExhausted?: string[];
  };
  incidents: {
    open: number;
    critical: number;
    humanActionRequired: number;
  };
}

const ACTIVE = new Set<TaskStatus>([
  "running",
  "waiting",
  "stalled",
  "validating",
  "repairing",
  "safety_checking",
]);
const TERMINAL_NON_SUCCESS = new Set<TaskStatus>([
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

function nodeReport(
  node: UnattendedWorkflowV1["nodes"][number],
  task: OrchestratorTask | undefined,
): UnattendedWorkflowNodeReportV1 {
  if (!task) {
    return {
      nodeId: node.nodeId,
      taskId: node.taskId,
      status: "missing",
      dependencyCount: node.dependsOnTaskIds.length,
      validationRequired: node.validationRequired,
      checkpointAvailable: false,
      humanEscalationPending: false,
    };
  }
  return {
    nodeId: node.nodeId,
    taskId: node.taskId,
    status: task.status,
    dependencyCount: node.dependsOnTaskIds.length,
    validationRequired: node.validationRequired,
    validationPassed: task.lastValidation?.passed,
    diffSafetyPassed: task.lastDiffSafety?.passed,
    checkpointAvailable: task.lastRunCheckpoint?.available === true
      && !task.lastRunCheckpoint.restoredAt,
    humanEscalationPending: task.status === "waiting_for_human"
      || task.pendingEscalation?.status === "pending",
  };
}

/**
 * Builds a bounded report from durable state only. It deliberately excludes task
 * goals, workspace paths, validation stdout/stderr, model output, session IDs,
 * credentials, incident summaries, and checkpoint storage references.
 */
export function buildUnattendedWorkflowReport(
  workflow: UnattendedWorkflowV1,
  tasks: OrchestratorTask[],
  options: {
    budgetDecisions?: UnattendedBudgetDecisionV1[];
    incidents?: SentinelIncidentV1[];
    now?: Date;
  } = {},
): UnattendedWorkflowReportV1 {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const nodes = workflow.nodes.map((node) => nodeReport(node, byId.get(node.taskId)));
  const attention: UnattendedWorkflowReportV1["attention"] = [];

  let created = 0;
  let active = 0;
  let completed = 0;
  let waitingForHuman = 0;
  let terminalNonSuccess = 0;
  let missingCompletionEvidence = false;

  for (const node of nodes) {
    if (node.status === "missing") {
      attention.push({ kind: "task_state_missing", taskId: node.taskId });
      continue;
    }
    if (node.status === "created") created += 1;
    if (ACTIVE.has(node.status)) active += 1;
    if (node.humanEscalationPending) {
      waitingForHuman += 1;
      attention.push({ kind: "human_escalation", taskId: node.taskId });
    }
    if (TERMINAL_NON_SUCCESS.has(node.status)) {
      terminalNonSuccess += 1;
      attention.push({ kind: "terminal_task_failure", taskId: node.taskId });
    }
    if (node.status === "completed") {
      const validationOk = !node.validationRequired || node.validationPassed === true;
      const diffOk = node.diffSafetyPassed === true;
      if (validationOk && diffOk) completed += 1;
      else {
        missingCompletionEvidence = true;
        attention.push({ kind: "completion_evidence_missing", taskId: node.taskId });
      }
    }
  }

  const budgetDecisions = options.budgetDecisions ?? [];
  const latestDenied = [...budgetDecisions].reverse().find((decision) => !decision.allowed);
  if (latestDenied) {
    attention.push({
      kind: "budget_denied",
      taskId: latestDenied.taskId,
      budgetReason: latestDenied.reason,
      exhausted: latestDenied.exhausted.slice(0, 16),
    });
  }

  const incidents = options.incidents ?? [];
  const openIncidents = incidents.filter((incident) => incident.status === "open");
  const allSuccessful = completed === workflow.nodes.length;
  const hasMissingTask = nodes.some((node) => node.status === "missing");

  let status: UnattendedWorkflowReportStatus;
  if (allSuccessful) status = "completed";
  else if (waitingForHuman > 0) status = "waiting_for_human";
  else if (terminalNonSuccess > 0 || missingCompletionEvidence || hasMissingTask) status = "blocked";
  else if (active > 0) status = "active";
  else if (latestDenied) status = "budget_blocked";
  else status = "ready";

  return {
    schemaVersion: 1,
    workflowId: workflow.workflowId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    status,
    final: status === "completed" || status === "blocked",
    counts: {
      totalNodes: workflow.nodes.length,
      created,
      active,
      completed,
      waitingForHuman,
      terminalNonSuccess,
    },
    nodes,
    attention: attention.slice(0, 200),
    budget: {
      decisions: budgetDecisions.length,
      latestDeniedReason: latestDenied?.reason,
      latestDeniedExhausted: latestDenied?.exhausted.slice(0, 16),
    },
    incidents: {
      open: openIncidents.length,
      critical: openIncidents.filter((incident) => incident.severity === "critical").length,
      humanActionRequired: openIncidents.filter((incident) => incident.humanActionRequired).length,
    },
  };
}
