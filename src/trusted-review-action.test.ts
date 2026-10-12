import assert from "node:assert/strict";
import test from "node:test";
import {
  OperatorActionService,
} from "./operator-action.js";
import {
  runTrustedReviewAction,
  TRUSTED_REVIEW_ACTION_CONTRACT,
  type TrustedReviewAction,
} from "./trusted-review-action.js";
import { createTaskCompletionPacket } from "./task-completion-packet.js";
import { buildTaskReviewProjection } from "./task-review-projection.js";
import type { PublicTaskView } from "./machine-orchestrator.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  task: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  escalation: "44444444-4444-4444-8444-444444444444",
};

function publicTask(overrides: Partial<PublicTaskView> = {}): PublicTaskView {
  return {
    taskId: IDS.task, projectId: IDS.project, workspaceId: IDS.workspace,
    goal: "Bearer PRIVATE_GOAL", status: "completed",
    createdAt: "2026-10-12T01:00:00.000Z", updatedAt: "2026-10-12T01:01:00.000Z",
    runCount: 1, sessionGeneration: 1, recoveryCount: 0, contextRotationCount: 0,
    validation: { configuredCommands: 0, runCount: 1, repairCount: 0, lastPassed: true },
    safety: {
      safetyPlanId: "55555555-5555-4555-8555-555555555555",
      policyVersion: "policy-v1", workerProfileId: "test",
      allowedPathPatterns: ["src/**"], protectedPathPatterns: [".env*"],
    },
    checkpoint: {
      checkpointId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", available: true,
      createdAt: "2026-10-12T01:00:00.000Z", runCount: 1,
    },
    ...overrides,
  };
}

function review(status: OrchestratorTask["status"] = "completed") {
  const task: OrchestratorTask = {
    id: IDS.task, workspace: "/PRIVATE_ROOT", goal: "PRIVATE_GOAL",
    status, createdAt: "2026-10-12T01:00:00.000Z",
    updatedAt: "2026-10-12T01:01:00.000Z",
  };
  return buildTaskReviewProjection(createTaskCompletionPacket(task, {
    taskId: IDS.task, projectId: IDS.project, workspaceId: IDS.workspace,
  }, { workspaceRoot: "/PRIVATE_ROOT" }));
}

function mock(initial = publicTask()) {
  let current = initial;
  const calls: string[] = [];
  const service = {
    getTask: async () => current,
    rejectEscalation: async () => {
      calls.push("reject_escalation");
      current = publicTask({ status: "aborted", updatedAt: "2026-10-12T01:02:00.000Z" });
      return current;
    },
    approveEscalation: async () => {
      calls.push("approve_escalation");
      current = publicTask({ status: "aborted", updatedAt: "2026-10-12T01:02:00.000Z" });
      return { task: current, nextAction: "new_safety_preview_required" as const };
    },
    abortTask: async () => {
      calls.push("abort_task");
      current = publicTask({ status: "aborted", updatedAt: "2026-10-12T01:02:00.000Z" });
      return current;
    },
    rollbackTask: async () => {
      calls.push("rollback_task");
      current = publicTask({ status: "rolled_back", updatedAt: "2026-10-12T01:02:00.000Z" });
      return current;
    },
  };
  return { service, calls, change(next: PublicTaskView) { current = next; } };
}

function pendingEscalation(): PublicTaskView {
  return publicTask({
    status: "waiting_for_human",
    pendingEscalation: {
      escalationId: IDS.escalation, taskId: IDS.task,
      requestedAt: "2026-10-12T01:00:00.000Z",
      reason: "PRIVATE_REASON",
      actionKind: "edit", actionFingerprint: "hash",
      status: "pending", reversible: true,
    },
  });
}

test("UX-D3 contract remains in-process with no browser task or release authority", () => {
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.browserExposure, "none");
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.requiresTrustedHostConfirmation, true);
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.actionTokenExposedToHost, false);
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.grantsTaskAuthority, false);
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(TRUSTED_REVIEW_ACTION_CONTRACT.grantsReleaseAuthority, false);
});

