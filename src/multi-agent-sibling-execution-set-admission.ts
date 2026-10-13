import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

export const MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "sibling_execution_set_admission_only" as const,
  parallelRequiresDisjointSetEvidence: true as const,
  serializedAdmitsExactlyOne: true as const,
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
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type MultiAgentSiblingChildStateV1 =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export interface MultiAgentSiblingChildStateEvidenceV1 {
  schemaVersion: 1;
  childTaskId: string;
  delegationId: string;
  state: MultiAgentSiblingChildStateV1;
  authority: "sibling_child_state_evidence_only";
}

export interface MultiAgentSiblingExecutionSetAdmissionV1 {
  schemaVersion: 1;
  delegationSetId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  admittedChildTaskIds: string[];
  blockedChildTaskIds: string[];
  terminalChildTaskIds: string[];
  authority: "sibling_execution_set_admission_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentSiblingExecutionSetAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "child_invalid"
      | "state_invalid"
      | "binding_mismatch"
      | "serialized_conflict",
  ) {
    super(message);
    this.name = "MultiAgentSiblingExecutionSetAdmissionError";
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || !Array.isArray(set.delegationIds)
    || set.delegationIds.length < 1
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
  if (
    set.coordinationMode === "parallel_disjoint"
    && set.overlappingDelegationPairs.length > 0
  ) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "parallel sibling admission requires existing disjoint-scope evidence",
      "set_invalid",
    );
  }
}

function assertChild(
  set: MultiAgentDelegationSetV1,
  child: MultiAgentChildTaskDescriptorV1,
): void {
  if (
    child.schemaVersion !== 1
    || child.authority !== "child_task_materialization_only"
    || child.executable !== false
    || child.delegationSetId !== set.delegationSetId
    || !set.delegationIds.includes(child.delegationId)
    || child.coordinationMode !== set.coordinationMode
    || child.parentSupervisorTaskId !== set.parentSupervisorTaskId
    || child.parentTaskId !== set.taskId
    || child.projectId !== set.projectId
    || child.workspaceId !== set.workspaceId
    || child.workspaceRegistryRevision !== set.workspaceRegistryRevision
    || child.safetyPlanId !== set.safetyPlanId
    || child.safetyProfileId !== set.safetyProfileId
    || child.safetyProfileRevision !== set.safetyProfileRevision
    || child.workerProfileId !== set.workerProfileId
    || child.grantsTaskAuthority !== false
    || child.grantsFilesystemAuthority !== false
    || child.grantsSafetyPlanAuthority !== false
    || child.grantsCredentialAuthority !== false
    || child.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "child descriptor does not match the exact delegation-set binding",
      "child_invalid",
    );
  }
}

function assertState(
  child: MultiAgentChildTaskDescriptorV1,
  state: MultiAgentSiblingChildStateEvidenceV1,
): void {
  if (
    state.schemaVersion !== 1
    || state.authority !== "sibling_child_state_evidence_only"
    || state.childTaskId !== child.childTaskId
    || state.delegationId !== child.delegationId
    || !["pending", "running", "completed", "failed", "aborted"].includes(state.state)
  ) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "child state evidence is invalid or cross-bound",
      "state_invalid",
    );
  }
}

export function admitMultiAgentSiblingExecutionSet(
  setInput: MultiAgentDelegationSetV1,
  childrenInput: MultiAgentChildTaskDescriptorV1[],
  statesInput: MultiAgentSiblingChildStateEvidenceV1[],
): MultiAgentSiblingExecutionSetAdmissionV1 {
  assertSet(setInput);
  const set = structuredClone(setInput);
  const children = childrenInput.map((child) => structuredClone(child));
  const states = statesInput.map((state) => structuredClone(state));

  if (children.length !== set.delegationIds.length || states.length !== children.length) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "every delegation in the set must have exactly one materialized child and state evidence",
      "binding_mismatch",
    );
  }

  const byDelegation = new Map(children.map((child) => [child.delegationId, child]));
  if (
    byDelegation.size !== children.length
    || set.delegationIds.some((id) => !byDelegation.has(id))
  ) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "materialized children must cover the delegation set exactly once",
      "binding_mismatch",
    );
  }

  const stateByChild = new Map(states.map((state) => [state.childTaskId, state]));
  if (stateByChild.size !== states.length) {
    throw new MultiAgentSiblingExecutionSetAdmissionError(
      "child state evidence contains duplicate child identities",
      "binding_mismatch",
    );
  }

  for (const child of children) {
    assertChild(set, child);
    const state = stateByChild.get(child.childTaskId);
    if (!state) {
      throw new MultiAgentSiblingExecutionSetAdmissionError(
        "missing state evidence for materialized child",
        "binding_mismatch",
      );
    }
    assertState(child, state);
  }

  const orderedChildren = set.delegationIds.map((id) => byDelegation.get(id)!);
  const running = orderedChildren.filter(
    (child) => stateByChild.get(child.childTaskId)!.state === "running",
  );
  const pending = orderedChildren.filter(
    (child) => stateByChild.get(child.childTaskId)!.state === "pending",
  );
  const terminal = orderedChildren.filter((child) =>
    ["completed", "failed", "aborted"].includes(
      stateByChild.get(child.childTaskId)!.state,
    ));

  let admitted: MultiAgentChildTaskDescriptorV1[] = [];
  if (set.coordinationMode === "parallel_disjoint") {
    admitted = pending;
  } else {
    if (running.length > 1) {
      throw new MultiAgentSiblingExecutionSetAdmissionError(
        "serialized sibling set cannot have more than one running child",
        "serialized_conflict",
      );
    }
    if (running.length === 0 && pending.length > 0) {
      admitted = [pending[0]!];
    }
  }

  const admittedIds = new Set(admitted.map((child) => child.childTaskId));
  return Object.freeze({
    schemaVersion: 1,
    delegationSetId: set.delegationSetId,
    coordinationMode: set.coordinationMode,
    admittedChildTaskIds: admitted.map((child) => child.childTaskId),
    blockedChildTaskIds: orderedChildren
      .filter((child) => !admittedIds.has(child.childTaskId)
        && !terminal.some((item) => item.childTaskId === child.childTaskId))
      .map((child) => child.childTaskId),
    terminalChildTaskIds: terminal.map((child) => child.childTaskId),
    authority: "sibling_execution_set_admission_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
