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

/**
 * Converts one exact M12E fence + candidate assignment into the optional M12F
 * target-write guard consumed by the lease-aware Hub safety boundary.
 *
 * The returned object carries no credentials and grants no authority. Every call
 * delegates to DistributedFenceAuthority.validateCurrent(), which revalidates the
 * candidate and the shared backend's exact current generation/holder.
 */
export function createDistributedWriterFenceGuard(
  authority: DistributedFenceAuthority,
  claimInput: DistributedFenceClaimV1,
  assignmentInput: DistributedWriterCandidateAssignmentV1,
): DistributedWriterFenceGuard {
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

  const claim = structuredClone(claimInput);
  const assignment = structuredClone(assignmentInput);
  return Object.freeze({
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    async validateCurrent(): Promise<void> {
      await authority.validateCurrent(claim, assignment);
    },
  });
}
