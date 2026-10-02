import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SupervisorDecisionError,
  SupervisorDecisionService,
} from "./supervisor-decision.js";
import type { SupervisorPlannerProposalV1 } from "./supervisor-planner.js";
import type { SupervisorReviewerResultV1 } from "./supervisor-reviewer.js";
import { createSupervisorTask } from "./supervisor-task.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  supervisor: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan: "55555555-5555-4555-8555-555555555555",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function approvedTask(workspace: string, overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "Implement the approved bounded change.",
    workspace,
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    acceptanceCriteria: ["Existing criterion."],
    validationCommands: ["npm test"],
    expectedChangedPaths: ["src/**"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 3,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v3",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*", ".git/**"],
    workerProfileId: "pilot-safe",
    clineSessionId: "hub-session-secret-that-must-not-leak",
    lastOutput: "worker output that must not leak",
    runCount: 0,
    ...overrides,
  } as OrchestratorTask;
}

function plannerProposal(): SupervisorPlannerProposalV1 {
  return {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    acceptanceCriteria: [
      "The bounded behavior is implemented.",
      "Existing tests remain green.",
    ],
    proposedValidationCommands: ["npm run typecheck", "npm test"],
    validationAuthority: "proposal_only",
  };
}

function reviewerResult(
  decision: "pass" | "repair" | "escalate",
): SupervisorReviewerResultV1 {
  if (decision === "repair") {
    return {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      decision,
      summary: "A bounded correction is required.",
      repairInstruction: "Adjust only the approved implementation path and preserve the existing safety envelope.",
      completionAuthority: "advisory_only",
    };
  }
  if (decision === "escalate") {
    return {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      decision,
      summary: "Human judgment is required.",
      escalationReason: "The review requires authority or judgment outside the current approved envelope.",
      completionAuthority: "advisory_only",
    };
  }
  return {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    decision,
    summary: "Durable evidence is satisfactory.",
    completionAuthority: "advisory_only",
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-supervisor-decision-"));
  const store = new TaskStore(root);
  const task = approvedTask(root);
  await store.save(task);
  const supervisor = createSupervisorTask(task, {
    idFactory: () => IDS.supervisor,
    now: () => new Date("2026-09-25T01:00:00.000Z"),
  });
  let decisionNumber = 0;
  const service = new SupervisorDecisionService(root, {
    now: () => new Date(`2026-09-25T01:0${decisionNumber}:00.000Z`),
    idFactory: () => {
      decisionNumber += 1;
      return `77777777-7777-4777-8${String(decisionNumber).padStart(3, "0")}-777777777777`;
    },
  });
  return { root, store, task, supervisor, service };
}

test("planner proposal is append-only durable evidence and does not silently trust validation commands", async () => {
  const { root, store, supervisor, service } = await fixture();
  try {
    const decision = await service.recordPlannerProposal(supervisor, plannerProposal());
    assert.equal(decision.kind, "planner_proposal");
    assert.deepEqual(decision.proposedValidationCommands, ["npm run typecheck", "npm test"]);

    const persistedTask = await store.load(IDS.task);
    assert.deepEqual(persistedTask.validationCommands, ["npm test"]);
    assert.deepEqual(persistedTask.acceptanceCriteria, ["Existing criterion."]);

    const decisions = await service.list(IDS.task);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.decisionId, decision.decisionId);

    const raw = await readFile(
      path.join(root, ".orchestrator", "supervisor-decisions", `${IDS.task}.jsonl`),
      "utf8",
    );
    assert.equal(raw.includes(root), false);
    assert.equal(raw.includes("hub-session-secret-that-must-not-leak"), false);
    assert.equal(raw.includes("worker output that must not leak"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trusted planner admission is pre-run only and may admit only exact proposed validation commands", async () => {
  const { root, store, supervisor, service } = await fixture();
  try {
    const proposal = plannerProposal();
    const decision = await service.admitPlannerProposal(supervisor, proposal, {
      acceptAcceptanceCriteria: true,
      admittedValidationCommands: ["npm run typecheck"],
    });
    assert.equal(decision.kind, "planner_admission");
    assert.deepEqual(decision.admittedValidationCommands, ["npm run typecheck"]);

    const persisted = await store.load(IDS.task);
    assert.deepEqual(persisted.acceptanceCriteria, proposal.acceptanceCriteria);
    assert.deepEqual(persisted.validationCommands, ["npm run typecheck"]);

    await assert.rejects(
      service.admitPlannerProposal(supervisor, proposal, {
        acceptAcceptanceCriteria: false,
        admittedValidationCommands: ["npm run unsafe"],
      }),
      (error: unknown) =>
        error instanceof SupervisorDecisionError && error.code === "proposal_not_admissible",
    );

    persisted.runCount = 1;
    persisted.status = "failed";
    await store.save(persisted);
    await assert.rejects(
      service.admitPlannerProposal(supervisor, proposal, {
        acceptAcceptanceCriteria: true,
        admittedValidationCommands: [],
      }),
      (error: unknown) =>
        error instanceof SupervisorDecisionError && error.code === "proposal_not_admissible",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewer pass and repair decisions persist without changing task authority or lifecycle", async () => {
  const { root, store, supervisor, service } = await fixture();
  try {
    const before = await store.load(IDS.task);
    const pass = await service.applyReviewerResult(supervisor, reviewerResult("pass"));
    const repair = await service.applyReviewerResult(supervisor, reviewerResult("repair"));

    assert.equal(pass.kind, "review_pass");
    assert.equal(repair.kind, "review_repair");
    assert.match(repair.repairInstruction ?? "", /approved implementation path/);

    const after = await store.load(IDS.task);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.validationCommands, before.validationCommands);
    assert.deepEqual(
      (after as OrchestratorTask & { approvedAllowedPathPatterns?: string[] }).approvedAllowedPathPatterns,
      (before as OrchestratorTask & { approvedAllowedPathPatterns?: string[] }).approvedAllowedPathPatterns,
    );
    assert.equal(after.pendingEscalation, undefined);

    const decisions = await service.list(IDS.task);
    assert.deepEqual(decisions.map((item) => item.kind), ["review_pass", "review_repair"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewer escalation reuses durable waiting_for_human state and records linked decision evidence", async () => {
  const { root, store, supervisor, service } = await fixture();
  try {
    const decision = await service.applyReviewerResult(supervisor, reviewerResult("escalate"));
    const task = await store.load(IDS.task);

    assert.equal(decision.kind, "review_escalation");
    assert.ok(decision.escalationId);
    assert.equal(task.status, "waiting_for_human");
    assert.equal(task.pendingEscalation?.status, "pending");
    assert.equal(task.pendingEscalation?.escalationId, decision.escalationId);
    assert.equal(task.pendingEscalation?.actionKind, "unknown");
    assert.match(task.pendingEscalation?.reason ?? "", /outside the current approved envelope/);

    const events = await store.events(IDS.task);
    assert.ok(events.some((event) => event.type === "human_escalation_requested"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supervisor decision application fails closed when durable task authority changed", async () => {
  const { root, store, supervisor, service } = await fixture();
  try {
    const task = await store.load(IDS.task) as OrchestratorTask & { safetyProfileRevision?: number };
    task.safetyProfileRevision = 99;
    await store.save(task);

    await assert.rejects(
      service.recordPlannerProposal(supervisor, plannerProposal()),
      (error: unknown) =>
        error instanceof SupervisorDecisionError && error.code === "binding_stale",
    );
    await assert.rejects(
      service.applyReviewerResult(supervisor, reviewerResult("repair")),
      (error: unknown) =>
        error instanceof SupervisorDecisionError && error.code === "binding_stale",
    );
    assert.deepEqual(await service.list(IDS.task), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
