import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestrationDashboardV1 } from "./orchestration-dashboard.js";
import type { SpecialistHandoffV1 } from "./specialist-handoff.js";
import { buildOperatorVisualization } from "./operator-visualization.js";
import type { WorkspaceLockStateV1 } from "./workspace-lock.js";

const IDS = {
  project: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  task: "33333333-3333-4333-8333-333333333333",
  workflow: "44444444-4444-4444-8444-444444444444",
  incident: "55555555-5555-4555-8555-555555555555",
  handoff: "66666666-6666-4666-8666-666666666666",
  supervisor: "77777777-7777-4777-8777-777777777777",
  safetyPlan: "88888888-8888-4888-8888-888888888888",
  profile: "99999999-9999-4999-8999-999999999999",
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  lease: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  fence: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  evidence: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

const SOURCE = {
  capturedAt: "2026-09-25T08:20:00.000Z",
  available: true,
  stale: false,
  truncated: false,
  total: 1,
  returned: 1,
};

function dashboard(): OrchestrationDashboardV1 {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-25T08:20:00.000Z",
    readOnly: true,
    sources: {
      projects: { ...SOURCE },
      workspaces: { ...SOURCE },
      tasks: { ...SOURCE },
      workflows: { ...SOURCE },
      incidents: { ...SOURCE },
      supervisor: { ...SOURCE, stale: true },
    },
    projects: [{ projectId: IDS.project, displayName: "Project", updatedAt: "2026-09-25T08:19:00.000Z" }],
    workspaces: [{
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      displayName: "Workspace",
      rootAlias: "registered-workspace",
      revision: 1,
      safetyProfileRevision: 3,
      policyVersion: "v1",
    }],
    tasks: [{
      taskId: IDS.task,
      projectId: IDS.project,
      workspaceId: IDS.workspace,
      status: "waiting_for_human",
      updatedAt: "2026-09-25T08:19:30.000Z",
      runCount: 2,
      recoveryCount: 0,
      validationPassed: false,
      diffSafetyPassed: true,
      waitingForHuman: true,
    }],
    workflows: [{
      workflowId: IDS.workflow,
      status: "budget_blocked",
      final: false,
      generatedAt: "2026-09-25T08:19:40.000Z",
      totalNodes: 3,
      completedNodes: 1,
      activeNodes: 0,
      waitingForHuman: 0,
      terminalNonSuccess: 0,
      latestBudgetDeniedReason: "max_task_runs_exceeded",
      openIncidents: 1,
      criticalIncidents: 1,
    }],
    incidents: [{
      incidentId: IDS.incident,
      workspaceId: IDS.workspace,
      kind: "runtime_unavailable",
      severity: "critical",
      status: "open",
      firstSeenAt: "2026-09-25T08:18:00.000Z",
      lastSeenAt: "2026-09-25T08:19:50.000Z",
      occurrenceCount: 2,
      humanActionRequired: true,
      failClosed: true,
    }],
    supervisor: {
      plannerProposals: 2,
      reviewerPasses: 1,
      reviewerRepairs: 1,
      reviewerEscalations: 1,
      pendingHumanEscalations: 1,
    },
    totals: {
      projects: 1,
      workspaces: 1,
      tasks: 1,
      activeTasks: 0,
      waitingForHumanTasks: 1,
      workflows: 1,
      activeWorkflows: 0,
      blockedWorkflows: 1,
      openIncidents: 1,
      criticalIncidents: 1,
    },
  };
}

