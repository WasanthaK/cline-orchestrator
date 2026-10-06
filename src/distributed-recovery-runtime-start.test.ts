import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedRecoveryRuntimeStartCoordinator,
  DistributedRecoveryRuntimeStartError,
  DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT,
} from "./distributed-recovery-runtime-start.js";
import type { DistributedRecoveryReacquisitionPreparationEvidenceV1 } from "./distributed-recovery-reacquisition-preparation.js";
import type { DistributedTargetRuntimeHandoffContext } from "./distributed-target-runtime-handoff.js";
import type { RenewableDistributedWriterFenceGuard } from "./distributed-write-fence-guard.js";
import type { OrchestratorTask } from "./types.js";

const ids = {
  proposal: "11111111-1111-4111-8111-111111111111",
  delivery: "22222222-2222-4222-8222-222222222222",
  dispatch: "33333333-3333-4333-8333-333333333333",
  task: "44444444-4444-4444-8444-444444444444",
  workspace: "55555555-5555-4555-8555-555555555555",
  machine: "66666666-6666-4666-8666-666666666666",
  registration: "77777777-7777-4777-8777-777777777777",
  placement: "88888888-8888-4888-8888-888888888888",
  assignment: "99999999-9999-4999-8999-999999999999",
  fence: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  lease: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  localFence: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const preparation: DistributedRecoveryReacquisitionPreparationEvidenceV1 = {
  schemaVersion: 1,
  proposalId: ids.proposal,
  deliveryId: ids.delivery,
  taskId: ids.task,
  workspaceId: ids.workspace,
  machineId: ids.machine,
  machineRegistrationId: ids.registration,
  machineRegistrationRevision: 2,
  placementId: ids.placement,
  placementRevision: 3,
  candidateAssignmentId: ids.assignment,
  fenceId: ids.fence,
  fenceGeneration: 7,
  localLeaseId: ids.lease,
  localFenceToken: ids.localFence,
  preparedAt: "2026-10-05T14:30:00.000Z",
  requiresFreshDispatch: true,
  requiresFreshAdmission: true,
  requiresTargetLocalAuthorityReentry: true,
  authority: "recovery_reacquisition_preparation_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function context(overrides: {
  leaseId?: string;
  fenceId?: string;
  fenceGeneration?: number;
  leaseValidationError?: Error;
  fenceValidationError?: Error;
} = {}): DistributedTargetRuntimeHandoffContext {
  const controller = new AbortController();
  const leaseClaim = {
    schemaVersion: 1 as const,
    workspaceId: ids.workspace,
    stateRevision: 1,
    leaseId: overrides.leaseId ?? ids.lease,
    fenceToken: ids.localFence,
    taskId: ids.task,
    ownerInstanceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    expiresAt: "2026-10-05T14:31:00.000Z",
    authority: "coordination_only" as const,
  };
  const fenceClaim = {
    schemaVersion: 1 as const,
    fenceId: overrides.fenceId ?? ids.fence,
    workspaceId: ids.workspace,
    taskId: ids.task,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 2,
    placementId: ids.placement,
    placementRevision: 3,
    candidateAssignmentId: ids.assignment,
    generation: overrides.fenceGeneration ?? 7,
    issuedAt: "2026-10-05T14:30:00.000Z",
    expiresAt: "2026-10-05T14:30:30.000Z",
    authority: "fencing_only" as const,
    grantsTaskAuthority: false as const,
    grantsFilesystemAuthority: false as const,
    grantsSafetyPlanAuthority: false as const,
    grantsWriterLeaseAuthority: false as const,
    grantsCredentialAuthority: false as const,
    grantsReleaseAuthority: false as const,
  };
  const assignment = {
    schemaVersion: 1 as const,
    assignmentId: ids.assignment,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 2,
    placementId: ids.placement,
    placementRevision: 3,
    issuedAt: "2026-10-05T14:30:00.000Z",
    expiresAt: "2026-10-05T14:31:00.000Z",
    authority: "coordination_only" as const,
    grantsTaskAuthority: false as const,
    grantsFilesystemAuthority: false as const,
    grantsSafetyPlanAuthority: false as const,
    grantsWriterLeaseAuthority: false as const,
    grantsCredentialAuthority: false as const,
    grantsReleaseAuthority: false as const,
  };

  const distributedFenceGuard: RenewableDistributedWriterFenceGuard = {
    taskId: ids.task,
    workspaceId: ids.workspace,
    currentClaim: () => structuredClone(fenceClaim),
    currentAssignment: () => structuredClone(assignment),
    renewCandidate: async () => structuredClone(assignment),
    renew: async () => structuredClone(fenceClaim),
    validateCurrent: async () => {
      if (overrides.fenceValidationError) throw overrides.fenceValidationError;
    },
  };

  return {
    evidence: {
      schemaVersion: 1,
      dispatchId: ids.dispatch,
      taskId: ids.task,
      workspaceId: ids.workspace,
      machineId: ids.machine,
      fenceGeneration: 7,
      admittedAt: "2026-10-05T14:30:01.000Z",
      preparedAt: "2026-10-05T14:30:02.000Z",
      authority: "local_runtime_handoff_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    task: {
      id: ids.task,
      goal: "recover safely",
      workspace: "/tmp/recovery",
      status: "created",
      createdAt: "2026-10-05T14:00:00.000Z",
      updatedAt: "2026-10-05T14:00:00.000Z",
      workspaceId: ids.workspace,
    } as OrchestratorTask,
    safetyOptions: {
      lease: {
        taskId: ids.task,
        workspaceId: ids.workspace,
        ownerInstanceId: leaseClaim.ownerInstanceId,
        signal: controller.signal,
        currentClaim: () => structuredClone(leaseClaim),
        validateCurrent: async () => {
          if (overrides.leaseValidationError) throw overrides.leaseValidationError;
        },
      },
      authorityProvider: { async revalidateCurrent() { throw new Error("not called by wrapper"); } },
      distributedFenceGuard,
    },
  };
}

