import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_ASSIGNMENT_TTL_MS = 1_000;
const MAX_ASSIGNMENT_TTL_MS = 2 * 60_000;

export const DISTRIBUTED_CONTROL_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  minAssignmentTtlMs: MIN_ASSIGNMENT_TTL_MS,
  maxAssignmentTtlMs: MAX_ASSIGNMENT_TTL_MS,
  globalWriteExecutionEnabled: false,
  machineRegistrationGrantsTaskAuthority: false,
  workspacePlacementGrantsFilesystemAuthority: false,
  dispatchGrantsTaskAuthority: false,
  dispatchGrantsSafetyPlanAuthority: false,
  dispatchGrantsWriterLeaseAuthority: false,
  dispatchGrantsCredentialAuthority: false,
  dispatchGrantsReleaseAuthority: false,
  requiresTargetMachineRegistrationRevalidation: true,
  requiresTargetWorkspaceRegistryRevalidation: true,
  requiresTaskSafetyBindingRevalidation: true,
  requiresDistributedFencingBeforeWrites: true,
  requiresLocalWriterLeaseBeforeWrites: true,
});

export type DistributedMachineCapabilityV1 =
  | "report_status"
  | "accept_writer_candidates";

const MACHINE_CAPABILITIES = new Set<DistributedMachineCapabilityV1>([
  "report_status",
  "accept_writer_candidates",
]);

export interface DistributedMachineRegistrationV1 {
  schemaVersion: 1;
  registrationId: string;
  machineId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  allowedCapabilities: DistributedMachineCapabilityV1[];
  revokedAt?: string;
  authority: "identity_only";
}

export interface DistributedWorkspacePlacementV1 {
  schemaVersion: 1;
  placementId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  authority: "routing_only";
}

export interface DistributedWriterCandidateRequestV1 {
  taskId: string;
  workspaceId: string;
  ttlMs: number;
}

export interface DistributedWriterCandidateAssignmentV1 {
  schemaVersion: 1;
  assignmentId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  placementId: string;
  placementRevision: number;
  issuedAt: string;
  expiresAt: string;
  authority: "coordination_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedContractOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedControlContractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "registration_invalid"
      | "registration_revoked"
      | "placement_invalid"
      | "placement_stale"
      | "capability_not_allowed"
      | "assignment_invalid"
      | "assignment_expired"
      | "assignment_stale",
  ) {
    super(message);
    this.name = "DistributedControlContractError";
  }
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
  code: DistributedControlContractError["code"],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new DistributedControlContractError(`${label} contains unsupported fields`, code);
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new DistributedControlContractError(`${label} is missing ${key}`, code);
    }
  }
}

function uuid(
  value: unknown,
  field: string,
  code: DistributedControlContractError["code"],
): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedControlContractError(`${field} must be an opaque UUID`, code);
  }
  return value.trim();
}

function positiveRevision(
  value: unknown,
  field: string,
  code: DistributedControlContractError["code"],
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DistributedControlContractError(`${field} must be a positive integer`, code);
  }
  return value as number;
}

function iso(
  value: unknown,
  field: string,
  code: DistributedControlContractError["code"],
): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedControlContractError(`${field} must be an ISO timestamp`, code);
  }
  return new Date(Date.parse(value)).toISOString();
}

function nowFrom(options: DistributedContractOptions): Date {
  const now = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) {
    throw new DistributedControlContractError("distributed control clock is invalid", "assignment_invalid");
  }
  return now;
}

function opaqueId(options: DistributedContractOptions, field: string): string {
  return uuid(
    (options.idFactory ?? (() => crypto.randomUUID()))(),
    field,
    "assignment_invalid",
  );
}

function uniqueCapabilities(value: unknown): DistributedMachineCapabilityV1[] {
  if (!Array.isArray(value)) {
    throw new DistributedControlContractError(
      "allowedCapabilities must be an array",
      "registration_invalid",
    );
  }
  const result: DistributedMachineCapabilityV1[] = [];
  const seen = new Set<string>();
  for (const capability of value) {
    if (typeof capability !== "string" || !MACHINE_CAPABILITIES.has(capability as DistributedMachineCapabilityV1)) {
      throw new DistributedControlContractError(
        "machine registration contains an unsupported capability",
        "registration_invalid",
      );
    }
    if (seen.has(capability)) {
      throw new DistributedControlContractError(
        "machine registration contains duplicate capabilities",
        "registration_invalid",
      );
    }
    seen.add(capability);
    result.push(capability as DistributedMachineCapabilityV1);
  }
  return result;
}

