import crypto from "node:crypto";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  assertDistributedExecutionDispatch,
  type DistributedExecutionCandidateValidator,
  type DistributedExecutionDispatchV1,
  type DistributedExecutionFenceValidator,
} from "./distributed-execution-admission.js";
import {
  DistributedExecutionPullDeliveryController,
  type DistributedExecutionDeliveryBundleV1,
  type DistributedExecutionDeliveryTransportAuthorizer,
} from "./distributed-execution-delivery.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type { DistributedMachineAuthorizedRequestV1 } from "./distributed-machine-transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REFERENCE_QUEUE_ITEMS = 256;

export const DISTRIBUTED_CONTROLLER_PENDING_WORK_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  selectionOwner: "controller" as const,
  pullInputIncludesTaskId: false as const,
  pullInputIncludesWorkspaceId: false as const,
  pullInputIncludesDispatchId: false as const,
  pullInputIncludesCandidateAssignmentId: false as const,
  pullInputIncludesFenceId: false as const,
  requiresAuthenticatedMachineIdentityBeforeSelection: true as const,
  requiresExactRegistrationRevisionBinding: true as const,
  requiresAtomicControllerClaim: true as const,
  requiresCandidateCurrentness: true as const,
  requiresFenceCurrentness: true as const,
  reusesM12JAuthorizedDeliveryBuilder: true as const,
  noWorkIsNonAuthorizing: true as const,
  networkIoIncluded: false as const,
  listenerIncluded: false as const,
  controllerPushEnabled: false as const,
  credentialProvisioningIncluded: false as const,
  distributedTakeoverEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedControllerPendingWorkTargetV1 {
  machineId: string;
  registrationId: string;
  registrationRevision: number;
}

export interface DistributedControllerPendingWorkItemV1 {
  schemaVersion: 1;
  pendingWorkId: string;
  enqueuedAt: string;
  dispatch: DistributedExecutionDispatchV1;
  assignment: DistributedWriterCandidateAssignmentV1;
  fence: DistributedFenceClaimV1;
  authority: "controller_selection_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedControllerPendingWorkSource {
  claimNext(target: DistributedControllerPendingWorkTargetV1): Promise<DistributedControllerPendingWorkItemV1 | null>;
}

export interface DistributedControllerPendingWorkSelectorOptions {
  transport: DistributedExecutionDeliveryTransportAuthorizer;
  pendingWork: DistributedControllerPendingWorkSource;
  candidates: DistributedExecutionCandidateValidator;
  fences: DistributedExecutionFenceValidator;
  delivery: DistributedExecutionPullDeliveryController;
  now?: () => Date;
}

export interface CreateDistributedControllerPendingWorkOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedControllerPendingWorkError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "pending_work_invalid"
      | "transport_identity_invalid"
      | "pending_work_target_mismatch"
      | "candidate_not_current"
      | "fence_not_current"
      | "delivery_failed"
      | "capacity_exceeded",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedControllerPendingWorkError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedControllerPendingWorkError(`${label} must be an object`, "pending_work_invalid");
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedControllerPendingWorkError(
      `${label} contains unsupported or missing fields`,
      "pending_work_invalid",
    );
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || value !== value.trim() || !UUID.test(value)) {
    throw new DistributedControllerPendingWorkError(`${field} must be an opaque UUID`, "pending_work_invalid");
  }
  return value;
}

function revision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedControllerPendingWorkError(`${field} must be a positive integer`, "pending_work_invalid");
  }
  return value;
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DistributedControllerPendingWorkError(`${field} must be an ISO timestamp`, "pending_work_invalid");
  }
  const canonical = new Date(Date.parse(value)).toISOString();
  if (canonical !== value) {
    throw new DistributedControllerPendingWorkError(`${field} must be canonical ISO`, "pending_work_invalid");
  }
  return value;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) {
    throw new DistributedControllerPendingWorkError("pending-work clock is invalid", "pending_work_invalid");
  }
  return value;
}

function sameEvidence(
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
    && fence.taskId === assignment.taskId
    && fence.workspaceId === assignment.workspaceId
    && fence.machineId === assignment.machineId
    && fence.machineRegistrationId === assignment.machineRegistrationId
    && fence.machineRegistrationRevision === assignment.machineRegistrationRevision
    && fence.placementId === assignment.placementId
    && fence.placementRevision === assignment.placementRevision
    && fence.candidateAssignmentId === assignment.assignmentId
    && dispatch.fenceId === fence.fenceId
    && dispatch.fenceGeneration === fence.generation;
}

export function assertDistributedControllerPendingWorkItem(
  value: unknown,
): asserts value is DistributedControllerPendingWorkItemV1 {
  exactKeys(value, [
    "schemaVersion",
    "pendingWorkId",
    "enqueuedAt",
    "dispatch",
    "assignment",
    "fence",
    "authority",
    "grantsTaskAuthority",
    "grantsFilesystemAuthority",
    "grantsSafetyPlanAuthority",
    "grantsWriterLeaseAuthority",
    "grantsCredentialAuthority",
    "grantsReleaseAuthority",
  ], "controller pending work item");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.authority !== "controller_selection_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedControllerPendingWorkError(
      "controller pending work cannot grant execution authority",
      "pending_work_invalid",
    );
  }
  uuid(record.pendingWorkId, "pendingWorkId");
  iso(record.enqueuedAt, "enqueuedAt");
  try {
    assertDistributedExecutionDispatch(record.dispatch);
    assertDistributedWriterCandidateAssignment(record.assignment);
    assertDistributedFenceClaim(record.fence);
  } catch (error) {
    throw new DistributedControllerPendingWorkError(
      "controller pending work contains invalid distributed evidence",
      "pending_work_invalid",
      { cause: error },
    );
  }
  if (!sameEvidence(record.dispatch, record.assignment, record.fence)) {
    throw new DistributedControllerPendingWorkError(
      "controller pending work evidence is cross-bound",
      "pending_work_invalid",
    );
  }
}

