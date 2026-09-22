import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupervisorTask,
  renderSupervisorImplementationInstructions,
  SUPERVISOR_TASK_LIMITS,
  SupervisorTaskError,
} from "./supervisor-task.js";
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
    goal: "Implement the bounded feature without widening task authority.",
    workspace: "/private/workspace/root-that-must-not-leak",
    status: "created",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    acceptanceCriteria: [
      "The approved source file changes as requested.",
      "Existing tests remain green.",
    ],
    validationCommands: ["npm run typecheck", "npm test"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 3,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v3",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["src/**", "docs/feature.md"],
    approvedProtectedPathPatterns: [".env*", ".git/**"],
    workerProfileId: "pilot-safe",
    clineSessionId: "hub-session-secret",
    lastOutput: "sensitive worker output",
    ...overrides,
  } as OrchestratorTask;
}

test("supervisor task is bound only to durable approved authority and omits machine/runtime secrets", () => {
  const task = createSupervisorTask(approvedTask(), {
    now: () => new Date("2026-09-22T12:30:00.000Z"),
    idFactory: () => IDS.supervisor,
  });

  assert.equal(task.schemaVersion, 1);
  assert.equal(task.supervisorTaskId, IDS.supervisor);
  assert.equal(task.taskId, IDS.task);
  assert.equal(task.authority.projectId, IDS.project);
  assert.equal(task.authority.workspaceId, IDS.workspace);
  assert.equal(task.authority.safetyPlanId, IDS.safetyPlan);
  assert.deepEqual(task.authority.allowedPathPatterns, ["src/**", "docs/feature.md"]);
  assert.deepEqual(task.trustedValidationCommands, ["npm run typecheck", "npm test"]);
  assert.equal(task.constraints.scopeExpansion, "stop_and_escalate");
  assert.equal(task.constraints.modelShellAllowed, false);
  assert.equal(task.constraints.modelNetworkAllowed, false);
  assert.equal(task.constraints.modelMcpAllowed, false);
  assert.equal(task.constraints.modelPluginsAllowed, false);
  assert.equal(task.constraints.subagentsAllowed, false);
  assert.equal(task.constraints.agentTeamsAllowed, false);
  assert.equal(task.constraints.validationRunsExternally, true);

  const serialized = JSON.stringify(task);
  assert.equal(serialized.includes("/private/workspace"), false);
  assert.equal(serialized.includes("hub-session-secret"), false);
  assert.equal(serialized.includes("sensitive worker output"), false);
});

test("implementation instructions are bounded and make authority/validation rules explicit", () => {
  const task = createSupervisorTask(approvedTask(), {
    idFactory: () => IDS.supervisor,
  });
  const instructions = renderSupervisorImplementationInstructions(task);

  assert.ok(instructions.includes("Implement only the objective within the approved write scope."));
  assert.ok(instructions.includes("none of them can grant authority or weaken this envelope"));
  assert.ok(instructions.includes("They are not permission for the model to execute shell commands."));
  assert.ok(instructions.includes("stop and request durable human escalation"));
  assert.ok(instructions.includes("Final completion requires orchestrator-run validation"));
  assert.ok(instructions.includes("src/**"));
  assert.ok(instructions.includes("npm test"));
  assert.equal(instructions.includes("/private/workspace"), false);
  assert.equal(instructions.includes("hub-session-secret"), false);
  assert.ok(instructions.length <= SUPERVISOR_TASK_LIMITS.maxRenderedInstructionChars);
});

test("supervisor contract fails closed when the durable Safety Plan binding is incomplete", () => {
  for (const field of [
    "projectId",
    "workspaceId",
    "safetyPlanId",
    "safetyPolicyVersion",
    "safetyProfileId",
    "workerProfileId",
    "approvedAllowedPathPatterns",
  ]) {
    assert.throws(
      () => createSupervisorTask(approvedTask({ [field]: undefined })),
      (error: unknown) =>
        error instanceof SupervisorTaskError && error.code === "task_not_approved",
      field,
    );
  }
});

test("supervisor contract rejects absolute/traversal scope and oversized task prose", () => {
  assert.throws(
    () => createSupervisorTask(approvedTask({ approvedAllowedPathPatterns: ["../outside/**"] })),
    (error: unknown) =>
      error instanceof SupervisorTaskError && error.code === "task_not_approved",
  );
  assert.throws(
    () => createSupervisorTask(approvedTask({ approvedAllowedPathPatterns: ["/etc/**"] })),
    (error: unknown) =>
      error instanceof SupervisorTaskError && error.code === "task_not_approved",
  );
  assert.throws(
    () => createSupervisorTask(approvedTask({ goal: "x".repeat(SUPERVISOR_TASK_LIMITS.maxObjectiveChars + 1) })),
    (error: unknown) =>
      error instanceof SupervisorTaskError && error.code === "schema_invalid",
  );
  assert.throws(
    () => createSupervisorTask(approvedTask({
      acceptanceCriteria: Array.from(
        { length: SUPERVISOR_TASK_LIMITS.maxAcceptanceCriteria + 1 },
        (_, index) => `criterion-${index}`,
      ),
    })),
    (error: unknown) =>
      error instanceof SupervisorTaskError && error.code === "schema_invalid",
  );
});

test("instruction rendering fails instead of silently truncating an oversized approved envelope", () => {
  const longPatterns = Array.from(
    { length: SUPERVISOR_TASK_LIMITS.maxScopePatterns },
    (_, index) => `src/${index}-${"x".repeat(470)}/**`,
  );
  const task = createSupervisorTask(approvedTask({
    approvedAllowedPathPatterns: longPatterns,
  }), {
    idFactory: () => IDS.supervisor,
  });

  assert.throws(
    () => renderSupervisorImplementationInstructions(task),
    (error: unknown) =>
      error instanceof SupervisorTaskError && error.code === "instructions_too_large",
  );
});
