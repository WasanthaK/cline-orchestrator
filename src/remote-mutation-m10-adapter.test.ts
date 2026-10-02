import assert from "node:assert/strict";
import test from "node:test";
import type { OperatorMutationActionV1 } from "./operator-capabilities.js";
import { RemoteMutationBridgeError, type RemoteMutationProposalV1 } from "./remote-mutation-bridge.js";
import {
  RemoteMutationM10Adapter,
  REMOTE_MUTATION_M10_ACTIONS,
  type RemoteMutationM10AdapterDependencies,
} from "./remote-mutation-m10-adapter.js";

const TASK = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const WORKFLOW = "33333333-3333-4333-8333-333333333333";
const EXPECTED_TASK = "44444444-4444-4444-8444-444444444444";
const TOKEN = "M10_CONFIRMATION_TOKEN_MUST_NOT_LEAK";
const EXPIRES = "2026-09-27T15:01:00.000Z";

function proposal(action: OperatorMutationActionV1): RemoteMutationProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: "55555555-5555-4555-8555-555555555555",
    registrationId: "66666666-6666-4666-8666-666666666666",
    sessionId: "77777777-7777-4777-8777-777777777777",
    remotePrincipalId: "88888888-8888-4888-8888-888888888888",
    registrationRevision: 1,
    requestId: "99999999-9999-4999-8999-999999999999",
    action,
    targetId: action === "resume_workflow" ? WORKFLOW : TASK,
    payloadDigest: "a".repeat(64),
    payloadChars: 2,
    revision: 1,
    status: "pending",
    createdAt: "2026-09-27T15:00:00.000Z",
  };
}

