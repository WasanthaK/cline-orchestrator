import crypto from "node:crypto";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const MAX_OBJECTIVE_CHARS = 4_000;
const MAX_ACCEPTANCE_CRITERIA = 20;
const MAX_ACCEPTANCE_CRITERION_CHARS = 600;
const MAX_SCOPE_PATTERNS = 100;
const MAX_SCOPE_PATTERN_CHARS = 512;

export const MULTI_AGENT_DELEGATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "delegation_envelope_only" as const,
  createsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDispatch: false as const,
  invokesAdmission: false as const,
  allowsSubdelegation: false as const,
  allowsAgentTeams: false as const,
  allowsShell: false as const,
  allowsNetwork: false as const,
  allowsMcp: false as const,
  allowsPlugins: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentDelegationEnvelopeV1 {
  schemaVersion: 1;
  delegationId: string;
  createdAt: string;
  parentSupervisorTaskId: string;
  taskId: string;
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
  authority: "delegation_envelope_only";
  constraints: {
    scopeExpansion: "stop_and_escalate";
    exactParentPathSelectionOnly: true;
    validationRunsExternally: true;
    subdelegationAllowed: false;
    agentTeamsAllowed: false;
    shellAllowed: false;
    networkAllowed: false;
    mcpAllowed: false;
    pluginsAllowed: false;
  };
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface CreateMultiAgentDelegationRequest {
  objective: string;
  acceptanceCriteria?: string[];
  allowedPathPatterns: string[];
}

export interface CreateMultiAgentDelegationOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentDelegationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "parent_invalid"
      | "request_invalid"
      | "scope_widening",
  ) {
    super(message);
    this.name = "MultiAgentDelegationError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedString(
  value: unknown,
  field: string,
  maxChars: number,
  code: MultiAgentDelegationError["code"],
): string {
  if (typeof value !== "string") {
    throw new MultiAgentDelegationError(`${field} must be a string`, code);
  }
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0") || normalized.length > maxChars) {
    throw new MultiAgentDelegationError(`${field} is invalid or exceeds ${maxChars} characters`, code);
  }
  return normalized;
}

function boundedList(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new MultiAgentDelegationError(
      `${field} must be an array with at most ${maxItems} items`,
      "request_invalid",
    );
  }
  return value.map((item, index) =>
    boundedString(item, `${field}[${index}]`, maxChars, "request_invalid"));
}

function opaqueUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new MultiAgentDelegationError(`${field} must be an opaque UUID`, "parent_invalid");
  }
  return value;
}

function positiveRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new MultiAgentDelegationError(`${field} must be a positive integer`, "parent_invalid");
  }
  return value;
}

function parentString(value: unknown, field: string): string {
  return boundedString(value, field, 256, "parent_invalid");
}

function normalizePattern(value: unknown, field: string): string {
  const normalized = boundedString(value, field, MAX_SCOPE_PATTERN_CHARS, "request_invalid")
    .replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new MultiAgentDelegationError(
      `${field} must be workspace-relative`,
      "request_invalid",
    );
  }
  return normalized;
}

function assertParent(parent: SupervisorTaskV1): void {
  if (
    parent.schemaVersion !== 1
    || parent.constraints.scopeExpansion !== "stop_and_escalate"
    || parent.constraints.subagentsAllowed !== false
    || parent.constraints.agentTeamsAllowed !== false
    || parent.constraints.modelShellAllowed !== false
    || parent.constraints.modelNetworkAllowed !== false
    || parent.constraints.modelMcpAllowed !== false
    || parent.constraints.modelPluginsAllowed !== false
    || !Array.isArray(parent.authority.allowedPathPatterns)
    || parent.authority.allowedPathPatterns.length === 0
  ) {
    throw new MultiAgentDelegationError(
      "parent supervisor task does not satisfy the bounded delegation prerequisite",
      "parent_invalid",
    );
  }
  opaqueUuid(parent.supervisorTaskId, "parentSupervisorTaskId");
  opaqueUuid(parent.taskId, "taskId");
  opaqueUuid(parent.authority.projectId, "projectId");
  opaqueUuid(parent.authority.workspaceId, "workspaceId");
  opaqueUuid(parent.authority.safetyPlanId, "safetyPlanId");
  opaqueUuid(parent.authority.safetyProfileId, "safetyProfileId");
  positiveRevision(parent.authority.workspaceRegistryRevision, "workspaceRegistryRevision");
  positiveRevision(parent.authority.safetyProfileRevision, "safetyProfileRevision");
  parentString(parent.authority.workerProfileId, "workerProfileId");
}

