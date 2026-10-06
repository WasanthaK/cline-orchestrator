import type {
  DistributedRecoveryReacquisitionPreparationEvidenceV1,
} from "./distributed-recovery-reacquisition-preparation.js";
import type {
  DistributedTargetRuntimeHandoffContext,
} from "./distributed-target-runtime-handoff.js";
import type {
  DistributedTargetRuntimeStarter,
} from "./distributed-target-runtime-start.js";
import {
  isRenewableDistributedWriterFenceGuard,
} from "./distributed-write-fence-guard.js";
import type { OrchestratorTask } from "./types.js";

export const DISTRIBUTED_RECOVERY_RUNTIME_START_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresM12ZGContext: true as const,
  requiresExactPreparedLocalLeaseIdentity: true as const,
  requiresExactPreparedDistributedFenceIdentity: true as const,
  delegatesToExistingM12IStarter: true as const,
  automaticRetryAllowed: false as const,
  automaticRequeueAllowed: false as const,
  staleSessionResumeAllowed: false as const,
  startsClineOnlyThroughM12I: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedRecoveryRuntimeStartOptions {
  starter: Pick<DistributedTargetRuntimeStarter, "start">;
}

export class DistributedRecoveryRuntimeStartError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "context_invalid"
      | "lease_not_current"
      | "fence_not_current"
      | "runtime_start_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryRuntimeStartError";
  }
}

function assertPreparation(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "recovery_reacquisition_preparation_evidence_only"
    || evidence.requiresFreshDispatch !== true
    || evidence.requiresFreshAdmission !== true
    || evidence.requiresTargetLocalAuthorityReentry !== true
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new DistributedRecoveryRuntimeStartError(
      "distributed recovery preparation evidence is invalid",
      "preparation_invalid",
    );
  }
}

function assertContext(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  context: DistributedTargetRuntimeHandoffContext,
): void {
  if (
    context?.evidence?.schemaVersion !== 1
    || context.evidence.authority !== "local_runtime_handoff_evidence_only"
    || context.evidence.taskId !== evidence.taskId
    || context.evidence.workspaceId !== evidence.workspaceId
    || context.evidence.machineId !== evidence.machineId
    || context.evidence.fenceGeneration !== evidence.fenceGeneration
    || context.evidence.grantsTaskAuthority !== false
    || context.evidence.grantsFilesystemAuthority !== false
    || context.evidence.grantsSafetyPlanAuthority !== false
    || context.evidence.grantsWriterLeaseAuthority !== false
    || context.evidence.grantsCredentialAuthority !== false
    || context.evidence.grantsReleaseAuthority !== false
    || context.task?.id !== evidence.taskId
    || context.task.workspaceId !== evidence.workspaceId
    || !context.safetyOptions?.lease
    || !context.safetyOptions.distributedFenceGuard
  ) {
    throw new DistributedRecoveryRuntimeStartError(
      "M12Z-G handoff context does not match the exact recovery preparation binding",
      "context_invalid",
    );
  }
}

function assertLeaseIdentity(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  context: DistributedTargetRuntimeHandoffContext,
): void {
  const lease = context.safetyOptions.lease;
  const claim = lease.currentClaim();
  if (
    lease.signal.aborted
    || lease.taskId !== evidence.taskId
    || lease.workspaceId !== evidence.workspaceId
    || claim.taskId !== evidence.taskId
    || claim.workspaceId !== evidence.workspaceId
    || claim.ownerInstanceId !== lease.ownerInstanceId
    || claim.leaseId !== evidence.localLeaseId
    || claim.fenceToken !== evidence.localFenceToken
    || claim.authority !== "coordination_only"
  ) {
    throw new DistributedRecoveryRuntimeStartError(
      "local writer lease no longer matches the exact M12Z-D recovery preparation",
      "lease_not_current",
    );
  }
}

function assertFenceIdentity(
  evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
  context: DistributedTargetRuntimeHandoffContext,
): void {
  const guard = context.safetyOptions.distributedFenceGuard!;
  if (!isRenewableDistributedWriterFenceGuard(guard)) {
    throw new DistributedRecoveryRuntimeStartError(
      "recovery runtime start requires the exact renewable distributed fence guard created by M12H",
      "fence_not_current",
    );
  }
  const claim = guard.currentClaim();
  if (
    claim.taskId !== evidence.taskId
    || claim.workspaceId !== evidence.workspaceId
    || claim.machineId !== evidence.machineId
    || claim.machineRegistrationId !== evidence.machineRegistrationId
    || claim.machineRegistrationRevision !== evidence.machineRegistrationRevision
    || claim.placementId !== evidence.placementId
    || claim.placementRevision !== evidence.placementRevision
    || claim.candidateAssignmentId !== evidence.candidateAssignmentId
    || claim.fenceId !== evidence.fenceId
    || claim.generation !== evidence.fenceGeneration
  ) {
    throw new DistributedRecoveryRuntimeStartError(
      "distributed fence no longer matches the exact M12Z-D recovery preparation",
      "fence_not_current",
    );
  }
}

export class DistributedRecoveryRuntimeStartCoordinator {
  constructor(private readonly options: DistributedRecoveryRuntimeStartOptions) {}

  async start(
    evidence: DistributedRecoveryReacquisitionPreparationEvidenceV1,
    context: DistributedTargetRuntimeHandoffContext,
  ): Promise<OrchestratorTask> {
    assertPreparation(evidence);
    assertContext(evidence, context);
    assertLeaseIdentity(evidence, context);
    assertFenceIdentity(evidence, context);

    try {
      await context.safetyOptions.lease.validateCurrent();
    } catch (error) {
      throw new DistributedRecoveryRuntimeStartError(
        "local writer lease is not current immediately before M12I recovery start",
        "lease_not_current",
        { cause: error },
      );
    }
    assertLeaseIdentity(evidence, context);

    try {
      await context.safetyOptions.distributedFenceGuard!.validateCurrent();
    } catch (error) {
      throw new DistributedRecoveryRuntimeStartError(
        "distributed fence is not current immediately before M12I recovery start",
        "fence_not_current",
        { cause: error },
      );
    }
    assertFenceIdentity(evidence, context);

    try {
      return await this.options.starter.start(context);
    } catch (error) {
      throw new DistributedRecoveryRuntimeStartError(
        "M12I recovery runtime start failed closed",
        "runtime_start_failed",
        { cause: error },
      );
    }
  }
}
