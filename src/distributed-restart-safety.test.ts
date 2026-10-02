import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DistributedCandidateRouter } from "./distributed-candidate-router.js";
import {
  DistributedCandidateLifecycleError,
  DistributedCandidateRenewalAuthority,
} from "./distributed-candidate-lifecycle.js";
import type {
  DistributedMachineRegistrationV1,
  DistributedWorkspacePlacementV1,
  DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  DistributedFenceAuthority,
  DistributedFenceError,
  ReferenceLinearizableFenceBackend,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import {
  DistributedExecutionAdmissionGateway,
  FileDistributedDispatchReplayStore,
} from "./distributed-execution-admission.js";
import {
  DistributedTargetRuntimeHandoffCoordinator,
  DistributedTargetRuntimeHandoffError,
} from "./distributed-target-runtime-handoff.js";
import { DISTRIBUTED_RESTART_SAFETY_CONTRACT } from "./distributed-restart-safety.js";
import type {
  LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import type { DistributedMachineLivenessViewV1 } from "./distributed-machine-transport.js";
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
  project: crypto.randomUUID(),
  plan: crypto.randomUUID(),
  profile: crypto.randomUUID(),
  worker: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  lease: crypto.randomUUID(),
  leaseFence: crypto.randomUUID(),
};

const baseNow = new Date("2026-09-29T14:00:00.000Z");

function registration(): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: ids.registration,
    machineId: ids.machine,
    revision: 1,
    createdAt: baseNow.toISOString(),
    updatedAt: baseNow.toISOString(),
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
    authority: "identity_only",
  };
}

function placement(): DistributedWorkspacePlacementV1 {
  return {
    schemaVersion: 1,
    placementId: ids.placement,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    revision: 1,
    createdAt: baseNow.toISOString(),
    updatedAt: baseNow.toISOString(),
    authority: "routing_only",
  };
}