test("UX-D3 abort delegates once after trusted local review without leaking task goal/token", async () => {
  const m = mock(publicTask({ status: "running" }));
  const actions = new OperatorActionService(m.service);
  let reviews = 0;
  const result = await runTrustedReviewAction(review("running"), "abort_task", actions, {
    async confirmOperatorReview(preview) {
      reviews++;
      assert.equal(preview.action, "abort_task");
      assert.equal(preview.taskId, IDS.task);
      assert.equal(preview.workspaceId, IDS.workspace);
      assert.equal(preview.consequence, "abort");
      assert.equal(preview.grantsAuthority, false);
      assert.doesNotMatch(JSON.stringify(preview), /confirmationToken|Bearer|PRIVATE_GOAL|PRIVATE_ROOT|PRIVATE_REASON|safetyPlanId/);
      return true;
    },
  });
  assert.equal(reviews, 1);
  assert.deepEqual(m.calls, ["abort_task"]);
  assert.equal(result.outcome, "completed");
  assert.equal(result.resultingTaskStatus, "aborted");
  assert.equal(result.grantsAuthority, false);
  assert.doesNotMatch(JSON.stringify(result), /confirmationToken|PRIVATE_GOAL|PRIVATE_ROOT/);
});

test("UX-D3 declines without invoking the trusted mutation", async () => {
  const m = mock(pendingEscalation());
  const result = await runTrustedReviewAction(review("waiting_for_human"), "reject_escalation",
    new OperatorActionService(m.service), { confirmOperatorReview: async () => false });
  assert.equal(result.outcome, "cancelled");
  assert.deepEqual(m.calls, []);
});

test("UX-D3 keeps escalation approval separate and requires a new Safety preview", async () => {
  const m = mock(pendingEscalation());
  const result = await runTrustedReviewAction(review("waiting_for_human"), "approve_escalation",
    new OperatorActionService(m.service), {
      async confirmOperatorReview(preview) {
        assert.equal(preview.consequence, "new_safety_preview_required");
        return true;
      },
    });
  assert.deepEqual(m.calls, ["approve_escalation"]);
  assert.equal(result.outcome, "completed");
  assert.equal(result.nextAction, "new_safety_preview_required");
  assert.equal(result.grantsAuthority, false);
});

test("UX-D3 rollback shows exact opaque checkpoint, never file data", async () => {
  const m = mock();
  const result = await runTrustedReviewAction(review(), "rollback_task",
    new OperatorActionService(m.service), {
      async confirmOperatorReview(preview) {
        assert.equal(preview.consequence, "restore_checkpoint");
        assert.equal(preview.checkpointId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_ROOT|PRIVATE_GOAL|Bearer/);
        return true;
      },
    });
  assert.deepEqual(m.calls, ["rollback_task"]);
  assert.equal(result.resultingTaskStatus, "rolled_back");
});

test("UX-D3 fails closed on task drift after preview, without retry or secret exposure", async () => {
  const m = mock(publicTask({ status: "running" }));
  const actions = new OperatorActionService(m.service);
  const operation = runTrustedReviewAction(review("running"), "abort_task", actions, {
    async confirmOperatorReview() {
      m.change(publicTask({ status: "running", updatedAt: "2026-10-12T01:55:00.000Z" }));
      return true;
    },
  });
  await assert.rejects(operation, (err: unknown) => {
    assert.equal((err as { code: string }).code, "action_failed");
    assert.doesNotMatch(String(err), /Bearer|PRIVATE_GOAL|PRIVATE_ROOT/);
    return true;
  });
  assert.deepEqual(m.calls, []);
});

test("UX-D3 cancels on expiry; consumed service token cannot run", async () => {
  let now = Date.parse("2026-10-12T01:00:00.000Z");
  const m = mock(publicTask({ status: "running" }));
  const actions = new OperatorActionService(m.service, () => now);
  await assert.rejects(runTrustedReviewAction(review("running"), "abort_task", actions, {
    async confirmOperatorReview() { now += 60_000; return true; },
  }), { code: "action_failed" });
  assert.deepEqual(m.calls, []);
});

test("UX-D3 rejects forged task selector, missing confirmation and disabled service action", async () => {
  const m = mock();
  const actions = new OperatorActionService(m.service);
  const host = { confirmOperatorReview: async () => true };
  await assert.rejects(runTrustedReviewAction(
    { ...review(), grantsAuthority: true } as never,
    "rollback_task", actions, host), { code: "invalid_review" });
  await assert.rejects(runTrustedReviewAction(
    { ...review(), taskId: "different" },
    "rollback_task", actions, host), { code: "action_failed" });
  await assert.rejects(runTrustedReviewAction(review(), "rollback_task", actions,
    {} as never), { code: "confirmation_unavailable" });
  await assert.rejects(runTrustedReviewAction(review(), "deploy" as TrustedReviewAction,
    actions, host), { code: "invalid_review" });
  // The existing trusted service itself decides eligibility for a current task.
  await assert.rejects(runTrustedReviewAction(review(), "abort_task", actions, host),
    { code: "action_failed" });
});
