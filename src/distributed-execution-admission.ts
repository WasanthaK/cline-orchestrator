import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  assertDistributedMachineRegistration,
  assertDistributedWorkspacePlacement,
  assertDistributedWriterCandidateAssignment,
  type DistributedMachineRegistrationV1,
  type DistributedWorkspacePlacementV1,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_DISPATCH_TTL_MS = 1_000;
const MAX_DISPATCH_TTL_MS = 30_000;

export const DISTRIBUTED_EXECUTION_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  minDispatchTtlMs: MIN_DISPATCH_TTL_MS,
  maxDispatchTtlMs: MAX_DISPATCH_TTL_MS,
  dispatchContainsPromptOrCommand: false as const,
  requiresExactTargetIdentity: true as const,
  requiresCurrentRegistration: true as const,
  requiresCurrentPlacement: true as const,
  requiresCurrentCandidateAssignment: true as const,
  requiresCurrentDistributedFence: true as const,
  requiresDurableReplayConsumption: true as const,
  replayMarkerCredentialsIncluded: false as const,
  networkListenerIncluded: false as const,
  commandDeliveryEnabled: false as const,
  clineExecutionEnabled: false as const,
  distributedWriteExecutionEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedExecutionDispatchV1 {
  schemaVersion: 1;
  dispatchId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
  placementId: string;
  placementRevision: number;
  candidateAssignmentId: string;
  fenceId: string;
  fenceGeneration: number;
  issuedAt: string;
  expiresAt: string;
  authority: "execution_request_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedExecutionAdmissionReceiptV1 {
  schemaVersion: 1;
  dispatchId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  fenceGeneration: number;
  admittedAt: string;
  authority: "admission_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedTargetIdentityV1 {
  machineId: string;
  machineRegistrationId: string;
  machineRegistrationRevision: number;
}

export interface DistributedExecutionRegistrationLookup {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedExecutionPlacementLookup {
  get(placementId: string): Promise<DistributedWorkspacePlacementV1>;
}

export interface DistributedExecutionCandidateValidator {
  assertCandidateCurrent(
    assignment: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void>;
}

export interface DistributedExecutionFenceValidator {
  validateCurrent(
    claim: DistributedFenceClaimV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void>;
}

export interface DistributedDispatchReplayStore {
  consume(dispatchId: string, expiresAt: string): Promise<boolean>;
}

export interface CreateDistributedExecutionDispatchOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export interface CreateDistributedExecutionDispatchRequest {
  assignment: DistributedWriterCandidateAssignmentV1;
  fence: DistributedFenceClaimV1;
  ttlMs: number;
}

export interface DistributedExecutionAdmissionOptions {
  targetIdentity: DistributedTargetIdentityV1;
  registrations: DistributedExecutionRegistrationLookup;
  placements: DistributedExecutionPlacementLookup;
  candidates: DistributedExecutionCandidateValidator;
  fences: DistributedExecutionFenceValidator;
  replayStore: DistributedDispatchReplayStore;
  now?: () => Date;
}

export class DistributedExecutionAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "dispatch_invalid"
      | "dispatch_expired"
      | "binding_mismatch"
      | "target_mismatch"
      | "registration_not_current"
      | "placement_not_current"
      | "candidate_not_current"
      | "fence_not_current"
      | "dispatch_replayed"
      | "replay_store_unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedExecutionAdmissionError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedExecutionAdmissionError(`${label} must be an object`, "dispatch_invalid");
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedExecutionAdmissionError(
      `${label} contains unsupported or missing fields`,
      "dispatch_invalid",
    );
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedExecutionAdmissionError(`${field} must be an opaque UUID`, "dispatch_invalid");
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedExecutionAdmissionError(`${field} must be a positive integer`, "dispatch_invalid");
  }
  return value;
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedExecutionAdmissionError(`${field} must be an ISO timestamp`, "dispatch_invalid");
  }
  return new Date(Date.parse(value)).toISOString();
}

