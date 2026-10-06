import crypto from "node:crypto";
import type { OrchestratorTask, TaskStatus } from "./types.js";

const MAX_WORKFLOW_NODES = 100;
const MAX_DEPENDENCIES_PER_NODE = 50;

export const UNATTENDED_WORKFLOW_LIMITS = Object.freeze({
  maxNodes: MAX_WORKFLOW_NODES,
  maxDependenciesPerNode: MAX_DEPENDENCIES_PER_NODE,
});

type ApprovedTask = OrchestratorTask & {
  projectId?: string;
  workspaceId?: string;
  safetyPlanId?: string;
  safetyProfileId?: string;
  safetyProfileRevision?: number;
  workerProfileId?: string;
};

export interface UnattendedWorkflowNodeV1 {
  nodeId: string;
  order: number;
  taskId: string;
  projectId: string;
  workspaceId: string;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  validationRequired: boolean;
  dependsOnTaskIds: string[];
}

export interface UnattendedWorkflowV1 {
  schemaVersion: 1;
  workflowId: string;
  createdAt: string;
  nodes: UnattendedWorkflowNodeV1[];
}

export interface UnattendedWorkflowNodeInput {
  task: OrchestratorTask;
  dependsOnTaskIds?: string[];
}

export interface UnattendedWorkflowCreateOptions {
  now?: () => Date;
  idFactory?: () => string;
  nodeIdFactory?: () => string;
}

export interface WorkflowTaskEvidence {
  taskId: string;
  status: TaskStatus;
  validationPassed?: boolean;
  diffSafetyPassed?: boolean;
  pendingHumanEscalation?: boolean;
}

export type WorkflowNodeBlockReason =
  | "task_evidence_missing"
  | "task_already_active"
  | "task_terminal_non_success"
  | "task_waiting_for_human"
  | "dependency_not_completed"
  | "dependency_validation_not_passed"
  | "dependency_diff_safety_not_passed"
  | "dependency_waiting_for_human";

export interface WorkflowNodeSelection {
  runnable: UnattendedWorkflowNodeV1[];
  blocked: Array<{
    node: UnattendedWorkflowNodeV1;
    reason: WorkflowNodeBlockReason;
    dependencyTaskId?: string;
  }>;
}

export class UnattendedWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "workflow_invalid"
      | "task_not_approved"
      | "cycle_detected",
  ) {
    super(message);
    this.name = "UnattendedWorkflowError";
  }
}

function opaqueId(value: unknown, field: string, code: UnattendedWorkflowError["code"]): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new UnattendedWorkflowError(`${field} must be an opaque UUID`, code);
  }
  return value;
}

function approvedText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("\0")) {
    throw new UnattendedWorkflowError(`${field} is missing or invalid`, "task_not_approved");
  }
  return value.trim();
}

function approvedRevision(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new UnattendedWorkflowError(`${field} must be a positive integer`, "task_not_approved");
  }
  return value as number;
}

function bindNode(
  input: UnattendedWorkflowNodeInput,
  order: number,
  nodeIdFactory: () => string,
): UnattendedWorkflowNodeV1 {
  const task = input.task as ApprovedTask;
  return {
    nodeId: opaqueId(nodeIdFactory(), "nodeId", "workflow_invalid"),
    order,
    taskId: opaqueId(task.id, "taskId", "task_not_approved"),
    projectId: opaqueId(task.projectId, "projectId", "task_not_approved"),
    workspaceId: opaqueId(task.workspaceId, "workspaceId", "task_not_approved"),
    safetyPlanId: opaqueId(task.safetyPlanId, "safetyPlanId", "task_not_approved"),
    safetyProfileId: opaqueId(task.safetyProfileId, "safetyProfileId", "task_not_approved"),
    safetyProfileRevision: approvedRevision(task.safetyProfileRevision, "safetyProfileRevision"),
    workerProfileId: approvedText(task.workerProfileId, "workerProfileId"),
    validationRequired: (task.validationCommands?.length ?? 0) > 0,
    dependsOnTaskIds: [...(input.dependsOnTaskIds ?? [])],
  };
}

function validateGraph(nodes: UnattendedWorkflowNodeV1[]): void {
  const byTask = new Map<string, UnattendedWorkflowNodeV1>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (byTask.has(node.taskId)) {
      throw new UnattendedWorkflowError(`Task ${node.taskId} appears more than once in the workflow`, "workflow_invalid");
    }
    if (nodeIds.has(node.nodeId)) {
      throw new UnattendedWorkflowError(`Duplicate workflow nodeId ${node.nodeId}`, "workflow_invalid");
    }
    byTask.set(node.taskId, node);
    nodeIds.add(node.nodeId);

    if (node.dependsOnTaskIds.length > MAX_DEPENDENCIES_PER_NODE) {
      throw new UnattendedWorkflowError(
        `Task ${node.taskId} exceeds ${MAX_DEPENDENCIES_PER_NODE} dependencies`,
        "workflow_invalid",
      );
    }
    if (new Set(node.dependsOnTaskIds).size !== node.dependsOnTaskIds.length) {
      throw new UnattendedWorkflowError(`Task ${node.taskId} has duplicate dependencies`, "workflow_invalid");
    }
    if (node.dependsOnTaskIds.includes(node.taskId)) {
      throw new UnattendedWorkflowError(`Task ${node.taskId} cannot depend on itself`, "cycle_detected");
    }
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOnTaskIds) {
      opaqueId(dependency, "dependsOnTaskId", "workflow_invalid");
      if (!byTask.has(dependency)) {
        throw new UnattendedWorkflowError(
          `Task ${node.taskId} depends on task ${dependency}, which is not in the workflow`,
          "workflow_invalid",
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      throw new UnattendedWorkflowError(`Workflow dependency cycle includes task ${taskId}`, "cycle_detected");
    }
    visiting.add(taskId);
    const node = byTask.get(taskId)!;
    for (const dependency of node.dependsOnTaskIds) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const node of nodes) visit(node.taskId);
}