export function assertDistributedMachineRegistration(
  value: unknown,
): asserts value is DistributedMachineRegistrationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControlContractError(
      "machine registration must be an object",
      "registration_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  exactKeys(
    record,
    [
      "schemaVersion",
      "registrationId",
      "machineId",
      "revision",
      "createdAt",
      "updatedAt",
      "allowedCapabilities",
      "authority",
    ],
    ["revokedAt"],
    "registration_invalid",
    "machine registration",
  );
  if (record.schemaVersion !== 1 || record.authority !== "identity_only") {
    throw new DistributedControlContractError(
      "machine registration schema/authority is invalid",
      "registration_invalid",
    );
  }
  uuid(record.registrationId, "registrationId", "registration_invalid");
  uuid(record.machineId, "machineId", "registration_invalid");
  positiveRevision(record.revision, "revision", "registration_invalid");
  const createdAt = iso(record.createdAt, "createdAt", "registration_invalid");
  const updatedAt = iso(record.updatedAt, "updatedAt", "registration_invalid");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DistributedControlContractError(
      "machine registration updatedAt cannot precede createdAt",
      "registration_invalid",
    );
  }
  uniqueCapabilities(record.allowedCapabilities);
  if (record.revokedAt !== undefined) {
    const revokedAt = iso(record.revokedAt, "revokedAt", "registration_invalid");
    if (Date.parse(revokedAt) < Date.parse(createdAt)) {
      throw new DistributedControlContractError(
        "machine registration revokedAt cannot precede createdAt",
        "registration_invalid",
      );
    }
  }
}

export function assertDistributedWorkspacePlacement(
  value: unknown,
): asserts value is DistributedWorkspacePlacementV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControlContractError(
      "workspace placement must be an object",
      "placement_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  exactKeys(
    record,
    [
      "schemaVersion",
      "placementId",
      "workspaceId",
      "machineId",
      "machineRegistrationId",
      "machineRegistrationRevision",
      "revision",
      "createdAt",
      "updatedAt",
      "authority",
    ],
    ["disabledAt"],
    "placement_invalid",
    "workspace placement",
  );
  if (record.schemaVersion !== 1 || record.authority !== "routing_only") {
    throw new DistributedControlContractError(
      "workspace placement schema/authority is invalid",
      "placement_invalid",
    );
  }
  uuid(record.placementId, "placementId", "placement_invalid");
  uuid(record.workspaceId, "workspaceId", "placement_invalid");
  uuid(record.machineId, "machineId", "placement_invalid");
  uuid(record.machineRegistrationId, "machineRegistrationId", "placement_invalid");
  positiveRevision(record.machineRegistrationRevision, "machineRegistrationRevision", "placement_invalid");
  positiveRevision(record.revision, "revision", "placement_invalid");
  const createdAt = iso(record.createdAt, "createdAt", "placement_invalid");
  const updatedAt = iso(record.updatedAt, "updatedAt", "placement_invalid");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DistributedControlContractError(
      "workspace placement updatedAt cannot precede createdAt",
      "placement_invalid",
    );
  }
  if (record.disabledAt !== undefined) {
    const disabledAt = iso(record.disabledAt, "disabledAt", "placement_invalid");
    if (Date.parse(disabledAt) < Date.parse(createdAt)) {
      throw new DistributedControlContractError(
        "workspace placement disabledAt cannot precede createdAt",
        "placement_invalid",
      );
    }
  }
}

export function assertDistributedPlacementCurrent(
  placement: DistributedWorkspacePlacementV1,
  registration: DistributedMachineRegistrationV1,
): void {
  assertDistributedWorkspacePlacement(placement);
  assertDistributedMachineRegistration(registration);
  if (registration.revokedAt) {
    throw new DistributedControlContractError(
      "machine registration is revoked",
      "registration_revoked",
    );
  }
  if (placement.disabledAt) {
    throw new DistributedControlContractError(
      "workspace placement is disabled",
      "placement_stale",
    );
  }
  if (
    placement.machineId !== registration.machineId
    || placement.machineRegistrationId !== registration.registrationId
    || placement.machineRegistrationRevision !== registration.revision
  ) {
    throw new DistributedControlContractError(
      "workspace placement no longer matches the current machine registration",
      "placement_stale",
    );
  }
}

function assignmentTtl(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < MIN_ASSIGNMENT_TTL_MS
    || (value as number) > MAX_ASSIGNMENT_TTL_MS
  ) {
    throw new DistributedControlContractError(
      `ttlMs must be an integer between ${MIN_ASSIGNMENT_TTL_MS} and ${MAX_ASSIGNMENT_TTL_MS}`,
      "assignment_invalid",
    );
  }
  return value as number;
}

