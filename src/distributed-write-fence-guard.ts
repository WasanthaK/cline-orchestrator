import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
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
  renew(ttlMs: number): Promise<DistributedFenceClaimV1>;
}

export function isRenewableDistributedWriterFenceGuard(
  value: DistributedWriterFenceGuard,
): value is RenewableDistributedWriterFenceGuard {
  const candidate = value as Partial<RenewableDistributedWriterFenceGuard>;
  return typeof candidate.currentClaim === "function" && typeof candidate.renew === "function";
}

/**
 * Converts one exact M12E fence + candidate assignment into the optional M12F
 * target-write guard consumed by the lease-aware Hub safety boundary.
 *
 * The returned object carries no credentials and grants no authority. Every call
 * delegates to DistributedFenceAuthority.validateCurrent(), which revalidates the
 * candidate and the shared backend's exact current generation/holder. M12K adds
 * serialized renewal of that same generation/holder; renewal never grants task,
 * filesystem, Safety Plan, writer-lease, credential or release authority.
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
  const assignment = structuredClone(assignmentInput);
  let tail: Promise<void> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  return Object.freeze({
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    currentClaim(): DistributedFenceClaimV1 {
      return structuredClone(claim);
    },
    async validateCurrent(): Promise<void> {
      await exclusive(async () => {
        await authority.validateCurrent(claim, assignment);
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
