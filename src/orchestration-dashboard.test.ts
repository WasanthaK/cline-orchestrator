import assert from "node:assert/strict";
import test from "node:test";
import type { PublicTaskView } from "./machine-orchestrator.js";
import {
  buildOrchestrationDashboard,
  ORCHESTRATION_DASHBOARD_LIMITS,
  type DashboardSupervisorSummaryInput,
} from "./orchestration-dashboard.js";
import type { SentinelIncidentV1 } from "./sentinel.js";
import type { UnattendedWorkflowReportV1 } from "./unattended-report.js";
import type { RegisteredProject, WorkspaceDiscoveryRecord } from "./workspace-registry.js";

const NOW = new Date("2026-09-25T07:30:00.000Z");
const CAPTURED = "2026-09-25T07:29:30.000Z";

function project(index = 0): RegisteredProject {
  return {
    projectId: `project-${String(index).padStart(3, "0")}`,
    displayName: `Project ${index}`,
    createdAt: "2026-09-25T07:00:00.000Z",
    updatedAt: "2026-09-25T07:20:00.000Z",
  };
}

function workspace(index = 0): WorkspaceDiscoveryRecord {
  return {
    workspaceId: `workspace-${String(index).padStart(3, "0")}`,
    projectId: "project-000",
    displayName: `Workspace ${index}`,
    rootAlias: `workspace-${index}`,
    revision: 2,
    safetyProfileId: `profile-${index}`,
    safetyProfileRevision: 3,
    policyVersion: "policy-v3",
  };
}

function task(index = 0, updatedAt = "2026-09-25T07:25:00.000Z"): PublicTaskView {
  return {
    taskId: `task-${String(index).padStart(3, "0")}`,
    projectId: "project-000",
    workspaceId: "workspace-000",
    goal: "PRIVATE_GOAL_DO_NOT_EXPOSE",
    status: "completed",
    createdAt: "2026-09-25T07:00:00.000Z",
    updatedAt,
    runCount: 2,
    sessionGeneration: 4,
    recoveryCount: 1,
    contextRotationCount: 2,
    validation: {
      configuredCommands: 2,
      runCount: 1,
      repairCount: 0,
      lastPassed: true,
      lastCompletedAt: "2026-09-25T07:24:00.000Z",
    },
    safety: {
      safetyPlanId: "PRIVATE_SAFETY_PLAN_ID",
      policyVersion: "policy-v3",
      workerProfileId: "PRIVATE_WORKER_PROFILE",
      allowedPathPatterns: ["PRIVATE/allowed/**"],
      protectedPathPatterns: ["PRIVATE/protected/**"],
    },
    checkpoint: {
      checkpointId: "PRIVATE_CHECKPOINT_ID",
      runCount: 1,
      createdAt: "2026-09-25T07:01:00.000Z",
      available: true,
    },
    diffSafety: {
      checkedAt: "2026-09-25T07:24:30.000Z",
      passed: true,
      finalDiffSummary: "PRIVATE_DIFF_SUMMARY",
      changedFiles: 1,
      warningCount: 0,
      failureCount: 0,
    },
    finishReason: "PRIVATE_FINISH_REASON",
    error: "Bearer PRIVATE_TOKEN C:\\private\\workspace",
  };
}

function workflow(index = 0): UnattendedWorkflowReportV1 {
  return {
    schemaVersion: 1,
    workflowId: `workflow-${String(index).padStart(3, "0")}`,
    generatedAt: "2026-09-25T07:28:00.000Z",
    status: "ready",
    final: false,
    counts: {
      totalNodes: 2,
      created: 2,
      active: 0,
      completed: 0,
      waitingForHuman: 0,
      terminalNonSuccess: 0,
    },
    nodes: [{
      nodeId: "PRIVATE_NODE_ID",
      taskId: "PRIVATE_WORKFLOW_TASK_ID",
      status: "created",
      dependencyCount: 0,
      validationRequired: true,
      checkpointAvailable: false,
      humanEscalationPending: false,
    }],
    attention: [{ kind: "budget_denied", taskId: "PRIVATE_ATTENTION_TASK" }],
    budget: {
      decisions: 3,
      latestDeniedReason: "budget_exhausted",
      latestDeniedExhausted: ["PRIVATE_BUDGET_DETAIL"],
    },
    incidents: {
      open: 1,
      critical: 0,
      humanActionRequired: 1,
    },
  };
}

function incident(index = 0): SentinelIncidentV1 {
  return {
    schemaVersion: 1,
    incidentId: `incident-${String(index).padStart(3, "0")}`,
    workspaceId: "workspace-000",
    fingerprint: "PRIVATE_INCIDENT_FINGERPRINT",
    kind: "validation_failure",
    severity: "error",
    status: "open",
    firstSeenAt: "2026-09-25T07:10:00.000Z",
    lastSeenAt: "2026-09-25T07:27:00.000Z",
    occurrenceCount: 2,
    summary: "Bearer PRIVATE_INCIDENT_TOKEN /private/path",
    humanActionRequired: true,
    failClosed: true,
    recoveryAttempts: 1,
    taskIds: ["PRIVATE_INCIDENT_TASK_ID"],
    eventIds: ["PRIVATE_INCIDENT_EVENT_ID"],
  };
}

function supervisor(overrides: Partial<DashboardSupervisorSummaryInput> = {}): DashboardSupervisorSummaryInput {
  return {
    capturedAt: CAPTURED,
    plannerProposals: 2,
    reviewerPasses: 1,
    reviewerRepairs: 1,
    reviewerEscalations: 0,
    pendingHumanEscalations: 1,
    ...overrides,
  };
}

