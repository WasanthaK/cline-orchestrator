import path from "node:path";
import {
  assertDistributedWriterCandidateAssignment,
  type DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  DistributedExecutionAdmissionGateway,
  assertDistributedExecutionDispatch,
  type DistributedExecutionAdmissionReceiptV1,
  type DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import {
  assertDistributedFenceClaim,
  type DistributedFenceClaimV1,
  type DistributedFenceAuthority,
} from "./distributed-fencing.js";
import { createDistributedWriterFenceGuard } from "./distributed-write-fence-guard.js";
import { durableSafetyBindingFromTask } from "./hub-safety-runtime.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type LeaseAwareHubSafetyOptions,
  type LeaseAwareWriterAuthorityProvider,
  type LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const DISTRIBUTED_TARGET_RUNTIME_HANDOFF_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresM12GAdmission: true as const,
  taskLoadedFromTargetLocalStore: true as const,
  dispatchMaySupplyPromptOrCommand: false as const,
  requiresFreshTargetTask: true as const,
  requiresCurrentTargetRegistryBinding: true as const,
  requiresCurrentTaskSafetyAuthority: true as const,
  requiresCurrentLocalWriterLease: true as const,
  requiresCurrentDistributedFence: true as const,
  producesLocalOnlyRuntimeContext: true as const,
  networkListenerIncluded: false as const,
  commandDeliveryEnabled: false as const,
  clineExecutionEnabled: false as const,
  distributedWriteExecutionEnabled: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedTargetTaskLoader {
  loadCurrent(taskId: string, workspaceId: string): Promise<OrchestratorTask>;
}

export interface DistributedTargetRuntimeHandoffEvidenceV1 {
  schemaVersion: 1;
  dispatchId: string;
  taskId: string;
  workspaceId: string;
  machineId: string;
  fenceGeneration: number;
  admittedAt: string;
  preparedAt: string;
  authority: "local_runtime_handoff_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

/**
 * Process-local only. This object is deliberately not a transport payload. The task
 * was loaded from the target machine's own durable store, and the safety options
 * contain live process objects (lease/provider/fence guard) that future runtime
 * wiring must pass into LeaseAwareHubRuntimeFactory. M12H itself never starts Cline.
 */
export interface DistributedTargetRuntimeHandoffContext {
  evidence: DistributedTargetRuntimeHandoffEvidenceV1;
  task: OrchestratorTask;
  safetyOptions: LeaseAwareHubSafetyOptions;
}

export interface DistributedTargetRuntimeHandoffOptions {
  admission: DistributedExecutionAdmissionGateway;
  tasks: DistributedTargetTaskLoader;
  authorityProvider: LeaseAwareWriterAuthorityProvider;
  lease: WriterLeaseSession;
  fenceAuthority: DistributedFenceAuthority;
  now?: () => Date;
}

export class DistributedTargetRuntimeHandoffError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "handoff_invalid"
      | "task_not_current"
      | "authority_not_current"
      | "lease_not_current"
      | "admission_failed"
      | "fence_not_current",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedTargetRuntimeHandoffError";
  }
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameAuthority(
  left: LeaseAwareWriterAuthorityV1,
  right: LeaseAwareWriterAuthorityV1,
): boolean {
  return left.schemaVersion === 1
    && right.schemaVersion === 1
    && left.taskId === right.taskId
    && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId
    && left.workspaceRegistryRevision === right.workspaceRegistryRevision
    && left.safetyPlanId === right.safetyPlanId
    && left.policyVersion === right.policyVersion
    && left.safetyProfileId === right.safetyProfileId
    && left.safetyProfileRevision === right.safetyProfileRevision
    && left.workerProfileId === right.workerProfileId
    && left.ownerInstanceId === right.ownerInstanceId
    && sameStrings(left.allowedPathPatterns, right.allowedPathPatterns)
    && sameStrings(left.protectedPathPatterns, right.protectedPathPatterns);
}

function sameLeaseIdentity(
  lease: WriterLeaseSession,
  claim: WorkspaceWriterClaimV1,
  taskId: string,
  workspaceId: string,
): boolean {
  return !lease.signal.aborted
    && lease.taskId === taskId
    && lease.workspaceId === workspaceId
    && claim.authority === "coordination_only"
    && claim.taskId === taskId
    && claim.workspaceId === workspaceId
    && claim.ownerInstanceId === lease.ownerInstanceId;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!Number.isFinite(value.getTime())) {
    throw new DistributedTargetRuntimeHandoffError(
      "target runtime handoff clock is invalid",
      "handoff_invalid",
    );
  }
  return value;
}

