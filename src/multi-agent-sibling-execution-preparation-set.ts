import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentSiblingExecutionSetAdmissionV1 } from "./multi-agent-sibling-execution-set-admission.js";

export const MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "sibling_execution_preparation_set_only" as const,
  requiresM13QAdmission: true as const,
  emitsOnlyAdmittedChildren: true as const,
  preservesCoordinationMode: true as const,
  issuesChildExecutionAdmissionToken: false as const,
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

export interface MultiAgentSiblingChildPreparationRequestV1 {
  schemaVersion: 1;
  childTaskId: string;
  delegationSetId: string;
  delegationId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  parentSupervisorTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  objective: string;
  acceptanceCriteria: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  authority: "sibling_child_preparation_request_only";
  executable: false;
  requiresIndependentChildExecutionAdmission: true;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentSiblingExecutionPreparationSetV1 {
  schemaVersion: 1;
  delegationSetId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  preparationRequests: MultiAgentSiblingChildPreparationRequestV1[];
  blockedChildTaskIds: string[];
  terminalChildTaskIds: string[];
  authority: "sibling_execution_preparation_set_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentSiblingExecutionPreparationSetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "admission_invalid"
      | "child_invalid"
      | "binding_mismatch"
      | "non_admitted_child",
  ) {
    super(message);
    this.name = "MultiAgentSiblingExecutionPreparationSetError";
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
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertAdmission(
  set: MultiAgentDelegationSetV1,
  admission: MultiAgentSiblingExecutionSetAdmissionV1,
): void {
  if (
    admission.schemaVersion !== 1
    || admission.authority !== "sibling_execution_set_admission_only"
    || admission.delegationSetId !== set.delegationSetId
    || admission.coordinationMode !== set.coordinationMode
    || admission.grantsTaskAuthority !== false
    || admission.grantsFilesystemAuthority !== false
    || admission.grantsSafetyPlanAuthority !== false
    || admission.grantsCredentialAuthority !== false
    || admission.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "M13Q sibling admission evidence is invalid or cross-bound",
      "admission_invalid",
    );
  }

  const all = [
    ...admission.admittedChildTaskIds,
    ...admission.blockedChildTaskIds,
    ...admission.terminalChildTaskIds,
  ];
  if (new Set(all).size !== all.length) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "M13Q sibling admission contains duplicate child identities",
      "admission_invalid",
    );
  }
  if (set.coordinationMode === "serialized" && admission.admittedChildTaskIds.length > 1) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "serialized sibling admission cannot prepare more than one child",
      "admission_invalid",
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
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "materialized child does not match the exact delegation-set binding",
      "child_invalid",
    );
  }
}

export function prepareMultiAgentSiblingExecutionSet(
  setInput: MultiAgentDelegationSetV1,
  admissionInput: MultiAgentSiblingExecutionSetAdmissionV1,
  childrenInput: MultiAgentChildTaskDescriptorV1[],
): MultiAgentSiblingExecutionPreparationSetV1 {
  assertSet(setInput);
  const set = structuredClone(setInput);
  const admission = structuredClone(admissionInput);
  const children = childrenInput.map((child) => structuredClone(child));
  assertAdmission(set, admission);

  if (children.length !== set.delegationIds.length) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "materialized children must cover the delegation set exactly once",
      "binding_mismatch",
    );
  }

  const byTask = new Map<string, MultiAgentChildTaskDescriptorV1>();
  const byDelegation = new Map<string, MultiAgentChildTaskDescriptorV1>();
  for (const child of children) {
    assertChild(set, child);
    if (byTask.has(child.childTaskId) || byDelegation.has(child.delegationId)) {
      throw new MultiAgentSiblingExecutionPreparationSetError(
        "materialized children contain duplicate task or delegation identities",
        "binding_mismatch",
      );
    }
    byTask.set(child.childTaskId, child);
    byDelegation.set(child.delegationId, child);
  }
  if (set.delegationIds.some((id) => !byDelegation.has(id))) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "materialized children do not cover every delegation in the set",
      "binding_mismatch",
    );
  }

  const admitted = admission.admittedChildTaskIds.map((id) => {
    const child = byTask.get(id);
    if (!child) {
      throw new MultiAgentSiblingExecutionPreparationSetError(
        "M13Q admitted child is not part of the exact materialized set",
        "binding_mismatch",
      );
    }
    return child;
  });

  for (const blockedId of [
    ...admission.blockedChildTaskIds,
    ...admission.terminalChildTaskIds,
  ]) {
    if (!byTask.has(blockedId)) {
      throw new MultiAgentSiblingExecutionPreparationSetError(
        "M13Q blocked/terminal child is not part of the exact materialized set",
        "binding_mismatch",
      );
    }
  }

  const requests = admitted.map((child): MultiAgentSiblingChildPreparationRequestV1 => ({
    schemaVersion: 1,
    childTaskId: child.childTaskId,
    delegationSetId: child.delegationSetId,
    delegationId: child.delegationId,
    coordinationMode: child.coordinationMode,
    parentSupervisorTaskId: child.parentSupervisorTaskId,
    parentTaskId: child.parentTaskId,
    projectId: child.projectId,
    workspaceId: child.workspaceId,
    workspaceRegistryRevision: child.workspaceRegistryRevision,
    safetyPlanId: child.safetyPlanId,
    safetyProfileId: child.safetyProfileId,
    safetyProfileRevision: child.safetyProfileRevision,
    workerProfileId: child.workerProfileId,
    objective: child.objective,
    acceptanceCriteria: [...child.acceptanceCriteria],
    allowedPathPatterns: [...child.allowedPathPatterns],
    protectedPathPatterns: [...child.protectedPathPatterns],
    authority: "sibling_child_preparation_request_only",
    executable: false,
    requiresIndependentChildExecutionAdmission: true,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  }));

  return Object.freeze({
    schemaVersion: 1,
    delegationSetId: set.delegationSetId,
    coordinationMode: set.coordinationMode,
    preparationRequests: requests,
    blockedChildTaskIds: [...admission.blockedChildTaskIds],
    terminalChildTaskIds: [...admission.terminalChildTaskIds],
    authority: "sibling_execution_preparation_set_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}

export function assertSiblingChildAdmittedForPreparation(
  set: MultiAgentSiblingExecutionPreparationSetV1,
  childTaskId: string,
): MultiAgentSiblingChildPreparationRequestV1 {
  const request = set.preparationRequests.find((item) => item.childTaskId === childTaskId);
  if (!request) {
    throw new MultiAgentSiblingExecutionPreparationSetError(
      "child is blocked or terminal and cannot advance to execution preparation",
      "non_admitted_child",
    );
  }
  return structuredClone(request);
}
