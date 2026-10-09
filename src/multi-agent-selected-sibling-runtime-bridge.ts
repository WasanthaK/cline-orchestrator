import type { MultiAgentChildExecutionActivationContext } from "./multi-agent-child-execution-activation.js";
import type { MultiAgentChildRuntimeStarter } from "./multi-agent-child-runtime-start.js";
import type { MultiAgentSiblingWriterCompatibilityEvidenceV1 } from "./multi-agent-sibling-writer-compatibility.js";
import type { OrchestratorTask } from "./types.js";

export const MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "selected_sibling_runtime_bridge_only" as const,
  requiresM13USelection: true as const,
  requiresM13VActivationContext: true as const,
  reusesM13GRuntimeStarter: true as const,
  deferredSiblingRuntimeAllowed: false as const,
  blockedSiblingRuntimeAllowed: false as const,
  terminalSiblingRuntimeAllowed: false as const,
  createsSecondWriter: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export class MultiAgentSelectedSiblingRuntimeBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "selection_invalid"
      | "activation_invalid"
      | "selection_mismatch"
      | "non_selected_child",
  ) {
    super(message);
    this.name = "MultiAgentSelectedSiblingRuntimeBridgeError";
  }
}

function assertSelection(selection: MultiAgentSiblingWriterCompatibilityEvidenceV1): void {
  if (
    selection.schemaVersion !== 1
    || selection.authority !== "sibling_writer_compatibility_evidence_only"
    || selection.grantsTaskAuthority !== false
    || selection.grantsFilesystemAuthority !== false
    || selection.grantsSafetyPlanAuthority !== false
    || selection.grantsCredentialAuthority !== false
    || selection.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSelectedSiblingRuntimeBridgeError(
      "M13U sibling selection evidence is invalid or widened",
      "selection_invalid",
    );
  }
  const candidate = selection.selectedCandidate;
  if (
    !candidate
    || candidate.schemaVersion !== 1
    || candidate.authority !== "sibling_writer_activation_candidate_only"
    || candidate.runtimeStartAuthorized !== false
    || candidate.requiresFreshSchedulerOwnedWriterLease !== true
    || candidate.delegationSetId !== selection.delegationSetId
    || candidate.workspaceId !== selection.workspaceId
    || candidate.coordinationMode !== selection.coordinationMode
  ) {
    throw new MultiAgentSelectedSiblingRuntimeBridgeError(
      "M13U selected sibling candidate is absent, invalid, or cross-bound",
      "selection_invalid",
    );
  }
  if (
    selection.deferredPreparedChildTaskIds.includes(candidate.childTaskId)
    || selection.blockedChildTaskIds.includes(candidate.childTaskId)
    || selection.terminalChildTaskIds.includes(candidate.childTaskId)
  ) {
    throw new MultiAgentSelectedSiblingRuntimeBridgeError(
      "selected sibling is simultaneously deferred/blocked/terminal",
      "selection_invalid",
    );
  }
}

function assertActivation(
  selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
  context: MultiAgentChildExecutionActivationContext,
): void {
  const candidate = selection.selectedCandidate!;
  if (
    context.evidence.schemaVersion !== 1
    || context.evidence.authority !== "child_execution_activation_evidence_only"
    || context.evidence.runtimeStartAuthorized !== false
    || context.runtimeInput.schemaVersion !== 1
    || context.runtimeInput.authority !== "child_runtime_input_only"
    || context.runtimeInput.runtimeStartAuthorized !== false
    || context.evidence.childTaskId !== candidate.childTaskId
    || context.runtimeInput.childTaskId !== candidate.childTaskId
    || context.evidence.workspaceId !== candidate.workspaceId
    || context.runtimeInput.workspaceId !== candidate.workspaceId
    || context.runtimeInput.coordinationMode !== candidate.coordinationMode
    || context.lease.taskId !== candidate.childTaskId
    || context.lease.workspaceId !== candidate.workspaceId
  ) {
    throw new MultiAgentSelectedSiblingRuntimeBridgeError(
      "M13V activation context does not match the exact M13U selected sibling",
      "activation_invalid",
    );
  }
}

export class MultiAgentSelectedSiblingRuntimeBridge {
  constructor(
    private readonly runtimeStarter: Pick<MultiAgentChildRuntimeStarter, "start">,
  ) {}

  async startSelected(
    selectionInput: MultiAgentSiblingWriterCompatibilityEvidenceV1,
    context: MultiAgentChildExecutionActivationContext,
  ): Promise<OrchestratorTask> {
    assertSelection(selectionInput);
    const selection = structuredClone(selectionInput);
    assertActivation(selection, context);
    return this.runtimeStarter.start(context);
  }

  assertChildSelected(
    selection: MultiAgentSiblingWriterCompatibilityEvidenceV1,
    childTaskId: string,
  ): void {
    assertSelection(selection);
    if (selection.selectedCandidate?.childTaskId !== childTaskId) {
      throw new MultiAgentSelectedSiblingRuntimeBridgeError(
        "deferred, blocked or terminal sibling cannot enter runtime start",
        "non_selected_child",
      );
    }
  }
}