export function createDistributedWriterCandidateAssignment(
  registration: DistributedMachineRegistrationV1,
  placement: DistributedWorkspacePlacementV1,
  request: DistributedWriterCandidateRequestV1,
  options: DistributedContractOptions = {},
): DistributedWriterCandidateAssignmentV1 {
  assertDistributedPlacementCurrent(placement, registration);
  if (!registration.allowedCapabilities.includes("accept_writer_candidates")) {
    throw new DistributedControlContractError(
      "machine registration does not allow writer candidates",
      "capability_not_allowed",
    );
  }
  const taskId = uuid(request.taskId, "taskId", "assignment_invalid");
  const workspaceId = uuid(request.workspaceId, "workspaceId", "assignment_invalid");
  if (workspaceId !== placement.workspaceId) {
    throw new DistributedControlContractError(
      "assignment workspace does not match the current placement",
      "assignment_invalid",
    );
  }
  const ttlMs = assignmentTtl(request.ttlMs);
  const now = nowFrom(options);
  return {
    schemaVersion: 1,
    assignmentId: opaqueId(options, "assignmentId"),
    taskId,
    workspaceId,
    machineId: registration.machineId,
    machineRegistrationId: registration.registrationId,
    machineRegistrationRevision: registration.revision,
    placementId: placement.placementId,
    placementRevision: placement.revision,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

export function assertDistributedWriterCandidateAssignment(
  value: unknown,
): asserts value is DistributedWriterCandidateAssignmentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControlContractError(
      "writer candidate assignment must be an object",
      "assignment_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  exactKeys(
    record,
    [
      "schemaVersion",
      "assignmentId",
      "taskId",
      "workspaceId",
      "machineId",
      "machineRegistrationId",
      "machineRegistrationRevision",
      "placementId",
      "placementRevision",
      "issuedAt",
      "expiresAt",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    [],
    "assignment_invalid",
    "writer candidate assignment",
  );
  if (
    record.schemaVersion !== 1
    || record.authority !== "coordination_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedControlContractError(
      "writer candidate assignment cannot grant authority",
      "assignment_invalid",
    );
  }
  uuid(record.assignmentId, "assignmentId", "assignment_invalid");
  uuid(record.taskId, "taskId", "assignment_invalid");
  uuid(record.workspaceId, "workspaceId", "assignment_invalid");
  uuid(record.machineId, "machineId", "assignment_invalid");
  uuid(record.machineRegistrationId, "machineRegistrationId", "assignment_invalid");
  positiveRevision(record.machineRegistrationRevision, "machineRegistrationRevision", "assignment_invalid");
  uuid(record.placementId, "placementId", "assignment_invalid");
  positiveRevision(record.placementRevision, "placementRevision", "assignment_invalid");
  const issuedAt = iso(record.issuedAt, "issuedAt", "assignment_invalid");
  const expiresAt = iso(record.expiresAt, "expiresAt", "assignment_invalid");
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttl < MIN_ASSIGNMENT_TTL_MS || ttl > MAX_ASSIGNMENT_TTL_MS) {
    throw new DistributedControlContractError(
      "writer candidate assignment TTL is outside the allowed bound",
      "assignment_invalid",
    );
  }
}

export function assertDistributedWriterCandidateCurrent(
  assignment: DistributedWriterCandidateAssignmentV1,
  registration: DistributedMachineRegistrationV1,
  placement: DistributedWorkspacePlacementV1,
  now: Date = new Date(),
): void {
  assertDistributedWriterCandidateAssignment(assignment);
  assertDistributedPlacementCurrent(placement, registration);
  if (!Number.isFinite(now.getTime())) {
    throw new DistributedControlContractError("assignment clock is invalid", "assignment_invalid");
  }
  if (Date.parse(assignment.expiresAt) <= now.getTime()) {
    throw new DistributedControlContractError(
      "writer candidate assignment has expired",
      "assignment_expired",
    );
  }
  if (!registration.allowedCapabilities.includes("accept_writer_candidates")) {
    throw new DistributedControlContractError(
      "machine registration no longer allows writer candidates",
      "assignment_stale",
    );
  }
  if (
    assignment.machineId !== registration.machineId
    || assignment.machineRegistrationId !== registration.registrationId
    || assignment.machineRegistrationRevision !== registration.revision
    || assignment.workspaceId !== placement.workspaceId
    || assignment.placementId !== placement.placementId
    || assignment.placementRevision !== placement.revision
  ) {
    throw new DistributedControlContractError(
      "writer candidate assignment is stale relative to current routing state",
      "assignment_stale",
    );
  }
}