function dependencies(calls: string[]): RemoteMutationM10AdapterDependencies {
  const core = {
    async previewEscalationRejection(taskId: string) {
      calls.push(`preview:reject:${taskId}`);
      return { action: "reject_escalation", taskId, workspaceId: WORKSPACE, escalationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", confirmationText: "reject", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async previewEscalationApproval(taskId: string) {
      calls.push(`preview:approve:${taskId}`);
      return { action: "approve_escalation", taskId, workspaceId: WORKSPACE, escalationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", confirmationText: "approve", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async previewTaskAbort(taskId: string) {
      calls.push(`preview:abort:${taskId}`);
      return { action: "abort_task", taskId, workspaceId: WORKSPACE, confirmationText: "abort", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async previewTaskRollback(taskId: string) {
      calls.push(`preview:rollback:${taskId}`);
      return { action: "rollback_task", taskId, workspaceId: WORKSPACE, checkpointId: "checkpoint-opaque", confirmationText: "rollback", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async previewTaskContinuation(taskId: string, instruction: string) {
      calls.push(`preview:continue:${taskId}:${instruction}`);
      return { action: "continue_task", taskId, workspaceId: WORKSPACE, instructionDigest: "b".repeat(64), instructionChars: instruction.trim().length, confirmationText: "continue", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async rejectEscalation(input: { confirmationToken: string }) {
      calls.push(`execute:reject:${input.confirmationToken}`);
      return { ok: true };
    },
    async approveEscalation(input: { confirmationToken: string }) {
      calls.push(`execute:approve:${input.confirmationToken}`);
      return { ok: true };
    },
    async abortTask(input: { confirmationToken: string }) {
      calls.push(`execute:abort:${input.confirmationToken}`);
      return { ok: true };
    },
    async rollbackTask(input: { confirmationToken: string }) {
      calls.push(`execute:rollback:${input.confirmationToken}`);
      return { ok: true };
    },
    async continueTask(input: { confirmationToken: string }) {
      calls.push(`execute:continue:${input.confirmationToken}`);
      return { ok: true };
    },
  };
  const workflow = {
    async previewWorkflowResume(workflowId: string) {
      calls.push(`preview:workflow:${workflowId}`);
      return {
        action: "resume_workflow",
        workflowId,
        expectedTaskId: EXPECTED_TASK,
        workflowStatus: "ready",
        counts: { totalNodes: 2, created: 1, active: 0, completed: 1, waitingForHuman: 0, terminalNonSuccess: 0 },
        confirmationText: "resume",
        expiresAt: EXPIRES,
        confirmationToken: TOKEN,
      };
    },
    async resumeWorkflow(input: { confirmationToken: string }) {
      calls.push(`execute:workflow:${input.confirmationToken}`);
      return { resumed: true };
    },
  };
  const workerRecovery = {
    async previewScheduledWriterRecovery(taskId: string) {
      calls.push(`preview:worker:${taskId}`);
      return { action: "recover_scheduled_writer", taskId, workspaceId: WORKSPACE, runCount: 3, sessionGeneration: 2, confirmationText: "recover", expiresAt: EXPIRES, confirmationToken: TOKEN };
    },
    async recoverScheduledWriter(input: { confirmationToken: string }) {
      calls.push(`execute:worker:${input.confirmationToken}`);
      return { recovered: true };
    },
  };
  return { core, workflow, workerRecovery } as unknown as RemoteMutationM10AdapterDependencies;
}

test("composite M10 adapter covers exactly the seven operator mutation actions", () => {
  assert.deepEqual(REMOTE_MUTATION_M10_ACTIONS, [
    "reject_escalation",
    "approve_escalation",
    "abort_task",
    "rollback_task",
    "continue_task",
    "resume_workflow",
    "recover_scheduled_writer",
  ]);
});

test("all seven mappings hide M10 confirmation token from binding and execute only through captured confirmation", async () => {
  for (const action of REMOTE_MUTATION_M10_ACTIONS) {
    const calls: string[] = [];
    const adapter = new RemoteMutationM10Adapter(dependencies(calls));
    const payload = action === "continue_task" ? { instruction: "  continue safely  " } : {};
    const prepared = await adapter.prepare({ proposal: proposal(action), payload });
    assert.equal(prepared.expiresAt, EXPIRES, action);
    assert.equal(prepared.actionBinding.includes(TOKEN), false, action);
    assert.equal(calls.length, 1, action);
    await prepared.execute();
    assert.equal(calls.length, 2, action);
    assert.match(calls[1] ?? "", new RegExp(TOKEN), action);
  }
});

test("continue_task binds exact instruction into M10 preview while binding exposes only its digest metadata", async () => {
  const calls: string[] = [];
  const adapter = new RemoteMutationM10Adapter(dependencies(calls));
  const prepared = await adapter.prepare({
    proposal: proposal("continue_task"),
    payload: { instruction: "  exact remote continuation  " },
  });
  assert.equal(calls[0], `preview:continue:${TASK}:  exact remote continuation  `);
  assert.equal(prepared.actionBinding.includes("exact remote continuation"), false);
  assert.equal(prepared.actionBinding.includes("b".repeat(64)), true);
});

test("actions with no payload reject unexpected remote fields before M10 preview", async () => {
  const calls: string[] = [];
  const adapter = new RemoteMutationM10Adapter(dependencies(calls));
  await assert.rejects(
    adapter.prepare({ proposal: proposal("abort_task"), payload: { reason: "remote override" } }),
    (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_invalid",
  );
  assert.deepEqual(calls, []);
});

test("workflow and worker actions fail closed when their M10 surface is not configured", async () => {
  const calls: string[] = [];
  const deps = dependencies(calls);
  const adapter = new RemoteMutationM10Adapter({ core: deps.core });
  await assert.rejects(
    adapter.prepare({ proposal: proposal("resume_workflow"), payload: {} }),
    (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_invalid",
  );
  await assert.rejects(
    adapter.prepare({ proposal: proposal("recover_scheduled_writer"), payload: {} }),
    (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_invalid",
  );
  assert.deepEqual(calls, []);
});
