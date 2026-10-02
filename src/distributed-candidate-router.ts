import {
  assertDistributedMachineRegistration,
  assertDistributedPlacementCurrent,
  assertDistributedWorkspacePlacement,
  assertDistributedWriterCandidateAssignment,
  assertDistributedWriterCandidateCurrent,
  createDistributedWriterCandidateAssignment,
  type DistributedMachineRegistrationV1,
  type DistributedWorkspacePlacementV1,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import type { DistributedMachineLivenessViewV1 } from "./distributed-machine-transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISTRIBUTED_CANDIDATE_ROUTER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresCurrentPlacement: true as const,
  requiresCurrentMachineRegistration: true as const,
  requiresFreshLiveness: true as const,
  requiresWriterCandidateCapability: true as const,
  revalidatesAfterAssignmentCreation: true as const,
  candidateAssignmentAuthority: "coordination_only" as const,
  networkCommandDeliveryEnabled: false as const,
  taskExecutionEnabled: false as const,
  distributedWriteDispatchEnabled: false as const,
  distributedWriteExecutionEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedCandidatePlacementLookup {
  list(): Promise<DistributedWorkspacePlacementV1[]>;
  get(placementId: string): Promise<DistributedWorkspacePlacementV1>;
}

export interface DistributedCandidateRegistrationLookup {
  get(registrationId: string): Promise<DistributedMachineRegistrationV1>;
}

export interface DistributedCandidateLivenessLookup {
  getLiveness(registrationId: string): Promise<DistributedMachineLivenessViewV1>;
}

export interface DistributedCandidateRouteRequestV1 {
  taskId: string;
  workspaceId: string;
  ttlMs: number;
}

export interface DistributedCandidateRouterOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class DistributedCandidateRouterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "request_invalid"
      | "placement_not_found"
      | "placement_ambiguous"
      | "registration_not_current"
      | "capability_not_allowed"
      | "machine_not_live"
      | "machine_not_accepting_candidates"
      | "candidate_invalid"
      | "candidate_not_current",
  ) {
    super(message);
    this.name = "DistributedCandidateRouterError";
  }
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DistributedCandidateRouterError(`${label} must be an object`, "request_invalid");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== required.length || keys.some((key) => !required.includes(key))) {
    throw new DistributedCandidateRouterError(
      `${label} contains unsupported or missing fields`,
      "request_invalid",
    );
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new DistributedCandidateRouterError(
      `${field} must be an opaque UUID`,
      "request_invalid",
    );
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DistributedCandidateRouterError(
      `${field} must be a positive integer`,
      "request_invalid",
    );
  }
  return value;
}

function parseRouteRequest(request: DistributedCandidateRouteRequestV1): DistributedCandidateRouteRequestV1 {
  exactKeys(
    request,
    ["taskId", "workspaceId", "ttlMs"],
    "distributed candidate route request",
  );
  return {
    taskId: requireUuid(request.taskId, "taskId"),
    workspaceId: requireUuid(request.workspaceId, "workspaceId"),
    ttlMs: requirePositiveInteger(request.ttlMs, "ttlMs"),
  };
}

function requireFreshLiveness(
  liveness: DistributedMachineLivenessViewV1,
  registration: DistributedMachineRegistrationV1,
  now: Date,
  staleCode: "machine_not_live" | "candidate_not_current",
): void {
  if (
    liveness.schemaVersion !== 1
    || liveness.authority !== "observation_only"
    || liveness.grantsTaskAuthority !== false
    || liveness.grantsFilesystemAuthority !== false
    || liveness.grantsSafetyPlanAuthority !== false
    || liveness.grantsWriterLeaseAuthority !== false
    || liveness.grantsCredentialAuthority !== false
    || liveness.grantsReleaseAuthority !== false
  ) {
    throw new DistributedCandidateRouterError(
      "machine liveness contains invalid authority",
      staleCode,
    );
  }
  if (
    liveness.registrationId !== registration.registrationId
    || liveness.machineId !== registration.machineId
    || liveness.registrationRevision !== registration.revision
  ) {
    throw new DistributedCandidateRouterError(
      "machine liveness no longer matches the current registration",
      staleCode,
    );
  }
  if (liveness.state !== "live") {
    throw new DistributedCandidateRouterError("machine is not currently live", staleCode);
  }
  if (
    typeof liveness.observedAt !== "string"
    || typeof liveness.validUntil !== "string"
    || !Number.isFinite(Date.parse(liveness.observedAt))
    || !Number.isFinite(Date.parse(liveness.validUntil))
    || Date.parse(liveness.observedAt) > now.getTime()
    || Date.parse(liveness.validUntil) <= now.getTime()
    || Date.parse(liveness.validUntil) < Date.parse(liveness.observedAt)
  ) {
    throw new DistributedCandidateRouterError(
      "machine liveness observation is stale or malformed",
      staleCode,
    );
  }
  if (!liveness.acceptingWriterCandidates) {
    throw new DistributedCandidateRouterError(
      "machine is not accepting writer candidates",
      staleCode === "machine_not_live"
        ? "machine_not_accepting_candidates"
        : "candidate_not_current",
    );
  }
}

