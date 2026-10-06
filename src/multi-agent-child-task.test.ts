import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeMultiAgentChildTask,
  MultiAgentChildTaskError,
  MULTI_AGENT_CHILD_TASK_CONTRACT,
} from "./multi-agent-child-task.js";
import type { MultiAgentDelegationEnvelopeV1 } from "./multi-agent-delegation-contract.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const delegation: MultiAgentDelegationEnvelopeV1 = {
  schemaVersion: 1,
  delegationId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-06T04:00:00.000Z",
  parentSupervisorTaskId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  projectId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  workspaceRegistryRevision: 2,
  safetyPlanId: "66666666-6666-4666-8666-666666666666",
  safetyProfileId: "77777777-7777-4777-8777-777777777777",
  safetyProfileRevision: 3,
  workerProfileId: "default",
  objective: "Implement child A",
  acceptanceCriteria: ["A is correct"],
  allowedPathPatterns: ["src/a.ts"],
  protectedPathPatterns: [".env*", ".git/**"],
  authority: "delegation_envelope_only",
  constraints: {
    scopeExpansion: "stop_and_escalate",
    exactParentPathSelectionOnly: true,
    validationRunsExternally: true,
    subdelegationAllowed: false,
    agentTeamsAllowed: false,
    shellAllowed: false,
    networkAllowed: false,
    mcpAllowed: false,
    pluginsAllowed: false,
  },
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const set: MultiAgentDelegationSetV1 = {
  schemaVersion: 1,
  delegationSetId: "88888888-8888-4888-8888-888888888888",
  createdAt: "2026-10-06T04:01:00.000Z",
  coordinationMode: "parallel_disjoint",
  parentSupervisorTaskId: delegation.parentSupervisorTaskId,
  taskId: delegation.taskId,
  projectId: delegation.projectId,
  workspaceId: delegation.workspaceId,
  workspaceRegistryRevision: delegation.workspaceRegistryRevision,
  safetyPlanId: delegation.safetyPlanId,
  safetyProfileId: delegation.safetyProfileId,
  safetyProfileRevision: delegation.safetyProfileRevision,
  workerProfileId: delegation.workerProfileId,
  delegationIds: [delegation.delegationId],
  overlappingDelegationPairs: [],
  authority: "delegation_set_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

test("M13C materialization remains non-executing and authority-free", () => {
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.executableTask, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.persistsIntoTaskStore, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.startsWorker, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.acquiresWriterLease, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.createsDispatch, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.allowsSubdelegation, false);
  assert.equal(MULTI_AGENT_CHILD_TASK_CONTRACT.grantsTaskAuthority, false);
});

test("validated child materializes with exact parent/Safety binding and narrowed scope", () => {
  const child = materializeMultiAgentChildTask(set, delegation, {
    now: () => new Date("2026-10-06T04:02:00.000Z"),
    idFactory: () => "99999999-9999-4999-8999-999999999999",
  });

  assert.equal(child.childTaskId, "99999999-9999-4999-8999-999999999999");
  assert.equal(child.delegationSetId, set.delegationSetId);
  assert.equal(child.delegationId, delegation.delegationId);
  assert.equal(child.parentTaskId, delegation.taskId);
  assert.equal(child.workspaceId, delegation.workspaceId);
  assert.equal(child.safetyPlanId, delegation.safetyPlanId);
  assert.deepEqual(child.allowedPathPatterns, ["src/a.ts"]);
  assert.equal(child.executable, false);
  assert.equal(child.requiresIndependentExecutionAdmission, true);
  assert.equal(child.requiresParentBindingRevalidation, true);
  assert.equal(child.authority, "child_task_materialization_only");
});

test("delegation outside the validated set is rejected", () => {
  const other = {
    ...delegation,
    delegationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  assert.throws(
    () => materializeMultiAgentChildTask(set, other),
    (error: unknown) => error instanceof MultiAgentChildTaskError
      && error.code === "delegation_not_in_set",
  );
});

test("parent binding drift between set and delegation is rejected", () => {
  const drifted = {
    ...delegation,
    workspaceRegistryRevision: delegation.workspaceRegistryRevision + 1,
  };
  assert.throws(
    () => materializeMultiAgentChildTask(set, drifted),
    (error: unknown) => error instanceof MultiAgentChildTaskError
      && error.code === "binding_mismatch",
  );
});

test("materialization rejects widened child authority", () => {
  const widened: MultiAgentDelegationEnvelopeV1 = {
    ...delegation,
    grantsFilesystemAuthority: true as false,
  };
  assert.throws(
    () => materializeMultiAgentChildTask(set, widened),
    (error: unknown) => error instanceof MultiAgentChildTaskError
      && error.code === "delegation_invalid",
  );
});

test("materialization requires opaque child identity", () => {
  assert.throws(
    () => materializeMultiAgentChildTask(
      set,
      delegation,
      { idFactory: () => "not-a-uuid" },
    ),
    (error: unknown) => error instanceof MultiAgentChildTaskError
      && error.code === "materialization_invalid",
  );
});