function boundedTtl(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < MIN_DISPATCH_TTL_MS
    || value > MAX_DISPATCH_TTL_MS
  ) {
    throw new DistributedExecutionAdmissionError(
      `ttlMs must be an integer between ${MIN_DISPATCH_TTL_MS} and ${MAX_DISPATCH_TTL_MS}`,
      "dispatch_invalid",
    );
  }
  return value;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) {
    throw new DistributedExecutionAdmissionError("distributed execution clock is invalid", "dispatch_invalid");
  }
  return value;
}

function sameAssignmentAndFence(
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
): boolean {
  return fence.taskId === assignment.taskId
    && fence.workspaceId === assignment.workspaceId
    && fence.machineId === assignment.machineId
    && fence.machineRegistrationId === assignment.machineRegistrationId
    && fence.machineRegistrationRevision === assignment.machineRegistrationRevision
    && fence.placementId === assignment.placementId
    && fence.placementRevision === assignment.placementRevision
    && fence.candidateAssignmentId === assignment.assignmentId;
}

function dispatchMatchesEvidence(
  dispatch: DistributedExecutionDispatchV1,
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
): boolean {
  return dispatch.taskId === assignment.taskId
    && dispatch.workspaceId === assignment.workspaceId
    && dispatch.machineId === assignment.machineId
    && dispatch.machineRegistrationId === assignment.machineRegistrationId
    && dispatch.machineRegistrationRevision === assignment.machineRegistrationRevision
    && dispatch.placementId === assignment.placementId
    && dispatch.placementRevision === assignment.placementRevision
    && dispatch.candidateAssignmentId === assignment.assignmentId
    && dispatch.fenceId === fence.fenceId
    && dispatch.fenceGeneration === fence.generation;
}

export function assertDistributedExecutionDispatch(
  value: unknown,
): asserts value is DistributedExecutionDispatchV1 {
  exactKeys(
    value,
    [
      "schemaVersion",
      "dispatchId",
      "taskId",
      "workspaceId",
      "machineId",
      "machineRegistrationId",
      "machineRegistrationRevision",
      "placementId",
      "placementRevision",
      "candidateAssignmentId",
      "fenceId",
      "fenceGeneration",
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
    "distributed execution dispatch",
  );
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.authority !== "execution_request_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedExecutionAdmissionError(
      "distributed execution dispatch cannot grant execution authority",
      "dispatch_invalid",
    );
  }
  uuid(record.dispatchId, "dispatchId");
  uuid(record.taskId, "taskId");
  uuid(record.workspaceId, "workspaceId");
  uuid(record.machineId, "machineId");
  uuid(record.machineRegistrationId, "machineRegistrationId");
  positiveInteger(record.machineRegistrationRevision, "machineRegistrationRevision");
  uuid(record.placementId, "placementId");
  positiveInteger(record.placementRevision, "placementRevision");
  uuid(record.candidateAssignmentId, "candidateAssignmentId");
  uuid(record.fenceId, "fenceId");
  positiveInteger(record.fenceGeneration, "fenceGeneration");
  const issuedAt = iso(record.issuedAt, "issuedAt");
  const expiresAt = iso(record.expiresAt, "expiresAt");
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttl < MIN_DISPATCH_TTL_MS || ttl > MAX_DISPATCH_TTL_MS) {
    throw new DistributedExecutionAdmissionError(
      "distributed execution dispatch TTL is outside the allowed bound",
      "dispatch_invalid",
    );
  }
}

