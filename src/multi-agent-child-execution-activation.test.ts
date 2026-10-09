import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiAgentChildExecutionActivationCoordinator,
  MultiAgentChildExecutionActivationError,
  MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT,
} from "./multi-agent-child-execution-activation.js";
import type {
  MultiAgentChildExecutionPreparationV1,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const preparation: MultiAgentChildExecutionPreparationV1 = {
  schemaVersion: 1,
  preparationId: "11111111-1111-4111-8111-111111111111",
  preparedAt: "2026-10-06T07:00:00.000Z",
  admissionPermitId: "22222222-2222-4222-8222-222222222222",
  admissionConsumedAt: "2026-10-06T06:59:00.000Z",
  childTaskId: "33333333-3333-4333-8333-333333333333",
  delegationSetId: "44444444-4444-4444-8444-444444444444",
  delegationId: "55555555-5555-4555-8555-555555555555",
  coordinationMode: "parallel_disjoint",
  parentSupervisorTaskId: "66666666-6666-4666-8666-666666666666",
  parentTaskId: "77777777-7777-4777-8777-777777777777",
  projectId: "88888888-8888-4888-8888-888888888888",
  workspaceId: "99999999-9999-4999-8999-999999999999",
  workspaceRegistryRevision: 2,
  safetyPlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  safetyPolicyVersion: "policy-v1",
  safetyProfileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  safetyProfileRevision: 3,
  workerProfileId: "default",
  objective: "Implement child A",
  acceptanceCriteria: ["A passes"],
  trustedValidationCommands: ["npm test"],
  allowedPathPatterns: ["src/a.ts"],
  protectedPathPatterns: [".env*", ".git/**"],
  state: "prepared",
  executable: false,
  requiresFreshParentBindingAtExecution: true,
  requiresFreshWriterLease: true,
  requiresFreshDistributedFenceWhenDistributed: true,
  authority: "child_execution_preparation_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const current: MultiAgentParentExecutionBindingV1 = {
  schemaVersion: 1,
  taskId: preparation.parentTaskId,
  projectId: preparation.projectId,
  workspaceId: preparation.workspaceId,
  workspaceRegistryRevision: preparation.workspaceRegistryRevision,
  safetyPlanId: preparation.safetyPlanId,
  safetyPolicyVersion: preparation.safetyPolicyVersion,
  safetyProfileId: preparation.safetyProfileId,
  safetyProfileRevision: preparation.safetyProfileRevision,
  workerProfileId: preparation.workerProfileId,
  allowedPathPatterns: ["src/a.ts", "src/b.ts"],
  protectedPathPatterns: [...preparation.protectedPathPatterns],
  trustedValidationCommands: [...preparation.trustedValidationCommands],
  status: "created",
  hasPendingEscalation: false,
  authority: "current_parent_execution_binding",
};

function lease(overrides: {
  taskId?: string;
  workspaceId?: string;
  leaseId?: string;
  validateError?: Error;
  mutateOnValidate?: boolean;
} = {}): WriterLeaseSession {
  let claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: overrides.workspaceId ?? preparation.workspaceId,
    stateRevision: 1,
    leaseId: overrides.leaseId ?? "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    fenceToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    taskId: overrides.taskId ?? preparation.childTaskId,
    ownerInstanceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    expiresAt: "2026-10-06T07:10:00.000Z",
    authority: "coordination_only",
  };
  const controller = new AbortController();
  return {
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
    signal: controller.signal,
    currentClaim: () => structuredClone(claim),
    validateCurrent: async () => {
      if (overrides.validateError) throw overrides.validateError;
      if (overrides.mutateOnValidate) {
        claim = {
          ...claim,
          leaseId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        };
      }
    },
  };
}

test("M13F activation remains non-runtime and consumes only an already-fresh lease", () => {
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT.requiresFreshSchedulerOwnedLease, true);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT.acquiresWriterLease, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT.invokesRuntime, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ACTIVATION_CONTRACT.grantsFilesystemAuthority, false);
});

test("fresh parent binding and exact child lease produce narrowed process-local runtime input", async () => {
  const session = lease();
  const coordinator = new MultiAgentChildExecutionActivationCoordinator(
    { async revalidateCurrent() { return structuredClone(current); } },
    { now: () => new Date("2026-10-06T07:01:00.000Z") },
  );

  const context = await coordinator.activate(preparation, session);
  assert.equal(context.lease, session);
  assert.equal(context.evidence.childTaskId, preparation.childTaskId);
  assert.equal(context.evidence.runtimeStartAuthorized, false);
  assert.equal(context.runtimeInput.childTaskId, preparation.childTaskId);
  assert.deepEqual(context.runtimeInput.allowedPathPatterns, ["src/a.ts"]);
  assert.deepEqual(context.runtimeInput.trustedValidationCommands, ["npm test"]);
  assert.equal(context.runtimeInput.runtimeStartAuthorized, false);
  assert.equal(context.runtimeInput.grantsTaskAuthority, false);
});

test("parent policy or narrowed execution binding drift fails before lease validation", async () => {
  for (const drift of [
    { ...current, safetyPolicyVersion: "policy-v2" },
    { ...current, allowedPathPatterns: ["src/b.ts"] },
    { ...current, trustedValidationCommands: ["npm run other"] },
    { ...current, hasPendingEscalation: true },
  ]) {
    let leaseChecks = 0;
    const session = lease();
    const wrapped: WriterLeaseSession = {
      ...session,
      validateCurrent: async () => { leaseChecks += 1; },
    };
    const coordinator = new MultiAgentChildExecutionActivationCoordinator({
      async revalidateCurrent() { return drift as MultiAgentParentExecutionBindingV1; },
    });
    await assert.rejects(() => coordinator.activate(preparation, wrapped));
    assert.equal(leaseChecks, 0);
  }
});

test("lease must be owned by exact child id and workspace", async () => {
  const coordinator = new MultiAgentChildExecutionActivationCoordinator({
    async revalidateCurrent() { return structuredClone(current); },
  });

  await assert.rejects(
    () => coordinator.activate(
      preparation,
      lease({ taskId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ),
    (error: unknown) => error instanceof MultiAgentChildExecutionActivationError
      && error.code === "lease_invalid",
  );

  await assert.rejects(
    () => coordinator.activate(
      preparation,
      lease({ workspaceId: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    ),
    (error: unknown) => error instanceof MultiAgentChildExecutionActivationError
      && error.code === "lease_invalid",
  );
});

test("lease validation failure or identity replacement fails closed", async () => {
  const coordinator = new MultiAgentChildExecutionActivationCoordinator({
    async revalidateCurrent() { return structuredClone(current); },
  });

  await assert.rejects(
    () => coordinator.activate(
      preparation,
      lease({ validateError: new Error("lease lost") }),
    ),
    (error: unknown) => error instanceof MultiAgentChildExecutionActivationError
      && error.code === "lease_invalid",
  );

  await assert.rejects(
    () => coordinator.activate(
      preparation,
      lease({ mutateOnValidate: true }),
    ),
    (error: unknown) => error instanceof MultiAgentChildExecutionActivationError
      && error.code === "lease_identity_changed",
  );
});
