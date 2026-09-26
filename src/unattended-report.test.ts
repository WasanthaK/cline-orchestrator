import assert from "node:assert/strict";
import test from "node:test";
import { buildUnattendedWorkflowReport } from "./unattended-report.js";
import { createUnattendedWorkflow } from "./unattended-workflow.js";
import type { UnattendedBudgetDecisionV1 } from "./unattended-budget-store.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  workflow: "11111111-1111-4111-8111-111111111111",
  node1: "21111111-1111-4111-8111-111111111111",
  node2: "31111111-1111-4111-8111-111111111111",
  task1: "22222222-2222-4222-8222-222222222221",
  task2: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function task(id: string, safetyPlanId: string, overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id,
    goal: "sensitive objective that report must omit",
    workspace: "C:\\private\\workspace",
    status: "created",
    createdAt: "2026-09-25T06:00:00.000Z",
    updatedAt: "2026-09-25T06:00:00.000Z",
    validationCommands: ["npm test -- secret-flag"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 1,
    safetyPlanId,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*"],
    workerProfileId: "pilot-safe",
    clineSessionId: "private-hub-session",
    lastOutput: "private model output",
    ...overrides,
  } as OrchestratorTask;
}

function completed(id: string, safetyPlanId: string, overrides: Record<string, unknown> = {}) {
  return task(id, safetyPlanId, {
    status: "completed",
    lastValidation: {
      startedAt: "2026-09-25T06:01:00.000Z",
      completedAt: "2026-09-25T06:01:01.000Z",
      durationMs: 1000,
      passed: true,
      commandsRequested: 1,
      commandsRun: 1,
      results: [{
        command: "npm test -- secret-flag",
        startedAt: "2026-09-25T06:01:00.000Z",
        completedAt: "2026-09-25T06:01:01.000Z",
        durationMs: 1000,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        stdout: "sensitive stdout",
        stderr: "",
      }],
    },
    lastDiffSafety: {
      checkedAt: "2026-09-25T06:01:02.000Z",
      passed: true,
      finalDiffSummary: "private diff summary",
      summary: {
        changedFiles: 1,
        trackedFiles: 1,
        untrackedFiles: 0,
        trackedAdditions: 1,
        trackedDeletions: 0,
      },
      changedPaths: [{ path: "src/private.ts", status: "modified", source: "tracked" }],
      warnings: [],
      failures: [],
    },
    lastRunCheckpoint: {
      createdAt: "2026-09-25T06:00:30.000Z",
      available: true,
      taskId: id,
      runCount: 1,
      backupDir: "C:\\secret\\backup",
    },
    ...overrides,
  });
}

function workflow() {
  const nodeIds = [IDS.node1, IDS.node2];
  let index = 0;
  return createUnattendedWorkflow([
    { task: task(IDS.task1, "55555555-5555-4555-8555-555555555551") },
    { task: task(IDS.task2, "55555555-5555-4555-8555-555555555552"), dependsOnTaskIds: [IDS.task1] },
  ], {
    idFactory: () => IDS.workflow,
    nodeIdFactory: () => nodeIds[index++]!,
  });
}

test("completed report requires validation and diff-safety evidence and omits sensitive runtime details", () => {
  const report = buildUnattendedWorkflowReport(
    workflow(),
    [
      completed(IDS.task1, "55555555-5555-4555-8555-555555555551"),
      completed(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
    { now: new Date("2026-09-25T07:00:00.000Z") },
  );

  assert.equal(report.status, "completed");
  assert.equal(report.final, true);
  assert.equal(report.counts.completed, 2);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "sensitive objective",
    "C:\\\\private",
    "secret-flag",
    "private-hub-session",
    "private model output",
    "sensitive stdout",
    "private diff summary",
    "src/private.ts",
    "secret\\\\backup",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("waiting-for-human task pauses the workflow and becomes explicit attention", () => {
  const waiting = task(IDS.task1, "55555555-5555-4555-8555-555555555551", {
    status: "waiting_for_human",
    pendingEscalation: {
      escalationId: "77777777-7777-4777-8777-777777777777",
      taskId: IDS.task1,
      requestedAt: "2026-09-25T06:30:00.000Z",
      reason: "scope expansion requested",
      actionKind: "edit",
      actionFingerprint: "fingerprint",
      status: "pending",
      reversible: true,
    },
  });
  const report = buildUnattendedWorkflowReport(workflow(), [waiting, task(IDS.task2, "55555555-5555-4555-8555-555555555552")]);

  assert.equal(report.status, "waiting_for_human");
  assert.equal(report.final, false);
  assert.ok(report.attention.some((item) => item.kind === "human_escalation" && item.taskId === IDS.task1));
});

test("terminal failure or missing completion evidence blocks workflow rather than reporting success", () => {
  const failed = buildUnattendedWorkflowReport(
    workflow(),
    [
      task(IDS.task1, "55555555-5555-4555-8555-555555555551", { status: "failed" }),
      task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
  );
  assert.equal(failed.status, "blocked");
  assert.equal(failed.final, true);

  const unsafeCompleted = buildUnattendedWorkflowReport(
    workflow(),
    [
      completed(IDS.task1, "55555555-5555-4555-8555-555555555551", { lastDiffSafety: undefined }),
      task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
  );
  assert.equal(unsafeCompleted.status, "blocked");
  assert.ok(unsafeCompleted.attention.some((item) => item.kind === "completion_evidence_missing"));
});

test("latest denied budget decision makes an otherwise idle workflow budget-blocked", () => {
  const denied: UnattendedBudgetDecisionV1 = {
    schemaVersion: 1,
    decisionId: "77777777-7777-4777-8777-777777777777",
    workflowId: IDS.workflow,
    taskId: IDS.task1,
    decidedAt: "2026-09-25T06:20:00.000Z",
    allowed: false,
    reason: "budget_exhausted",
    exhausted: ["input_tokens"],
    accountingIssues: [],
  };
  const report = buildUnattendedWorkflowReport(
    workflow(),
    [
      task(IDS.task1, "55555555-5555-4555-8555-555555555551"),
      task(IDS.task2, "55555555-5555-4555-8555-555555555552"),
    ],
    { budgetDecisions: [denied] },
  );

  assert.equal(report.status, "budget_blocked");
  assert.equal(report.final, false);
  assert.equal(report.budget.latestDeniedReason, "budget_exhausted");
  assert.deepEqual(report.budget.latestDeniedExhausted, ["input_tokens"]);
});
