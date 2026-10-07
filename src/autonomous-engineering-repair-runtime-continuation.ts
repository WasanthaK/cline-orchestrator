import type {
  AutonomousEngineeringExecutionActivationContext,
} from "./autonomous-engineering-execution-activation.js";
import type {
  ApprovedWriterBindingV1,
  WriterLeaseSession,
} from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_repair_runtime_continuation_bridge" as const,
  boundedRepairOnly: true as const,
  requiresExactReviewerInstruction: true as const,
  reusesLeaseAwareScheduledRunner: true as const,
  requiresFreshRunnerAuthorityBinding: true as const,
  requiresFreshWriterLease: true as const,
  acquiresWriterLease: false as const,
  createsDistributedDispatch: false as const,
  performsGitDelivery: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface AutonomousEngineeringRepairRunner {
  revalidateApprovedRepair(
    taskId: string,
    instruction: string,
  ): Promise<ApprovedWriterBindingV1>;
  runApprovedRepair(
    taskId: string,
    instruction: string,
    lease: WriterLeaseSession,
  ): Promise<void>;
}

export interface AutonomousEngineeringRepairRuntimeContinuationResultV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  loopId: string;
  loopRevision: number;
  preparationId: string;
  intentId: string;
  reviewerDecisionId: string;
  continued: true;
  authority: "autonomous_engineering_repair_runtime_continuation_bridge";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class AutonomousEngineeringRepairRuntimeContinuationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "context_invalid"
      | "initial_not_supported"
      | "repair_provenance_invalid"
      | "runner_binding_stale"
      | "lease_not_current"
      | "runtime_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringRepairRuntimeContinuationError";
  }
}

function assertContext(context: AutonomousEngineeringExecutionActivationContext): void {
  const { evidence, runtimeInput, lease } = context;
  if (
    runtimeInput.schemaVersion !== 1
    || runtimeInput.authority !== "autonomous_engineering_runtime_input_only"
    || runtimeInput.runtimeStartAuthorized !== false
    || evidence.schemaVersion !== 1
    || evidence.authority !== "autonomous_engineering_execution_activation_evidence_only"
    || evidence.runtimeStartAuthorized !== false
    || runtimeInput.preparationId !== evidence.preparationId
    || runtimeInput.intentId !== evidence.intentId
    || runtimeInput.loopId !== evidence.loopId
    || runtimeInput.loopRevision !== evidence.loopRevision
    || runtimeInput.taskId !== evidence.taskId
    || runtimeInput.workspaceId !== evidence.workspaceId
    || lease.taskId !== runtimeInput.taskId
    || lease.workspaceId !== runtimeInput.workspaceId
    || evidence.ownerInstanceId !== lease.ownerInstanceId
  ) {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "M14G activation context is invalid or cross-bound",
      "context_invalid",
    );
  }

  const claim = lease.currentClaim();
  if (
    claim.authority !== "coordination_only"
    || claim.taskId !== evidence.taskId
    || claim.workspaceId !== evidence.workspaceId
    || claim.leaseId !== evidence.leaseId
    || claim.fenceToken !== evidence.fenceToken
    || claim.ownerInstanceId !== evidence.ownerInstanceId
  ) {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "M14G activation evidence no longer matches the live writer lease",
      "context_invalid",
    );
  }

  if (
    runtimeInput.grantsTaskAuthority !== false
    || runtimeInput.grantsFilesystemAuthority !== false
    || runtimeInput.grantsSafetyPlanAuthority !== false
    || runtimeInput.grantsWriterLeaseAuthority !== false
    || runtimeInput.grantsCredentialAuthority !== false
    || runtimeInput.grantsReleaseAuthority !== false
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "repair activation context contains widened authority",
      "context_invalid",
    );
  }
}

function assertRepairProvenance(context: AutonomousEngineeringExecutionActivationContext): {
  instruction: string;
  reviewerDecisionId: string;
} {
  if (context.runtimeInput.kind !== "bounded_repair") {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "M14I supports only bounded repair continuation",
      "initial_not_supported",
    );
  }
  const instruction = context.runtimeInput.repairInstruction?.trim();
  const reviewerDecisionId = context.runtimeInput.reviewerDecisionId?.trim();
  if (!instruction || !reviewerDecisionId) {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "bounded repair activation is missing trusted reviewer provenance",
      "repair_provenance_invalid",
    );
  }
  return { instruction, reviewerDecisionId };
}

function assertRunnerBinding(
  context: AutonomousEngineeringExecutionActivationContext,
  current: ApprovedWriterBindingV1,
): void {
  if (
    current.taskId !== context.runtimeInput.taskId
    || current.workspaceId !== context.runtimeInput.workspaceId
    || current.ownerInstanceId !== context.lease.ownerInstanceId
  ) {
    throw new AutonomousEngineeringRepairRuntimeContinuationError(
      "scheduled repair runner authority binding changed before continuation",
      "runner_binding_stale",
    );
  }
}

export class AutonomousEngineeringRepairRuntimeContinuationBridge {
  constructor(private readonly runner: AutonomousEngineeringRepairRunner) {}

  async continue(
    contextInput: AutonomousEngineeringExecutionActivationContext,
  ): Promise<AutonomousEngineeringRepairRuntimeContinuationResultV1> {
    assertContext(contextInput);
    const context = contextInput;
    const { instruction, reviewerDecisionId } = assertRepairProvenance(context);

    let binding: ApprovedWriterBindingV1;
    try {
      binding = await this.runner.revalidateApprovedRepair(
        context.runtimeInput.taskId,
        instruction,
      );
    } catch (error) {
      throw new AutonomousEngineeringRepairRuntimeContinuationError(
        "scheduled repair runner could not revalidate current task authority",
        "runner_binding_stale",
        { cause: error },
      );
    }
    assertRunnerBinding(context, binding);

    try {
      await context.lease.validateCurrent();
    } catch (error) {
      throw new AutonomousEngineeringRepairRuntimeContinuationError(
        "local writer lease is no longer current immediately before repair handoff",
        "lease_not_current",
        { cause: error },
      );
    }
    assertContext(context);

    try {
      await this.runner.runApprovedRepair(
        context.runtimeInput.taskId,
        instruction,
        context.lease,
      );
    } catch (error) {
      throw new AutonomousEngineeringRepairRuntimeContinuationError(
        "scheduled lease-aware bounded repair failed closed",
        "runtime_failed",
        { cause: error },
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      taskId: context.runtimeInput.taskId,
      workspaceId: context.runtimeInput.workspaceId,
      loopId: context.runtimeInput.loopId,
      loopRevision: context.runtimeInput.loopRevision,
      preparationId: context.runtimeInput.preparationId,
      intentId: context.runtimeInput.intentId,
      reviewerDecisionId,
      continued: true,
      authority: "autonomous_engineering_repair_runtime_continuation_bridge",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
