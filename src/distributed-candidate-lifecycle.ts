import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";

const MIN_RENEW_TTL_MS = 1_000;
const MAX_RENEW_TTL_MS = 2 * 60_000;
const MIN_RENEW_INTERVAL_MS = 250;
const MAX_RENEW_INTERVAL_MS = 60_000;

export const DISTRIBUTED_CANDIDATE_LIFECYCLE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  preservesAssignmentId: true as const,
  preservesTaskWorkspaceBinding: true as const,
  preservesMachineRegistrationPlacementBinding: true as const,
  revalidatesBeforeRenewal: true as const,
  revalidatesAfterRenewal: true as const,
  renewalAuthority: "coordination_only" as const,
  renewalGrantsAuthority: false as const,
  replacementCandidateIncluded: false as const,
  networkListenerIncluded: false as const,
  externalTransportIncluded: false as const,
  taskExecutionIncluded: false as const,
  distributedFenceRenewalIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedCandidateCurrentValidator {
  assertCandidateCurrent(
    assignment: DistributedWriterCandidateAssignmentV1,
    observedNow?: Date,
  ): Promise<void>;
}

export interface DistributedCandidateRenewalOptions {
  now?: () => Date;
}

export interface DistributedCandidateLifecycleOptions {
  renewTtlMs: number;
  renewIntervalMs: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class DistributedCandidateLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "candidate_invalid"
      | "configuration_invalid"
      | "candidate_not_current"
      | "renewal_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedCandidateLifecycleError";
  }
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedCandidateLifecycleError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

function sameBinding(
  left: DistributedWriterCandidateAssignmentV1,
  right: DistributedWriterCandidateAssignmentV1,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.assignmentId === right.assignmentId
    && left.taskId === right.taskId
    && left.workspaceId === right.workspaceId
    && left.machineId === right.machineId
    && left.machineRegistrationId === right.machineRegistrationId
    && left.machineRegistrationRevision === right.machineRegistrationRevision
    && left.placementId === right.placementId
    && left.placementRevision === right.placementRevision
    && left.authority === right.authority
    && left.grantsTaskAuthority === right.grantsTaskAuthority
    && left.grantsFilesystemAuthority === right.grantsFilesystemAuthority
    && left.grantsSafetyPlanAuthority === right.grantsSafetyPlanAuthority
    && left.grantsWriterLeaseAuthority === right.grantsWriterLeaseAuthority
    && left.grantsCredentialAuthority === right.grantsCredentialAuthority
    && left.grantsReleaseAuthority === right.grantsReleaseAuthority;
}

export class DistributedCandidateRenewalAuthority {
  constructor(
    private readonly validator: DistributedCandidateCurrentValidator,
    private readonly options: DistributedCandidateRenewalOptions = {},
  ) {}

  private now(): Date {
    const value = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(value.getTime())) {
      throw new DistributedCandidateLifecycleError(
        "distributed candidate renewal clock is invalid",
        "configuration_invalid",
      );
    }
    return value;
  }

  async renew(
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    ttlMsInput: number,
  ): Promise<DistributedWriterCandidateAssignmentV1> {
    const ttlMs = boundedInteger(
      ttlMsInput,
      "renewTtlMs",
      MIN_RENEW_TTL_MS,
      MAX_RENEW_TTL_MS,
    );

    let assignment: DistributedWriterCandidateAssignmentV1;
    try {
      assertDistributedWriterCandidateAssignment(assignmentInput);
      assignment = structuredClone(assignmentInput);
    } catch (error) {
      throw new DistributedCandidateLifecycleError(
        "writer candidate renewal input is invalid",
        "candidate_invalid",
        { cause: error },
      );
    }

    const before = this.now();
    try {
      await this.validator.assertCandidateCurrent(assignment, before);
    } catch (error) {
      throw new DistributedCandidateLifecycleError(
        "writer candidate is no longer current before renewal",
        "candidate_not_current",
        { cause: error },
      );
    }

    const renewed: DistributedWriterCandidateAssignmentV1 = {
      ...assignment,
      issuedAt: before.toISOString(),
      expiresAt: new Date(before.getTime() + ttlMs).toISOString(),
    };
    try {
      assertDistributedWriterCandidateAssignment(renewed);
    } catch (error) {
      throw new DistributedCandidateLifecycleError(
        "renewed writer candidate is invalid",
        "candidate_invalid",
        { cause: error },
      );
    }
    if (!sameBinding(assignment, renewed)) {
      throw new DistributedCandidateLifecycleError(
        "writer candidate renewal changed immutable coordination binding",
        "candidate_invalid",
      );
    }

    try {
      await this.validator.assertCandidateCurrent(renewed, this.now());
    } catch (error) {
      throw new DistributedCandidateLifecycleError(
        "writer candidate routing/liveness changed during renewal",
        "candidate_not_current",
        { cause: error },
      );
    }
    return structuredClone(renewed);
  }
}

export class DistributedCandidateLifecycle {
  private readonly renewTtlMs: number;
  private readonly renewIntervalMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly controller = new AbortController();
  private assignment: DistributedWriterCandidateAssignmentV1;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = false;

  readonly signal = this.controller.signal;

  constructor(
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    private readonly authority: DistributedCandidateRenewalAuthority,
    options: DistributedCandidateLifecycleOptions,
  ) {
    try {
      assertDistributedWriterCandidateAssignment(assignmentInput);
      this.assignment = structuredClone(assignmentInput);
    } catch (error) {
      throw new DistributedCandidateLifecycleError(
        "writer candidate lifecycle input is invalid",
        "candidate_invalid",
        { cause: error },
      );
    }
    this.renewTtlMs = boundedInteger(
      options.renewTtlMs,
      "renewTtlMs",
      MIN_RENEW_TTL_MS,
      MAX_RENEW_TTL_MS,
    );
    this.renewIntervalMs = boundedInteger(
      options.renewIntervalMs,
      "renewIntervalMs",
      MIN_RENEW_INTERVAL_MS,
      MAX_RENEW_INTERVAL_MS,
    );
    if (this.renewIntervalMs >= this.renewTtlMs) {
      throw new DistributedCandidateLifecycleError(
        "renewIntervalMs must be shorter than renewTtlMs",
        "configuration_invalid",
      );
    }
    this.setTimer = options.setTimeoutFn ?? setTimeout;
    this.clearTimer = options.clearTimeoutFn ?? clearTimeout;
  }

  currentAssignment(): DistributedWriterCandidateAssignmentV1 {
    return structuredClone(this.assignment);
  }

  start(): void {
    if (this.stopped || this.timer || this.inFlight || this.signal.aborted) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.signal.aborted) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.inFlight = this.renewOnce().finally(() => {
        this.inFlight = undefined;
        if (!this.stopped && !this.signal.aborted) this.schedule();
      });
    }, this.renewIntervalMs);
  }

  private async renewOnce(): Promise<void> {
    try {
      this.assignment = await this.authority.renew(this.assignment, this.renewTtlMs);
    } catch (error) {
      if (!this.signal.aborted) {
        this.controller.abort(new DistributedCandidateLifecycleError(
          "writer candidate renewal failed; dependent fence/runtime must stop fail-safe",
          "renewal_failed",
          { cause: error },
        ));
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) await this.inFlight;
  }
}