function baseInput() {
  return {
    projects: [project()],
    projectsMeta: { capturedAt: CAPTURED },
    workspaces: [workspace()],
    workspacesMeta: { capturedAt: CAPTURED },
    tasks: [task()],
    tasksMeta: { capturedAt: CAPTURED },
    workflows: [workflow()],
    workflowsMeta: { capturedAt: CAPTURED },
    incidents: [incident()],
    incidentsMeta: { capturedAt: CAPTURED },
    supervisor: supervisor(),
  };
}

test("dashboard composes only bounded read-only summaries and omits private evidence", () => {
  const dashboard = buildOrchestrationDashboard(baseInput(), { now: NOW });

  assert.equal(dashboard.schemaVersion, 1);
  assert.equal(dashboard.readOnly, true);
  assert.equal(dashboard.tasks[0]?.taskId, "task-000");
  assert.equal(dashboard.tasks[0]?.validationPassed, true);
  assert.equal(dashboard.tasks[0]?.diffSafetyPassed, true);
  assert.equal(dashboard.workflows[0]?.latestBudgetDeniedReason, "budget_exhausted");
  assert.equal(dashboard.incidents[0]?.humanActionRequired, true);
  assert.equal(dashboard.supervisor.pendingHumanEscalations, 1);
  assert.equal(dashboard.sources.tasks.stale, false);

  const serialized = JSON.stringify(dashboard);
  for (const forbidden of [
    "PRIVATE_GOAL_DO_NOT_EXPOSE",
    "PRIVATE_SAFETY_PLAN_ID",
    "PRIVATE_WORKER_PROFILE",
    "PRIVATE/allowed/**",
    "PRIVATE/protected/**",
    "PRIVATE_CHECKPOINT_ID",
    "PRIVATE_DIFF_SUMMARY",
    "PRIVATE_FINISH_REASON",
    "PRIVATE_TOKEN",
    "PRIVATE_NODE_ID",
    "PRIVATE_WORKFLOW_TASK_ID",
    "PRIVATE_ATTENTION_TASK",
    "PRIVATE_BUDGET_DETAIL",
    "PRIVATE_INCIDENT_FINGERPRINT",
    "PRIVATE_INCIDENT_TOKEN",
    "PRIVATE_INCIDENT_TASK_ID",
    "PRIVATE_INCIDENT_EVENT_ID",
    "C:\\private\\workspace",
    "/private/path",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("dashboard enforces deterministic collection bounds and reports truncation", () => {
  const tasks = Array.from(
    { length: ORCHESTRATION_DASHBOARD_LIMITS.maxTasks + 3 },
    (_, index) => task(index, new Date(NOW.getTime() - index * 1_000).toISOString()),
  );
  const incidents = Array.from(
    { length: ORCHESTRATION_DASHBOARD_LIMITS.maxIncidents + 2 },
    (_, index) => ({
      ...incident(index),
      lastSeenAt: new Date(NOW.getTime() - index * 1_000).toISOString(),
    }),
  );

  const dashboard = buildOrchestrationDashboard({
    ...baseInput(),
    tasks,
    incidents,
  }, { now: NOW });

  assert.equal(dashboard.tasks.length, ORCHESTRATION_DASHBOARD_LIMITS.maxTasks);
  assert.equal(dashboard.sources.tasks.total, tasks.length);
  assert.equal(dashboard.sources.tasks.returned, ORCHESTRATION_DASHBOARD_LIMITS.maxTasks);
  assert.equal(dashboard.sources.tasks.truncated, true);
  assert.equal(dashboard.tasks[0]?.taskId, "task-000");
  assert.equal(dashboard.incidents.length, ORCHESTRATION_DASHBOARD_LIMITS.maxIncidents);
  assert.equal(dashboard.sources.incidents.truncated, true);
  assert.equal(dashboard.incidents[0]?.incidentId, "incident-000");
});

test("dashboard marks unavailable, missing, old, or future source evidence stale", () => {
  const dashboard = buildOrchestrationDashboard({
    ...baseInput(),
    projectsMeta: {
      capturedAt: CAPTURED,
      available: false,
      errorCode: "Bearer PRIVATE_META_SECRET /private/path",
    },
    workspacesMeta: undefined,
    tasksMeta: { capturedAt: "2026-09-25T07:00:00.000Z" },
    workflowsMeta: { capturedAt: "2026-09-25T07:31:00.000Z" },
  }, { now: NOW, staleAfterMs: 60_000 });

  assert.equal(dashboard.sources.projects.available, false);
  assert.equal(dashboard.sources.projects.stale, true);
  assert.equal(dashboard.sources.projects.errorCode, "source_error");
  assert.equal(dashboard.sources.workspaces.stale, true);
  assert.equal(dashboard.sources.tasks.stale, true);
  assert.equal(dashboard.sources.workflows.stale, true);
  assert.equal(JSON.stringify(dashboard).includes("PRIVATE_META_SECRET"), false);
  assert.equal(JSON.stringify(dashboard).includes("/private/path"), false);
});

test("dashboard sanitizes invalid supervisor counters without inventing usage", () => {
  const dashboard = buildOrchestrationDashboard({
    ...baseInput(),
    supervisor: supervisor({
      plannerProposals: -1,
      reviewerPasses: Number.NaN,
      reviewerRepairs: 1.5,
      reviewerEscalations: 2,
      pendingHumanEscalations: 3,
    }),
  }, { now: NOW });

  assert.deepEqual(dashboard.supervisor, {
    plannerProposals: 0,
    reviewerPasses: 0,
    reviewerRepairs: 0,
    reviewerEscalations: 2,
    pendingHumanEscalations: 3,
  });
});