function assertFreshTargetTask(task: OrchestratorTask): void {
  if (
    task.status !== "created"
    || Boolean(task.clineSessionId)
    || (task.sessionGeneration ?? 0) > 0
    || (task.runCount ?? 0) > 0
    || Boolean(task.pendingEscalation)
  ) {
    throw new DistributedTargetRuntimeHandoffError(
      `distributed target handoff requires a fresh created task with no prior runtime or escalation state; task ${task.id} is ${task.status}`,
      "task_not_current",
    );
  }
}

function assertReceiptMatches(
  receipt: DistributedExecutionAdmissionReceiptV1,
  dispatch: DistributedExecutionDispatchV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "admission_evidence_only"
    || receipt.dispatchId !== dispatch.dispatchId
    || receipt.taskId !== dispatch.taskId
    || receipt.workspaceId !== dispatch.workspaceId
    || receipt.machineId !== dispatch.machineId
    || receipt.fenceGeneration !== dispatch.fenceGeneration
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new DistributedTargetRuntimeHandoffError(
      "M12G admission receipt does not match the requested target handoff",
      "admission_failed",
    );
  }
}

/**
 * Production local task resolver for M12H. Remote/distributed evidence contributes
 * only opaque IDs. The filesystem root is resolved exclusively from the target's
 * current WorkspaceRegistry, then the task is loaded from that workspace's local
 * TaskStore and checked against the current registry/profile revision.
 *
 * Safety Plans may deliberately narrow allowedPathPatterns below the workspace
 * profile; that narrower task scope remains authoritative. Protected paths and
 * validation commands, however, must still match the current profile exactly.
 */
export class RegisteredWorkspaceTargetTaskLoader implements DistributedTargetTaskLoader {
  constructor(private readonly registry: WorkspaceRegistry) {}

  async loadCurrent(taskId: string, workspaceId: string): Promise<OrchestratorTask> {
    let workspace;
    try {
      workspace = await this.registry.resolveVerifiedWorkspace(workspaceId);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "target workspace is not currently registered and verified",
        "task_not_current",
        { cause: error },
      );
    }

    let task: OrchestratorTask;
    try {
      task = await new TaskStore(workspace.canonicalRoot).load(taskId);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "approved task does not exist in the target workspace's local store",
        "task_not_current",
        { cause: error },
      );
    }

    let binding;
    try {
      binding = durableSafetyBindingFromTask(task);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "target-local task lacks a complete durable safety binding",
        "task_not_current",
        { cause: error },
      );
    }

    if (
      task.id !== taskId
      || binding.workspaceId !== workspace.workspaceId
      || binding.projectId !== workspace.projectId
      || binding.workspaceRegistryRevision !== workspace.revision
      || binding.safetyProfileId !== workspace.safetyProfile.profileId
      || binding.safetyProfileRevision !== workspace.safetyProfile.revision
      || binding.policyVersion !== workspace.safetyProfile.policyVersion
      || binding.workerProfileId !== workspace.safetyProfile.workerProfileId
      || !sameStrings(binding.protectedPathPatterns, workspace.safetyProfile.protectedPathPatterns)
      || !sameStrings(task.validationCommands, workspace.safetyProfile.validationCommands)
      || normalizePath(task.workspace) !== normalizePath(workspace.canonicalRoot)
    ) {
      throw new DistributedTargetRuntimeHandoffError(
        "target-local task no longer matches the current registered workspace authority",
        "task_not_current",
      );
    }

    return structuredClone(task);
  }
}

export class DistributedTargetRuntimeHandoffCoordinator {
  constructor(private readonly options: DistributedTargetRuntimeHandoffOptions) {}

  private async revalidateLocalAuthority(
    task: OrchestratorTask,
    dispatch: DistributedExecutionDispatchV1,
  ): Promise<LeaseAwareWriterAuthorityV1> {
    let expected: LeaseAwareWriterAuthorityV1;
    try {
      expected = leaseAwareWriterAuthorityFromTask(task, this.options.lease.ownerInstanceId);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "target-local task cannot produce the required lease-aware authority binding",
        "task_not_current",
        { cause: error },
      );
    }
    if (expected.taskId !== dispatch.taskId || expected.workspaceId !== dispatch.workspaceId) {
      throw new DistributedTargetRuntimeHandoffError(
        "target-local task binding does not match the admitted task/workspace",
        "task_not_current",
      );
    }

