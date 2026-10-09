import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";

export const MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "sibling_writer_compatibility_evidence_only" as const,
  maxActiveWritersPerWorkspace: 1 as const,
  allSiblingsShareWorkspace: true as const,
  parallelDisjointOverridesWorkspaceWriterLock: false as const,
  selectsAtMostOneLeaseCandidate: true as const,
  acquiresWriterLease: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresDistributedFence: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentSiblingWriterCompatibilityCandidateV1 {
  schemaVersion: 1;
  childTaskId: string;
  preparationId: string;
  workspaceId: string;
  delegationSetId: string;
  delegationId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  authority: "sibling_writer_activation_candidate_only";
  requiresFreshSchedulerOwnedWriterLease: true;
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentSiblingWriterCompatibilityEvidenceV1 {
  schemaVersion: 1;
  delegationSetId: string;
  workspaceId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  selectedCandidate?: MultiAgentSiblingWriterCompatibilityCandidateV1;
  deferredPreparedChildTaskIds: string[];
  blockedChildTaskIds: string[];
  terminalChildTaskIds: string[];
  parallelConcurrencyDeferredByExclusiveWorkspaceWriter: boolean;
  authority: "sibling_writer_compatibility_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentSiblingWriterCompatibilityError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "batch_invalid"
      | "preparation_invalid"
      | "binding_mismatch",
  ) {
    super(message);
    this.name = "MultiAgentSiblingWriterCompatibilityError";
  }
}

function assertPreparation(
  batch: MultiAgentSiblingDurablePreparationBatchV1,
  preparation: MultiAgentChildExecutionPreparationV1,
): void {
  if (
    preparation.schemaVersion !== 1
    || preparation.authority !== "child_execution_preparation_only"
    || preparation.state !== "prepared"
    || preparation.executable !== false
    || preparation.delegationSetId !== batch.delegationSetId
    || preparation.coordinationMode !== batch.coordinationMode
    || preparation.requiresFreshParentBindingAtExecution !== true
    || preparation.requiresFreshWriterLease !== true
    || preparation.grantsTaskAuthority !== false
    || preparation.grantsFilesystemAuthority !== false
    || preparation.grantsSafetyPlanAuthority !== false
    || preparation.grantsCredentialAuthority !== false
    || preparation.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingWriterCompatibilityError(
      "sibling durable preparation is invalid or cross-bound",
      "preparation_invalid",
    );
  }
}

export function selectMultiAgentSiblingWriterCandidate(
  batchInput: MultiAgentSiblingDurablePreparationBatchV1,
): MultiAgentSiblingWriterCompatibilityEvidenceV1 {
  if (
    batchInput.schemaVersion !== 1
    || batchInput.authority !== "sibling_durable_preparation_batch_only"
    || !["parallel_disjoint", "serialized"].includes(batchInput.coordinationMode)
    || batchInput.grantsTaskAuthority !== false
    || batchInput.grantsFilesystemAuthority !== false
    || batchInput.grantsSafetyPlanAuthority !== false
    || batchInput.grantsCredentialAuthority !== false
    || batchInput.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingWriterCompatibilityError(
      "M13T sibling preparation batch is invalid or widened",
      "batch_invalid",
    );
  }

  const batch = structuredClone(batchInput);
  const preparations = batch.preparations;
  for (const preparation of preparations) {
    assertPreparation(batch, preparation);
  }

  const ids = preparations.map((item) => item.childTaskId);
  if (new Set(ids).size !== ids.length) {
    throw new MultiAgentSiblingWriterCompatibilityError(
      "sibling preparation batch contains duplicate child identities",
      "binding_mismatch",
    );
  }

  const workspaceIds = new Set(preparations.map((item) => item.workspaceId));
  if (workspaceIds.size > 1) {
    throw new MultiAgentSiblingWriterCompatibilityError(
      "M13B sibling preparations must share one workspace",
      "binding_mismatch",
    );
  }

  if (batch.coordinationMode === "serialized" && preparations.length > 1) {
    throw new MultiAgentSiblingWriterCompatibilityError(
      "serialized sibling preparation batch cannot contain multiple executable candidates",
      "binding_mismatch",
    );
  }

  const selected = preparations[0];
  const workspaceId = selected?.workspaceId ?? "";
  const selectedCandidate = selected
    ? Object.freeze({
        schemaVersion: 1 as const,
        childTaskId: selected.childTaskId,
        preparationId: selected.preparationId,
        workspaceId: selected.workspaceId,
        delegationSetId: selected.delegationSetId,
        delegationId: selected.delegationId,
        coordinationMode: selected.coordinationMode,
        authority: "sibling_writer_activation_candidate_only" as const,
        requiresFreshSchedulerOwnedWriterLease: true as const,
        runtimeStartAuthorized: false as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      })
    : undefined;

  return Object.freeze({
    schemaVersion: 1,
    delegationSetId: batch.delegationSetId,
    workspaceId,
    coordinationMode: batch.coordinationMode,
    ...(selectedCandidate ? { selectedCandidate } : {}),
    deferredPreparedChildTaskIds: preparations.slice(1).map((item) => item.childTaskId),
    blockedChildTaskIds: [...batch.blockedChildTaskIds],
    terminalChildTaskIds: [...batch.terminalChildTaskIds],
    parallelConcurrencyDeferredByExclusiveWorkspaceWriter:
      batch.coordinationMode === "parallel_disjoint" && preparations.length > 1,
    authority: "sibling_writer_compatibility_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
