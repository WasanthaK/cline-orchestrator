import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT,
  DistributedTakeoverRecoveryError,
  classifyDistributedTakeoverRecovery,
  type DistributedTakeoverTargetTaskSummaryV1,
} from "./distributed-takeover-recovery.js";
import type { DistributedDeliveryStateRecordV1 } from "./distributed-delivery-reconciliation.js";

const baseRecord: DistributedDeliveryStateRecordV1 = {
  schemaVersion: 1,
  deliveryId: "11111111-1111-4111-8111-111111111111",
  dispatchId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  machineId: "55555555-5555-4555-8555-555555555555",
  machineRegistrationId: "66666666-6666-4666-8666-666666666666",
  machineRegistrationRevision: 1,
  state: "pending",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  authority: "delivery_reconciliation_state_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function task(overrides: Partial<DistributedTakeoverTargetTaskSummaryV1> = {}): DistributedTakeoverTargetTaskSummaryV1 {
  return {
    taskId: baseRecord.taskId,
    workspaceId: baseRecord.workspaceId,
    status: "created",
    runCount: 0,
    sessionGeneration: 0,
    hasClineSessionId: false,
    hasPendingEscalation: false,
    ...overrides,
  };
}

function record(state: DistributedDeliveryStateRecordV1["state"]): DistributedDeliveryStateRecordV1 {
  return {
    ...baseRecord,
    state,
    ...(state === "admission_acknowledged"
      ? {
          acknowledgement: {
            schemaVersion: 1 as const,
            acknowledgementId: "77777777-7777-4777-8777-777777777777",
            deliveryId: baseRecord.deliveryId,
            dispatchId: baseRecord.dispatchId,
            taskId: baseRecord.taskId,
            workspaceId: baseRecord.workspaceId,
            machineId: baseRecord.machineId,
            machineRegistrationId: baseRecord.machineRegistrationId,
            machineRegistrationRevision: 1,
            admittedAt: "2026-10-05T10:00:01.000Z",
            acknowledgedAt: "2026-10-05T10:00:02.000Z",
            authority: "delivery_admission_evidence_only" as const,
            grantsTaskAuthority: false as const,
            grantsFilesystemAuthority: false as const,
            grantsSafetyPlanAuthority: false as const,
            grantsWriterLeaseAuthority: false as const,
            grantsCredentialAuthority: false as const,
            grantsReleaseAuthority: false as const,
          },
        }
      : {}),
  };
}

test("M12Z-A contract never grants automatic takeover/retry/requeue authority", () => {
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.automaticTakeoverAllowed, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.automaticWorkRetryAllowed, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.automaticWorkRequeueAllowed, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.staleDispatchReusable, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.staleCandidateReusable, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.staleFenceReusable, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.processLocalHandoffReusable, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.priorRuntimeSessionReusable, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.requiresFreshCandidateAssignment, true);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.requiresFreshDistributedFence, true);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.requiresFreshLocalWriterLease, true);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.requiresFreshAdmission, true);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT.grantsReleaseAuthority, false);
});

test("delivered_unconfirmed with durable target ACK allows ACK reconciliation only", () => {
  const decision = classifyDistributedTakeoverRecovery(
    record("delivered_unconfirmed"),
    task(),
    { targetAckAvailable: true },
  );
  assert.equal(decision.disposition, "ack_reconciliation_only");
  assert.equal(decision.reason, "delivery_unconfirmed_ack_available");
  assert.equal(decision.automaticTakeoverAllowed, false);
  assert.equal(decision.requiresFreshDispatch, true);
});

test("delivered_unconfirmed without ACK remains ambiguous and cannot be retried", () => {
  const decision = classifyDistributedTakeoverRecovery(
    record("delivered_unconfirmed"),
    task(),
    { targetAckAvailable: false },
  );
  assert.equal(decision.disposition, "manual_ambiguity_review");
  assert.equal(decision.reason, "delivery_unconfirmed_without_ack");
  assert.equal(decision.automaticWorkRetryAllowed, false);
  assert.equal(decision.automaticWorkRequeueAllowed, false);
});

test("acknowledged delivery with any runtime history requires manual review", () => {
  for (const summary of [
    task({ status: "running", runCount: 1, sessionGeneration: 1, hasClineSessionId: true }),
    task({ status: "waiting_for_human", hasPendingEscalation: true }),
    task({ status: "created", runCount: 1 }),
  ]) {
    const decision = classifyDistributedTakeoverRecovery(
      record("admission_acknowledged"),
      summary,
      { targetAckAvailable: true },
    );
    assert.equal(decision.disposition, "manual_ambiguity_review");
    assert.equal(decision.reason, "runtime_history_requires_review");
  }
});

test("acknowledged admission before runtime history permits only fresh-authority review", () => {
  const decision = classifyDistributedTakeoverRecovery(
    record("admission_acknowledged"),
    task(),
    { targetAckAvailable: true },
  );
  assert.equal(decision.disposition, "fresh_authority_review_required");
  assert.equal(decision.reason, "admitted_without_runtime_history");
  assert.equal(decision.requiresFreshControllerSelection, true);
  assert.equal(decision.requiresFreshCandidateAssignment, true);
  assert.equal(decision.requiresFreshDistributedFence, true);
  assert.equal(decision.requiresFreshLocalWriterLease, true);
  assert.equal(decision.requiresFreshDispatch, true);
  assert.equal(decision.requiresFreshAdmission, true);
  assert.equal(decision.requiresTargetLocalAuthorityReentry, true);
});

test("claimed controller state is not automatically reused after restart", () => {
  const decision = classifyDistributedTakeoverRecovery(
    record("claimed"),
    task(),
    { targetAckAvailable: false },
  );
  assert.equal(decision.disposition, "manual_ambiguity_review");
  assert.equal(decision.reason, "controller_claim_incomplete");
});

test("pending delivery with fresh task permits only fresh-authority review", () => {
  const decision = classifyDistributedTakeoverRecovery(
    record("pending"),
    task(),
    { targetAckAvailable: false },
  );
  assert.equal(decision.disposition, "fresh_authority_review_required");
  assert.equal(decision.reason, "no_delivery_yet");
  assert.equal(decision.automaticTakeoverAllowed, false);
});

test("terminal target task never enters takeover", () => {
  for (const status of ["completed", "failed", "aborted", "rolled_back", "validation_failed"] as const) {
    const decision = classifyDistributedTakeoverRecovery(
      record("admission_acknowledged"),
      task({ status, runCount: 1 }),
      { targetAckAvailable: true },
    );
    assert.equal(decision.disposition, "terminal_no_takeover");
    assert.equal(decision.reason, "terminal_task");
  }
});

test("cross-bound delivery/task recovery evidence fails closed", () => {
  assert.throws(
    () => classifyDistributedTakeoverRecovery(
      record("pending"),
      task({ workspaceId: "88888888-8888-4888-8888-888888888888" }),
      { targetAckAvailable: false },
    ),
    (error: unknown) => error instanceof DistributedTakeoverRecoveryError
      && error.code === "binding_mismatch",
  );
});
