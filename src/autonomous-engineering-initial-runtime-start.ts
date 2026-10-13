import type {
  AutonomousEngineeringExecutionActivationContext,
} from "./autonomous-engineering-execution-activation.js";
import type {
  ApprovedWriterBindingV1,
  WriterAuthorityRunner,
} from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_initial_runtime_start_bridge" as const,
  initialImplementationOnly: true as const,
  reusesScheduledLeaseAwareRunner: true as const,
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

export interface AutonomousEngineeringInitialRuntimeStartResultV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  loopId: string;
  loopRevision: number;
  preparationId: string;
  intentId: string;
  started: true;
  authority: "autonomous_engineering_initial_runtime_start_bridge";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class AutonomousEngineeringInitialRuntimeStartError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "context_invalid"
      | "repair_not_supported"
      | "runner_binding_stale"
      | "lease_not_current"
      | "runtime_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringInitialRuntimeStartError";
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
    || runtimeInput.grantsTaskAuthority !== false
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
    throw new AutonomousEngineeringInitialRuntimeStartError(
      "M14G activation context is invalid or widened",
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
    throw new AutonomousEngineeringInitialRuntimeStartError(
      "M14G activation evidence no longer matches the live writer lease",
      "context_invalid",
    );
  }
}

function assertRunnerBinding(
  expected: AutonomousEngineeringExecutionActivationContext,
  current: ApprovedWriterBindingV1,
): void {
  if (
    current.taskId !== expected.runtimeInput.taskId
    || current.workspaceId !== expected.runtimeInput.workspaceId
    || current.ownerInstanceId !== expected.lease.ownerInstanceId
  ) {
    throw new AutonomousEngineeringInitialRuntimeStartError(
      "scheduled runner authority binding changed before runtime start",
      "runner_binding_stale",
    );
  }
}

export class AutonomousEngineeringInitialRuntimeStartBridge {
  constructor(private readonly runner: WriterAuthorityRunner) {}

  async start(
    contextInput: AutonomousEngineeringExecutionActivationContext,
  ): Promise<AutonomousEngineeringInitialRuntimeStartResultV1> {
    assertContext(contextInput);
    const context = contextInput;

    if (context.runtimeInput.kind !== "initial_implementation") {
      throw new AutonomousEngineeringInitialRuntimeStartError(
        "M14H supports only initial implementation; bounded repair requires M14I",
        "repair_not_supported",
      );
    }

    let binding: ApprovedWriterBindingV1;
    try {
      binding = await this.runner.revalidateApprovedTask(context.runtimeInput.taskId);
    } catch (error) {
      throw new AutonomousEngineeringInitialRuntimeStartError(
        "scheduled runner could not revalidate the approved task before M14H start",
        "runner_binding_stale",
        { cause: error },
      );
    }
    assertRunnerBinding(context, binding);

    try {
      await context.lease.validateCurrent();
    } catch (error) {
      throw new AutonomousEngineeringInitialRuntimeStartError(
        "local writer lease is no longer current immediately before runtime handoff",
        "lease_not_current",
        { cause: error },
      );
    }
    assertContext(context);

    try {
      await this.runner.runApprovedTask(context.runtimeInput.taskId, context.lease);
    } catch (error) {
      throw new AutonomousEngineeringInitialRuntimeStartError(
        "scheduled lease-aware local runtime failed closed",
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
      started: true,
      authority: "autonomous_engineering_initial_runtime_start_bridge",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
