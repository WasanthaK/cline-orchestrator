import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedRecoveryAdmissionBridge,
  DistributedRecoveryAdmissionBridgeError,
  DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT,
} from "./distributed-recovery-admission-bridge.js";
import type {
  DistributedExecutionAdmissionReceiptV1,
  DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import type { DistributedFenceClaimV1 } from "./distributed-fencing.js";
import type { DistributedRecoveryReacquisitionPreparationEvidenceV1 } from "./distributed-recovery-reacquisition-preparation.js";

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
  preparedAt: "2026-10-05T13:30:00.000Z",
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
  issuedAt: "2026-10-05T13:30:00.000Z",
  expiresAt: "2026-10-05T13:31:00.000Z",
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
  issuedAt: "2026-10-05T13:30:00.000Z",
  expiresAt: "2026-10-05T13:30:30.000Z",
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
  issuedAt: "2026-10-05T13:30:00.000Z",
  expiresAt: "2026-10-05T13:30:05.000Z",
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
  admittedAt: "2026-10-05T13:30:01.000Z",
  authority: "admission_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

test("M12Z-F contract delegates durable replay consumption only to M12G", () => {
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.requiresExactPreparedDispatchBinding, true);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.delegatesToExistingM12GAdmission, true);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.durableReplayConsumptionOccursOnlyInM12G, true);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.invokesTargetHandoff, false);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.invokesRuntime, false);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.startsCline, false);
  assert.equal(DISTRIBUTED_RECOVERY_ADMISSION_BRIDGE_CONTRACT.grantsTaskAuthority, false);
});

test("exact recovery dispatch delegates once to M12G and returns admission evidence only", async () => {
  let calls = 0;
  const bridge = new DistributedRecoveryAdmissionBridge({
    async admit(actualDispatch, actualAssignment, actualFence) {
      calls += 1;
      assert.deepEqual(actualDispatch, dispatch);
      assert.deepEqual(actualAssignment, assignment);
      assert.deepEqual(actualFence, fence);
      return receipt;
    },
  } as any);

  const result = await bridge.admit(preparation, dispatch, assignment, fence);
  assert.equal(calls, 1);
  assert.deepEqual(result, receipt);
  assert.equal(result.authority, "admission_evidence_only");
  assert.equal(result.grantsTaskAuthority, false);
});

test("cross-bound dispatch is rejected before M12G is called", async () => {
  let calls = 0;
  const bridge = new DistributedRecoveryAdmissionBridge({
    async admit() {
      calls += 1;
      return receipt;
    },
  } as any);

  await assert.rejects(
    () => bridge.admit(
      preparation,
      { ...dispatch, fenceGeneration: 8 },
      assignment,
      fence,
    ),
    (error: unknown) => error instanceof DistributedRecoveryAdmissionBridgeError
      && error.code === "binding_mismatch",
  );
  assert.equal(calls, 0);
});

test("M12G failure remains terminal to the recovery bridge", async () => {
  const bridge = new DistributedRecoveryAdmissionBridge({
    async admit() {
      throw new Error("dispatch replayed");
    },
  } as any);

  await assert.rejects(
    () => bridge.admit(preparation, dispatch, assignment, fence),
    (error: unknown) => error instanceof DistributedRecoveryAdmissionBridgeError
      && error.code === "admission_failed",
  );
});

test("mismatched M12G receipt is rejected", async () => {
  const bridge = new DistributedRecoveryAdmissionBridge({
    async admit() {
      return { ...receipt, fenceGeneration: 8 };
    },
  } as any);

  await assert.rejects(
    () => bridge.admit(preparation, dispatch, assignment, fence),
    (error: unknown) => error instanceof DistributedRecoveryAdmissionBridgeError
      && error.code === "admission_failed",
  );
});
