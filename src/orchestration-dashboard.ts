import type { PublicTaskView } from "./machine-orchestrator.js";
import type { SentinelIncidentV1 } from "./sentinel.js";
import type { UnattendedWorkflowReportV1 } from "./unattended-report.js";
import type { RegisteredProject, WorkspaceDiscoveryRecord } from "./workspace-registry.js";

const MAX_PROJECTS = 50;
const MAX_WORKSPACES = 100;
const MAX_TASKS = 200;
const MAX_WORKFLOWS = 100;
const MAX_INCIDENTS = 100;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export const ORCHESTRATION_DASHBOARD_LIMITS = Object.freeze({
  maxProjects: MAX_PROJECTS,
  maxWorkspaces: MAX_WORKSPACES,
  maxTasks: MAX_TASKS,
  maxWorkflows: MAX_WORKFLOWS,
  maxIncidents: MAX_INCIDENTS,
  defaultStaleAfterMs: DEFAULT_STALE_AFTER_MS,
});

export interface DashboardSourceMetaInput {
  capturedAt?: string;
  available?: boolean;
  errorCode?: string;
}

export interface DashboardSourceMeta {
  capturedAt?: string;
  available: boolean;
  stale: boolean;
  errorCode?: string;
  truncated: boolean;
  total: number;
  returned: number;
}

export interface DashboardSupervisorSummaryInput {
  capturedAt?: string;
  available?: boolean;
  errorCode?: string;
  plannerProposals: number;
  reviewerPasses: number;
  reviewerRepairs: number;
  reviewerEscalations: number;
  pendingHumanEscalations: number;
}

export interface OrchestrationDashboardInput {
  projects: RegisteredProject[];
  projectsMeta?: DashboardSourceMetaInput;
  workspaces: WorkspaceDiscoveryRecord[];
  workspacesMeta?: DashboardSourceMetaInput;
  tasks: PublicTaskView[];
  tasksMeta?: DashboardSourceMetaInput;
  workflows: UnattendedWorkflowReportV1[];
  workflowsMeta?: DashboardSourceMetaInput;
  incidents: SentinelIncidentV1[];
  incidentsMeta?: DashboardSourceMetaInput;
  supervisor: DashboardSupervisorSummaryInput;
}

export interface OrchestrationDashboardV1 {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  sources: {
    projects: DashboardSourceMeta;
    workspaces: DashboardSourceMeta;
    tasks: DashboardSourceMeta;
    workflows: DashboardSourceMeta;
    incidents: DashboardSourceMeta;
    supervisor: DashboardSourceMeta;
  };
  projects: Array<{
    projectId: string;
    displayName: string;
    updatedAt: string;
  }>;
  workspaces: Array<{
    workspaceId: string;
    projectId: string;
    displayName: string;
    rootAlias: string;
    revision: number;
    safetyProfileRevision: number;
    policyVersion: string;
  }>;
  tasks: Array<{
    taskId: string;
    projectId: string;
    workspaceId: string;
    status: PublicTaskView["status"];
    updatedAt: string;
    runCount: number;
    recoveryCount: number;
    validationPassed?: boolean;
    diffSafetyPassed?: boolean;
    waitingForHuman: boolean;
  }>;
  workflows: Array<{
    workflowId: string;
    status: UnattendedWorkflowReportV1["status"];
    final: boolean;
    generatedAt: string;
    totalNodes: number;
    completedNodes: number;
    activeNodes: number;
    waitingForHuman: number;
    terminalNonSuccess: number;
    latestBudgetDeniedReason?: string;
    openIncidents: number;
    criticalIncidents: number;
  }>;
  incidents: Array<{
    incidentId: string;
    workspaceId: string;
    kind: SentinelIncidentV1["kind"];
    severity: SentinelIncidentV1["severity"];
    status: SentinelIncidentV1["status"];
    firstSeenAt: string;
    lastSeenAt: string;
    occurrenceCount: number;
    humanActionRequired: boolean;
    failClosed: boolean;
  }>;
  supervisor: {
    plannerProposals: number;
    reviewerPasses: number;
    reviewerRepairs: number;
    reviewerEscalations: number;
    pendingHumanEscalations: number;
  };
  totals: {
    projects: number;
    workspaces: number;
    tasks: number;
    activeTasks: number;
    waitingForHumanTasks: number;
    workflows: number;
    activeWorkflows: number;
    blockedWorkflows: number;
    openIncidents: number;
    criticalIncidents: number;
  };
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeErrorCode(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(normalized)
    ? normalized
    : "source_error";
}

function sourceMeta(
  meta: DashboardSourceMetaInput | undefined,
  total: number,
  returned: number,
  nowMs: number,
  staleAfterMs: number,
): DashboardSourceMeta {
  const available = meta?.available !== false;
  const capturedMs = meta?.capturedAt ? Date.parse(meta.capturedAt) : Number.NaN;
  const stale = !available
    || !Number.isFinite(capturedMs)
    || capturedMs > nowMs
    || nowMs - capturedMs > staleAfterMs;
  return {
    capturedAt: meta?.capturedAt,
    available,
    stale,
    errorCode: safeErrorCode(meta?.errorCode),
    truncated: total > returned,
    total,
    returned,
  };
}

function sortedBounded<T>(
  values: T[],
  limit: number,
  key: (value: T) => string,
): T[] {
  return [...values].sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit);
}

