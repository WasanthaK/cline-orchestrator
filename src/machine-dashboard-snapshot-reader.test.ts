import assert from "node:assert/strict";
import test from "node:test";
import { createMachineDashboardSnapshotReader } from "./machine-dashboard-snapshot-reader.js";
import type { TrustedDashboardMachineReader } from "./machine-dashboard-snapshot-reader.js";

const at = new Date("2026-10-12T09:00:00.000Z");
function machine(overrides: Partial<TrustedDashboardMachineReader> = {}): TrustedDashboardMachineReader {
  return {
    listProjects: async () => [],
    listWorkspaces: async () => [],
    findTasks: async () => [],
    ...overrides,
  };
}

test("UX-E2b2 reads three trusted machine APIs and marks unconnected sources unavailable", async () => {
  const calls: string[] = [];
  const reader = createMachineDashboardSnapshotReader(machine({
    listProjects: async () => { calls.push("projects"); return []; },
    listWorkspaces: async () => { calls.push("workspaces"); return []; },
    findTasks: async ({ limit } = {}) => {
      calls.push("tasks:" + limit);
      return [];
    },
  }), { now: () => at });
  const view = await reader.readSnapshot();
  assert.deepEqual(calls.sort(), ["projects", "tasks:100", "workspaces"]);
  assert.equal(view.readOnly, true);
  assert.deepEqual(view.actions, []);
  assert.equal(view.header.health, "unknown");
  for (const source of ["workflows", "incidents", "supervisor"]) {
    assert.ok(view.sourceNotices.some(s => s.source === source && !s.available && s.stale));
  }
  assert.equal(view.taskBoard.length, 0);
});

test("UX-E2b2 denied task source is unavailable, not an empty healthy snapshot", async () => {
  const reader = createMachineDashboardSnapshotReader(machine({
    findTasks: async () => { throw new Error("Bearer PRIVATE_ACCESS_TOKEN"); },
  }), { now: () => at });
  const view = await reader.readSnapshot();
  assert.ok(view.sourceNotices.some(s => s.source === "tasks" && s.errorCode === "tasks_unavailable"));
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_ACCESS_TOKEN/);
  assert.equal(view.header.health, "unknown");
});

test("UX-E2b2 saturated task list never advertises completeness", async () => {
  const sample = { taskId: "task-1", projectId: "project-1", workspaceId: "workspace-1",
    status: "completed", updatedAt: at.toISOString(), runCount: 1, recoveryCount: 0,
    validation: { configuredCommands: 0, runCount: 0, repairCount: 0 },
    safety: { safetyPlanId: "PRIVATE_SAFETY_ID", policyVersion: "p1", workerProfileId: "PRIVATE_PROFILE",
      allowedPathPatterns: [], protectedPathPatterns: [] },
    goal: "PRIVATE_WORKER_GOAL",
    createdAt: at.toISOString(), sessionGeneration: 0, contextRotationCount: 0,
  };
  const reader = createMachineDashboardSnapshotReader(machine({
    findTasks: async () => Array.from({ length: 100 }, (_, i) =>
      ({ ...sample, taskId: "task-" + i } as never)),
  }), { now: () => at });
  const view = await reader.readSnapshot();
  assert.ok(view.sourceNotices.some(s => s.source === "tasks"
    && s.errorCode === "task_listing_completeness_unknown" && !s.available));
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_WORKER_GOAL|PRIVATE_SAFETY_ID|PRIVATE_PROFILE/);
});

test("UX-2B names come only from trusted registry records, never raw task goals", async () => {
 const task = { taskId:"task-safe",projectId:"p1",workspaceId:"w1",status:"completed",
   updatedAt:at.toISOString(),runCount:1,recoveryCount:0,
   goal:"PRIVATE_WORK_GOAL",createdAt:at.toISOString(),
   validation:{configuredCommands:0,runCount:0,repairCount:0},
   safety:{safetyPlanId:"PRIVATE_SAFETY",policyVersion:"v1",workerProfileId:"PRIVATE_PROFILE",
      allowedPathPatterns:[],protectedPathPatterns:[]}};
 const reader=createMachineDashboardSnapshotReader(machine({
  listProjects:async()=>[{projectId:"p1",displayName:"Customer Web App",updatedAt:at.toISOString()}] as never,
  listWorkspaces:async()=>[{workspaceId:"w1",projectId:"p1",displayName:"Frontend",rootAlias:"PRIVATE_ROOT",revision:1,safetyProfileRevision:1,policyVersion:"v1"}] as never,
  findTasks:async()=>[task] as never,
 }),{now:()=>at});
 const view=await reader.readSnapshot();
 assert.equal(view.taskBoard[0]?.projectDisplayName,"Customer Web App");
 assert.equal(view.taskBoard[0]?.workspaceDisplayName,"Frontend");
 assert.doesNotMatch(JSON.stringify(view),/PRIVATE_WORK_GOAL|PRIVATE_ROOT|PRIVATE_SAFETY|PRIVATE_PROFILE/);
});
