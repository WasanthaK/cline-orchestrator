import crypto from "node:crypto";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  assertDistributedExecutionDispatch,
  type DistributedExecutionDispatchV1,
  type DistributedTargetIdentityV1,
} from "./distributed-execution-admission.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type { DistributedMachineAuthorizedRequestV1 } from "./distributed-machine-transport.js";
import type { DistributedTargetRuntimeHandoffContext } from "./distributed-target-runtime-handoff.js";
import type { OrchestratorTask } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISTRIBUTED_EXECUTION_DELIVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  targetPullAuthenticatedWithM12C: true as const,
  requiresAcceptWriterCandidatesCapability: true as const,
  deliveryContainsExistingAuthorityFreeEvidenceOnly: true as const,
  requiresExactMachineRegistrationBinding: true as const,
  requiresM12HAdmissionAndLocalAuthorityReentry: true as const,
  requiresM12ITargetRuntimeStart: true as const,
  m12GReplayProtectionRemainsAuthoritative: true as const,
  controllerPushEnabled: false as const,
  networkListenerIncluded: false as const,
  externalNetworkTransportIncluded: false as const,
  transportServerAuthenticationIncluded: false as const,
  distributedFenceRenewalIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

/**
 * Controller-side M12C authorizer. In M12J the target pulls work using its existing
 * authenticated machine session. The returned identity is transport evidence only.
 */
export interface DistributedExecutionDeliveryTransportAuthorizer {
  authorize(
    token: string,
    requestId: string,
    capability: "accept_writer_candidates",
  ): Promise<DistributedMachineAuthorizedRequestV1>;
}

export interface DistributedExecutionDeliveryHandoff {
  prepare(
    dispatch: DistributedExecutionDispatchV1,
    assignment: DistributedWriterCandidateAssignmentV1,
    fence: DistributedFenceClaimV1,
  ): Promise<DistributedTargetRuntimeHandoffContext>;
}

export interface DistributedExecutionDeliveryStarter {
  start(context: DistributedTargetRuntimeHandoffContext): Promise<OrchestratorTask>;
}

export interface DistributedExecutionDeliveryBundleV1 {
  schemaVersion: 1;
  deliveryId: string;
  transportRequest: DistributedMachineAuthorizedRequestV1;
  dispatch: DistributedExecutionDispatchV1;
  assignment: DistributedWriterCandidateAssignmentV1;
  fence: DistributedFenceClaimV1;
  authority: "transport_delivery_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DistributedExecutionDeliveryControllerOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedExecutionDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "delivery_invalid"
      | "transport_identity_invalid"
      | "target_mismatch"
      | "evidence_mismatch"
      | "delivery_stale"
      | "handoff_failed"
      | "runtime_start_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedExecutionDeliveryError";
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  code: DistributedExecutionDeliveryError["code"],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedExecutionDeliveryError(`${label} must be an object`, code);
  }
  const actual = Object.keys(value as Record<string, unknown>);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new DistributedExecutionDeliveryError(
      `${label} contains unsupported or missing fields`,
      code,
    );
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedExecutionDeliveryError(`${field} must be an opaque UUID`, "delivery_invalid");
  }
  return value.trim();
}

function requireRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedExecutionDeliveryError(`${field} must be a positive integer`, "delivery_invalid");
  }
  return value;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) {
    throw new DistributedExecutionDeliveryError("distributed delivery clock is invalid", "delivery_invalid");
  }
  return value;
}

function assertAuthorizedTransportRequest(
  value: unknown,
): asserts value is DistributedMachineAuthorizedRequestV1 {
  exactKeys(
    value,
    [
      "schemaVersion",
      "requestId",
      "sessionId",
      "registrationId",
      "machineId",
      "registrationRevision",
      "capability",
      "authority",
      "grantsTaskAuthority",
      "grantsFilesystemAuthority",
      "grantsSafetyPlanAuthority",
      "grantsWriterLeaseAuthority",
      "grantsCredentialAuthority",
      "grantsReleaseAuthority",
    ],
    "authorized machine transport request",
    "transport_identity_invalid",
  );
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.capability !== "accept_writer_candidates"
    || record.authority !== "transport_identity_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedExecutionDeliveryError(
      "transport request is not an authority-free writer-candidate pull",
      "transport_identity_invalid",
    );
  }
  requireUuid(record.requestId, "transportRequest.requestId");
  requireUuid(record.sessionId, "transportRequest.sessionId");
  requireUuid(record.registrationId, "transportRequest.registrationId");
  requireUuid(record.machineId, "transportRequest.machineId");
  requireRevision(record.registrationRevision, "transportRequest.registrationRevision");
}