/**
 * Creates a workflow from already-approved durable tasks. The workflow stores no
 * filesystem scope or executable capability: those remain owned by each task's
 * Safety Plan binding. Dependency edges therefore coordinate ordering only.
 */
export function createUnattendedWorkflow(
  inputs: UnattendedWorkflowNodeInput[],
  options: UnattendedWorkflowCreateOptions = {},
): UnattendedWorkflowV1 {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new UnattendedWorkflowError("Workflow requires at least one node", "workflow_invalid");
  }
  if (inputs.length > MAX_WORKFLOW_NODES) {
    throw new UnattendedWorkflowError(
      `Workflow supports at most ${MAX_WORKFLOW_NODES} nodes`,
      "workflow_invalid",
    );
  }

  const nodeIdFactory = options.nodeIdFactory ?? (() => crypto.randomUUID());
  const nodes = inputs.map((input, index) => bindNode(input, index, nodeIdFactory));
  validateGraph(nodes);

  return {
    schemaVersion: 1,
    workflowId: opaqueId(
      (options.idFactory ?? (() => crypto.randomUUID()))(),
      "workflowId",
      "workflow_invalid",
    ),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    nodes,
  };
}

function successfulDependency(
  node: UnattendedWorkflowNodeV1,
  evidence: WorkflowTaskEvidence,
): WorkflowNodeBlockReason | undefined {
  if (evidence.pendingHumanEscalation || evidence.status === "waiting_for_human") {
    return "dependency_waiting_for_human";
  }
  if (evidence.status !== "completed") return "dependency_not_completed";
  if (node.validationRequired && evidence.validationPassed !== true) {
    return "dependency_validation_not_passed";
  }
  if (evidence.diffSafetyPassed !== true) return "dependency_diff_safety_not_passed";
  return undefined;
}

/**
 * Selects nodes whose own durable task is still `created` and whose dependencies
 * have completed with required validation + diff-safety evidence. Ordering is the
 * persisted node declaration order, making selection deterministic across restarts.
 */
export function selectRunnableWorkflowNodes(
  workflow: UnattendedWorkflowV1,
  evidenceValues: WorkflowTaskEvidence[],
): WorkflowNodeSelection {
  if (workflow.schemaVersion !== 1) {
    throw new UnattendedWorkflowError("Unsupported workflow schema", "workflow_invalid");
  }
  validateGraph(workflow.nodes);

  const evidence = new Map(evidenceValues.map((item) => [item.taskId, item]));
  const nodesByTask = new Map(workflow.nodes.map((node) => [node.taskId, node]));
  const runnable: UnattendedWorkflowNodeV1[] = [];
  const blocked: WorkflowNodeSelection["blocked"] = [];

  for (const node of [...workflow.nodes].sort((a, b) => a.order - b.order)) {
    const own = evidence.get(node.taskId);
    if (!own) {
      blocked.push({ node, reason: "task_evidence_missing" });
      continue;
    }
    if (own.pendingHumanEscalation || own.status === "waiting_for_human") {
      blocked.push({ node, reason: "task_waiting_for_human" });
      continue;
    }
    if (["running", "waiting", "stalled", "validating", "repairing", "safety_checking"].includes(own.status)) {
      blocked.push({ node, reason: "task_already_active" });
      continue;
    }
    if (own.status !== "created") {
      blocked.push({ node, reason: "task_terminal_non_success" });
      continue;
    }

    let dependencyBlock: WorkflowNodeSelection["blocked"][number] | undefined;
    for (const dependencyTaskId of node.dependsOnTaskIds) {
      const dependencyEvidence = evidence.get(dependencyTaskId);
      if (!dependencyEvidence) {
        dependencyBlock = { node, reason: "dependency_not_completed", dependencyTaskId };
        break;
      }
      const dependencyNode = nodesByTask.get(dependencyTaskId)!;
      const reason = successfulDependency(dependencyNode, dependencyEvidence);
      if (reason) {
        dependencyBlock = { node, reason, dependencyTaskId };
        break;
      }
    }

    if (dependencyBlock) blocked.push(dependencyBlock);
    else runnable.push(node);
  }

  return { runnable, blocked };
}
