import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  DistributedTargetRuntimeHandoffCoordinator,
  DistributedTargetRuntimeHandoffError,
} from "./distributed-target-runtime-handoff.js";
import {
  createDistributedExecutionDispatch,
  type DistributedExecutionAdmissionReceiptV1,
} from "./distributed-execution-admission.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { DistributedFenceClaimV1, DistributedFenceAuthority } from "./distributed-fencing.js";
import type { LeaseAwareWriterAuthorityV1 } from "./lease-aware-hub-safety-runtime.js";
import type { OrchestratorTask } from "./types.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const id = () => crypto.randomUUID();

test("M12H rejects prior runtime history before consuming M12G admission", async () => {
  const taskId = id();
  const workspaceId = id();
  const machineId = id();
  const registrationId = id();
  const placementId = id();
  const assignmentId = id();
  const fenceId = id();
  const ownerInstanceId = id();
  const now = new Date("2026-09-29T08:30:00.000Z");

  const assignment: DistributedWriterCandidateAssignmentV1 = {
    schemaVersion: 1,
    assignmentId,
    taskId,
    workspaceId,
    machineId,
    machineRegistrationId: registrationId,
    machineRegistrationRevision: 1,
    placementId,
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
  const fence: DistributedFenceClaimV1 = {
    schemaVersion: 1,
    fenceId,
    taskId,
    workspaceId,
    machineId,
    machineRegistrationId: registrationId,
    machineRegistrationRevision: 1,
    placementId,
    placementRevision: 1,
    candidateAssignmentId: assignmentId,
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
  const dispatch = createDistributedExecutionDispatch(
    { assignment, fence, ttlMs: 5_000 },
    { now: () => now, idFactory: id },
  );

  const projectId = id();
  const safetyPlanId = id();
  const safetyProfileId = id();
  const workerProfileId = id();
  const staleTask = {
    id: taskId,
    goal: "Previously started task",
    workspace: process.cwd(),
    status: "created",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    projectId,
    workspaceId,
    workspaceRegistryRevision: 1,
    safetyPlanId,
    safetyPolicyVersion: "policy-v1",
    safetyProfileId,
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env"],
    workerProfileId,
    validationCommands: [],
    clineSessionId: id(),
    sessionGeneration: 1,
    runCount: 1,
  } as OrchestratorTask;
  const currentAuthority: LeaseAwareWriterAuthorityV1 = {
    schemaVersion: 1,
    taskId,
    projectId,
    workspaceId,
    workspaceRegistryRevision: 1,
    safetyPlanId,
    policyVersion: "policy-v1",
    safetyProfileId,
    safetyProfileRevision: 1,
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: [".env"],
    workerProfileId,
    ownerInstanceId,
  };

  const leaseClaim = {
    schemaVersion: 1 as const,
    workspaceId,
    stateRevision: 1,
    leaseId: id(),
    fenceToken: id(),
    taskId,
    ownerInstanceId,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    authority: "coordination_only" as const,
  };
  const lease: WriterLeaseSession = {
    taskId,
    workspaceId,
    ownerInstanceId,
    signal: new AbortController().signal,
    currentClaim: () => structuredClone(leaseClaim),
    validateCurrent: async () => undefined,
  };

  let admissionCalls = 0;
  const coordinator = new DistributedTargetRuntimeHandoffCoordinator({
    tasks: { loadCurrent: async () => structuredClone(staleTask) },
    authorityProvider: { revalidateCurrent: async () => currentAuthority },
    lease,
    fenceAuthority: { validateCurrent: async () => undefined } as unknown as DistributedFenceAuthority,
    admission: {
      admit: async (): Promise<DistributedExecutionAdmissionReceiptV1> => {
        admissionCalls += 1;
        throw new Error("must not be reached");
      },
    } as any,
    now: () => now,
  });

  await assert.rejects(
    coordinator.prepare(dispatch, assignment, fence),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError && error.code === "task_not_current",
  );
  assert.equal(admissionCalls, 0);
});
