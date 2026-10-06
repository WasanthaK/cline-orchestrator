import crypto from "node:crypto";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentChildRepairAdmissionReceiptV1 } from "./multi-agent-child-repair-admission.js";
import type { MultiAgentChildReviewDecisionV1 } from "./multi-agent-child-review-decision.js";
import type { MultiAgentChildReviewHandoffV1 } from "./multi-agent-child-review-handoff.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MULTI_AGENT_REPAIR_CHILD_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "repair_child_materialization_only" as const,
  freshChildTaskIdentityRequired: true as const,
  priorChildResumeAllowed: false as const,
  priorChildMutationAllowed: false as const,
  preservesOriginalDelegation: true as const,
  preservesExactScope: true as const,
  executableTask: false as const,
  persistsIntoTaskStore: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRepairChildDescriptorV1 {
  schemaVersion: 1;
  repairChildTaskId: string;
  priorChildTaskId: string;
  materializedAt: string;
  repairAttempt: number;
  repairAdmissionPermitId: string;
  repairAdmissionConsumedAt: string;
  delegationSetId: string;
  delegationId: string;
  coordinationMode: "parallel_disjoint" | "serialized";
  parentSupervisorTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  objective: string;
  repairInstruction: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  authority: "repair_child_materialization_only";
  executable: false;
  requiresFreshExecutionAdmission: true;
  requiresFreshParentBindingRevalidation: true;
  requiresFreshWriterLease: true;
  priorChildResumeAllowed: false;
  priorChildMutationAllowed: false;
  allowsSubdelegation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MaterializeMultiAgentRepairChildOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentRepairChildError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "handoff_invalid"
      | "decision_invalid"
      | "receipt_invalid"
      | "binding_mismatch"
      | "identity_reuse"
      | "materialization_invalid",
  ) {
    super(message);
    this.name = "MultiAgentRepairChildError";
  }
}

function assertPreparation(value: MultiAgentChildExecutionPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_execution_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildError(
      "original child execution preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertHandoff(value: MultiAgentChildReviewHandoffV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_review_evidence_only"
    || value.reviewState !== "ready_for_supervisor_review"
    || !["completed", "validation_failed", "failed"].includes(value.childStatus)
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildError(
      "repair-child materialization requires a terminal reviewed child handoff",
      "handoff_invalid",
    );
  }
}

function assertDecision(value: MultiAgentChildReviewDecisionV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_review_decision_advisory_only"
    || value.decision !== "repair"
    || !value.repairInstruction?.trim()
    || value.schedulesChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildError(
      "repair-child materialization requires a bounded advisory repair decision",
      "decision_invalid",
    );
  }
}

