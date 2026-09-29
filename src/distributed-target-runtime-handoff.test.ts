import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  DistributedTargetRuntimeHandoffCoordinator,
  DistributedTargetRuntimeHandoffError,
  type DistributedTargetTaskLoader,
} from "./distributed-target-runtime-handoff.js";
import {
  createDistributedExecutionDispatch,
  type DistributedExecutionAdmissionReceiptV1,
  type DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { DistributedFenceClaimV1, DistributedFenceAuthority } from "./distributed-fencing.js";
import type {
  LeaseAwareWriterAuthorityProvider,
  LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import type { OrchestratorTask } from "./types.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const ids = {
  task: crypto.randomUUID(),
  workspace: crypto.randomUUID(),
  machine: crypto.randomUUID(),
  registration: crypto.randomUUID(),
  placement: crypto.randomUUID(),
  assignment: crypto.randomUUID(),
  fence: crypto.randomUUID(),
  dispatch: crypto.randomUUID(),
  project: crypto.randomUUID(),
  plan: crypto.randomUUID(),
  profile: crypto.randomUUID(),
  worker: crypto.randomUUID(),
  lease: crypto.randomUUID(),
  leaseFence: crypto.randomUUID(),
  owner: crypto.randomUUID(),
};

const now = new Date("2026-09-29T08:00:00.000Z");

function task(): OrchestratorTask {
  return {
    id: ids.task,
    goal: "Change only approved file",
    workspace: process.cwd(),
    status: "created",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    projectId: ids.project,
    workspaceId: ids.workspace,
    workspaceRegistryRevision: 1,
    safetyPlanId: ids.plan,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: ids.profile,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env"],
    workerProfileId: ids.worker,
    validationCommands: [],
  } as OrchestratorTask;
}

function assignment(): DistributedWriterCandidateAssignmentV1 {
  return {
    schemaVersion: 1,
    assignmentId: ids.assignment,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function fence(): DistributedFenceClaimV1 {
  return {
    schemaVersion: 1,
    fenceId: ids.fence,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    candidateAssignmentId: ids.assignment,
    generation: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    authority: "fencing_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function authority(): LeaseAwareWriterAuthorityV1 {
  return {
    schemaVersion: 1,
    taskId: ids.task,
    projectId: ids.project,
    workspaceId: ids.workspace,
    workspaceRegistryRevision: 1,
    safetyPlanId: ids.plan,
    policyVersion: "policy-v1",
    safetyProfileId: ids.profile,
    safetyProfileRevision: 1,
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: [".env"],
    workerProfileId: ids.worker,
    ownerInstanceId: ids.owner,
  };
}

function lease(): WriterLeaseSession {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: ids.workspace,
    stateRevision: 1,
    leaseId: ids.lease,
    fenceToken: ids.leaseFence,
    taskId: ids.task,
    ownerInstanceId: ids.owner,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    authority: "coordination_only",
  };
  const controller = new AbortController();
  return {
    taskId: ids.task,
    workspaceId: ids.workspace,
    ownerInstanceId: ids.owner,
    signal: controller.signal,
    currentClaim: () => structuredClone(claim),
    validateCurrent: async () => undefined,
  };
}

function admissionReceipt(dispatch: DistributedExecutionDispatchV1): DistributedExecutionAdmissionReceiptV1 {
  return {
    schemaVersion: 1,
    dispatchId: dispatch.dispatchId,
    taskId: dispatch.taskId,
    workspaceId: dispatch.workspaceId,
    machineId: dispatch.machineId,
    fenceGeneration: dispatch.fenceGeneration,
    admittedAt: now.toISOString(),
    authority: "admission_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function fixtures(overrides: {
  taskLoader?: DistributedTargetTaskLoader;
  authorityProvider?: LeaseAwareWriterAuthorityProvider;
  lease?: WriterLeaseSession;
  admission?: any;
  fenceAuthority?: any;
} = {}) {
  const assigned = assignment();
  const fenced = fence();
  const dispatch = createDistributedExecutionDispatch(
    { assignment: assigned, fence: fenced, ttlMs: 5_000 },
    { now: () => now, idFactory: () => ids.dispatch },
  );
  const admission = overrides.admission ?? {
    admit: async () => admissionReceipt(dispatch),
  };
  const fenceAuthority = overrides.fenceAuthority ?? {
    validateCurrent: async () => undefined,
  };
  const coordinator = new DistributedTargetRuntimeHandoffCoordinator({
    admission,
    tasks: overrides.taskLoader ?? { loadCurrent: async () => task() },
    authorityProvider: overrides.authorityProvider ?? { revalidateCurrent: async () => authority() },
    lease: overrides.lease ?? lease(),
    fenceAuthority: fenceAuthority as DistributedFenceAuthority,
    now: () => now,
  });
  return { coordinator, assigned, fenced, dispatch };
}

test("M12H prepares only local handoff evidence + existing safety objects", async () => {
  const { coordinator, assigned, fenced, dispatch } = fixtures();
  const result = await coordinator.prepare(dispatch, assigned, fenced);
  assert.equal(result.evidence.authority, "local_runtime_handoff_evidence_only");
  assert.equal(result.evidence.grantsTaskAuthority, false);
  assert.equal(result.evidence.grantsFilesystemAuthority, false);
  assert.equal(result.evidence.grantsSafetyPlanAuthority, false);
  assert.equal(result.evidence.grantsWriterLeaseAuthority, false);
  assert.equal(result.evidence.grantsCredentialAuthority, false);
  assert.equal(result.evidence.grantsReleaseAuthority, false);
  assert.equal(result.task.id, ids.task);
  assert.equal(result.safetyOptions.lease.taskId, ids.task);
  assert.equal(result.safetyOptions.distributedFenceGuard?.workspaceId, ids.workspace);
});

test("M12H fails before admission when target-local durable authority is stale", async () => {
  let admitted = false;
  const stale = authority();
  stale.safetyProfileRevision = 2;
  const { coordinator, assigned, fenced, dispatch } = fixtures({
    authorityProvider: { revalidateCurrent: async () => stale },
    admission: { admit: async () => { admitted = true; return admissionReceipt(dispatch); } },
  });
  await assert.rejects(
    coordinator.prepare(dispatch, assigned, fenced),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "authority_not_current",
  );
  assert.equal(admitted, false);
});

test("M12H fails before admission when local fenced writer lease is wrong", async () => {
  let admitted = false;
  const badLease = lease();
  Object.defineProperty(badLease, "workspaceId", { value: crypto.randomUUID() });
  const { coordinator, assigned, fenced, dispatch } = fixtures({
    lease: badLease,
    admission: { admit: async () => { admitted = true; return admissionReceipt(dispatch); } },
  });
  await assert.rejects(
    coordinator.prepare(dispatch, assigned, fenced),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "lease_not_current",
  );
  assert.equal(admitted, false);
});

test("M12H propagates one-shot admission failure and prepares nothing", async () => {
  const { coordinator, assigned, fenced, dispatch } = fixtures({
    admission: { admit: async () => { throw new Error("dispatch already consumed"); } },
  });
  await assert.rejects(
    coordinator.prepare(dispatch, assigned, fenced),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "admission_failed",
  );
});

test("M12H rejects when shared fence changes after M12G admission", async () => {
  let checks = 0;
  const { coordinator, assigned, fenced, dispatch } = fixtures({
    fenceAuthority: {
      validateCurrent: async () => {
        checks += 1;
        throw new Error("stale generation");
      },
    },
  });
  await assert.rejects(
    coordinator.prepare(dispatch, assigned, fenced),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "fence_not_current",
  );
  assert.equal(checks, 1);
});

test("M12H rechecks local authority after admission to close TOCTOU", async () => {
  let calls = 0;
  const provider: LeaseAwareWriterAuthorityProvider = {
    revalidateCurrent: async () => {
      calls += 1;
      const value = authority();
      if (calls > 1) value.workspaceRegistryRevision = 2;
      return value;
    },
  };
  const { coordinator, assigned, fenced, dispatch } = fixtures({ authorityProvider: provider });
  await assert.rejects(
    coordinator.prepare(dispatch, assigned, fenced),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "authority_not_current",
  );
  assert.equal(calls, 2);
});