export function createDistributedControllerPendingWorkItem(
  input: {
    dispatch: DistributedExecutionDispatchV1;
    assignment: DistributedWriterCandidateAssignmentV1;
    fence: DistributedFenceClaimV1;
  },
  options: CreateDistributedControllerPendingWorkOptions = {},
): DistributedControllerPendingWorkItemV1 {
  const now = currentTime(options.now);
  const item: DistributedControllerPendingWorkItemV1 = {
    schemaVersion: 1,
    pendingWorkId: uuid(
      (options.idFactory ?? (() => crypto.randomUUID()))(),
      "pendingWorkId",
    ),
    enqueuedAt: now.toISOString(),
    dispatch: structuredClone(input.dispatch),
    assignment: structuredClone(input.assignment),
    fence: structuredClone(input.fence),
    authority: "controller_selection_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertDistributedControllerPendingWorkItem(item);
  return item;
}

function targetFromAuthorized(
  authorized: DistributedMachineAuthorizedRequestV1,
): DistributedControllerPendingWorkTargetV1 {
  return {
    machineId: uuid(authorized.machineId, "machineId"),
    registrationId: uuid(authorized.registrationId, "registrationId"),
    registrationRevision: revision(authorized.registrationRevision, "registrationRevision"),
  };
}

function itemMatchesTarget(
  item: DistributedControllerPendingWorkItemV1,
  target: DistributedControllerPendingWorkTargetV1,
): boolean {
  return item.dispatch.machineId === target.machineId
    && item.dispatch.machineRegistrationId === target.registrationId
    && item.dispatch.machineRegistrationRevision === target.registrationRevision;
}

/**
 * Deterministic single-process queue used as the M12R reference selector proof.
 * Selection is FIFO among work already prepared by trusted controller code, and
 * claimNext accepts only an authenticated machine identity — never task/workspace/
 * dispatch/candidate/fence selectors from the target.
 */
export class ReferenceControllerPendingWorkQueue implements DistributedControllerPendingWorkSource {
  private readonly items: DistributedControllerPendingWorkItemV1[] = [];

  enqueue(itemInput: DistributedControllerPendingWorkItemV1): void {
    const item = structuredClone(itemInput);
    assertDistributedControllerPendingWorkItem(item);
    if (this.items.length >= MAX_REFERENCE_QUEUE_ITEMS) {
      throw new DistributedControllerPendingWorkError(
        "controller pending work queue capacity exceeded",
        "capacity_exceeded",
      );
    }
    if (this.items.some((candidate) => candidate.pendingWorkId === item.pendingWorkId)) {
      throw new DistributedControllerPendingWorkError(
        "controller pending work id is already queued",
        "pending_work_invalid",
      );
    }
    this.items.push(item);
  }

  async claimNext(
    targetInput: DistributedControllerPendingWorkTargetV1,
  ): Promise<DistributedControllerPendingWorkItemV1 | null> {
    const target: DistributedControllerPendingWorkTargetV1 = {
      machineId: uuid(targetInput.machineId, "machineId"),
      registrationId: uuid(targetInput.registrationId, "registrationId"),
      registrationRevision: revision(targetInput.registrationRevision, "registrationRevision"),
    };
    const index = this.items.findIndex((item) => itemMatchesTarget(item, target));
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    return structuredClone(item!);
  }

  get size(): number {
    return this.items.length;
  }
}

export class DistributedControllerPendingWorkSelector {
  constructor(private readonly options: DistributedControllerPendingWorkSelectorOptions) {}

  async pullNext(
    token: string,
    requestId: string,
  ): Promise<DistributedExecutionDeliveryBundleV1 | null> {
    let authorized: DistributedMachineAuthorizedRequestV1;
    try {
      authorized = await this.options.transport.authorize(
        token,
        requestId,
        "accept_writer_candidates",
      );
    } catch (error) {
      throw new DistributedControllerPendingWorkError(
        "machine pull could not be authenticated before controller selection",
        "transport_identity_invalid",
        { cause: error },
      );
    }
    if (authorized.requestId !== requestId) {
      throw new DistributedControllerPendingWorkError(
        "authenticated machine request id does not match the pull request",
        "transport_identity_invalid",
      );
    }

    const target = targetFromAuthorized(authorized);
    const claimed = await this.options.pendingWork.claimNext(target);
    if (claimed === null) return null;

    const item = structuredClone(claimed);
    assertDistributedControllerPendingWorkItem(item);
    if (!itemMatchesTarget(item, target)) {
      throw new DistributedControllerPendingWorkError(
        "controller-selected work does not match the authenticated machine",
        "pending_work_target_mismatch",
      );
    }

    const now = currentTime(this.options.now);
    try {
      await this.options.candidates.assertCandidateCurrent(item.assignment, now);
    } catch (error) {
      throw new DistributedControllerPendingWorkError(
        "controller-selected candidate is no longer current",
        "candidate_not_current",
        { cause: error },
      );
    }
    try {
      await this.options.fences.validateCurrent(item.fence, item.assignment, now);
    } catch (error) {
      throw new DistributedControllerPendingWorkError(
        "controller-selected fence is no longer current",
        "fence_not_current",
        { cause: error },
      );
    }

    try {
      return await this.options.delivery.deliverAuthorized(
        authorized,
        item.dispatch,
        item.assignment,
        item.fence,
      );
    } catch (error) {
      throw new DistributedControllerPendingWorkError(
        "controller-selected work could not enter the existing M12J delivery boundary",
        "delivery_failed",
        { cause: error },
      );
    }
  }
}
