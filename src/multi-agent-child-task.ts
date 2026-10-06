import crypto from "node:crypto";
import type { MultiAgentDelegationEnvelopeV1 } from "./multi-agent-delegation-contract.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MULTI_AGENT_CHILD_TASK_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_task_materialization_only" as const,
  executableTask: false as const,
  persistsIntoTaskStore: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDispatch: false as const,
  invokesAdmission: false as const,
  allowsSubdelegation: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentChildTaskDescriptorV1 {
  schemaVersion: 1;
  childTaskId: string;
  materializedAt: string;
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
  authority: "child_task_materialization_only";
  executable: false;
  requiresIndependentExecutionAdmission: true;
  requiresFreshWriterLease: true;
  requiresFreshDistributedFenceWhenDistributed: true;
  requiresParentBindingRevalidation: true;
  allowsSubdelegation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MaterializeMultiAgentChildTaskOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentChildTaskError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "delegation_invalid"
      | "binding_mismatch"
      | "delegation_not_in_set"
      | "materialization_invalid",
  ) {
    super(message);
    this.name = "MultiAgentChildTaskError";
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !UUID.test(set.delegationSetId)
    || !UUID.test(set.parentSupervisorTaskId)
    || !UUID.test(set.taskId)
    || !UUID.test(set.projectId)
    || !UUID.test(set.workspaceId)
    || !UUID.test(set.safetyPlanId)
    || !UUID.test(set.safetyProfileId)
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || !Array.isArray(set.delegationIds)
    || set.delegationIds.length < 1
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsWriterLeaseAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildTaskError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertDelegation(value: MultiAgentDelegationEnvelopeV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "delegation_envelope_only"
    || !UUID.test(value.delegationId)
    || !UUID.test(value.parentSupervisorTaskId)
    || !UUID.test(value.taskId)
    || !UUID.test(value.projectId)
    || !UUID.test(value.workspaceId)
    || !UUID.test(value.safetyPlanId)
    || !UUID.test(value.safetyProfileId)
    || value.constraints.scopeExpansion !== "stop_and_escalate"
    || value.constraints.subdelegationAllowed !== false
    || value.constraints.agentTeamsAllowed !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildTaskError(
      "delegation envelope is invalid or widened",
      "delegation_invalid",
    );
  }
}

function sameParent(
  set: MultiAgentDelegationSetV1,
  delegation: MultiAgentDelegationEnvelopeV1,
): boolean {
  return set.parentSupervisorTaskId === delegation.parentSupervisorTaskId
    && set.taskId === delegation.taskId
    && set.projectId === delegation.projectId
    && set.workspaceId === delegation.workspaceId
    && set.workspaceRegistryRevision === delegation.workspaceRegistryRevision
    && set.safetyPlanId === delegation.safetyPlanId
    && set.safetyProfileId === delegation.safetyProfileId
    && set.safetyProfileRevision === delegation.safetyProfileRevision
    && set.workerProfileId === delegation.workerProfileId;
}

export function materializeMultiAgentChildTask(
  set: MultiAgentDelegationSetV1,
  delegation: MultiAgentDelegationEnvelopeV1,
  options: MaterializeMultiAgentChildTaskOptions = {},
): MultiAgentChildTaskDescriptorV1 {
  assertSet(set);
  assertDelegation(delegation);

  if (!sameParent(set, delegation)) {
    throw new MultiAgentChildTaskError(
      "delegation no longer matches the exact delegation-set parent/Safety binding",
      "binding_mismatch",
    );
  }
  if (!set.delegationIds.includes(delegation.delegationId)) {
    throw new MultiAgentChildTaskError(
      "delegation is not a member of the validated delegation set",
      "delegation_not_in_set",
    );
  }

  const childTaskId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!UUID.test(childTaskId)) {
    throw new MultiAgentChildTaskError(
      "childTaskId must be an opaque UUID",
      "materialization_invalid",
    );
  }
  const materializedAt = (options.now ?? (() => new Date()))();
  if (!(materializedAt instanceof Date) || !Number.isFinite(materializedAt.getTime())) {
    throw new MultiAgentChildTaskError(
      "child task materialization clock is invalid",
      "materialization_invalid",
    );
  }

  const descriptor: MultiAgentChildTaskDescriptorV1 = {
    schemaVersion: 1,
    childTaskId,
    materializedAt: materializedAt.toISOString(),
    delegationSetId: set.delegationSetId,
    delegationId: delegation.delegationId,
    coordinationMode: set.coordinationMode,
    parentSupervisorTaskId: delegation.parentSupervisorTaskId,
    parentTaskId: delegation.taskId,
    projectId: delegation.projectId,
    workspaceId: delegation.workspaceId,
    workspaceRegistryRevision: delegation.workspaceRegistryRevision,
    safetyPlanId: delegation.safetyPlanId,
    safetyProfileId: delegation.safetyProfileId,
    safetyProfileRevision: delegation.safetyProfileRevision,
    workerProfileId: delegation.workerProfileId,
    objective: delegation.objective,
    acceptanceCriteria: [...delegation.acceptanceCriteria],
    allowedPathPatterns: [...delegation.allowedPathPatterns],
    protectedPathPatterns: [...delegation.protectedPathPatterns],
    authority: "child_task_materialization_only",
    executable: false,
    requiresIndependentExecutionAdmission: true,
    requiresFreshWriterLease: true,
    requiresFreshDistributedFenceWhenDistributed: true,
    requiresParentBindingRevalidation: true,
    allowsSubdelegation: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  return Object.freeze(descriptor);
}
