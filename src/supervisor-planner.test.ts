import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupervisorTask,
} from "./supervisor-task.js";
import {
  renderSupervisorPlannerPrompt,
  SUPERVISOR_PLANNER_LIMITS,
  SupervisorPlannerError,
  validateSupervisorPlannerProposal,
} from "./supervisor-planner.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  supervisor: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan: "55555555-5555-4555-8555-555555555555",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
};

function approvedTask(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "Add bounded planner behavior without widening authority.",
    workspace: "/private/workspace/root-that-must-not-leak",
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    acceptanceCriteria: ["Planner output is bounded."],
    validationCommands: ["npm run typecheck", "npm test"],
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
    clineSessionId: "hub-session-secret",
    lastOutput: "sensitive worker output",
    ...overrides,
  } as OrchestratorTask;
}

function supervisorTask() {
  return createSupervisorTask(approvedTask(), {
    idFactory: () => IDS.supervisor,
    now: () => new Date("2026-09-25T01:00:00.000Z"),
  });
}

test("planner prompt exposes bounded planning context but no machine/runtime secrets", () => {
  const prompt = renderSupervisorPlannerPrompt(supervisorTask());

  assert.ok(prompt.includes("Add bounded planner behavior without widening authority."));
  assert.ok(prompt.includes("src/**"));
  assert.ok(prompt.includes("npm test"));
  assert.ok(prompt.includes("proposal data only"));
  assert.ok(prompt.includes("Do not claim the implementation is complete"));
  assert.equal(prompt.includes("/private/workspace"), false);
  assert.equal(prompt.includes("hub-session-secret"), false);
  assert.equal(prompt.includes("sensitive worker output"), false);
  assert.ok(prompt.length <= SUPERVISOR_PLANNER_LIMITS.maxPromptChars);
});

test("planner proposal returns only bounded criteria and proposal-only validation commands", () => {
  const task = supervisorTask();
  const proposal = validateSupervisorPlannerProposal(task, {
    schemaVersion: 1,
    supervisorTaskId: IDS.supervisor,
    taskId: IDS.task,
    acceptanceCriteria: [
      "The planner rejects fields that attempt to alter authority.",
      "Accepted planner output remains bound to the approved task IDs.",
    ],
    proposedValidationCommands: ["npm run typecheck", "npm test"],
    validationAuthority: "proposal_only",
  });

  assert.deepEqual(proposal.acceptanceCriteria, [
    "The planner rejects fields that attempt to alter authority.",
    "Accepted planner output remains bound to the approved task IDs.",
  ]);
  assert.deepEqual(proposal.proposedValidationCommands, ["npm run typecheck", "npm test"]);
  assert.equal(proposal.validationAuthority, "proposal_only");
  assert.deepEqual(Object.keys(proposal).sort(), [
    "acceptanceCriteria",
    "proposedValidationCommands",
    "schemaVersion",
    "supervisorTaskId",
    "taskId",
    "validationAuthority",
  ].sort());
});

test("planner proposal rejects attempted scope, policy, shell, completion, or worker overrides", () => {
  const task = supervisorTask();
  for (const [field, value] of [
    ["allowedPathPatterns", ["../outside/**"]],
    ["workerProfileId", "unsafe"],
    ["modelShellAllowed", true],
    ["completed", true],
    ["safetyPolicyVersion", "disabled"],
  ] as const) {
    assert.throws(
      () => validateSupervisorPlannerProposal(task, {
        schemaVersion: 1,
        supervisorTaskId: IDS.supervisor,
        taskId: IDS.task,
        acceptanceCriteria: [],
        proposedValidationCommands: [],
        validationAuthority: "proposal_only",
        [field]: value,
      }),
      (error: unknown) =>
        error instanceof SupervisorPlannerError && error.code === "proposal_invalid",
      field,
    );
  }
});

test("planner proposal rejects cross-task output and attempts to self-authorize validation", () => {
  const task = supervisorTask();
  assert.throws(
    () => validateSupervisorPlannerProposal(task, {
      schemaVersion: 1,
      supervisorTaskId: "77777777-7777-4777-8777-777777777777",
      taskId: IDS.task,
      acceptanceCriteria: [],
      proposedValidationCommands: [],
      validationAuthority: "proposal_only",
    }),
    (error: unknown) =>
      error instanceof SupervisorPlannerError && error.code === "task_mismatch",
  );

  assert.throws(
    () => validateSupervisorPlannerProposal(task, {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      acceptanceCriteria: [],
      proposedValidationCommands: ["npm test"],
      validationAuthority: "trusted",
    }),
    (error: unknown) =>
      error instanceof SupervisorPlannerError && error.code === "proposal_invalid",
  );
});

test("planner proposal enforces item counts and string bounds", () => {
  const task = supervisorTask();
  assert.throws(
    () => validateSupervisorPlannerProposal(task, {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      acceptanceCriteria: Array.from(
        { length: SUPERVISOR_PLANNER_LIMITS.maxAcceptanceCriteria + 1 },
        (_, index) => `criterion-${index}`,
      ),
      proposedValidationCommands: [],
      validationAuthority: "proposal_only",
    }),
    (error: unknown) =>
      error instanceof SupervisorPlannerError && error.code === "proposal_invalid",
  );

  assert.throws(
    () => validateSupervisorPlannerProposal(task, {
      schemaVersion: 1,
      supervisorTaskId: IDS.supervisor,
      taskId: IDS.task,
      acceptanceCriteria: [],
      proposedValidationCommands: [
        "x".repeat(SUPERVISOR_PLANNER_LIMITS.maxValidationCommandChars + 1),
      ],
      validationAuthority: "proposal_only",
    }),
    (error: unknown) =>
      error instanceof SupervisorPlannerError && error.code === "proposal_invalid",
  );
});