function assertEvidenceBinding(
  dispatch: DistributedExecutionDispatchV1,
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
): void {
  if (
    dispatch.taskId !== assignment.taskId
    || dispatch.workspaceId !== assignment.workspaceId
    || dispatch.machineId !== assignment.machineId
    || dispatch.machineRegistrationId !== assignment.machineRegistrationId
    || dispatch.machineRegistrationRevision !== assignment.machineRegistrationRevision
    || dispatch.placementId !== assignment.placementId
    || dispatch.placementRevision !== assignment.placementRevision
    || dispatch.candidateAssignmentId !== assignment.assignmentId
    || fence.taskId !== assignment.taskId
    || fence.workspaceId !== assignment.workspaceId
    || fence.machineId !== assignment.machineId
    || fence.machineRegistrationId !== assignment.machineRegistrationId
    || fence.machineRegistrationRevision !== assignment.machineRegistrationRevision
    || fence.placementId !== assignment.placementId
    || fence.placementRevision !== assignment.placementRevision
    || fence.candidateAssignmentId !== assignment.assignmentId
    || dispatch.fenceId !== fence.fenceId
    || dispatch.fenceGeneration !== fence.generation
  ) {
    throw new DistributedExecutionDeliveryError(
      "dispatch, candidate assignment and distributed fence are cross-bound",
      "evidence_mismatch",
    );
  }
}

function assertTransportTargetBinding(
  authorized: DistributedMachineAuthorizedRequestV1,
  dispatch: DistributedExecutionDispatchV1,
): void {
  if (
    authorized.machineId !== dispatch.machineId
    || authorized.registrationId !== dispatch.machineRegistrationId
    || authorized.registrationRevision !== dispatch.machineRegistrationRevision
  ) {
    throw new DistributedExecutionDeliveryError(
      "authenticated target machine does not match the distributed dispatch target",
      "target_mismatch",
    );
  }
}

function assertEvidenceCurrentEnoughToDeliver(
  dispatch: DistributedExecutionDispatchV1,
  assignment: DistributedWriterCandidateAssignmentV1,
  fence: DistributedFenceClaimV1,
  now: Date,
): void {
  const nowMs = now.getTime();
  const issued = [dispatch.issuedAt, assignment.issuedAt, fence.issuedAt].map(Date.parse);
  const expires = [dispatch.expiresAt, assignment.expiresAt, fence.expiresAt].map(Date.parse);
  if (issued.some((value) => value > nowMs) || expires.some((value) => value <= nowMs)) {
    throw new DistributedExecutionDeliveryError(
      "distributed execution evidence is not current enough for delivery",
      "delivery_stale",
    );
  }
}

export function assertDistributedExecutionDeliveryBundle(
  value: unknown,
): asserts value is DistributedExecutionDeliveryBundleV1 {
  exactKeys(
    value,
    [
      "schemaVersion",
      "deliveryId",
      "transportRequest",
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
    ],
    "distributed execution delivery bundle",
    "delivery_invalid",
  );
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.authority !== "transport_delivery_evidence_only"
    || record.grantsTaskAuthority !== false
    || record.grantsFilesystemAuthority !== false
    || record.grantsSafetyPlanAuthority !== false
    || record.grantsWriterLeaseAuthority !== false
    || record.grantsCredentialAuthority !== false
    || record.grantsReleaseAuthority !== false
  ) {
    throw new DistributedExecutionDeliveryError(
      "distributed delivery cannot grant execution authority",
      "delivery_invalid",
    );
  }
  requireUuid(record.deliveryId, "deliveryId");
  try {
    assertAuthorizedTransportRequest(record.transportRequest);
    assertDistributedExecutionDispatch(record.dispatch);
    assertDistributedWriterCandidateAssignment(record.assignment);
    assertDistributedFenceClaim(record.fence);
  } catch (error) {
    if (error instanceof DistributedExecutionDeliveryError) throw error;
    throw new DistributedExecutionDeliveryError(
      "distributed delivery contains invalid transport or execution evidence",
      "delivery_invalid",
      { cause: error },
    );
  }
  assertEvidenceBinding(record.dispatch, record.assignment, record.fence);
  assertTransportTargetBinding(record.transportRequest, record.dispatch);
}

/**
 * Controller-local half of M12J. A target machine pulls using its already-issued
 * M12C bearer session. The controller authenticates the pull and returns only the
 * existing M12G/M12D/M12E authority-free evidence for that exact machine.
 *
 * This class is not a network route and does not expose M12C session issuance.
 */
export class DistributedExecutionPullDeliveryController {
  constructor(
    private readonly transport: DistributedExecutionDeliveryTransportAuthorizer,
    private readonly options: DistributedExecutionDeliveryControllerOptions = {},
  ) {}