export function createDistributedExecutionDispatch(
  request: CreateDistributedExecutionDispatchRequest,
  options: CreateDistributedExecutionDispatchOptions = {},
): DistributedExecutionDispatchV1 {
  try {
    assertDistributedWriterCandidateAssignment(request.assignment);
    assertDistributedFenceClaim(request.fence);
  } catch (error) {
    throw new DistributedExecutionAdmissionError(
      "distributed execution evidence is invalid",
      "dispatch_invalid",
      { cause: error },
    );
  }
  if (!sameAssignmentAndFence(request.assignment, request.fence)) {
    throw new DistributedExecutionAdmissionError(
      "distributed fence does not match the candidate assignment",
      "binding_mismatch",
    );
  }
  const ttlMs = boundedTtl(request.ttlMs);
  const now = currentTime(options.now);
  const evidenceExpiry = Math.min(
    Date.parse(request.assignment.expiresAt),
    Date.parse(request.fence.expiresAt),
  );
  const expiresAtMs = Math.min(now.getTime() + ttlMs, evidenceExpiry);
  if (expiresAtMs - now.getTime() < MIN_DISPATCH_TTL_MS) {
    throw new DistributedExecutionAdmissionError(
      "candidate/fence evidence expires before a dispatch can be issued",
      "dispatch_expired",
    );
  }
  const dispatch: DistributedExecutionDispatchV1 = {
    schemaVersion: 1,
    dispatchId: uuid((options.idFactory ?? (() => crypto.randomUUID()))(), "dispatchId"),
    taskId: request.assignment.taskId,
    workspaceId: request.assignment.workspaceId,
    machineId: request.assignment.machineId,
    machineRegistrationId: request.assignment.machineRegistrationId,
    machineRegistrationRevision: request.assignment.machineRegistrationRevision,
    placementId: request.assignment.placementId,
    placementRevision: request.assignment.placementRevision,
    candidateAssignmentId: request.assignment.assignmentId,
    fenceId: request.fence.fenceId,
    fenceGeneration: request.fence.generation,
    issuedAt: now.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    authority: "execution_request_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedExecutionDispatch(dispatch);
  return dispatch;
}

/**
 * Durable machine-local replay barrier for future target-machine dispatch delivery.
 * The directory is trusted local configuration, never dispatch input. Each opaque
 * dispatch UUID is consumed by exclusive file creation so process restart cannot
 * make an already admitted dispatch usable again.
 */
export class FileDistributedDispatchReplayStore implements DistributedDispatchReplayStore {
  constructor(private readonly directory: string) {
    if (!directory.trim() || !path.isAbsolute(directory)) {
      throw new DistributedExecutionAdmissionError(
        "dispatch replay directory must be an absolute machine-local path",
        "replay_store_unavailable",
      );
    }
  }

  async consume(dispatchIdInput: string, expiresAtInput: string): Promise<boolean> {
    const dispatchId = uuid(dispatchIdInput, "dispatchId");
    const expiresAt = iso(expiresAtInput, "expiresAt");
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(this.directory, `${dispatchId}.json`),
        `${JSON.stringify({ schemaVersion: 1, dispatchId, expiresAt })}\n`,
        { flag: "wx", mode: 0o600, encoding: "utf8" },
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
      throw new DistributedExecutionAdmissionError(
        "durable dispatch replay store is unavailable",
        "replay_store_unavailable",
        { cause: error },
      );
    }
  }
}

export class DistributedExecutionAdmissionGateway {
  constructor(private readonly options: DistributedExecutionAdmissionOptions) {
    uuid(options.targetIdentity.machineId, "target machineId");
    uuid(options.targetIdentity.machineRegistrationId, "target machineRegistrationId");
    positiveInteger(options.targetIdentity.machineRegistrationRevision, "target machineRegistrationRevision");
  }