    let current: LeaseAwareWriterAuthorityV1;
    try {
      current = await this.options.authorityProvider.revalidateCurrent(dispatch.taskId);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "current target task/Safety/registry authority could not be revalidated",
        "authority_not_current",
        { cause: error },
      );
    }
    if (!sameAuthority(expected, current)) {
      throw new DistributedTargetRuntimeHandoffError(
        "current target task/Safety/registry authority changed before runtime handoff",
        "authority_not_current",
      );
    }
    return current;
  }

  private async revalidateLease(taskId: string, workspaceId: string): Promise<void> {
    const before = this.options.lease.currentClaim();
    if (!sameLeaseIdentity(this.options.lease, before, taskId, workspaceId)) {
      throw new DistributedTargetRuntimeHandoffError(
        "local fenced writer lease does not match the admitted task/workspace",
        "lease_not_current",
      );
    }
    try {
      await this.options.lease.validateCurrent();
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "local fenced writer lease is no longer current",
        "lease_not_current",
        { cause: error },
      );
    }
    const after = this.options.lease.currentClaim();
    if (
      !sameLeaseIdentity(this.options.lease, after, taskId, workspaceId)
      || before.leaseId !== after.leaseId
      || before.fenceToken !== after.fenceToken
    ) {
      throw new DistributedTargetRuntimeHandoffError(
        "local fenced writer lease identity changed during handoff validation",
        "lease_not_current",
      );
    }
  }

  async prepare(
    dispatchInput: DistributedExecutionDispatchV1,
    assignmentInput: DistributedWriterCandidateAssignmentV1,
    fenceInput: DistributedFenceClaimV1,
  ): Promise<DistributedTargetRuntimeHandoffContext> {
    try {
      assertDistributedExecutionDispatch(dispatchInput);
      assertDistributedWriterCandidateAssignment(assignmentInput);
      assertDistributedFenceClaim(fenceInput);
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "target runtime handoff evidence is invalid",
        "handoff_invalid",
        { cause: error },
      );
    }

    const dispatch = structuredClone(dispatchInput);
    const assignment = structuredClone(assignmentInput);
    const fence = structuredClone(fenceInput);

    let task: OrchestratorTask;
    try {
      task = await this.options.tasks.loadCurrent(dispatch.taskId, dispatch.workspaceId);
    } catch (error) {
      if (error instanceof DistributedTargetRuntimeHandoffError) throw error;
      throw new DistributedTargetRuntimeHandoffError(
        "target-local approved task could not be loaded",
        "task_not_current",
        { cause: error },
      );
    }
    assertFreshTargetTask(task);

    await this.revalidateLocalAuthority(task, dispatch);
    await this.revalidateLease(dispatch.taskId, dispatch.workspaceId);

    let receipt: DistributedExecutionAdmissionReceiptV1;
    try {
      receipt = await this.options.admission.admit(dispatch, assignment, fence);
      assertReceiptMatches(receipt, dispatch);
    } catch (error) {
      if (error instanceof DistributedTargetRuntimeHandoffError) throw error;
      throw new DistributedTargetRuntimeHandoffError(
        "M12G target execution admission failed",
        "admission_failed",
        { cause: error },
      );
    }

    const distributedFenceGuard = createDistributedWriterFenceGuard(
      this.options.fenceAuthority,
      fence,
      assignment,
    );
    try {
      await distributedFenceGuard.validateCurrent();
    } catch (error) {
      throw new DistributedTargetRuntimeHandoffError(
        "shared distributed fence changed after admission",
        "fence_not_current",
        { cause: error },
      );
    }

    // Close authority/lease TOCTOU around admission. No runtime is started by M12H;
    // every future write is still required to repeat these checks in M12F.
    assertFreshTargetTask(task);
    await this.revalidateLocalAuthority(task, dispatch);
    await this.revalidateLease(dispatch.taskId, dispatch.workspaceId);

    const preparedAt = currentTime(this.options.now).toISOString();
    return {
      evidence: Object.freeze({
        schemaVersion: 1,
        dispatchId: receipt.dispatchId,
        taskId: receipt.taskId,
        workspaceId: receipt.workspaceId,
        machineId: receipt.machineId,
        fenceGeneration: receipt.fenceGeneration,
        admittedAt: receipt.admittedAt,
        preparedAt,
        authority: "local_runtime_handoff_evidence_only",
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      }),
      task,
      safetyOptions: {
        lease: this.options.lease,
        authorityProvider: this.options.authorityProvider,
        distributedFenceGuard,
      },
    };
  }
}
