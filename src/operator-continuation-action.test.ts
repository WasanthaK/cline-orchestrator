import assert from "node:assert/strict";
import test from "node:test";
import type { PublicTaskView } from "./machine-orchestrator.js";
import { OperatorActionError, OperatorActionService } from "./operator-action.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

function task(overrides: Partial<PublicTaskView> = {}): PublicTaskView {
  return {
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    goal: "Existing approved task",
    status: "completed",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:01.000Z",
    runCount: 1,
    sessionGeneration: 1,
    recoveryCount: 0,
    contextRotationCount: 0,
    validation: {
      configuredCommands: 1,
      runCount: 1,
      repairCount: 0,
      lastPassed: true,
      lastCompletedAt: "2026-09-27T00:00:01.000Z",
    },
    safety: {
      safetyPlanId: "44444444-4444-4444-8444-444444444444",
      policyVersion: "policy-v1",
      workerProfileId: "pilot",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*"],
    },
    checkpoint: {
      checkpointId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runCount: 1,
      createdAt: "2026-09-27T00:00:00.500Z",
      available: true,
    },
    diffSafety: {
      checkedAt: "2026-09-27T00:00:01.000Z",
      passed: true,
      finalDiffSummary: "1 file changed",
      changedFiles: 1,
      warningCount: 0,
      failureCount: 0,
    },
    finishReason: "completed",
    ...overrides,
  };
}

function mockService(initial = task()) {
  let current = initial;
  const calls: Array<{ taskId: string; instruction: string }> = [];
  const service = {
    getTask: async () => current,
    rejectEscalation: async () => current,
    continueTask: async (taskId: string, instruction: string) => {
      calls.push({ taskId, instruction });
      current = {
        ...current,
        status: "waiting" as const,
        updatedAt: "2026-09-27T00:00:02.000Z",
        finishReason: undefined,
      };
      return current;
    },
  };
  return {
    service,
    calls,
    setCurrent(value: PublicTaskView) {
      current = value;
    },
  };
}

test("operator continuation binds the exact instruction, delegates once, and rejects replay", async () => {
  const mock = mockService();
  const actions = new OperatorActionService(mock.service);
  const instruction = "Re-check the approved src/** scope only.";

  const preview = await actions.previewTaskContinuation(TASK_ID, `  ${instruction}  `);
  assert.equal(preview.action, "continue_task");
  assert.equal(preview.taskId, TASK_ID);
  assert.equal(preview.workspaceId, WORKSPACE_ID);
  assert.equal(preview.instructionChars, instruction.length);
  assert.equal(preview.instructionDigest.length, 64);
  assert.equal(JSON.stringify(preview).includes(instruction), false);

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: "0".repeat(64),
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
  );
  assert.equal(mock.calls.length, 0);

  const result = await actions.continueTask({
    taskId: TASK_ID,
    instructionDigest: preview.instructionDigest,
    confirmationToken: preview.confirmationToken,
    confirmed: true,
  });
  assert.equal(result.status, "waiting");
  assert.deepEqual(mock.calls, [{ taskId: TASK_ID, instruction }]);

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
  );
  assert.equal(mock.calls.length, 1);
});

test("continuation confirmation fails closed after task state drift and consumes the token", async () => {
  const mock = mockService();
  const actions = new OperatorActionService(mock.service);
  const preview = await actions.previewTaskContinuation(TASK_ID, "Continue within the approved scope.");

  mock.setCurrent(task({ status: "failed", updatedAt: "2026-09-27T00:00:03.000Z", error: "new failure" }));

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
  );
  assert.equal(mock.calls.length, 0);

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
  );
});

test("expired continuation confirmation is consumed before delegation", async () => {
  let now = Date.parse("2026-09-27T00:00:00.000Z");
  const mock = mockService();
  const actions = new OperatorActionService(mock.service, () => now);
  const preview = await actions.previewTaskContinuation(TASK_ID, "Continue inside current authority.");
  now += 60_000;

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
  );
  assert.equal(mock.calls.length, 0);
});

test("continuation preview rejects active, rolled-back, and escalated tasks", async () => {
  for (const current of [
    task({ status: "running" }),
    task({ status: "rolled_back" }),
    task({
      status: "waiting_for_human",
      pendingEscalation: {
        escalationId: "55555555-5555-4555-8555-555555555555",
        taskId: TASK_ID,
        requestedAt: "2026-09-27T00:00:00.000Z",
        reason: "scope expansion",
        actionKind: "edit",
        actionFingerprint: "fingerprint",
        status: "pending",
        reversible: true,
      },
    }),
  ]) {
    const mock = mockService(current);
    const actions = new OperatorActionService(mock.service);
    await assert.rejects(
      actions.previewTaskContinuation(TASK_ID, "Continue safely."),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    assert.equal(mock.calls.length, 0);
  }
});

test("machine continuation authority failures propagate after one-time operator confirmation", async () => {
  const current = task();
  let calls = 0;
  const authorityError = Object.assign(new Error("Task binding is stale"), { code: "task_binding_stale" });
  const service = {
    getTask: async () => current,
    rejectEscalation: async () => current,
    continueTask: async () => {
      calls += 1;
      throw authorityError;
    },
  };
  const actions = new OperatorActionService(service);
  const preview = await actions.previewTaskContinuation(TASK_ID, "Continue safely.");

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error === authorityError,
  );
  assert.equal(calls, 1);

  await assert.rejects(
    actions.continueTask({
      taskId: TASK_ID,
      instructionDigest: preview.instructionDigest,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    }),
    (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
  );
  assert.equal(calls, 1);
});
