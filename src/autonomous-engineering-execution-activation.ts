import {
  FileAutonomousEngineeringLoopStore,
} from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";
import type {
  AutonomousEngineeringExecutionPreparationV1,
} from "./autonomous-engineering-execution-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_execution_activation_evidence_only" as const,
  requiresExactLoopRevision: true as const,
  requiresFreshTaskSafetyBinding: true as const,
  requiresFreshSchedulerOwnedLease: true as const,
  acquiresWriterLease: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
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

export interface AutonomousEngineeringRuntimeInputV1 {
  schemaVersion: 1;
  preparationId: string;
  intentId: string;
  loopId: string;
  loopRevision: number;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  kind: AutonomousEngineeringExecutionPreparationV1["kind"];
  objective: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  repairInstruction?: string;
  reviewerDecisionId?: string;
  authority: "autonomous_engineering_runtime_input_only";
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionActivationEvidenceV1 {
  schemaVersion: 1;
  preparationId: string;
  intentId: string;
  loopId: string;
  loopRevision: number;
  taskId: string;
  workspaceId: string;
  leaseId: string;
  fenceToken: string;
  ownerInstanceId: string;
  activatedAt: string;
  authority: "autonomous_engineering_execution_activation_evidence_only";
  runtimeStartAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionActivationContext {
  evidence: AutonomousEngineeringExecutionActivationEvidenceV1;
  runtimeInput: AutonomousEngineeringRuntimeInputV1;
  lease: WriterLeaseSession;
}

export interface AutonomousEngineeringExecutionActivationOptions {
  now?: () => Date;
}

export class AutonomousEngineeringExecutionActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "preparation_invalid"
      | "loop_stale"
      | "binding_stale"
      | "lease_invalid"
      | "lease_identity_changed"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringExecutionActivationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertPreparation(value: AutonomousEngineeringExecutionPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "autonomous_engineering_execution_preparation_only"
    || value.executable !== false
    || value.requiresFreshTaskSafetyBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.mutatesTaskState !== false
    || value.mutatesLoopState !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionActivationError(
      "durable execution preparation is invalid or widened",
      "preparation_invalid",
    );
  }
}

function assertCurrent(
  preparation: AutonomousEngineeringExecutionPreparationV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_autonomous_loop_task_binding"
    || current.taskId !== preparation.taskId
    || current.projectId !== preparation.projectId
    || current.workspaceId !== preparation.workspaceId
    || current.workspaceRegistryRevision !== preparation.workspaceRegistryRevision
    || current.safetyPlanId !== preparation.safetyPlanId
    || current.safetyPolicyVersion !== preparation.safetyPolicyVersion
    || current.safetyProfileId !== preparation.safetyProfileId
    || current.safetyProfileRevision !== preparation.safetyProfileRevision
    || current.workerProfileId !== preparation.workerProfileId
    || !sameStrings(current.allowedPathPatterns, preparation.allowedPathPatterns)
    || !sameStrings(current.protectedPathPatterns, preparation.protectedPathPatterns)
    || current.hasPendingEscalation
    || ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
  ) {
    throw new AutonomousEngineeringExecutionActivationError(
      "current task/Safety binding no longer matches durable execution preparation",
      "binding_stale",
    );
  }
}

type BoundLeaseIdentity = {
  leaseId: string;
  fenceToken: string;
  taskId: string;
  workspaceId: string;
  ownerInstanceId: string;
};

function currentLeaseIdentity(
  preparation: AutonomousEngineeringExecutionPreparationV1,
  lease: WriterLeaseSession,
): BoundLeaseIdentity {
  if (
    lease.signal.aborted
    || lease.taskId !== preparation.taskId
    || lease.workspaceId !== preparation.workspaceId
  ) {
    throw new AutonomousEngineeringExecutionActivationError(
      "fresh local writer lease is not bound to exact task/workspace",
      "lease_invalid",
    );
  }

  const claim = lease.currentClaim();
  if (
    claim.authority !== "coordination_only"
    || claim.taskId !== preparation.taskId
    || claim.workspaceId !== preparation.workspaceId
    || claim.ownerInstanceId !== lease.ownerInstanceId
  ) {
    throw new AutonomousEngineeringExecutionActivationError(
      "fresh local writer lease claim does not match task/workspace/owner binding",
      "lease_invalid",
    );
  }
  return {
    leaseId: claim.leaseId,
    fenceToken: claim.fenceToken,
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    ownerInstanceId: claim.ownerInstanceId,
  };
}

