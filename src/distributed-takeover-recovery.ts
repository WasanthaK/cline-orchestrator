import type {
  DistributedDeliveryStateRecordV1,
} from "./distributed-delivery-reconciliation.js";
import type { TaskStatus } from "./types.js";

export const DISTRIBUTED_TAKEOVER_RECOVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  automaticTakeoverAllowed: false as const,
  automaticWorkRetryAllowed: false as const,
  automaticWorkRequeueAllowed: false as const,
  staleDispatchReusable: false as const,
  staleCandidateReusable: false as const,
  staleFenceReusable: false as const,
  processLocalHandoffReusable: false as const,
  priorRuntimeSessionReusable: false as const,
  requiresFreshControllerSelection: true as const,
  requiresFreshCandidateAssignment: true as const,
  requiresFreshDistributedFence: true as const,
  requiresFreshLocalWriterLease: true as const,
  requiresFreshDispatch: true as const,
  requiresFreshAdmission: true as const,
  requiresTargetLocalAuthorityReentry: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type DistributedTakeoverRecoveryDispositionV1 =
  | "ack_reconciliation_only"
  | "manual_ambiguity_review"
  | "fresh_authority_review_required"
  | "terminal_no_takeover";

export interface DistributedTakeoverTargetTaskSummaryV1 {
  taskId: string;
  workspaceId: string;
  status: TaskStatus;
  runCount: number;
  sessionGeneration: number;
  hasClineSessionId: boolean;
  hasPendingEscalation: boolean;
}

export interface DistributedTakeoverRecoveryDecisionV1 {
  schemaVersion: 1;
  deliveryId: string;
  taskId: string;
  workspaceId: string;
  disposition: DistributedTakeoverRecoveryDispositionV1;
  reason:
    | "delivery_unconfirmed_ack_available"
    | "delivery_unconfirmed_without_ack"
    | "controller_claim_incomplete"
    | "no_delivery_yet"
    | "admitted_without_runtime_history"
    | "runtime_history_requires_review"
    | "terminal_task";
  targetAckAvailable: boolean;
  requiresFreshControllerSelection: true;
  requiresFreshCandidateAssignment: true;
  requiresFreshDistributedFence: true;
  requiresFreshLocalWriterLease: true;
  requiresFreshDispatch: true;
  requiresFreshAdmission: true;
  requiresTargetLocalAuthorityReentry: true;
  automaticTakeoverAllowed: false;
  automaticWorkRetryAllowed: false;
  automaticWorkRequeueAllowed: false;
  authority: "recovery_decision_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DistributedTakeoverRecoveryError extends Error {
  constructor(
    message: string,
    public readonly code: "binding_mismatch" | "task_summary_invalid",
  ) {
    super(message);
    this.name = "DistributedTakeoverRecoveryError";
  }
}

const TERMINAL = new Set<TaskStatus>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

function validateTaskSummary(summary: DistributedTakeoverTargetTaskSummaryV1): void {
  if (
    typeof summary.taskId !== "string"
    || typeof summary.workspaceId !== "string"
    || !summary.taskId
    || !summary.workspaceId
    || !Number.isSafeInteger(summary.runCount)
    || summary.runCount < 0
    || !Number.isSafeInteger(summary.sessionGeneration)
    || summary.sessionGeneration < 0
    || typeof summary.hasClineSessionId !== "boolean"
    || typeof summary.hasPendingEscalation !== "boolean"
  ) {
    throw new DistributedTakeoverRecoveryError(
      "distributed takeover target task summary is invalid",
      "task_summary_invalid",
    );
  }
}

function baseDecision(
  record: DistributedDeliveryStateRecordV1,
  targetAckAvailable: boolean,
  disposition: DistributedTakeoverRecoveryDispositionV1,
  reason: DistributedTakeoverRecoveryDecisionV1["reason"],
): DistributedTakeoverRecoveryDecisionV1 {
  return Object.freeze({
    schemaVersion: 1,
    deliveryId: record.deliveryId,
    taskId: record.taskId,
    workspaceId: record.workspaceId,
    disposition,
    reason,
    targetAckAvailable,
    requiresFreshControllerSelection: true,
    requiresFreshCandidateAssignment: true,
    requiresFreshDistributedFence: true,
    requiresFreshLocalWriterLease: true,
    requiresFreshDispatch: true,
    requiresFreshAdmission: true,
    requiresTargetLocalAuthorityReentry: true,
    automaticTakeoverAllowed: false,
    automaticWorkRetryAllowed: false,
    automaticWorkRequeueAllowed: false,
    authority: "recovery_decision_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}

/**
 * M12Z-A recovery classification only.
 *
 * This function never starts work, mutates controller delivery state, acquires a
 * candidate/fence/lease, or invokes M12G/M12H/M12I. It classifies durable
 * controller delivery state plus target-local durable task history into a
 * non-authoritative disposition for a later trusted recovery coordinator.
 */
export function classifyDistributedTakeoverRecovery(
  record: DistributedDeliveryStateRecordV1,
  task: DistributedTakeoverTargetTaskSummaryV1,
  options: { targetAckAvailable: boolean },
): DistributedTakeoverRecoveryDecisionV1 {
  validateTaskSummary(task);
  if (record.taskId !== task.taskId || record.workspaceId !== task.workspaceId) {
    throw new DistributedTakeoverRecoveryError(
      "delivery state and target task summary do not share the exact task/workspace binding",
      "binding_mismatch",
    );
  }

  if (record.state === "delivered_unconfirmed") {
    if (options.targetAckAvailable) {
      return baseDecision(
        record,
        true,
        "ack_reconciliation_only",
        "delivery_unconfirmed_ack_available",
      );
    }
    return baseDecision(
      record,
      false,
      "manual_ambiguity_review",
      "delivery_unconfirmed_without_ack",
    );
  }

  if (TERMINAL.has(task.status)) {
    return baseDecision(
      record,
      options.targetAckAvailable,
      "terminal_no_takeover",
      "terminal_task",
    );
  }

  const hasRuntimeHistory =
    task.runCount > 0
    || task.sessionGeneration > 0
    || task.hasClineSessionId
    || task.hasPendingEscalation
    || task.status !== "created";

  if (record.state === "admission_acknowledged") {
    if (hasRuntimeHistory) {
      return baseDecision(
        record,
        options.targetAckAvailable,
        "manual_ambiguity_review",
        "runtime_history_requires_review",
      );
    }
    return baseDecision(
      record,
      options.targetAckAvailable,
      "fresh_authority_review_required",
      "admitted_without_runtime_history",
    );
  }

  if (record.state === "claimed") {
    return baseDecision(
      record,
      options.targetAckAvailable,
      "manual_ambiguity_review",
      "controller_claim_incomplete",
    );
  }

  return baseDecision(
    record,
    options.targetAckAvailable,
    "fresh_authority_review_required",
    "no_delivery_yet",
  );
}