/**
 * M12D routing boundary.
 *
 * This coordinator may select only the one active placement for an opaque
 * workspace, revalidate the exact current machine registration, require fresh
 * 12C liveness, and create the existing short-lived M12A coordination-only
 * writer-candidate assignment. It never delivers a command or executes a task.
 */
export class DistributedCandidateRouter {
  constructor(
    private readonly placements: DistributedCandidatePlacementLookup,
    private readonly registrations: DistributedCandidateRegistrationLookup,
    private readonly liveness: DistributedCandidateLivenessLookup,
    private readonly options: DistributedCandidateRouterOptions = {},
  ) {}

  private now(): Date {
    const now = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedCandidateRouterError(
        "distributed candidate router clock is invalid",
        "request_invalid",
      );
    }
    return now;
  }

  private async resolveCurrentPlacement(
    workspaceId: string,
  ): Promise<DistributedWorkspacePlacementV1> {
    let placements: DistributedWorkspacePlacementV1[];
    try {
      placements = await this.placements.list();
    } catch {
      throw new DistributedCandidateRouterError(
        "distributed placement state is unavailable",
        "placement_not_found",
      );
    }
    const matches = placements.filter(
      (placement) => placement.workspaceId === workspaceId && !placement.disabledAt,
    );
    if (matches.length === 0) {
      throw new DistributedCandidateRouterError(
        "workspace has no active distributed placement",
        "placement_not_found",
      );
    }
    if (matches.length !== 1) {
      throw new DistributedCandidateRouterError(
        "workspace has ambiguous active distributed placement state",
        "placement_ambiguous",
      );
    }
    try {
      assertDistributedWorkspacePlacement(matches[0]);
    } catch {
      throw new DistributedCandidateRouterError(
        "active distributed placement is invalid",
        "placement_not_found",
      );
    }
    return structuredClone(matches[0]);
  }

  private async resolveCurrentRegistration(
    placement: DistributedWorkspacePlacementV1,
  ): Promise<DistributedMachineRegistrationV1> {
    let registration: DistributedMachineRegistrationV1;
    try {
      registration = await this.registrations.get(placement.machineRegistrationId);
      assertDistributedMachineRegistration(registration);
      assertDistributedPlacementCurrent(placement, registration);
    } catch {
      throw new DistributedCandidateRouterError(
        "placement no longer matches a current machine registration",
        "registration_not_current",
      );
    }
    if (!registration.allowedCapabilities.includes("accept_writer_candidates")) {
      throw new DistributedCandidateRouterError(
        "machine registration does not allow writer candidates",
        "capability_not_allowed",
      );
    }
    return structuredClone(registration);
  }

  private async requireLiveness(
    registration: DistributedMachineRegistrationV1,
    now: Date,
    staleCode: "machine_not_live" | "candidate_not_current",
  ): Promise<void> {
    let view: DistributedMachineLivenessViewV1;
    try {
      view = await this.liveness.getLiveness(registration.registrationId);
    } catch {
      throw new DistributedCandidateRouterError(
        "machine liveness is unavailable",
        staleCode,
      );
    }
    requireFreshLiveness(view, registration, now, staleCode);
  }

  async routeCandidate(
    requestInput: DistributedCandidateRouteRequestV1,
  ): Promise<DistributedWriterCandidateAssignmentV1> {
    const request = parseRouteRequest(requestInput);
    const now = this.now();
    const placement = await this.resolveCurrentPlacement(request.workspaceId);
    const registration = await this.resolveCurrentRegistration(placement);
    await this.requireLiveness(registration, now, "machine_not_live");

    let assignment: DistributedWriterCandidateAssignmentV1;
    try {
      assignment = createDistributedWriterCandidateAssignment(
        registration,
        placement,
        request,
        { now: () => now, idFactory: this.options.idFactory },
      );
    } catch {
      throw new DistributedCandidateRouterError(
        "writer candidate assignment could not be created",
        "candidate_invalid",
      );
    }

    await this.assertCandidateCurrent(assignment, now);
    return structuredClone(assignment);
  }

  async assertCandidateCurrent(
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void> {
    try {
      assertDistributedWriterCandidateAssignment(assignmentInput);
    } catch {
      throw new DistributedCandidateRouterError(
        "writer candidate assignment is invalid",
        "candidate_invalid",
      );
    }
    const now = observedNow ?? this.now();
    if (!Number.isFinite(now.getTime())) {
      throw new DistributedCandidateRouterError(
        "distributed candidate router clock is invalid",
        "candidate_invalid",
      );
    }

    let placement: DistributedWorkspacePlacementV1;
    let registration: DistributedMachineRegistrationV1;
    try {
      placement = await this.placements.get(assignmentInput.placementId);
      registration = await this.registrations.get(assignmentInput.machineRegistrationId);
      assertDistributedWriterCandidateCurrent(
        assignmentInput,
        registration,
        placement,
        now,
      );
    } catch {
      throw new DistributedCandidateRouterError(
        "writer candidate assignment no longer matches current routing state",
        "candidate_not_current",
      );
    }

    await this.requireLiveness(registration, now, "candidate_not_current");
  }
}
