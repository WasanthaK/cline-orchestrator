import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiAgentChildExecutionAdmissionError,
  MultiAgentChildExecutionAdmissionService,
  MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT,
  type MultiAgentParentAuthoritySnapshotV1,
} from "./multi-agent-child-execution-admission.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const child: MultiAgentChildTaskDescriptorV1 = {
  schemaVersion: 1,
  childTaskId: "11111111-1111-4111-8111-111111111111",
  materializedAt: "2026-10-06T05:00:00.000Z",
  delegationSetId: "22222222-2222-4222-8222-222222222222",
  delegationId: "33333333-3333-4333-8333-333333333333",
  coordinationMode: "parallel_disjoint",
  parentSupervisorTaskId: "44444444-4444-4444-8444-444444444444",
  parentTaskId: "55555555-5555-4555-8555-555555555555",
  projectId: "66666666-6666-4666-8666-666666666666",
  workspaceId: "77777777-7777-4777-8777-777777777777",
  workspaceRegistryRevision: 2,
  safetyPlanId: "88888888-8888-4888-8888-888888888888",
  safetyProfileId: "99999999-9999-4999-8999-999999999999",
  safetyProfileRevision: 3,
  workerProfileId: "default",
  objective: "Implement child",
  acceptanceCriteria: ["Child passes"],
  allowedPathPatterns: ["src/a.ts"],
  protectedPathPatterns: [".env*", ".git/**"],
  authority: "child_task_materialization_only",
  executable: false,
  requiresIndependentExecutionAdmission: true,
  requiresFreshWriterLease: true,
  requiresFreshDistributedFenceWhenDistributed: true,
  requiresParentBindingRevalidation: true,
  allowsSubdelegation: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const set: MultiAgentDelegationSetV1 = {
  schemaVersion: 1,
  delegationSetId: child.delegationSetId,
  createdAt: "2026-10-06T05:00:00.000Z",
  coordinationMode: child.coordinationMode,
  parentSupervisorTaskId: child.parentSupervisorTaskId,
  taskId: child.parentTaskId,
  projectId: child.projectId,
  workspaceId: child.workspaceId,
  workspaceRegistryRevision: child.workspaceRegistryRevision,
  safetyPlanId: child.safetyPlanId,
  safetyProfileId: child.safetyProfileId,
  safetyProfileRevision: child.safetyProfileRevision,
  workerProfileId: child.workerProfileId,
  delegationIds: [child.delegationId],
  overlappingDelegationPairs: [],
  authority: "delegation_set_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const current: MultiAgentParentAuthoritySnapshotV1 = {
  schemaVersion: 1,
  taskId: child.parentTaskId,
  projectId: child.projectId,
  workspaceId: child.workspaceId,
  workspaceRegistryRevision: child.workspaceRegistryRevision,
  safetyPlanId: child.safetyPlanId,
  safetyProfileId: child.safetyProfileId,
  safetyProfileRevision: child.safetyProfileRevision,
  workerProfileId: child.workerProfileId,
  allowedPathPatterns: ["src/a.ts", "src/b.ts"],
  protectedPathPatterns: [...child.protectedPathPatterns],
  status: "created",
  hasPendingEscalation: false,
  authority: "current_parent_task_authority",
};

test("M13D permit is short-lived/single-use but remains non-executing", () => {
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.shortLived, true);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.singleUse, true);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.createsWorker, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.acquiresWriterLease, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.createsDistributedDispatch, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_ADMISSION_CONTRACT.grantsTaskAuthority, false);
});

test("current parent binding issues and consumes one exact permit once", async () => {
  let now = new Date("2026-10-06T05:01:00.000Z");
  const service = new MultiAgentChildExecutionAdmissionService(
    { async revalidateCurrent() { return structuredClone(current); } },
    {
      now: () => new Date(now),
      ttlMs: 60_000,
      idFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      tokenFactory: () => "mae_abcdefghijklmnopqrstuvwxyz1234567890",
    },
  );

  const ticket = await service.issue(child, set);
  assert.equal(ticket.permit.childTaskId, child.childTaskId);
  assert.equal(ticket.permit.authority, "child_execution_admission_only");
  assert.equal(ticket.permit.grantsFilesystemAuthority, false);

  now = new Date("2026-10-06T05:01:30.000Z");
  const permit = service.consume(ticket.token, child, set);
  assert.equal(permit.permitId, ticket.permit.permitId);

  assert.throws(
    () => service.consume(ticket.token, child, set),
    (error: unknown) => error instanceof MultiAgentChildExecutionAdmissionError
      && error.code === "permit_replayed",
  );
});

test("parent binding drift fails admission issuance", async () => {
  const service = new MultiAgentChildExecutionAdmissionService({
    async revalidateCurrent() {
      return { ...current, workspaceRegistryRevision: current.workspaceRegistryRevision + 1 };
    },
  });
  await assert.rejects(
    () => service.issue(child, set),
    (error: unknown) => error instanceof MultiAgentChildExecutionAdmissionError
      && error.code === "parent_not_current",
  );
});

test("terminal parent or pending escalation cannot admit child execution", async () => {
  for (const drift of [
    { ...current, status: "completed" as const },
    { ...current, hasPendingEscalation: true },
  ]) {
    const service = new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent() { return drift; },
    });
    await assert.rejects(
      () => service.issue(child, set),
      (error: unknown) => error instanceof MultiAgentChildExecutionAdmissionError
        && error.code === "parent_not_executable",
    );
  }
});

test("set/mode drift fails before parent authority lookup", async () => {
  let calls = 0;
  const service = new MultiAgentChildExecutionAdmissionService({
    async revalidateCurrent() {
      calls += 1;
      return structuredClone(current);
    },
  });
  await assert.rejects(
    () => service.issue(child, { ...set, coordinationMode: "serialized" }),
    (error: unknown) => error instanceof MultiAgentChildExecutionAdmissionError
      && error.code === "binding_mismatch",
  );
  assert.equal(calls, 0);
});

test("expired permit cannot be consumed", async () => {
  let now = new Date("2026-10-06T05:02:00.000Z");
  const service = new MultiAgentChildExecutionAdmissionService(
    { async revalidateCurrent() { return structuredClone(current); } },
    {
      now: () => new Date(now),
      ttlMs: 5_000,
      tokenFactory: () => "mae_abcdefghijklmnopqrstuvwxyz0987654321",
    },
  );
  const ticket = await service.issue(child, set);
  now = new Date("2026-10-06T05:02:05.000Z");
  assert.throws(
    () => service.consume(ticket.token, child, set),
    (error: unknown) => error instanceof MultiAgentChildExecutionAdmissionError
      && error.code === "permit_expired",
  );
});
