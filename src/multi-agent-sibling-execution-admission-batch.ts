import type {
  MultiAgentChildExecutionAdmissionService,
  MultiAgentChildExecutionAdmissionTicketV1,
} from "./multi-agent-child-execution-admission.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type {
  MultiAgentSiblingExecutionPreparationSetV1,
  MultiAgentSiblingChildPreparationRequestV1,
} from "./multi-agent-sibling-execution-preparation-set.js";

export const MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "sibling_execution_admission_batch_only" as const,
  reusesM13DAdmissionSemantics: true as const,
  issuesOnlyPreparedChildren: true as const,
  blockedSiblingTicketAllowed: false as const,
  terminalSiblingTicketAllowed: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  createsDurablePreparation: false as const,
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

export interface MultiAgentSiblingExecutionAdmissionBatchV1 {
  schemaVersion: 1;
  delegationSetId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  tickets: MultiAgentChildExecutionAdmissionTicketV1[];
  blockedChildTaskIds: string[];
  terminalChildTaskIds: string[];
  authority: "sibling_execution_admission_batch_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentSiblingExecutionAdmissionBatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "preparation_set_invalid"
      | "child_invalid"
      | "binding_mismatch"
      | "non_prepared_child",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentSiblingExecutionAdmissionBatchError";
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionAdmissionBatchError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertPreparationSet(
  set: MultiAgentDelegationSetV1,
  prepared: MultiAgentSiblingExecutionPreparationSetV1,
): void {
  if (
    prepared.schemaVersion !== 1
    || prepared.authority !== "sibling_execution_preparation_set_only"
    || prepared.delegationSetId !== set.delegationSetId
    || prepared.coordinationMode !== set.coordinationMode
    || prepared.grantsTaskAuthority !== false
    || prepared.grantsFilesystemAuthority !== false
    || prepared.grantsSafetyPlanAuthority !== false
    || prepared.grantsCredentialAuthority !== false
    || prepared.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionAdmissionBatchError(
      "M13R preparation set is invalid or cross-bound",
      "preparation_set_invalid",
    );
  }

  const ids = [
    ...prepared.preparationRequests.map((item) => item.childTaskId),
    ...prepared.blockedChildTaskIds,
    ...prepared.terminalChildTaskIds,
  ];
  if (new Set(ids).size !== ids.length) {
    throw new MultiAgentSiblingExecutionAdmissionBatchError(
      "M13R preparation set contains duplicate child identities",
      "preparation_set_invalid",
    );
  }
  if (set.coordinationMode === "serialized" && prepared.preparationRequests.length > 1) {
    throw new MultiAgentSiblingExecutionAdmissionBatchError(
      "serialized sibling batch cannot admit more than one child",
      "preparation_set_invalid",
    );
  }
}

function assertRequestMatchesChild(
  request: MultiAgentSiblingChildPreparationRequestV1,
  child: MultiAgentChildTaskDescriptorV1,
  set: MultiAgentDelegationSetV1,
): void {
  if (
    request.schemaVersion !== 1
    || request.authority !== "sibling_child_preparation_request_only"
    || request.executable !== false
    || request.requiresIndependentChildExecutionAdmission !== true
    || request.childTaskId !== child.childTaskId
    || request.delegationSetId !== child.delegationSetId
    || request.delegationId !== child.delegationId
    || request.coordinationMode !== child.coordinationMode
    || request.parentSupervisorTaskId !== child.parentSupervisorTaskId
    || request.parentTaskId !== child.parentTaskId
    || request.projectId !== child.projectId
    || request.workspaceId !== child.workspaceId
    || request.workspaceRegistryRevision !== child.workspaceRegistryRevision
    || request.safetyPlanId !== child.safetyPlanId
    || request.safetyProfileId !== child.safetyProfileId
    || request.safetyProfileRevision !== child.safetyProfileRevision
    || request.workerProfileId !== child.workerProfileId
    || request.objective !== child.objective
    || JSON.stringify(request.acceptanceCriteria) !== JSON.stringify(child.acceptanceCriteria)
    || JSON.stringify(request.allowedPathPatterns) !== JSON.stringify(child.allowedPathPatterns)
    || JSON.stringify(request.protectedPathPatterns) !== JSON.stringify(child.protectedPathPatterns)
    || child.delegationSetId !== set.delegationSetId
    || child.coordinationMode !== set.coordinationMode
    || child.grantsTaskAuthority !== false
    || child.grantsFilesystemAuthority !== false
    || child.grantsSafetyPlanAuthority !== false
    || child.grantsCredentialAuthority !== false
    || child.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingExecutionAdmissionBatchError(
      "M13R preparation request no longer matches the exact M13C child descriptor",
      "child_invalid",
    );
  }
}

export class MultiAgentSiblingExecutionAdmissionBatchService {
  constructor(
    private readonly childAdmission: MultiAgentChildExecutionAdmissionService,
  ) {}