function sameLeaseIdentity(
  expected: BoundLeaseIdentity,
  lease: WriterLeaseSession,
): boolean {
  const claim = lease.currentClaim();
  return !lease.signal.aborted
    && claim.authority === "coordination_only"
    && claim.leaseId === expected.leaseId
    && claim.fenceToken === expected.fenceToken
    && claim.taskId === expected.taskId
    && claim.workspaceId === expected.workspaceId
    && claim.ownerInstanceId === expected.ownerInstanceId
    && lease.ownerInstanceId === expected.ownerInstanceId;
}

export class AutonomousEngineeringExecutionActivationCoordinator {
  private readonly loops: FileAutonomousEngineeringLoopStore;

  constructor(
    stateRoot: string,
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly options: AutonomousEngineeringExecutionActivationOptions = {},
  ) {
    this.loops = new FileAutonomousEngineeringLoopStore(stateRoot);
  }

  async activate(
    preparationInput: AutonomousEngineeringExecutionPreparationV1,
    lease: WriterLeaseSession,
  ): Promise<AutonomousEngineeringExecutionActivationContext> {
    assertPreparation(preparationInput);
    const preparation = structuredClone(preparationInput);

    const loop = await this.loops.load(preparation.loopId);
    if (
      loop.loopId !== preparation.loopId
      || loop.revision !== preparation.loopRevision
      || loop.phase !== "implementation_in_progress"
      || loop.authorityBinding.taskId !== preparation.taskId
      || loop.authorityBinding.workspaceId !== preparation.workspaceId
      || loop.authorityBinding.safetyPlanId !== preparation.safetyPlanId
    ) {
      throw new AutonomousEngineeringExecutionActivationError(
        "durable autonomous loop no longer matches execution preparation",
        "loop_stale",
      );
    }

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(preparation.taskId);
    } catch (error) {
      throw new AutonomousEngineeringExecutionActivationError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(preparation, current);

    const boundLease = currentLeaseIdentity(preparation, lease);
    try {
      await lease.validateCurrent();
    } catch (error) {
      throw new AutonomousEngineeringExecutionActivationError(
        "fresh local writer lease is no longer current",
        "lease_invalid",
        { cause: error },
      );
    }
    if (!sameLeaseIdentity(boundLease, lease)) {
      throw new AutonomousEngineeringExecutionActivationError(
        "local writer lease identity changed during autonomous activation",
        "lease_identity_changed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringExecutionActivationError(
        "execution activation clock is invalid",
        "clock_invalid",
      );
    }

    const runtimeInput: AutonomousEngineeringRuntimeInputV1 = Object.freeze({
      schemaVersion: 1,
      preparationId: preparation.preparationId,
      intentId: preparation.intentId,
      loopId: preparation.loopId,
      loopRevision: preparation.loopRevision,
      taskId: preparation.taskId,
      projectId: preparation.projectId,
      workspaceId: preparation.workspaceId,
      workspaceRegistryRevision: preparation.workspaceRegistryRevision,
      safetyPlanId: preparation.safetyPlanId,
      safetyPolicyVersion: preparation.safetyPolicyVersion,
      safetyProfileId: preparation.safetyProfileId,
      safetyProfileRevision: preparation.safetyProfileRevision,
      workerProfileId: preparation.workerProfileId,
      allowedPathPatterns: [...preparation.allowedPathPatterns],
      protectedPathPatterns: [...preparation.protectedPathPatterns],
      kind: preparation.kind,
      objective: preparation.objective,
      acceptanceCriteria: [...preparation.acceptanceCriteria],
      trustedValidationCommands: [...preparation.trustedValidationCommands],
      ...(preparation.repairInstruction !== undefined
        ? { repairInstruction: preparation.repairInstruction }
        : {}),
      ...(preparation.reviewerDecisionId !== undefined
        ? { reviewerDecisionId: preparation.reviewerDecisionId }
        : {}),
      authority: "autonomous_engineering_runtime_input_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });

    const evidence: AutonomousEngineeringExecutionActivationEvidenceV1 = Object.freeze({
      schemaVersion: 1,
      preparationId: preparation.preparationId,
      intentId: preparation.intentId,
      loopId: preparation.loopId,
      loopRevision: preparation.loopRevision,
      taskId: preparation.taskId,
      workspaceId: preparation.workspaceId,
      leaseId: boundLease.leaseId,
      fenceToken: boundLease.fenceToken,
      ownerInstanceId: boundLease.ownerInstanceId,
      activatedAt: now.toISOString(),
      authority: "autonomous_engineering_execution_activation_evidence_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });

    return { evidence, runtimeInput, lease };
  }
}