function assertReceipt(value: MultiAgentChildRepairAdmissionReceiptV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_repair_admission_consumed_evidence_only"
    || !UUID.test(value.permitId)
    || !UUID.test(value.childTaskId)
    || !UUID.test(value.delegationSetId)
    || !UUID.test(value.delegationId)
    || !UUID.test(value.parentTaskId)
    || !Number.isInteger(value.repairAttempt)
    || value.repairAttempt < 1
    || value.repairAttempt > 2
    || !Number.isFinite(Date.parse(value.consumedAt))
    || value.startsChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildError(
      "consumed repair admission receipt is invalid or widened",
      "receipt_invalid",
    );
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertBindings(
  preparation: MultiAgentChildExecutionPreparationV1,
  handoff: MultiAgentChildReviewHandoffV1,
  decision: MultiAgentChildReviewDecisionV1,
  receipt: MultiAgentChildRepairAdmissionReceiptV1,
): void {
  if (
    handoff.childTaskId !== preparation.childTaskId
    || handoff.delegationSetId !== preparation.delegationSetId
    || handoff.delegationId !== preparation.delegationId
    || handoff.parentSupervisorTaskId !== preparation.parentSupervisorTaskId
    || handoff.parentTaskId !== preparation.parentTaskId
    || handoff.projectId !== preparation.projectId
    || handoff.workspaceId !== preparation.workspaceId
    || handoff.coordinationMode !== preparation.coordinationMode
    || !sameStrings(handoff.approvedWriteScope, preparation.allowedPathPatterns)
    || !sameStrings(handoff.protectedPaths, preparation.protectedPathPatterns)
    || decision.childTaskId !== preparation.childTaskId
    || decision.delegationSetId !== preparation.delegationSetId
    || decision.delegationId !== preparation.delegationId
    || decision.parentSupervisorTaskId !== preparation.parentSupervisorTaskId
    || decision.parentTaskId !== preparation.parentTaskId
    || receipt.childTaskId !== preparation.childTaskId
    || receipt.delegationSetId !== preparation.delegationSetId
    || receipt.delegationId !== preparation.delegationId
    || receipt.parentTaskId !== preparation.parentTaskId
  ) {
    throw new MultiAgentRepairChildError(
      "repair-child inputs do not match the exact prior child/delegation binding",
      "binding_mismatch",
    );
  }
}

export function materializeMultiAgentRepairChild(
  preparationInput: MultiAgentChildExecutionPreparationV1,
  handoffInput: MultiAgentChildReviewHandoffV1,
  decisionInput: MultiAgentChildReviewDecisionV1,
  receiptInput: MultiAgentChildRepairAdmissionReceiptV1,
  options: MaterializeMultiAgentRepairChildOptions = {},
): MultiAgentRepairChildDescriptorV1 {
  assertPreparation(preparationInput);
  assertHandoff(handoffInput);
  assertDecision(decisionInput);
  assertReceipt(receiptInput);

  const preparation = structuredClone(preparationInput);
  const handoff = structuredClone(handoffInput);
  const decision = structuredClone(decisionInput);
  const receipt = structuredClone(receiptInput);
  assertBindings(preparation, handoff, decision, receipt);

  const repairChildTaskId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!UUID.test(repairChildTaskId)) {
    throw new MultiAgentRepairChildError(
      "repair child task id must be an opaque UUID",
      "materialization_invalid",
    );
  }
  if (repairChildTaskId === preparation.childTaskId) {
    throw new MultiAgentRepairChildError(
      "repair child must use a fresh child task identity",
      "identity_reuse",
    );
  }

  const now = (options.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new MultiAgentRepairChildError(
      "repair-child materialization clock is invalid",
      "materialization_invalid",
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    repairChildTaskId,
    priorChildTaskId: preparation.childTaskId,
    materializedAt: now.toISOString(),
    repairAttempt: receipt.repairAttempt,
    repairAdmissionPermitId: receipt.permitId,
    repairAdmissionConsumedAt: receipt.consumedAt,
    delegationSetId: preparation.delegationSetId,
    delegationId: preparation.delegationId,
    coordinationMode: preparation.coordinationMode,
    parentSupervisorTaskId: preparation.parentSupervisorTaskId,
    parentTaskId: preparation.parentTaskId,
    projectId: preparation.projectId,
    workspaceId: preparation.workspaceId,
    workspaceRegistryRevision: preparation.workspaceRegistryRevision,
    safetyPlanId: preparation.safetyPlanId,
    safetyPolicyVersion: preparation.safetyPolicyVersion,
    safetyProfileId: preparation.safetyProfileId,
    safetyProfileRevision: preparation.safetyProfileRevision,
    workerProfileId: preparation.workerProfileId,
    objective: preparation.objective,
    repairInstruction: decision.repairInstruction!,
    acceptanceCriteria: [...preparation.acceptanceCriteria],
    trustedValidationCommands: [...preparation.trustedValidationCommands],
    allowedPathPatterns: [...preparation.allowedPathPatterns],
    protectedPathPatterns: [...preparation.protectedPathPatterns],
    authority: "repair_child_materialization_only",
    executable: false,
    requiresFreshExecutionAdmission: true,
    requiresFreshParentBindingRevalidation: true,
    requiresFreshWriterLease: true,
    priorChildResumeAllowed: false,
    priorChildMutationAllowed: false,
    allowsSubdelegation: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