/**
 * Composes already-sanitized orchestration evidence into a read-only dashboard
 * snapshot. This function deliberately does not accept workspace roots, raw task
 * objects, events, validation output, model output, Hub/session state, credentials,
 * diff contents, checkpoint refs, or mutation callbacks.
 */
export function buildOrchestrationDashboard(
  input: OrchestrationDashboardInput,
  options: { now?: Date; staleAfterMs?: number } = {},
): OrchestrationDashboardV1 {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const staleAfterMs = Math.max(1, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);

  const projects = sortedBounded(input.projects, MAX_PROJECTS, (item) => item.projectId);
  const workspaces = sortedBounded(input.workspaces, MAX_WORKSPACES, (item) => item.workspaceId);
  const tasks = [...input.tasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.taskId.localeCompare(b.taskId))
    .slice(0, MAX_TASKS);
  const workflows = [...input.workflows]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.workflowId.localeCompare(b.workflowId))
    .slice(0, MAX_WORKFLOWS);
  const incidents = [...input.incidents]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.incidentId.localeCompare(b.incidentId))
    .slice(0, MAX_INCIDENTS);

  const taskViews = tasks.map((task) => ({
    taskId: task.taskId,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    status: task.status,
    updatedAt: task.updatedAt,
    runCount: task.runCount,
    recoveryCount: task.recoveryCount,
    validationPassed: task.validation.lastPassed,
    diffSafetyPassed: task.diffSafety?.passed,
    waitingForHuman: task.status === "waiting_for_human" || task.pendingEscalation?.status === "pending",
  }));

  const workflowViews = workflows.map((workflow) => ({
    workflowId: workflow.workflowId,
    status: workflow.status,
    final: workflow.final,
    generatedAt: workflow.generatedAt,
    totalNodes: workflow.counts.totalNodes,
    completedNodes: workflow.counts.completed,
    activeNodes: workflow.counts.active,
    waitingForHuman: workflow.counts.waitingForHuman,
    terminalNonSuccess: workflow.counts.terminalNonSuccess,
    latestBudgetDeniedReason: workflow.budget.latestDeniedReason,
    openIncidents: workflow.incidents.open,
    criticalIncidents: workflow.incidents.critical,
  }));

  const incidentViews = incidents.map((incident) => ({
    incidentId: incident.incidentId,
    workspaceId: incident.workspaceId,
    kind: incident.kind,
    severity: incident.severity,
    status: incident.status,
    firstSeenAt: incident.firstSeenAt,
    lastSeenAt: incident.lastSeenAt,
    occurrenceCount: incident.occurrenceCount,
    humanActionRequired: incident.humanActionRequired,
    failClosed: incident.failClosed,
  }));

  const supervisor = {
    plannerProposals: safeCount(input.supervisor.plannerProposals),
    reviewerPasses: safeCount(input.supervisor.reviewerPasses),
    reviewerRepairs: safeCount(input.supervisor.reviewerRepairs),
    reviewerEscalations: safeCount(input.supervisor.reviewerEscalations),
    pendingHumanEscalations: safeCount(input.supervisor.pendingHumanEscalations),
  };

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    readOnly: true,
    sources: {
      projects: sourceMeta(input.projectsMeta, input.projects.length, projects.length, nowMs, staleAfterMs),
      workspaces: sourceMeta(input.workspacesMeta, input.workspaces.length, workspaces.length, nowMs, staleAfterMs),
      tasks: sourceMeta(input.tasksMeta, input.tasks.length, tasks.length, nowMs, staleAfterMs),
      workflows: sourceMeta(input.workflowsMeta, input.workflows.length, workflows.length, nowMs, staleAfterMs),
      incidents: sourceMeta(input.incidentsMeta, input.incidents.length, incidents.length, nowMs, staleAfterMs),
      supervisor: sourceMeta(input.supervisor, 1, 1, nowMs, staleAfterMs),
    },
    projects: projects.map((project) => ({
      projectId: project.projectId,
      displayName: project.displayName.slice(0, 200),
      updatedAt: project.updatedAt,
    })),
    workspaces: workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      displayName: workspace.displayName.slice(0, 200),
      rootAlias: workspace.rootAlias.slice(0, 200),
      revision: workspace.revision,
      safetyProfileRevision: workspace.safetyProfileRevision,
      policyVersion: workspace.policyVersion.slice(0, 200),
    })),
    tasks: taskViews,
    workflows: workflowViews,
    incidents: incidentViews,
    supervisor,
    totals: {
      projects: input.projects.length,
      workspaces: input.workspaces.length,
      tasks: input.tasks.length,
      activeTasks: input.tasks.filter((task) => ["running", "waiting", "stalled", "validating", "repairing", "safety_checking"].includes(task.status)).length,
      waitingForHumanTasks: input.tasks.filter((task) => task.status === "waiting_for_human" || task.pendingEscalation?.status === "pending").length,
      workflows: input.workflows.length,
      activeWorkflows: input.workflows.filter((workflow) => workflow.status === "active" || workflow.status === "ready").length,
      blockedWorkflows: input.workflows.filter((workflow) => ["blocked", "budget_blocked", "waiting_for_human"].includes(workflow.status)).length,
      openIncidents: input.incidents.filter((incident) => incident.status === "open").length,
      criticalIncidents: input.incidents.filter((incident) => incident.status === "open" && incident.severity === "critical").length,
    },
  };
}
