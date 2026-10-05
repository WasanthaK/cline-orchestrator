import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedRecoveryTargetHandoffCoordinator,
  DistributedRecoveryTargetHandoffError,
  DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT,
} from "./distributed-recovery-target-handoff.js";
import type { DistributedRecoveryReacquisitionPreparationEvidenceV1 } from "./distributed-recovery-reacquisition-preparation.js";
import type { DistributedExecutionAdmissionReceiptV1, DistributedExecutionDispatchV1 } from "./distributed-execution-admission.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { DistributedFenceClaimV1 } from "./distributed-fencing.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { DistributedTargetRuntimeHandoffContext } from "./distributed-target-runtime-handoff.js";

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
  preparedAt: "2026-10-05T14:00:00.000Z",
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

const assignment: DistributedWriterCandidateAssignmentV1 = {
  schemaVersion: 1,
  assignmentId: ids.assignment,
  taskId: ids.task,
  workspaceId: ids.workspace,
  machineId: ids.machine,
  machineRegistrationId: ids.registration,
  machineRegistrationRevision: 2,
  placementId: ids.placement,
  placementRevision: 3,
  issuedAt: "2026-10-05T14:00:00.000Z",
  expiresAt: "2026-10-05T14:01:00.000Z",
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
  fenceId: ids.fence,
  taskId: ids.task,
  workspaceId: ids.workspace,
  machineId: ids.machine,
  machineRegistrationId: ids.registration,
  machineRegistrationRevision: 2,
  placementId: ids.placement,
  placementRevision: 3,
  candidateAssignmentId: ids.assignment,
  generation: 7,
  issuedAt: "2026-10-05T14:00:00.000Z",
  expiresAt: "2026-10-05T14:00:30.000Z",
  authority: "fencing_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const dispatch: DistributedExecutionDispatchV1 = {
  schemaVersion: 1,
  dispatchId: ids.dispatch,
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
  issuedAt: "2026-10-05T14:00:00.000Z",
  expiresAt: "2026-10-05T14:00:05.000Z",
  authority: "execution_request_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const receipt: DistributedExecutionAdmissionReceiptV1 = {
  schemaVersion: 1,
  dispatchId: ids.dispatch,
  taskId: ids.task,
  workspaceId: ids.workspace,
  machineId: ids.machine,
  fenceGeneration: 7,
  admittedAt: "2026-10-05T14:00:01.000Z",
  authority: "admission_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function lease(): WriterLeaseSession {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion: 1,
    workspaceId: ids.workspace,
    stateRevision: 1,
    leaseId: ids.lease,
    fenceToken: ids.localFence,
    taskId: ids.task,
    ownerInstanceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    expiresAt: "2026-10-05T14:01:00.000Z",
    authority: "coordination_only",
  };
  const controller = new AbortController();
  return {
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
    signal: controller.signal,
    currentClaim: () => structuredClone(claim),
    validateCurrent: async () => undefined,
  };
}

function handoffContext(): DistributedTargetRuntimeHandoffContext {
  return {
    evidence: {
      schemaVersion: 1,
      dispatchId: ids.dispatch,
      taskId: ids.task,
      workspaceId: ids.workspace,
      machineId: ids.machine,
      fenceGeneration: 7,
      admittedAt: receipt.admittedAt,
      preparedAt: "2026-10-05T14:00:02.000Z",
      authority: "local_runtime_handoff_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    task: {} as any,
    safetyOptions: {} as any,
  };
}

test("M12Z-G contract reuses M12H without consuming admission again", () => {
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.requiresAlreadyAdmittedDispatch, true);
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.reusesExistingM12HTargetLocalChecks, true);
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.consumesAdmissionAgain, false);
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.invokesRuntime, false);
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.startsCline, false);
  assert.equal(DISTRIBUTED_RECOVERY_TARGET_HANDOFF_CONTRACT.grantsTaskAuthority, false);
});

test("exact prepared and admitted recovery set delegates only to M12H post-admission path", async () => {
  let calls = 0;
  const coordinator = new DistributedRecoveryTargetHandoffCoordinator({
    lease: lease(),
    handoff: {
      async prepareAdmitted(actualDispatch, actualAssignment, actualFence, actualReceipt) {
        calls += 1;
        assert.deepEqual(actualDispatch, dispatch);
        assert.deepEqual(actualAssignment, assignment);
        assert.deepEqual(actualFence, fence);
        assert.deepEqual(actualReceipt, receipt);
        return handoffContext();
      },
    },
  });

  const context = await coordinator.prepare(preparation, dispatch, assignment, fence, receipt);
  assert.equal(calls, 1);
  assert.equal(context.evidence.authority, "local_runtime_handoff_evidence_only");
});

test("mismatched receipt is rejected before M12H re-entry", async () => {
  let calls = 0;
  const coordinator = new DistributedRecoveryTargetHandoffCoordinator({
    lease: lease(),
    handoff: {
      async prepareAdmitted() {
        calls += 1;
        return handoffContext();
      },
    },
  });

  await assert.rejects(
    () => coordinator.prepare(
      preparation,
      dispatch,
      assignment,
      fence,
      { ...receipt, fenceGeneration: 8 },
    ),
    (error: unknown) => error instanceof DistributedRecoveryTargetHandoffError
      && error.code === "receipt_invalid",
  );
  assert.equal(calls, 0);
});

test("changed local lease is rejected before M12H re-entry", async () => {
  const baseLease = lease();
  const changed = baseLease.currentClaim();
  changed.leaseId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const changedLease: WriterLeaseSession = {
    ...baseLease,
    currentClaim: () => structuredClone(changed),
  };
  let calls = 0;
  const coordinator = new DistributedRecoveryTargetHandoffCoordinator({
    lease: changedLease,
    handoff: {
      async prepareAdmitted() {
        calls += 1;
        return handoffContext();
      },
    },
  });

  await assert.rejects(
    () => coordinator.prepare(preparation, dispatch, assignment, fence, receipt),
    (error: unknown) => error instanceof DistributedRecoveryTargetHandoffError
      && error.code === "lease_not_current",
  );
  assert.equal(calls, 0);
});

test("M12H post-admission failure remains terminal to recovery handoff", async () => {
  const coordinator = new DistributedRecoveryTargetHandoffCoordinator({
    lease: lease(),
    handoff: {
      async prepareAdmitted() {
        throw new Error("target task no longer fresh");
      },
    },
  });

  await assert.rejects(
    () => coordinator.prepare(preparation, dispatch, assignment, fence, receipt),
    (error: unknown) => error instanceof DistributedRecoveryTargetHandoffError
      && error.code === "handoff_failed",
  );
});
