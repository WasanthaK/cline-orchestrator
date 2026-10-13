import crypto from "node:crypto";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringLoopTransitionAdmissionV1 } from "./autonomous-engineering-loop-transition-admission.js";
import type { AutonomousEngineeringLoopTransitionApplyReceiptV1 } from "./autonomous-engineering-loop-transition-apply.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";
import type { SupervisorDecisionV1 } from "./supervisor-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_execution_intent_only" as const,
  evidenceOnly: true as const,
  requiresAppliedLoopTransition: true as const,
  requiresFreshTaskSafetyBinding: true as const,
  initialImplementationUsesApprovedSupervisorObjective: true as const,
  repairUsesTrustedReviewerDecisionOnly: true as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  mutatesTaskState: false as const,
  mutatesLoopState: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
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

export type AutonomousEngineeringExecutionIntentKind =
  | "initial_implementation"
  | "bounded_repair";

export interface AutonomousEngineeringExecutionIntentV1 {
  schemaVersion: 1;
  intentId: string;
  createdAt: string;
  loopId: string;
  loopRevision: number;
  appliedAdmissionId: string;
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
  kind: AutonomousEngineeringExecutionIntentKind;
  objective: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  repairInstruction?: string;
  reviewerDecisionId?: string;
  authority: "autonomous_engineering_execution_intent_only";
  executable: false;
  mutatesTaskState: false;
  mutatesLoopState: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionIntentOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class AutonomousEngineeringExecutionIntentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "loop_invalid"
      | "transition_invalid"
      | "receipt_invalid"
      | "binding_stale"
      | "decision_invalid"
      | "intent_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringExecutionIntentError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertLoopSupervisorBinding(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
): void {
  const binding = loop.authorityBinding;
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.phase !== "implementation_in_progress"
    || loop.executable !== false
    || binding.supervisorTaskId !== supervisor.supervisorTaskId
    || binding.taskId !== supervisor.taskId
    || binding.projectId !== supervisor.authority.projectId
    || binding.workspaceId !== supervisor.authority.workspaceId
    || binding.workspaceRegistryRevision !== supervisor.authority.workspaceRegistryRevision
    || binding.safetyPlanId !== supervisor.authority.safetyPlanId
    || binding.safetyPolicyVersion !== supervisor.authority.safetyPolicyVersion
    || binding.safetyProfileId !== supervisor.authority.safetyProfileId
    || binding.safetyProfileRevision !== supervisor.authority.safetyProfileRevision
    || binding.workerProfileId !== supervisor.authority.workerProfileId
    || !sameStrings(binding.allowedPathPatterns, supervisor.authority.allowedPathPatterns)
    || !sameStrings(binding.protectedPathPatterns, supervisor.authority.protectedPathPatterns)
  ) {
    throw new AutonomousEngineeringExecutionIntentError(
      "durable loop is not a current implementation phase bound to the approved supervisor task",
      "loop_invalid",
    );
  }
}

function assertAppliedTransition(
  loop: AutonomousEngineeringLoopStateV1,
  admission: AutonomousEngineeringLoopTransitionAdmissionV1,
  receipt: AutonomousEngineeringLoopTransitionApplyReceiptV1,
): AutonomousEngineeringExecutionIntentKind {
  if (
    admission.schemaVersion !== 1
    || admission.authority !== "autonomous_loop_transition_admission_only"
    || admission.loopId !== loop.loopId
    || !["implementation_started", "repair_started"].includes(admission.event.type)
    || receipt.schemaVersion !== 1
    || receipt.authority !== "autonomous_loop_transition_apply_state_only"
    || receipt.admissionId !== admission.admissionId
    || receipt.loopId !== loop.loopId
    || receipt.priorRevision !== admission.expectedLoopRevision
    || receipt.resultingRevision !== loop.revision
    || receipt.resultingRevision !== receipt.priorRevision + 1
    || receipt.mutatesTaskState !== false
    || receipt.startsWorker !== false
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionIntentError(
      "execution intent requires the exact applied implementation/repair transition evidence",
      "transition_invalid",
    );
  }
  return admission.event.type === "implementation_started"
    ? "initial_implementation"
    : "bounded_repair";
}

