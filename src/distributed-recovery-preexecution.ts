import {
  durableSafetyBindingFromTask,
} from "./hub-safety-runtime.js";
import type {
  DistributedTargetTaskLoader,
} from "./distributed-target-runtime-handoff.js";
import type {
  DistributedRecoveryProposalV1,
} from "./distributed-recovery-proposal.js";
import type { OrchestratorTask } from "./types.js";

export const DISTRIBUTED_RECOVERY_PREEXECUTION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresCurrentTargetLocalTask: true as const,
  requiresCurrentWorkspaceSafetyBinding: true as const,
  requiresFreshCreatedTask: true as const,
  requiresNoRuntimeHistory: true as const,
  requiresNoPendingEscalation: true as const,
  acquiresCandidate: false as const,
  acquiresDistributedFence: false as const,
  acquiresLocalWriterLease: false as const,
  createsDispatch: false as const,
  invokesAdmission: false as const,
  invokesTargetHandoff: false as const,
  invokesRuntime: false as const,
  startsCline: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DistributedRecoveryPreexecutionEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  deliveryId: string;
  taskId: string;
  workspaceId: string;
  projectId: string;
  safetyPlanId: string;
  workspaceRegistryRevision: number;
  safetyProfileId: string;
  safetyProfileRevision: number;
  policyVersion: string;
  workerProfileId: string;
  verifiedAt: string;
  requiresFreshControllerSelection: true;
  requiresFreshCandidateAssignment: true;
  requiresFreshDistributedFence: true;
  requiresFreshLocalWriterLease: true;
  requiresFreshDispatch: true;
  requiresFreshAdmission: true;
  requiresTargetLocalAuthorityReentry: true;
  authority: "recovery_preexecution_evidence_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DistributedRecoveryPreexecutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "proposal_invalid"
      | "task_not_current"
      | "task_not_fresh"
      | "clock_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedRecoveryPreexecutionError";
  }
}

export interface DistributedRecoveryPreexecutionOptions {
  tasks: DistributedTargetTaskLoader;
  now?: () => Date;
}

function currentTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DistributedRecoveryPreexecutionError(
      "distributed recovery pre-execution clock is invalid",
      "clock_invalid",
    );
  }
  return value;
}

function assertProposal(proposal: DistributedRecoveryProposalV1): void {
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "recovery_proposal_evidence_only"
    || proposal.sourceDisposition !== "fresh_authority_review_required"
    || proposal.automaticTakeoverAllowed !== false
    || proposal.automaticWorkRetryAllowed !== false
    || proposal.automaticWorkRequeueAllowed !== false
    || proposal.requiresFreshControllerSelection !== true
    || proposal.requiresFreshCandidateAssignment !== true
    || proposal.requiresFreshDistributedFence !== true
    || proposal.requiresFreshLocalWriterLease !== true
    || proposal.requiresFreshDispatch !== true
    || proposal.requiresFreshAdmission !== true
    || proposal.requiresTargetLocalAuthorityReentry !== true
    || proposal.grantsTaskAuthority !== false
    || proposal.grantsFilesystemAuthority !== false
    || proposal.grantsSafetyPlanAuthority !== false
    || proposal.grantsWriterLeaseAuthority !== false
    || proposal.grantsCredentialAuthority !== false
    || proposal.grantsReleaseAuthority !== false
  ) {
    throw new DistributedRecoveryPreexecutionError(
      "distributed recovery proposal is not eligible for trusted pre-execution review",
      "proposal_invalid",
    );
  }
}

function assertFreshTask(task: OrchestratorTask): void {
  if (
    task.status !== "created"
    || Boolean(task.clineSessionId)
    || (task.sessionGeneration ?? 0) !== 0
    || (task.runCount ?? 0) !== 0
    || Boolean(task.pendingEscalation)
  ) {
    throw new DistributedRecoveryPreexecutionError(
      "distributed recovery requires a fresh created target-local task with no runtime/session/escalation history",
      "task_not_fresh",
    );
  }
}

export class DistributedRecoveryPreexecutionCoordinator {
  constructor(private readonly options: DistributedRecoveryPreexecutionOptions) {}

  async verify(
    proposal: DistributedRecoveryProposalV1,
  ): Promise<DistributedRecoveryPreexecutionEvidenceV1> {
    assertProposal(proposal);

    let task: OrchestratorTask;
    try {
      task = await this.options.tasks.loadCurrent(proposal.taskId, proposal.workspaceId);
    } catch (error) {
      throw new DistributedRecoveryPreexecutionError(
        "current target-local task/workspace/Safety binding could not be loaded",
        "task_not_current",
        { cause: error },
      );
    }

    if (
      task.id !== proposal.taskId
      || task.workspaceId !== proposal.workspaceId
    ) {
      throw new DistributedRecoveryPreexecutionError(
        "loaded target-local task does not match the recovery proposal binding",
        "task_not_current",
      );
    }

    assertFreshTask(task);

    let binding;
    try {
      binding = durableSafetyBindingFromTask(task);
    } catch (error) {
      throw new DistributedRecoveryPreexecutionError(
        "target-local task lacks a complete current Safety binding",
        "task_not_current",
        { cause: error },
      );
    }

    if (binding.workspaceId !== proposal.workspaceId) {
      throw new DistributedRecoveryPreexecutionError(
        "target-local Safety binding does not match the recovery proposal workspace",
        "task_not_current",
      );
    }

    const verifiedAt = currentTime(this.options.now).toISOString();
    return Object.freeze({
      schemaVersion: 1,
      proposalId: proposal.proposalId,
      deliveryId: proposal.deliveryId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      projectId: binding.projectId,
      safetyPlanId: binding.safetyPlanId,
      workspaceRegistryRevision: binding.workspaceRegistryRevision,
      safetyProfileId: binding.safetyProfileId,
      safetyProfileRevision: binding.safetyProfileRevision,
      policyVersion: binding.policyVersion,
      workerProfileId: binding.workerProfileId,
      verifiedAt,
      requiresFreshControllerSelection: true,
      requiresFreshCandidateAssignment: true,
      requiresFreshDistributedFence: true,
      requiresFreshLocalWriterLease: true,
      requiresFreshDispatch: true,
      requiresFreshAdmission: true,
      requiresTargetLocalAuthorityReentry: true,
      authority: "recovery_preexecution_evidence_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
