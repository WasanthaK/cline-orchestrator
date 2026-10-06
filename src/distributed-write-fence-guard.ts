import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  DistributedCandidateRenewalAuthority,
} from "./distributed-candidate-lifecycle.js";
import {
  assertDistributedFenceClaim,
  DistributedFenceAuthority,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import type { DistributedWriterFenceGuard } from "./lease-aware-hub-safety-runtime.js";

export class DistributedWriteFenceGuardError extends Error {
  constructor(
    message: string,
    public readonly code: "binding_invalid",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DistributedWriteFenceGuardError";
  }
}

export interface RenewableDistributedWriterFenceGuard extends DistributedWriterFenceGuard {
  currentClaim(): DistributedFenceClaimV1;
  currentAssignment(): DistributedWriterCandidateAssignmentV1;
  renewCandidate(ttlMs: number): Promise<DistributedWriterCandidateAssignmentV1>;
  renew(ttlMs: number): Promise<DistributedFenceClaimV1>;
}

export function isRenewableDistributedWriterFenceGuard(
  value: DistributedWriterFenceGuard,
): value is RenewableDistributedWriterFenceGuard {
  const candidate = value as Partial<RenewableDistributedWriterFenceGuard>;
  return typeof candidate.currentClaim === "function"
    && typeof candidate.currentAssignment === "function"
    && typeof candidate.renewCandidate === "function"
    && typeof candidate.renew === "function";
}

function sameCandidateBinding(
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

/**
 * Converts one exact M12E fence + candidate assignment into the optional M12F
 * target-write guard consumed by the lease-aware Hub safety boundary.
 *
 * The returned object carries no credentials and grants no authority. Every call
 * delegates to DistributedFenceAuthority validation against the shared backend.
 * M12K adds serialized fence renewal; M12N additionally permits only a time-bound
 * renewal of the exact same candidate identity/binding before fence renewal.
 */
export function createDistributedWriterFenceGuard(
  authority: DistributedFenceAuthority,
  claimInput: DistributedFenceClaimV1,
  assignmentInput: DistributedWriterCandidateAssignmentV1,
): RenewableDistributedWriterFenceGuard {
  try {
    assertDistributedFenceClaim(claimInput);
    assertDistributedWriterCandidateAssignment(assignmentInput);
  } catch (error) {
    throw new DistributedWriteFenceGuardError(
      "Distributed write fence input is invalid",
      "binding_invalid",
      { cause: error },
    );
  }
  if (
    claimInput.taskId !== assignmentInput.taskId
    || claimInput.workspaceId !== assignmentInput.workspaceId
    || claimInput.candidateAssignmentId !== assignmentInput.assignmentId
  ) {
    throw new DistributedWriteFenceGuardError(
      "Distributed fence and candidate assignment do not share the exact task/workspace/assignment binding",
      "binding_invalid",
    );
  }

  let claim = structuredClone(claimInput);
  let assignment = structuredClone(assignmentInput);
  let tail: Promise<void> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  const candidateRenewal = new DistributedCandidateRenewalAuthority({
    async assertCandidateCurrent(candidate, observedNow) {
      await authority.validateCurrent(claim, candidate, observedNow);
    },
  });

  return Object.freeze({
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    currentClaim(): DistributedFenceClaimV1 {
      return structuredClone(claim);
    },
    currentAssignment(): DistributedWriterCandidateAssignmentV1 {
      return structuredClone(assignment);
    },
    async validateCurrent(): Promise<void> {
      await exclusive(async () => {
        await authority.validateCurrent(claim, assignment);
      });
    },
    async renewCandidate(ttlMs: number): Promise<DistributedWriterCandidateAssignmentV1> {
      return await exclusive(async () => {
        const renewed = await candidateRenewal.renew(assignment, ttlMs);
        if (!sameCandidateBinding(assignment, renewed)) {
          throw new DistributedWriteFenceGuardError(
            "renewed writer candidate changed immutable distributed fence binding",
            "binding_invalid",
          );
        }
        assignment = structuredClone(renewed);
        return structuredClone(renewed);
      });
    },
    async renew(ttlMs: number): Promise<DistributedFenceClaimV1> {
      return await exclusive(async () => {
        const renewed = await authority.renew(claim, assignment, ttlMs);
        claim = structuredClone(renewed);
        return structuredClone(renewed);
      });
    },
  });
}
