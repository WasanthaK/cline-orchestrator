import type { DistributedWriterFenceGuard } from "./lease-aware-hub-safety-runtime.js";
import {
  isRenewableDistributedWriterFenceGuard,
  type RenewableDistributedWriterFenceGuard,
} from "./distributed-write-fence-guard.js";

const MIN_RENEW_INTERVAL_MS = 250;
const MAX_RENEW_INTERVAL_MS = 30_000;

export const DISTRIBUTED_COORDINATION_LIFECYCLE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  candidateRenewedBeforeFence: true as const,
  preservesCandidateIdentity: true as const,
  preservesFenceGeneration: true as const,
  failureAbortsLifecycle: true as const,
  renewalGrantsAuthority: false as const,
  networkListenerIncluded: false as const,
  externalTransportIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedCoordinationLifecycleOptions {
  candidateRenewTtlMs: number;
  fenceRenewTtlMs: number;
  renewIntervalMs: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class DistributedCoordinationLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "guard_not_renewable"
      | "configuration_invalid"
      | "candidate_renewal_failed"
      | "fence_renewal_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedCoordinationLifecycleError";
  }
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedCoordinationLifecycleError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

export class DistributedCoordinationLifecycle {
  private readonly guard: RenewableDistributedWriterFenceGuard;
  private readonly candidateRenewTtlMs: number;
  private readonly fenceRenewTtlMs: number;
  private readonly renewIntervalMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = false;

  readonly signal = this.controller.signal;

  constructor(
    guardInput: DistributedWriterFenceGuard,
    options: DistributedCoordinationLifecycleOptions,
  ) {
    if (!isRenewableDistributedWriterFenceGuard(guardInput)) {
      throw new DistributedCoordinationLifecycleError(
        "distributed coordination lifecycle requires the M12N renewal-aware fence guard",
        "guard_not_renewable",
      );
    }
    this.guard = guardInput;
    this.candidateRenewTtlMs = boundedInteger(
      options.candidateRenewTtlMs,
      "candidateRenewTtlMs",
      1_000,
      120_000,
    );
    this.fenceRenewTtlMs = boundedInteger(
      options.fenceRenewTtlMs,
      "fenceRenewTtlMs",
      1_000,
      60_000,
    );
    this.renewIntervalMs = boundedInteger(
      options.renewIntervalMs,
      "renewIntervalMs",
      MIN_RENEW_INTERVAL_MS,
      MAX_RENEW_INTERVAL_MS,
    );
    if (
      this.renewIntervalMs >= this.candidateRenewTtlMs
      || this.renewIntervalMs >= this.fenceRenewTtlMs
    ) {
      throw new DistributedCoordinationLifecycleError(
        "renewIntervalMs must be shorter than both candidate and fence renewal TTLs",
        "configuration_invalid",
      );
    }
    this.setTimer = options.setTimeoutFn ?? setTimeout;
    this.clearTimer = options.clearTimeoutFn ?? clearTimeout;
  }

  currentAssignment() {
    return this.guard.currentAssignment();
  }

  currentClaim() {
    return this.guard.currentClaim();
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
      await this.guard.renewCandidate(this.candidateRenewTtlMs);
    } catch (error) {
      if (!this.signal.aborted) {
        this.controller.abort(new DistributedCoordinationLifecycleError(
          "writer candidate renewal failed; distributed target execution must abort fail-safe",
          "candidate_renewal_failed",
          { cause: error },
        ));
      }
      return;
    }

    try {
      await this.guard.renew(this.fenceRenewTtlMs);
    } catch (error) {
      if (!this.signal.aborted) {
        this.controller.abort(new DistributedCoordinationLifecycleError(
          "distributed fence renewal failed after candidate renewal; target execution must abort fail-safe",
          "fence_renewal_failed",
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
