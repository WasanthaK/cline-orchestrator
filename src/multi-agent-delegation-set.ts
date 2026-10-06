import crypto from "node:crypto";
import type { MultiAgentDelegationEnvelopeV1 } from "./multi-agent-delegation-contract.js";

const MAX_DELEGATIONS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MULTI_AGENT_DELEGATION_SET_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  maxDelegations: MAX_DELEGATIONS,
  authority: "delegation_set_evidence_only" as const,
  allowsParallelOnlyForDisjointScopes: true as const,
  overlapRequiresSerializedCoordination: true as const,
  createsWorkers: false as const,
  schedulesWorkers: false as const,
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

export type MultiAgentDelegationCoordinationModeV1 =
  | "parallel_disjoint"
  | "serialized";

export interface MultiAgentDelegationSetV1 {
  schemaVersion: 1;
  delegationSetId: string;
  createdAt: string;
  coordinationMode: MultiAgentDelegationCoordinationModeV1;
  parentSupervisorTaskId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  delegationIds: string[];
  overlappingDelegationPairs: Array<{
    leftDelegationId: string;
    rightDelegationId: string;
  }>;
  authority: "delegation_set_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface CreateMultiAgentDelegationSetOptions {
  coordinationMode: MultiAgentDelegationCoordinationModeV1;
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentDelegationSetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "parent_binding_mismatch"
      | "duplicate_delegation"
      | "duplicate_objective"
      | "scope_overlap",
  ) {
    super(message);
    this.name = "MultiAgentDelegationSetError";
  }
}

function assertEnvelope(value: MultiAgentDelegationEnvelopeV1): void {
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
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
    || value.constraints.scopeExpansion !== "stop_and_escalate"
    || value.constraints.subdelegationAllowed !== false
    || value.constraints.agentTeamsAllowed !== false
    || value.constraints.shellAllowed !== false
    || value.constraints.networkAllowed !== false
    || value.constraints.mcpAllowed !== false
    || value.constraints.pluginsAllowed !== false
    || !Array.isArray(value.allowedPathPatterns)
    || value.allowedPathPatterns.length === 0
  ) {
    throw new MultiAgentDelegationSetError(
      "delegation envelope is invalid or has widened authority",
      "set_invalid",
    );
  }
}

function sameParent(
  left: MultiAgentDelegationEnvelopeV1,
  right: MultiAgentDelegationEnvelopeV1,
): boolean {
  return left.parentSupervisorTaskId === right.parentSupervisorTaskId
    && left.taskId === right.taskId
    && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId
    && left.workspaceRegistryRevision === right.workspaceRegistryRevision
    && left.safetyPlanId === right.safetyPlanId
    && left.safetyProfileId === right.safetyProfileId
    && left.safetyProfileRevision === right.safetyProfileRevision
    && left.workerProfileId === right.workerProfileId;
}

function objectiveIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function staticPrefix(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/");
  const wildcard = normalized.search(/[?*[]/);
  const prefix = wildcard >= 0 ? normalized.slice(0, wildcard) : normalized;
  return prefix.replace(/\/+$/, "");
}

function scopesMayOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const a = staticPrefix(left);
  const b = staticPrefix(right);
  if (!a || !b) return true;
  return a === b
    || a.startsWith(`${b}/`)
    || b.startsWith(`${a}/`);
}

function findOverlaps(
  envelopes: MultiAgentDelegationEnvelopeV1[],
): MultiAgentDelegationSetV1["overlappingDelegationPairs"] {
  const pairs: MultiAgentDelegationSetV1["overlappingDelegationPairs"] = [];
  for (let i = 0; i < envelopes.length; i += 1) {
    for (let j = i + 1; j < envelopes.length; j += 1) {
      const left = envelopes[i]!;
      const right = envelopes[j]!;
      if (
        left.allowedPathPatterns.some((a) =>
          right.allowedPathPatterns.some((b) => scopesMayOverlap(a, b)))
      ) {
        pairs.push({
          leftDelegationId: left.delegationId,
          rightDelegationId: right.delegationId,
        });
      }
    }
  }
  return pairs;
}

export function createMultiAgentDelegationSet(
  inputs: MultiAgentDelegationEnvelopeV1[],
  options: CreateMultiAgentDelegationSetOptions,
): MultiAgentDelegationSetV1 {
  if (
    !Array.isArray(inputs)
    || inputs.length < 1
    || inputs.length > MAX_DELEGATIONS
    || !options
    || !["parallel_disjoint", "serialized"].includes(options.coordinationMode)
  ) {
    throw new MultiAgentDelegationSetError(
      `delegation set must contain between 1 and ${MAX_DELEGATIONS} children and a valid coordination mode`,
      "set_invalid",
    );
  }

  const envelopes = inputs.map((item) => {
    assertEnvelope(item);
    return structuredClone(item);
  });
  const parent = envelopes[0]!;
  if (envelopes.some((item) => !sameParent(parent, item))) {
    throw new MultiAgentDelegationSetError(
      "all child delegations must share the exact same parent task/Safety binding",
      "parent_binding_mismatch",
    );
  }

  const ids = new Set<string>();
  const objectives = new Set<string>();
  for (const item of envelopes) {
    if (ids.has(item.delegationId)) {
      throw new MultiAgentDelegationSetError(
        "delegation IDs must be unique within a delegation set",
        "duplicate_delegation",
      );
    }
    ids.add(item.delegationId);

    const objective = objectiveIdentity(item.objective);
    if (objectives.has(objective)) {
      throw new MultiAgentDelegationSetError(
        "child delegation objectives must be unique within a delegation set",
        "duplicate_objective",
      );
    }
    objectives.add(objective);
  }

  const overlaps = findOverlaps(envelopes);
  if (options.coordinationMode === "parallel_disjoint" && overlaps.length > 0) {
    throw new MultiAgentDelegationSetError(
      "parallel delegation requires disjoint child write scopes; overlapping scopes require serialized coordination",
      "scope_overlap",
    );
  }

  const delegationSetId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!UUID.test(delegationSetId)) {
    throw new MultiAgentDelegationSetError(
      "delegationSetId must be an opaque UUID",
      "set_invalid",
    );
  }
  const createdAt = (options.now ?? (() => new Date()))();
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new MultiAgentDelegationSetError(
      "delegation set clock is invalid",
      "set_invalid",
    );
  }

  const result: MultiAgentDelegationSetV1 = {
    schemaVersion: 1,
    delegationSetId,
    createdAt: createdAt.toISOString(),
    coordinationMode: options.coordinationMode,
    parentSupervisorTaskId: parent.parentSupervisorTaskId,
    taskId: parent.taskId,
    projectId: parent.projectId,
    workspaceId: parent.workspaceId,
    workspaceRegistryRevision: parent.workspaceRegistryRevision,
    safetyPlanId: parent.safetyPlanId,
    safetyProfileId: parent.safetyProfileId,
    safetyProfileRevision: parent.safetyProfileRevision,
    workerProfileId: parent.workerProfileId,
    delegationIds: envelopes.map((item) => item.delegationId),
    overlappingDelegationPairs: overlaps,
    authority: "delegation_set_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  return Object.freeze(result);
}
