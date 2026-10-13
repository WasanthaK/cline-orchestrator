import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

export const MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_review_evidence_only" as const,
  trustsWorkerClaims: false as const,
  requiresIndependentValidationEvidence: true as const,
  requiresIndependentDiffSafetyEvidence: true as const,
  requiresCheckpointEvidence: true as const,
  schedulesSibling: false as const,
  startsChild: false as const,
  invokesRuntime: false as const,
  automaticRepairAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  distributedChildExecutionAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentChildReviewHandoffV1 {
  schemaVersion: 1;
  capturedAt: string;
  delegationSetId: string;
  delegationId: string;
  childTaskId: string;
  parentSupervisorTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  objective: string;
  acceptanceCriteria: string[];
  approvedWriteScope: string[];
  protectedPaths: string[];
  childStatus: TaskCompletionPacketV1["status"];
  reviewState: TaskCompletionPacketV1["reviewState"];
  workerCompletion?: {
    source: "cline_result";
    trust: "untrusted_worker_claims";
    report: string;
    truncated: boolean;
  };
  independentEvidence: TaskCompletionPacketV1["independentEvidence"];
  authority: "child_review_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentChildReviewHandoffError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "set_invalid"
      | "packet_invalid"
      | "binding_mismatch"
      | "evidence_insufficient",
  ) {
    super(message);
    this.name = "MultiAgentChildReviewHandoffError";
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
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildReviewHandoffError(
      "child execution preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertSet(value: MultiAgentDelegationSetV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "delegation_set_evidence_only"
    || !value.delegationIds.includes(value.delegationIds[0] ?? "")
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildReviewHandoffError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
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
    throw new MultiAgentChildReviewHandoffError(
      "child completion packet is not ready for supervisor review",
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
    throw new MultiAgentChildReviewHandoffError(
      "child completion packet lacks sufficient independent completion evidence",
      "evidence_insufficient",
    );
  }
}

function assertBindings(
  preparation: MultiAgentChildExecutionPreparationV1,
  set: MultiAgentDelegationSetV1,
  packet: TaskCompletionPacketV1,
): void {
  if (
    preparation.delegationSetId !== set.delegationSetId
    || !set.delegationIds.includes(preparation.delegationId)
    || preparation.coordinationMode !== set.coordinationMode
    || preparation.parentSupervisorTaskId !== set.parentSupervisorTaskId
    || preparation.parentTaskId !== set.taskId
    || preparation.projectId !== set.projectId
    || preparation.workspaceId !== set.workspaceId
    || preparation.workspaceRegistryRevision !== set.workspaceRegistryRevision
    || preparation.safetyPlanId !== set.safetyPlanId
    || preparation.safetyProfileId !== set.safetyProfileId
    || preparation.safetyProfileRevision !== set.safetyProfileRevision
    || preparation.workerProfileId !== set.workerProfileId
    || packet.taskId !== preparation.childTaskId
    || packet.projectId !== preparation.projectId
    || packet.workspaceId !== preparation.workspaceId
  ) {
    throw new MultiAgentChildReviewHandoffError(
      "child completion evidence does not match the exact delegation/preparation binding",
      "binding_mismatch",
    );
  }
}

export function createMultiAgentChildReviewHandoff(
  preparationInput: MultiAgentChildExecutionPreparationV1,
  setInput: MultiAgentDelegationSetV1,
  packetInput: TaskCompletionPacketV1,
): MultiAgentChildReviewHandoffV1 {
  assertPreparation(preparationInput);
  assertSet(setInput);
  assertPacket(packetInput);

  const preparation = structuredClone(preparationInput);
  const set = structuredClone(setInput);
  const packet = structuredClone(packetInput);

  assertBindings(preparation, set, packet);

  const handoff: MultiAgentChildReviewHandoffV1 = {
    schemaVersion: 1,
    capturedAt: packet.capturedAt,
    delegationSetId: preparation.delegationSetId,
    delegationId: preparation.delegationId,
    childTaskId: preparation.childTaskId,
    parentSupervisorTaskId: preparation.parentSupervisorTaskId,
    parentTaskId: preparation.parentTaskId,
    projectId: preparation.projectId,
    workspaceId: preparation.workspaceId,
    coordinationMode: preparation.coordinationMode,
    objective: preparation.objective,
    acceptanceCriteria: [...preparation.acceptanceCriteria],
    approvedWriteScope: [...preparation.allowedPathPatterns],
    protectedPaths: [...preparation.protectedPathPatterns],
    childStatus: packet.status,
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
    authority: "child_review_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };

  return Object.freeze(handoff);
}
