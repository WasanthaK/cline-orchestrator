import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { MultiAgentRepairChildPreparationV1 } from "./multi-agent-repair-child-preparation.js";

export const MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "repair_child_review_evidence_only" as const,
  trustsWorkerClaims: false as const,
  requiresIndependentValidationEvidence: true as const,
  requiresIndependentDiffSafetyEvidence: true as const,
  requiresCheckpointEvidence: true as const,
  issuesRepairAdmission: false as const,
  schedulesChild: false as const,
  startsChild: false as const,
  automaticRepairAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  distributedExecutionAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRepairChildReviewHandoffV1 {
  schemaVersion: 1;
  capturedAt: string;
  delegationSetId: string;
  delegationId: string;
  repairChildTaskId: string;
  priorChildTaskId: string;
  repairAttempt: number;
  parentSupervisorTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  coordinationMode: "parallel_disjoint" | "serialized";
  objective: string;
  repairInstruction: string;
  acceptanceCriteria: string[];
  approvedWriteScope: string[];
  protectedPaths: string[];
  repairChildStatus: TaskCompletionPacketV1["status"];
  reviewState: TaskCompletionPacketV1["reviewState"];
  workerCompletion?: {
    source: "cline_result";
    trust: "untrusted_worker_claims";
    report: string;
    truncated: boolean;
  };
  independentEvidence: TaskCompletionPacketV1["independentEvidence"];
  authority: "repair_child_review_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentRepairChildReviewHandoffError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "packet_invalid"
      | "binding_mismatch"
      | "evidence_insufficient",
  ) {
    super(message);
    this.name = "MultiAgentRepairChildReviewHandoffError";
  }
}

function assertPreparation(value: MultiAgentRepairChildPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || value.repairChildTaskId === value.priorChildTaskId
    || value.priorChildResumeAllowed !== false
    || value.priorChildMutationAllowed !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildReviewHandoffError(
      "repair-child preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertPacket(value: TaskCompletionPacketV1): void {
  if (
    value.schemaVersion !== 1
    || value.reviewState !== "ready_for_supervisor_review"
    || !value.completionSignal.terminal
    || value.status === "aborted"
    || value.status === "rolled_back"
  ) {
    throw new MultiAgentRepairChildReviewHandoffError(
      "repair-child completion packet is not ready for supervisor review",
      "packet_invalid",
    );
  }

  const evidence = value.independentEvidence;
  if (
    evidence.checkpoint.available !== true
    || evidence.diffSafety.available !== true
    || evidence.diffSafety.passed !== true
    || (
      evidence.validation.available === true
      && evidence.validation.passed !== true
    )
  ) {
    throw new MultiAgentRepairChildReviewHandoffError(
      "repair-child completion packet lacks sufficient independent completion evidence",
      "evidence_insufficient",
    );
  }
}

function assertBindings(
  preparation: MultiAgentRepairChildPreparationV1,
  packet: TaskCompletionPacketV1,
): void {
  if (
    packet.taskId !== preparation.repairChildTaskId
    || packet.projectId !== preparation.projectId
    || packet.workspaceId !== preparation.workspaceId
  ) {
    throw new MultiAgentRepairChildReviewHandoffError(
      "repair-child completion evidence does not match the exact preparation binding",
      "binding_mismatch",
    );
  }
}

export function createMultiAgentRepairChildReviewHandoff(
  preparationInput: MultiAgentRepairChildPreparationV1,
  packetInput: TaskCompletionPacketV1,
): MultiAgentRepairChildReviewHandoffV1 {
  assertPreparation(preparationInput);
  assertPacket(packetInput);

  const preparation = structuredClone(preparationInput);
  const packet = structuredClone(packetInput);
  assertBindings(preparation, packet);

  return Object.freeze({
    schemaVersion: 1,
    capturedAt: packet.capturedAt,
    delegationSetId: preparation.delegationSetId,
    delegationId: preparation.delegationId,
    repairChildTaskId: preparation.repairChildTaskId,
    priorChildTaskId: preparation.priorChildTaskId,
    repairAttempt: preparation.repairAttempt,
    parentSupervisorTaskId: preparation.parentSupervisorTaskId,
    parentTaskId: preparation.parentTaskId,
    projectId: preparation.projectId,
    workspaceId: preparation.workspaceId,
    coordinationMode: preparation.coordinationMode,
    objective: preparation.objective,
    repairInstruction: preparation.repairInstruction,
    acceptanceCriteria: [...preparation.acceptanceCriteria],
    approvedWriteScope: [...preparation.allowedPathPatterns],
    protectedPaths: [...preparation.protectedPathPatterns],
    repairChildStatus: packet.status,
    reviewState: packet.reviewState,
    ...(packet.workerCompletion
      ? {
          workerCompletion: {
            source: packet.workerCompletion.source,
            trust: packet.workerCompletion.trust,
            report: packet.workerCompletion.report,
            truncated: packet.workerCompletion.truncated,
          },
        }
      : {}),
    independentEvidence: structuredClone(packet.independentEvidence),
    authority: "repair_child_review_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
