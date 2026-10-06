import type {
  MultiAgentChildExecutionActivationContext,
  MultiAgentChildExecutionActivationCoordinator,
} from "./multi-agent-child-execution-activation.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import type {
  MultiAgentSiblingWriterCompatibilityEvidenceV1,
} from "./multi-agent-sibling-writer-compatibility.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "selected_sibling_activation_bridge_only" as const,
  requiresM13USelection: true as const,
  reusesM13FActivationCoordinator: true as const,
  deferredSiblingActivationAllowed: false as const,
  blockedSiblingActivationAllowed: false as const,
  terminalSiblingActivationAllowed: false as const,
  acquiresWriterLease: false as const,
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

export class MultiAgentSelectedSiblingActivationBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "selection_invalid"
      | "batch_invalid"
      | "preparation_missing"
      | "selection_mismatch"
      | "non_selected_child",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentSelectedSiblingActivationBridgeError";
  }
}

function assertSelection(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
): void {
  if (
    selection.schemaVersion !== 1
    || selection.authority !== "sibling_writer_compatibility_evidence_only"
    || selection.grantsTaskAuthority !== false
    || selection.grantsFilesystemAuthority !== false
    || selection.grantsSafetyPlanAuthority !== false
    || selection.grantsCredentialAuthority !== false
    || selection.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "M13U sibling selection evidence is invalid or widened",
      "selection_invalid",
    );
  }
  const candidate = selection.selectedCandidate;
  if (
    candidate
    && (
      candidate.schemaVersion !== 1
      || candidate.authority !== "sibling_writer_activation_candidate_only"
      || candidate.requiresFreshSchedulerOwnedWriterLease !== true
      || candidate.runtimeStartAuthorized !== false
      || candidate.delegationSetId !== selection.delegationSetId
      || candidate.workspaceId !== selection.workspaceId
      || candidate.coordinationMode !== selection.coordinationMode
      || candidate.grantsTaskAuthority !== false
      || candidate.grantsFilesystemAuthority !== false
      || candidate.grantsSafetyPlanAuthority !== false
      || candidate.grantsCredentialAuthority !== false
      || candidate.grantsReleaseAuthority !== false
    )
  ) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "M13U selected candidate is invalid or cross-bound",
      "selection_invalid",
    );
  }
}

function assertBatch(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  batch: MultiAgentSiblingDurablePreparationBatchV1,
): void {
  if (
    batch.schemaVersion !== 1
    || batch.authority !== "sibling_durable_preparation_batch_only"
    || batch.delegationSetId !== selection.delegationSetId
    || batch.coordinationMode !== selection.coordinationMode
    || batch.grantsTaskAuthority !== false
    || batch.grantsFilesystemAuthority !== false
    || batch.grantsSafetyPlanAuthority !== false
    || batch.grantsCredentialAuthority !== false
    || batch.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "M13T sibling durable-preparation batch is invalid or cross-bound",
      "batch_invalid",
    );
  }
}

function findPreparation(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  batch: MultiAgentSiblingDurablePreparationBatchV1,
): MultiAgentChildExecutionPreparationV1 {
  const candidate = selection.selectedCandidate;
  if (!candidate) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "M13U did not select a sibling for activation",
      "non_selected_child",
    );
  }
  if (
    selection.deferredPreparedChildTaskIds.includes(candidate.childTaskId)
    || selection.blockedChildTaskIds.includes(candidate.childTaskId)
    || selection.terminalChildTaskIds.includes(candidate.childTaskId)
  ) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "selected sibling is simultaneously marked deferred/blocked/terminal",
      "selection_invalid",
    );
  }

  const preparation = batch.preparations.find(
    (item) => item.childTaskId === candidate.childTaskId,
  );
  if (!preparation) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "selected sibling has no exact M13T durable preparation",
      "preparation_missing",
    );
  }
  if (
    preparation.preparationId !== candidate.preparationId
    || preparation.delegationSetId !== candidate.delegationSetId
    || preparation.delegationId !== candidate.delegationId
    || preparation.workspaceId !== candidate.workspaceId
    || preparation.coordinationMode !== candidate.coordinationMode
  ) {
    throw new MultiAgentSelectedSiblingActivationBridgeError(
      "M13U candidate does not match the exact M13T preparation identity",
      "selection_mismatch",
    );
  }
  return preparation;
}

export class MultiAgentSelectedSiblingActivationBridge {
  constructor(
    private readonly activation: MultiAgentChildExecutionActivationCoordinator,
  ) {}

  async activateSelected(
    selectionInput: MultiAgentSiblingWriterCompatibilityEvidenceV1,
    batchInput: MultiAgentSiblingDurablePreparationBatchV1,
    lease: WriterLeaseSession,
  ): Promise<MultiAgentChildExecutionActivationContext> {
    assertSelection(selectionInput);
    const selection = structuredClone(selectionInput);
    const batch = structuredClone(batchInput);
    assertBatch(selection, batch);
    const preparation = findPreparation(selection, batch);

    const candidate = selection.selectedCandidate!;
    if (
      lease.taskId !== candidate.childTaskId
      || lease.workspaceId !== candidate.workspaceId
    ) {
      throw new MultiAgentSelectedSiblingActivationBridgeError(
        "fresh local writer lease is not bound to the selected sibling/workspace",
        "selection_mismatch",
      );
    }

    return this.activation.activate(preparation, lease);
  }

  assertChildSelected(
    selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
    childTaskId: string,
  ): void {
    assertSelection(selection);
    if (selection.selectedCandidate?.childTaskId !== childTaskId) {
      throw new MultiAgentSelectedSiblingActivationBridgeError(
        "deferred, blocked or terminal sibling cannot enter activation",
        "non_selected_child",
      );
    }
  }
}
