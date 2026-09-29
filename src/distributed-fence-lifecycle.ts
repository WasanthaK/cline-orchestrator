import type { DistributedWriterFenceGuard } from "./lease-aware-hub-safety-runtime.js";
import {
  isRenewableDistributedWriterFenceGuard,
  type RenewableDistributedWriterFenceGuard,
} from "./distributed-write-fence-guard.js";

const MIN_RENEW_INTERVAL_MS = 250;
const MAX_RENEW_INTERVAL_MS = 30_000;

export const DISTRIBUTED_FENCE_LIFECYCLE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresRenewableM12FGuard: true as const,
  candidateRenewedBeforeFence: true as const,
  renewalKeepsSameCandidateIdentity: true as const,
  renewalKeepsSameGeneration: true as const,
  renewalGrantsAuthority: false as const,
  abortSignalOnRenewalFailure: true as const,
  networkListenerIncluded: false as const,
  externalTransportIncluded: false as const,
  candidateRenewalIncluded: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedFenceLifecycleOptions {
  renewTtlMs: number;
  renewIntervalMs: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class DistributedFenceLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "guard_not_renewable"
      | "configuration_invalid"
      | "renewal_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedFenceLifecycleError";
  }
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DistributedFenceLifecycleError(
      `${field} must be an integer between ${min} and ${max}`,
      "configuration_invalid",
    );
  }
  return value;
}

function candidateTtlMs(guard: RenewableDistributedWriterFenceGuard): number {
  const assignment = guard.currentAssignment();
  const ttlMs = Date.parse(assignment.expiresAt) - Date.parse(assignment.issuedAt);
  return boundedInteger(ttlMs, "candidateRenewTtlMs", 1_000, 120_000);
}

export class DistributedFenceLifecycle {
  private readonly guard: RenewableDistributedWriterFenceGuard;
  private readonly renewTtlMs: number;
  private readonly candidateRenewTtlMs: number;
  private readonly renewIntervalMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private inFlight?: Promise<void>;

  readonly signal = this.controller.signal;

  constructor(
    guard: DistributedWriterFenceGuard,
    options: DistributedFenceLifecycleOptions,
  ) {
    if (!isRenewableDistributedWriterFenceGuard(guard)) {
      throw new DistributedFenceLifecycleError(
        "distributed fence lifecycle requires the renewal-aware M12F/M12N guard",
        "guard_not_renewable",
      );
    }
    this.guard = guard;
    this.renewTtlMs = boundedInteger(options.renewTtlMs, "renewTtlMs", 1_000, 60_000);
    this.candidateRenewTtlMs = candidateTtlMs(guard);
    this.renewIntervalMs = boundedInteger(
      options.renewIntervalMs,
      "renewIntervalMs",
      MIN_RENEW_INTERVAL_MS,
      MAX_RENEW_INTERVAL_MS,
    );
    if (
      this.renewIntervalMs >= this.renewTtlMs
      || this.renewIntervalMs >= this.candidateRenewTtlMs
    ) {
      throw new DistributedFenceLifecycleError(
        "renewIntervalMs must be shorter than both candidate and fence renewal TTLs",
        "configuration_invalid",
      );
    }
    this.setTimer = options.setTimeoutFn ?? setTimeout;
    this.clearTimer = options.clearTimeoutFn ?? clearTimeout;
  }

  currentClaim() {
    return this.guard.currentClaim();
  }

  currentAssignment() {
    return this.guard.currentAssignment();
  }

  start(): void {
    if (this.stopped || this.timer || this.inFlight) return;
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
      await this.guard.renew(this.renewTtlMs);
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.controller.abort(new DistributedFenceLifecycleError(
          "distributed candidate/fence renewal failed; target execution must abort fail-safe",
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