export function createMultiAgentDelegationEnvelope(
  parent: SupervisorTaskV1,
  request: CreateMultiAgentDelegationRequest,
  options: CreateMultiAgentDelegationOptions = {},
): MultiAgentDelegationEnvelopeV1 {
  assertParent(parent);

  const objective = boundedString(
    request.objective,
    "objective",
    MAX_OBJECTIVE_CHARS,
    "request_invalid",
  );
  const acceptanceCriteria = boundedList(
    request.acceptanceCriteria,
    "acceptanceCriteria",
    MAX_ACCEPTANCE_CRITERIA,
    MAX_ACCEPTANCE_CRITERION_CHARS,
  );
  if (
    !Array.isArray(request.allowedPathPatterns)
    || request.allowedPathPatterns.length === 0
    || request.allowedPathPatterns.length > MAX_SCOPE_PATTERNS
  ) {
    throw new MultiAgentDelegationError(
      `allowedPathPatterns must contain between 1 and ${MAX_SCOPE_PATTERNS} items`,
      "request_invalid",
    );
  }
  const requested = request.allowedPathPatterns.map((item, index) =>
    normalizePattern(item, `allowedPathPatterns[${index}]`));
  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) {
    throw new MultiAgentDelegationError(
      "allowedPathPatterns must not contain duplicates",
      "request_invalid",
    );
  }

  const parentAllowed = new Set(parent.authority.allowedPathPatterns.map((item) =>
    item.replace(/\\/g, "/")));
  if (unique.some((pattern) => !parentAllowed.has(pattern))) {
    throw new MultiAgentDelegationError(
      "delegation may select only exact path patterns already approved by the parent task",
      "scope_widening",
    );
  }

  const delegationId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!UUID.test(delegationId)) {
    throw new MultiAgentDelegationError(
      "delegationId must be an opaque UUID",
      "request_invalid",
    );
  }
  const createdAt = (options.now ?? (() => new Date()))();
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new MultiAgentDelegationError(
      "delegation clock is invalid",
      "request_invalid",
    );
  }

  const envelope: MultiAgentDelegationEnvelopeV1 = {
    schemaVersion: 1,
    delegationId,
    createdAt: createdAt.toISOString(),
    parentSupervisorTaskId: parent.supervisorTaskId,
    taskId: parent.taskId,
    projectId: parent.authority.projectId,
    workspaceId: parent.authority.workspaceId,
    workspaceRegistryRevision: parent.authority.workspaceRegistryRevision,
    safetyPlanId: parent.authority.safetyPlanId,
    safetyProfileId: parent.authority.safetyProfileId,
    safetyProfileRevision: parent.authority.safetyProfileRevision,
    workerProfileId: parent.authority.workerProfileId,
    objective,
    acceptanceCriteria,
    allowedPathPatterns: unique,
    protectedPathPatterns: [...parent.authority.protectedPathPatterns],
    authority: "delegation_envelope_only",
    constraints: {
      scopeExpansion: "stop_and_escalate",
      exactParentPathSelectionOnly: true,
      validationRunsExternally: true,
      subdelegationAllowed: false,
      agentTeamsAllowed: false,
      shellAllowed: false,
      networkAllowed: false,
      mcpAllowed: false,
      pluginsAllowed: false,
    },
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  return Object.freeze(envelope);
}