  async issue(
    setInput: MultiAgentDelegationSetV1,
    preparedInput: MultiAgentSiblingExecutionPreparationSetV1,
    childrenInput: MultiAgentChildTaskDescriptorV1[],
  ): Promise<MultiAgentSiblingExecutionAdmissionBatchV1> {
    assertSet(setInput);
    const set = structuredClone(setInput);
    const prepared = structuredClone(preparedInput);
    const children = childrenInput.map((child) => structuredClone(child));
    assertPreparationSet(set, prepared);

    const byTask = new Map(children.map((child) => [child.childTaskId, child]));
    if (byTask.size !== children.length) {
      throw new MultiAgentSiblingExecutionAdmissionBatchError(
        "materialized child descriptors contain duplicate task identities",
        "binding_mismatch",
      );
    }

    for (const id of [
      ...prepared.blockedChildTaskIds,
      ...prepared.terminalChildTaskIds,
    ]) {
      if (!byTask.has(id)) {
        throw new MultiAgentSiblingExecutionAdmissionBatchError(
          "blocked/terminal sibling is not part of the exact materialized child set",
          "binding_mismatch",
        );
      }
    }

    const issuable: MultiAgentChildTaskDescriptorV1[] = [];
    for (const request of prepared.preparationRequests) {
      const child = byTask.get(request.childTaskId);
      if (!child) {
        throw new MultiAgentSiblingExecutionAdmissionBatchError(
          "prepared sibling is not part of the exact materialized child set",
          "binding_mismatch",
        );
      }
      assertRequestMatchesChild(request, child, set);
      issuable.push(child);
    }

    const tickets: MultiAgentChildExecutionAdmissionTicketV1[] = [];
    for (const child of issuable) {
      tickets.push(await this.childAdmission.issue(child, set));
    }

    return Object.freeze({
      schemaVersion: 1,
      delegationSetId: set.delegationSetId,
      coordinationMode: set.coordinationMode,
      tickets,
      blockedChildTaskIds: [...prepared.blockedChildTaskIds],
      terminalChildTaskIds: [...prepared.terminalChildTaskIds],
      authority: "sibling_execution_admission_batch_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }

  async issueForChild(
    set: MultiAgentDelegationSetV1,
    prepared: MultiAgentSiblingExecutionPreparationSetV1,
    children: MultiAgentChildTaskDescriptorV1[],
    childTaskId: string,
  ): Promise<MultiAgentChildExecutionAdmissionTicketV1> {
    const request = prepared.preparationRequests.find((item) => item.childTaskId === childTaskId);
    if (!request) {
      throw new MultiAgentSiblingExecutionAdmissionBatchError(
        "blocked or terminal sibling cannot obtain an execution-admission ticket",
        "non_prepared_child",
      );
    }
    const child = children.find((item) => item.childTaskId === childTaskId);
    if (!child) {
      throw new MultiAgentSiblingExecutionAdmissionBatchError(
        "prepared sibling is missing its materialized descriptor",
        "binding_mismatch",
      );
    }
    assertSet(set);
    assertPreparationSet(set, prepared);
    assertRequestMatchesChild(request, child, set);
    return this.childAdmission.issue(child, set);
  }
}