  async admit(
    dispatchInput: DistributedExecutionDispatchV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    fenceInput: DistributedFenceClaimV1,
  ): Promise<DistributedExecutionAdmissionReceiptV1> {
    assertDistributedExecutionDispatch(dispatchInput);
    try {
      assertDistributedWriterCandidateAssignment(assignmentInput);
      assertDistributedFenceClaim(fenceInput);
    } catch (error) {
      throw new DistributedExecutionAdmissionError(
        "distributed execution evidence is invalid",
        "dispatch_invalid",
        { cause: error },
      );
    }
    const dispatch = structuredClone(dispatchInput);
    const assignment = structuredClone(assignmentInput);
    const fence = structuredClone(fenceInput);
    if (!sameAssignmentAndFence(assignment, fence) || !dispatchMatchesEvidence(dispatch, assignment, fence)) {
      throw new DistributedExecutionAdmissionError(
        "dispatch, candidate assignment and distributed fence bindings do not match",
        "binding_mismatch",
      );
    }

    const now = currentTime(this.options.now);
    if (Date.parse(dispatch.expiresAt) <= now.getTime()) {
      throw new DistributedExecutionAdmissionError("distributed execution dispatch has expired", "dispatch_expired");
    }

    const target = this.options.targetIdentity;
    if (
      dispatch.machineId !== target.machineId
      || dispatch.machineRegistrationId !== target.machineRegistrationId
      || dispatch.machineRegistrationRevision !== target.machineRegistrationRevision
    ) {
      throw new DistributedExecutionAdmissionError(
        "distributed execution dispatch targets a different machine identity",
        "target_mismatch",
      );
    }

    let registration: DistributedMachineRegistrationV1;
    try {
      registration = await this.options.registrations.get(dispatch.machineRegistrationId);
      assertDistributedMachineRegistration(registration);
    } catch (error) {
      throw new DistributedExecutionAdmissionError(
        "target machine registration is not current",
        "registration_not_current",
        { cause: error },
      );
    }
    if (
      registration.revokedAt
      || registration.registrationId !== dispatch.machineRegistrationId
      || registration.machineId !== dispatch.machineId
      || registration.revision !== dispatch.machineRegistrationRevision
      || !registration.allowedCapabilities.includes("accept_writer_candidates")
    ) {
      throw new DistributedExecutionAdmissionError(
        "target machine registration is no longer current for this dispatch",
        "registration_not_current",
      );
    }

    let placement: DistributedWorkspacePlacementV1;
    try {
      placement = await this.options.placements.get(dispatch.placementId);
      assertDistributedWorkspacePlacement(placement);
    } catch (error) {
      throw new DistributedExecutionAdmissionError(
        "target workspace placement is not current",
        "placement_not_current",
        { cause: error },
      );
    }
    if (
      placement.disabledAt
      || placement.placementId !== dispatch.placementId
      || placement.workspaceId !== dispatch.workspaceId
      || placement.machineId !== dispatch.machineId
      || placement.machineRegistrationId !== dispatch.machineRegistrationId
      || placement.machineRegistrationRevision !== dispatch.machineRegistrationRevision
      || placement.revision !== dispatch.placementRevision
    ) {
      throw new DistributedExecutionAdmissionError(
        "target workspace placement is no longer current for this dispatch",
        "placement_not_current",
      );
    }

    try {
      await this.options.candidates.assertCandidateCurrent(assignment, now);
    } catch (error) {
      throw new DistributedExecutionAdmissionError(
        "writer candidate assignment is no longer current",
        "candidate_not_current",
        { cause: error },
      );
    }
    try {
      await this.options.fences.validateCurrent(fence, assignment, now);
    } catch (error) {
      throw new DistributedExecutionAdmissionError(
        "distributed fence is no longer current",
        "fence_not_current",
        { cause: error },
      );
    }

    let consumed: boolean;
    try {
      consumed = await this.options.replayStore.consume(dispatch.dispatchId, dispatch.expiresAt);
    } catch (error) {
      if (error instanceof DistributedExecutionAdmissionError) throw error;
      throw new DistributedExecutionAdmissionError(
        "durable dispatch replay store is unavailable",
        "replay_store_unavailable",
        { cause: error },
      );
    }
    if (!consumed) {
      throw new DistributedExecutionAdmissionError(
        "distributed execution dispatch has already been admitted",
        "dispatch_replayed",
      );
    }

    return {
      schemaVersion: 1,
      dispatchId: dispatch.dispatchId,
      taskId: dispatch.taskId,
      workspaceId: dispatch.workspaceId,
      machineId: dispatch.machineId,
      fenceGeneration: dispatch.fenceGeneration,
      admittedAt: now.toISOString(),
      authority: "admission_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
  }
}