function handoff(): SpecialistHandoffV1 {
  return {
    schemaVersion: 1,
    handoffId: IDS.handoff,
    createdAt: "2026-09-25T08:19:20.000Z",
    sequence: 2,
    previousHandoffId: IDS.evidence,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    fromRole: "implementation",
    toRole: "reviewer",
    authority: {
      projectId: IDS.project,
      workspaceId: IDS.workspace,
      safetyPlanId: IDS.safetyPlan,
      safetyProfileId: IDS.profile,
      safetyProfileRevision: 3,
      workspaceRegistryRevision: 4,
      workerProfileId: "private-worker-profile",
    },
    evidence: [{
      kind: "task_event",
      evidenceId: IDS.evidence,
      capturedAt: "2026-09-25T08:19:10.000Z",
    }],
    constraints: {
      executionMode: "sequential_only",
      authoritySource: "approved_task_only",
      machineAuthorityGranted: false,
      writeAuthorityGranted: false,
      concurrentWorkspaceWritesAllowed: false,
    },
  };
}

function lock(): WorkspaceLockStateV1 {
  return {
    schemaVersion: 1,
    workspaceId: IDS.workspace,
    revision: 4,
    activeWriter: {
      leaseId: IDS.lease,
      fenceToken: IDS.fence,
      taskId: IDS.task,
      ownerInstanceId: IDS.owner,
      acquiredAt: "2026-09-25T08:19:30.000Z",
      expiresAt: "2026-09-25T08:21:30.000Z",
    },
    coordination: {
      exclusiveWriter: true,
      observersRequireLease: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
    },
  };
}

test("operator model surfaces attention and coordination without exposing authority/private fields", () => {
  const view = buildOperatorVisualization(
    { dashboard: dashboard(), handoffs: [handoff()], writerLocks: [lock()] },
    { now: new Date("2026-09-25T08:20:00.000Z") },
  );

  assert.equal(view.readOnly, true);
  assert.deepEqual(view.actions, []);
  assert.equal(view.header.health, "critical");
  assert.equal(view.header.activeWriters, 1);
  assert.equal(view.header.waitingForHuman, 1);
  assert.equal(view.header.staleSources, 1);
  assert.equal(view.attention[0].kind, "incident");
  assert.equal(view.attention[0].severity, "critical");
  assert.deepEqual(view.specialistTimeline[0], {
    handoffId: IDS.handoff,
    taskId: IDS.task,
    workspaceId: IDS.workspace,
    sequence: 2,
    createdAt: "2026-09-25T08:19:20.000Z",
    fromRole: "implementation",
    toRole: "reviewer",
    evidenceCount: 1,
  });
  assert.equal(view.activeWriters[0].workspaceId, IDS.workspace);
  assert.equal(view.activeWriters[0].taskId, IDS.task);

  const serialized = JSON.stringify(view);
  for (const forbidden of [
    IDS.safetyPlan,
    IDS.profile,
    IDS.owner,
    IDS.lease,
    IDS.fence,
    "private-worker-profile",
    "safetyPlanId",
    "workerProfileId",
    "ownerInstanceId",
    "leaseId",
    "fenceToken",
    "workspaceRoot",
    "validationCommands",
    "hubSessionId",
    "checkpoint",
    "modelOutput",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("operator model excludes expired writers and remains deterministic", () => {
  const first = buildOperatorVisualization(
    { dashboard: dashboard(), handoffs: [handoff()], writerLocks: [lock()] },
    { now: new Date("2026-09-25T08:22:00.000Z") },
  );
  const second = buildOperatorVisualization(
    { dashboard: dashboard(), handoffs: [handoff()], writerLocks: [lock()] },
    { now: new Date("2026-09-25T08:22:00.000Z") },
  );

  assert.equal(first.header.activeWriters, 0);
  assert.deepEqual(first, second);
});

test("unavailable dashboard evidence reports unknown health without creating actions", () => {
  const source = dashboard();
  source.sources.tasks.available = false;
  source.sources.tasks.stale = true;
  source.sources.tasks.errorCode = "task_store_unavailable";

  const view = buildOperatorVisualization(
    { dashboard: source, handoffs: [], writerLocks: [] },
    { now: new Date("2026-09-25T08:20:00.000Z") },
  );
  assert.equal(view.header.health, "unknown");
  assert.equal(view.header.unavailableSources, 1);
  assert.ok(view.sourceNotices.some((notice) => notice.source === "tasks"));
  assert.deepEqual(view.actions, []);
});