function assignment(expiresAt = new Date(baseNow.getTime() + 120_000)): DistributedWriterCandidateAssignmentV1 {
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
    issuedAt: baseNow.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function liveness(validUntil = new Date(baseNow.getTime() + 120_000)): DistributedMachineLivenessViewV1 {
  return {
    schemaVersion: 1,
    registrationId: ids.registration,
    machineId: ids.machine,
    registrationRevision: 1,
    state: "live",
    acceptingWriterCandidates: true,
    observedAt: baseNow.toISOString(),
    validUntil: validUntil.toISOString(),
    authority: "observation_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function runtimeTask(): OrchestratorTask {
  return {
    id: ids.task,
    goal: "Change only approved file",
    workspace: process.cwd(),
    status: "created",
    createdAt: baseNow.toISOString(),
    updatedAt: baseNow.toISOString(),
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
    runCount: 1,
  } as OrchestratorTask;
}

function writerAuthority(): LeaseAwareWriterAuthorityV1 {
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
    expiresAt: new Date(baseNow.getTime() + 60_000).toISOString(),
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

test("M12O restart contract grants no recovery or takeover authority", () => {
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.restartCreatesAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.consumedDispatchReusableAfterRestart, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.staleCandidateReusableAfterRestart, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.staleFenceReusableAfterRestart, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.processLocalHandoffReusableAfterRestart, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.priorRuntimeHistoryEligibleForFreshAdmission, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.distributedTakeoverEnabled, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsSafetyPlanAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsWriterLeaseAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsCredentialAuthority, false);
  assert.equal(DISTRIBUTED_RESTART_SAFETY_CONTRACT.grantsReleaseAuthority, false);
});

test("M12O consumed dispatch stays consumed when replay-store process state is recreated", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12o-replay-"));
  const dispatchId = crypto.randomUUID();
  const expiresAt = new Date(baseNow.getTime() + 30_000).toISOString();
  try {
    const beforeRestart = new FileDistributedDispatchReplayStore(directory);
    assert.equal(await beforeRestart.consume(dispatchId, expiresAt), true);

    const afterRestart = new FileDistributedDispatchReplayStore(directory);
    assert.equal(await afterRestart.consume(dispatchId, expiresAt), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M12O expired candidate cannot be renewed by a freshly constructed target lifecycle", async () => {
  const afterRestartNow = new Date(baseNow.getTime() + 10_000);
  const expired = assignment(new Date(baseNow.getTime() + 5_000));
  const router = new DistributedCandidateRouter(
    {
      async list() { return [placement()]; },
      async get() { return placement(); },
    },
    { async get() { return registration(); } },
    { async getLiveness() { return liveness(new Date(baseNow.getTime() + 60_000)); } },
    { now: () => new Date(afterRestartNow) },
  );
  const renewal = new DistributedCandidateRenewalAuthority(router, {
    now: () => new Date(afterRestartNow),
  });

  await assert.rejects(
    () => renewal.renew(expired, 30_000),
    (error: unknown) => error instanceof DistributedCandidateLifecycleError
      && error.code === "candidate_not_current",
  );
});

test("M12O superseded fence cannot be reused or renewed by a fresh authority object", async () => {
  let now = new Date(baseNow);
  const backend = new ReferenceLinearizableFenceBackend();
  const candidate = assignment();
  const validator = { async assertCandidateCurrent() {} };
  const firstAuthority = new DistributedFenceAuthority(backend, validator, {
    now: () => new Date(now),
    idFactory: () => crypto.randomUUID(),
  });
  const first = await firstAuthority.acquire({ assignment: candidate, ttlMs: 30_000 });
  await firstAuthority.revoke(first);

  now = new Date(baseNow.getTime() + 1_000);
  const replacement = await firstAuthority.acquire({ assignment: candidate, ttlMs: 30_000 });
  assert.equal(replacement.generation, first.generation + 1);

  const restartedAuthority = new DistributedFenceAuthority(backend, validator, {
    now: () => new Date(now),
    idFactory: () => crypto.randomUUID(),
  });
  await assert.rejects(
    () => restartedAuthority.validateCurrent(first, candidate),
    (error: unknown) => error instanceof DistributedFenceError && error.code === "fence_stale",
  );
  await assert.rejects(
    () => restartedAuthority.renew(first, candidate, 30_000),
    (error: unknown) => error instanceof DistributedFenceError && error.code === "fence_stale",
  );
});

test("M12O prior runtime history cannot re-enter M12H after target process restart", async () => {
  let admissionCalls = 0;
  const candidate = assignment();
  const fence: DistributedFenceClaimV1 = {
    schemaVersion: 1,
    fenceId: crypto.randomUUID(),
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    candidateAssignmentId: ids.assignment,
    generation: 1,
    issuedAt: baseNow.toISOString(),
    expiresAt: new Date(baseNow.getTime() + 30_000).toISOString(),
    authority: "fencing_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  const dispatch = {
    schemaVersion: 1 as const,
    dispatchId: crypto.randomUUID(),
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    candidateAssignmentId: ids.assignment,
    fenceId: fence.fenceId,
    fenceGeneration: 1,
    issuedAt: baseNow.toISOString(),
    expiresAt: new Date(baseNow.getTime() + 5_000).toISOString(),
    authority: "execution_request_only" as const,
    grantsTaskAuthority: false as const,
    grantsFilesystemAuthority: false as const,
    grantsSafetyPlanAuthority: false as const,
    grantsWriterLeaseAuthority: false as const,
    grantsCredentialAuthority: false as const,
    grantsReleaseAuthority: false as const,
  };

  const restartedAdmission = new DistributedExecutionAdmissionGateway({
    targetIdentity: {
      machineId: ids.machine,
      machineRegistrationId: ids.registration,
      machineRegistrationRevision: 1,
    },
    registrations: {
      async get() {
        admissionCalls += 1;
        return registration();
      },
    },
    placements: { async get() { return placement(); } },
    candidates: { async assertCandidateCurrent() {} },
    fences: { async validateCurrent() {} },
    replayStore: { async consume() { return true; } },
    now: () => new Date(baseNow),
  });
  const restartedFenceAuthority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    { async assertCandidateCurrent() {} },
    { now: () => new Date(baseNow), idFactory: () => crypto.randomUUID() },
  );
  const restartedCoordinator = new DistributedTargetRuntimeHandoffCoordinator({
    admission: restartedAdmission,
    tasks: { async loadCurrent() { return runtimeTask(); } },
    authorityProvider: { async revalidateCurrent() { return writerAuthority(); } },
    lease: lease(),
    fenceAuthority: restartedFenceAuthority,
    now: () => new Date(baseNow),
  });

  await assert.rejects(
    () => restartedCoordinator.prepare(dispatch, candidate, fence),
    (error: unknown) => error instanceof DistributedTargetRuntimeHandoffError
      && error.code === "task_not_current",
  );
  assert.equal(admissionCalls, 0);
});