function assertCurrent(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
): void {
  const binding = loop.authorityBinding;
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_autonomous_loop_task_binding"
    || current.taskId !== binding.taskId
    || current.projectId !== binding.projectId
    || current.workspaceId !== binding.workspaceId
    || current.workspaceRegistryRevision !== binding.workspaceRegistryRevision
    || current.safetyPlanId !== binding.safetyPlanId
    || current.safetyPolicyVersion !== binding.safetyPolicyVersion
    || current.safetyProfileId !== binding.safetyProfileId
    || current.safetyProfileRevision !== binding.safetyProfileRevision
    || current.workerProfileId !== binding.workerProfileId
    || !sameStrings(current.allowedPathPatterns, binding.allowedPathPatterns)
    || !sameStrings(current.protectedPathPatterns, binding.protectedPathPatterns)
    || current.hasPendingEscalation
    || ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
  ) {
    throw new AutonomousEngineeringExecutionIntentError(
      "current task/Safety binding no longer permits autonomous execution intent",
      "binding_stale",
    );
  }
}

function assertRepairDecision(
  loop: AutonomousEngineeringLoopStateV1,
  admission: AutonomousEngineeringLoopTransitionAdmissionV1,
  decision: SupervisorDecisionV1 | undefined,
): SupervisorDecisionV1 {
  if (
    !decision
    || decision.schemaVersion !== 1
    || decision.kind !== "review_repair"
    || decision.provenance !== "reviewer"
    || !UUID.test(decision.decisionId)
    || admission.decisionId !== decision.decisionId
    || decision.supervisorTaskId !== loop.authorityBinding.supervisorTaskId
    || decision.taskId !== loop.authorityBinding.taskId
    || decision.safetyPlanId !== loop.authorityBinding.safetyPlanId
    || decision.safetyProfileId !== loop.authorityBinding.safetyProfileId
    || decision.safetyProfileRevision !== loop.authorityBinding.safetyProfileRevision
    || decision.workspaceRegistryRevision !== loop.authorityBinding.workspaceRegistryRevision
    || !decision.repairInstruction?.trim()
  ) {
    throw new AutonomousEngineeringExecutionIntentError(
      "bounded repair intent requires the exact trusted reviewer repair decision",
      "decision_invalid",
    );
  }
  return decision;
}

export class AutonomousEngineeringExecutionIntentService {
  constructor(
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly options: AutonomousEngineeringExecutionIntentOptions = {},
  ) {}

  async create(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    admissionInput: AutonomousEngineeringLoopTransitionAdmissionV1,
    receiptInput: AutonomousEngineeringLoopTransitionApplyReceiptV1,
    repairDecision?: SupervisorDecisionV1,
  ): Promise<AutonomousEngineeringExecutionIntentV1> {
    const loop = structuredClone(loopInput);
    const admission = structuredClone(admissionInput);
    const receipt = structuredClone(receiptInput);

    assertLoopSupervisorBinding(loop, supervisor);
    const kind = assertAppliedTransition(loop, admission, receipt);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(loop.authorityBinding.taskId);
    } catch (error) {
      throw new AutonomousEngineeringExecutionIntentError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(loop, current);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringExecutionIntentError(
        "execution intent clock is invalid",
        "intent_invalid",
      );
    }
    const intentId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(intentId)) {
      throw new AutonomousEngineeringExecutionIntentError(
        "intentId must be an opaque UUID",
        "intent_invalid",
      );
    }

    const decision = kind === "bounded_repair"
      ? assertRepairDecision(loop, admission, repairDecision)
      : undefined;
    if (kind === "initial_implementation" && repairDecision !== undefined) {
      throw new AutonomousEngineeringExecutionIntentError(
        "initial implementation intent must not consume repair decision evidence",
        "decision_invalid",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      intentId,
      createdAt: now.toISOString(),
      loopId: loop.loopId,
      loopRevision: loop.revision,
      appliedAdmissionId: admission.admissionId,
      taskId: supervisor.taskId,
      projectId: supervisor.authority.projectId,
      workspaceId: supervisor.authority.workspaceId,
      workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
      safetyPlanId: supervisor.authority.safetyPlanId,
      safetyPolicyVersion: supervisor.authority.safetyPolicyVersion,
      safetyProfileId: supervisor.authority.safetyProfileId,
      safetyProfileRevision: supervisor.authority.safetyProfileRevision,
      workerProfileId: supervisor.authority.workerProfileId,
      allowedPathPatterns: [...supervisor.authority.allowedPathPatterns],
      protectedPathPatterns: [...supervisor.authority.protectedPathPatterns],
      kind,
      objective: supervisor.objective,
      acceptanceCriteria: [...supervisor.acceptanceCriteria],
      trustedValidationCommands: [...supervisor.trustedValidationCommands],
      ...(decision
        ? {
            repairInstruction: decision.repairInstruction!,
            reviewerDecisionId: decision.decisionId,
          }
        : {}),
      authority: "autonomous_engineering_execution_intent_only",
      executable: false,
      mutatesTaskState: false,
      mutatesLoopState: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
