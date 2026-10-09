import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FileMultiAgentChildExecutionPreparationStore,
  MultiAgentChildExecutionPreparationError,
  MultiAgentChildExecutionPreparationService,
  MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT,
  type MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentChildExecutionAdmissionReceiptV1 } from "./multi-agent-child-execution-admission.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const child: MultiAgentChildTaskDescriptorV1 = {
  schemaVersion: 1,
  childTaskId: "11111111-1111-4111-8111-111111111111",
  materializedAt: "2026-10-06T06:00:00.000Z",
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
  createdAt: "2026-10-06T06:00:00.000Z",
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

const receipt: MultiAgentChildExecutionAdmissionReceiptV1 = {
  schemaVersion: 1,
  permitId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  childTaskId: child.childTaskId,
  delegationSetId: child.delegationSetId,
  delegationId: child.delegationId,
  parentTaskId: child.parentTaskId,
  workspaceId: child.workspaceId,
  coordinationMode: child.coordinationMode,
  consumedAt: "2026-10-06T06:01:00.000Z",
  authority: "child_execution_admission_consumed_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const current: MultiAgentParentExecutionBindingV1 = {
  schemaVersion: 1,
  taskId: child.parentTaskId,
  projectId: child.projectId,
  workspaceId: child.workspaceId,
  workspaceRegistryRevision: child.workspaceRegistryRevision,
  safetyPlanId: child.safetyPlanId,
  safetyPolicyVersion: "policy-v1",
  safetyProfileId: child.safetyProfileId,
  safetyProfileRevision: child.safetyProfileRevision,
  workerProfileId: child.workerProfileId,
  allowedPathPatterns: ["src/a.ts", "src/b.ts"],
  protectedPathPatterns: [...child.protectedPathPatterns],
  trustedValidationCommands: ["npm test"],
  status: "created",
  hasPendingEscalation: false,
  authority: "current_parent_execution_binding",
};

test("M13E durable preparation remains outside TaskStore and non-executing", () => {
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.durable, true);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.executableTask, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.persistsIntoTaskStore, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.startsWorker, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.startsCline, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.acquiresWriterLease, false);
  assert.equal(MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT.grantsTaskAuthority, false);
});

test("consumed admission plus current parent binding persists one narrowed preparation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m13e-"));
  try {
    const store = new FileMultiAgentChildExecutionPreparationStore(root);
    const service = new MultiAgentChildExecutionPreparationService(
      { async revalidateCurrent() { return structuredClone(current); } },
      store,
      {
        now: () => new Date("2026-10-06T06:02:00.000Z"),
        idFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    );
    const prepared = await service.prepare(child, set, receipt);
    assert.equal(prepared.preparationId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.equal(prepared.safetyPolicyVersion, "policy-v1");
    assert.deepEqual(prepared.allowedPathPatterns, ["src/a.ts"]);
    assert.deepEqual(prepared.trustedValidationCommands, ["npm test"]);
    assert.equal(prepared.executable, false);
    assert.equal(prepared.authority, "child_execution_preparation_only");

    const durable = await store.load(child.childTaskId);
    assert.deepEqual(durable, prepared);

    await assert.rejects(
      () => service.prepare(child, set, receipt),
      (error: unknown) => error instanceof MultiAgentChildExecutionPreparationError
        && error.code === "preparation_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt mismatch is rejected before parent revalidation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m13e-"));
  let calls = 0;
  try {
    const service = new MultiAgentChildExecutionPreparationService(
      { async revalidateCurrent() { calls += 1; return structuredClone(current); } },
      new FileMultiAgentChildExecutionPreparationStore(root),
    );
    await assert.rejects(
      () => service.prepare(child, set, {
        ...receipt,
        childTaskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      (error: unknown) => error instanceof MultiAgentChildExecutionPreparationError
        && error.code === "binding_mismatch",
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("current parent binding drift or terminal state fails closed", async () => {
  for (const drift of [
    { ...current, safetyPolicyVersion: "" },
    { ...current, workspaceRegistryRevision: current.workspaceRegistryRevision + 1 },
    { ...current, status: "completed" as const },
    { ...current, hasPendingEscalation: true },
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "m13e-"));
    try {
      const service = new MultiAgentChildExecutionPreparationService(
        { async revalidateCurrent() { return drift as MultiAgentParentExecutionBindingV1; } },
        new FileMultiAgentChildExecutionPreparationStore(root),
      );
      await assert.rejects(() => service.prepare(child, set, receipt));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("corrupt durable preparation fails closed on load", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m13e-"));
  try {
    const store = new FileMultiAgentChildExecutionPreparationStore(root);
    const dir = path.join(root, "multi-agent-child-execution-preparations");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${child.childTaskId}.json`), "{bad-json", "utf8");
    await assert.rejects(
      () => store.load(child.childTaskId),
      (error: unknown) => error instanceof MultiAgentChildExecutionPreparationError
        && error.code === "store_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