  async deliverAuthorized(
    authorizedInput: DistributedMachineAuthorizedRequestV1,
    dispatchInput: DistributedExecutionDispatchV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    fenceInput: DistributedFenceClaimV1,
  ): Promise<DistributedExecutionDeliveryBundleV1> {
    const authorized = structuredClone(authorizedInput);
    const dispatch = structuredClone(dispatchInput);
    const assignment = structuredClone(assignmentInput);
    const fence = structuredClone(fenceInput);
    try {
      assertAuthorizedTransportRequest(authorized);
      assertDistributedExecutionDispatch(dispatch);
      assertDistributedWriterCandidateAssignment(assignment);
      assertDistributedFenceClaim(fence);
    } catch (error) {
      if (error instanceof DistributedExecutionDeliveryError) throw error;
      throw new DistributedExecutionDeliveryError(
        "controller delivery evidence is invalid",
        "delivery_invalid",
        { cause: error },
      );
    }
    assertEvidenceBinding(dispatch, assignment, fence);
    assertTransportTargetBinding(authorized, dispatch);
    assertEvidenceCurrentEnoughToDeliver(dispatch, assignment, fence, currentTime(this.options.now));

    const delivery: DistributedExecutionDeliveryBundleV1 = {
      schemaVersion: 1,
      deliveryId: requireUuid(
        (this.options.idFactory ?? (() => crypto.randomUUID()))(),
        "deliveryId",
      ),
      transportRequest: authorized,
      dispatch,
      assignment,
      fence,
      authority: "transport_delivery_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertDistributedExecutionDeliveryBundle(delivery);
    return structuredClone(delivery);
  }

  async authorizePull(
    token: string,
    requestId: string,
    dispatchInput: DistributedExecutionDispatchV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    fenceInput: DistributedFenceClaimV1,
  ): Promise<DistributedExecutionDeliveryBundleV1> {
    let authorized: DistributedMachineAuthorizedRequestV1;
    try {
      authorized = await this.transport.authorize(token, requestId, "accept_writer_candidates");
      assertAuthorizedTransportRequest(authorized);
    } catch (error) {
      if (error instanceof DistributedExecutionDeliveryError) throw error;
      throw new DistributedExecutionDeliveryError(
        "target pull could not be authenticated by M12C",
        "transport_identity_invalid",
        { cause: error },
      );
    }
    if (authorized.requestId !== requestId) {
      throw new DistributedExecutionDeliveryError(
        "M12C authorization evidence does not match the pull request id",
        "transport_identity_invalid",
      );
    }
    return this.deliverAuthorized(
      authorized,
      dispatchInput,
      assignmentInput,
      fenceInput,
    );
  }
}

export interface DistributedTargetExecutionDeliveryOptions {
  targetIdentity: DistributedTargetIdentityV1;
  handoff: DistributedExecutionDeliveryHandoff;
  starter: DistributedExecutionDeliveryStarter;
}

/**
 * Process-local target half of M12J. A future authenticated network adapter may
 * deserialize a delivery bundle and call this receiver, but the receiver itself
 * opens no listener and trusts no transport artifact as execution authority.
 *
 * M12G durable replay consumption remains inside M12H admission. M12H then reloads
 * target-local task/Safety/workspace authority and M12I revalidates immediately
 * before starting Cline. Replaying a delivered bundle therefore cannot bypass the
 * existing target admission/replay boundary.
 */
export class DistributedTargetExecutionDeliveryReceiver {
  constructor(private readonly options: DistributedTargetExecutionDeliveryOptions) {}

  async execute(bundleInput: DistributedExecutionDeliveryBundleV1): Promise<OrchestratorTask> {
    const bundle = structuredClone(bundleInput);
    assertDistributedExecutionDeliveryBundle(bundle);
    const target = this.options.targetIdentity;
    if (
      bundle.transportRequest.machineId !== target.machineId
      || bundle.transportRequest.registrationId !== target.machineRegistrationId
      || bundle.transportRequest.registrationRevision !== target.machineRegistrationRevision
      || bundle.dispatch.machineId !== target.machineId
      || bundle.dispatch.machineRegistrationId !== target.machineRegistrationId
      || bundle.dispatch.machineRegistrationRevision !== target.machineRegistrationRevision
    ) {
      throw new DistributedExecutionDeliveryError(
        "delivery does not match this target machine identity",
        "target_mismatch",
      );
    }

    let context: DistributedTargetRuntimeHandoffContext;
    try {
      context = await this.options.handoff.prepare(
        bundle.dispatch,
        bundle.assignment,
        bundle.fence,
      );
    } catch (error) {
      throw new DistributedExecutionDeliveryError(
        "M12H target-local handoff rejected the delivered execution evidence",
        "handoff_failed",
        { cause: error },
      );
    }
    if (
      context.evidence.taskId !== bundle.dispatch.taskId
      || context.evidence.workspaceId !== bundle.dispatch.workspaceId
      || context.evidence.machineId !== bundle.dispatch.machineId
      || context.evidence.fenceGeneration !== bundle.dispatch.fenceGeneration
    ) {
      throw new DistributedExecutionDeliveryError(
        "M12H handoff context does not match the delivered execution evidence",
        "handoff_failed",
      );
    }

    try {
      return await this.options.starter.start(context);
    } catch (error) {
      throw new DistributedExecutionDeliveryError(
        "M12I target runtime start rejected the delivered execution context",
        "runtime_start_failed",
        { cause: error },
      );
    }
  }
}