test("M12Z-H delegates runtime start only through M12I and adds no retry/resume authority", () => {
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.requiresM12ZGContext, true);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.delegatesToExistingM12IStarter, true);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.automaticRetryAllowed, false);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.automaticRequeueAllowed, false);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.staleSessionResumeAllowed, false);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.startsClineOnlyThroughM12I, true);
  assert.equal(DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT.grantsTaskAuthority, false);
});

test("exact current M12Z-G context delegates once to M12I", async () => {
  const handoff = context();
  const completed = { ...handoff.task, status: "completed" as const };
  let calls = 0;
  const coordinator = new DistributedRecoveryRuntimeStartCoordinator({
    starter: {
      async start(actual) {
        calls += 1;
        assert.equal(actual, handoff);
        return completed;
      },
    },
  });

  const result = await coordinator.start(preparation, handoff);
  assert.equal(calls, 1);
  assert.equal(result.status, "completed");
});

test("changed local lease identity is rejected before M12I", async () => {
  const handoff = context({ leaseId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  let calls = 0;
  const coordinator = new DistributedRecoveryRuntimeStartCoordinator({
    starter: { async start() { calls += 1; return handoff.task; } },
  });

  await assert.rejects(
    () => coordinator.start(preparation, handoff),
    (error: unknown) => error instanceof DistributedRecoveryRuntimeStartError
      && error.code === "lease_not_current",
  );
  assert.equal(calls, 0);
});

test("changed distributed fence identity is rejected before M12I", async () => {
  const handoff = context({ fenceGeneration: 8 });
  let calls = 0;
  const coordinator = new DistributedRecoveryRuntimeStartCoordinator({
    starter: { async start() { calls += 1; return handoff.task; } },
  });

  await assert.rejects(
    () => coordinator.start(preparation, handoff),
    (error: unknown) => error instanceof DistributedRecoveryRuntimeStartError
      && error.code === "fence_not_current",
  );
  assert.equal(calls, 0);
});

test("lease or fence revalidation failure prevents M12I start", async () => {
  for (const handoff of [
    context({ leaseValidationError: new Error("lost lease") }),
    context({ fenceValidationError: new Error("lost fence") }),
  ]) {
    let calls = 0;
    const coordinator = new DistributedRecoveryRuntimeStartCoordinator({
      starter: { async start() { calls += 1; return handoff.task; } },
    });
    await assert.rejects(() => coordinator.start(preparation, handoff));
    assert.equal(calls, 0);
  }
});

test("M12I failure remains terminal to the recovery runtime gate", async () => {
  const handoff = context();
  const coordinator = new DistributedRecoveryRuntimeStartCoordinator({
    starter: { async start() { throw new Error("provider failed"); } },
  });

  await assert.rejects(
    () => coordinator.start(preparation, handoff),
    (error: unknown) => error instanceof DistributedRecoveryRuntimeStartError
      && error.code === "runtime_start_failed",
  );
});
