import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { WorkspaceLockStateV1 } from "./workspace-lock.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import {
  selectMultiAgentSiblingWriterCandidate,
  type MultiAgentSiblingWriterCompatibilityEvidenceV1,
} from "./multi-agent-sibling-writer-compatibility.js";

export const MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "deferred_sibling_progression_evidence_only" as const,
  requiresPriorSelectedTerminal: true as const,
  requiresWorkspaceWriterReleased: true as const,
  reusesM13USelection: true as const,
  acquiresWriterLease: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentDeferredSiblingProgressionEvidenceV1 {
  schemaVersion: 1;
  previousSelectedChildTaskId: string;
  delegationSetId: string;
  workspaceId: string;
  previousChildTerminalStatus: TaskCompletionPacketV1["status"];
  nextSelection: MultiAgentSiblingWriterCompatibilityEvidenceV1;
  authority: "deferred_sibling_progression_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentDeferredSiblingProgressionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "selection_invalid"
      | "completion_invalid"
      | "workspace_lock_active"
      | "batch_invalid"
      | "no_deferred_sibling",
  ) {
    super(message);
    this.name = "MultiAgentDeferredSiblingProgressionError";
  }
}

function assertPriorSelection(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
): void {
  if (
    selection.schemaVersion !== 1
    || selection.authority !== "sibling_writer_compatibility_evidence_only"
    || !selection.selectedCandidate
    || selection.selectedCandidate.authority !== "sibling_writer_activation_candidate_only"
    || selection.selectedCandidate.childTaskId.length === 0
    || selection.selectedCandidate.workspaceId !== selection.workspaceId
    || selection.selectedCandidate.delegationSetId !== selection.delegationSetId
    || selection.grantsTaskAuthority !== false
    || selection.grantsFilesystemAuthority !== false
    || selection.grantsSafetyPlanAuthority !== false
    || selection.grantsCredentialAuthority !== false
    || selection.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "prior M13U selection evidence is invalid or widened",
      "selection_invalid",
    );
  }
}

function assertTerminalCompletion(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  completion: TaskCompletionPacketV1,
): void {
  const selected = selection.selectedCandidate!;
  if (
    completion.schemaVersion !== 1
    || completion.taskId !== selected.childTaskId
    || completion.workspaceId !== selected.workspaceId
    || completion.completionSignal.terminal !== true
    || !["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(completion.status)
  ) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "previously selected sibling is not proven terminal in the same workspace",
      "completion_invalid",
    );
  }
}

function assertWriterReleased(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  lock: WorkspaceLockStateV1,
): void {
  if (
    lock.schemaVersion !== 1
    || lock.workspaceId !== selection.workspaceId
    || lock.coordination.exclusiveWriter !== true
  ) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "workspace lock evidence does not match the selected sibling workspace",
      "workspace_lock_active",
    );
  }
  if (lock.activeWriter) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "shared workspace still has an active writer; deferred sibling cannot advance",
      "workspace_lock_active",
    );
  }
}

export function progressMultiAgentDeferredSibling(
  priorSelectionInput: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  completionInput: TaskCompletionPacketV1,
  workspaceLockInput: WorkspaceLockStateV1,
  batchInput: MultiAgentSiblingDurablePreparationBatchV1,
): MultiAgentDeferredSiblingProgressionEvidenceV1 {
  assertPriorSelection(priorSelectionInput);
  const priorSelection = structuredClone(priorSelectionInput);
  const completion = structuredClone(completionInput);
  const workspaceLock = structuredClone(workspaceLockInput);
  const batch = structuredClone(batchInput);

  assertTerminalCompletion(priorSelection, completion);
  assertWriterReleased(priorSelection, workspaceLock);

  const selectedId = priorSelection.selectedCandidate!.childTaskId;
  if (
    batch.schemaVersion !== 1
    || batch.authority !== "sibling_durable_preparation_batch_only"
    || batch.delegationSetId !== priorSelection.delegationSetId
    || batch.coordinationMode !== priorSelection.coordinationMode
    || batch.preparations.some((item) => item.workspaceId !== priorSelection.workspaceId)
  ) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "M13T preparation batch no longer matches the prior sibling selection",
      "batch_invalid",
    );
  }

  const remainingPreparations = batch.preparations.filter(
    (item) => item.childTaskId !== selectedId,
  );
  if (remainingPreparations.length === 0) {
    throw new MultiAgentDeferredSiblingProgressionError(
      "no deferred prepared sibling remains to advance",
      "no_deferred_sibling",
    );
  }

  const nextBatch: MultiAgentSiblingDurablePreparationBatchV1 = {
    ...batch,
    preparations: remainingPreparations,
    terminalChildTaskIds: Array.from(new Set([
      ...batch.terminalChildTaskIds,
      selectedId,
    ])),
  };
  const nextSelection = selectMultiAgentSiblingWriterCandidate(nextBatch);

  return Object.freeze({
    schemaVersion: 1,
    previousSelectedChildTaskId: selectedId,
    delegationSetId: priorSelection.delegationSetId,
    workspaceId: priorSelection.workspaceId,
    previousChildTerminalStatus: completion.status,
    nextSelection,
    authority: "deferred_sibling_progression_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
