import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopTransitionAdmissionService,
  AutonomousEngineeringLoopTransitionAdmissionV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type {
  AutonomousEngineeringLoopTransitionApplyReceiptV1,
  AutonomousEngineeringLoopTransitionApplyService,
} from "./autonomous-engineering-loop-transition-apply.js";
import type {
  AutonomousEngineeringCompletionReviewProgressionResultV1,
} from "./autonomous-engineering-completion-review-progression.js";
import type {
  AutonomousEngineeringExecutionIntentService,
  AutonomousEngineeringExecutionIntentV1,
} from "./autonomous-engineering-execution-intent.js";
import type {
  AutonomousEngineeringExecutionAdmissionReceiptV1,
  AutonomousEngineeringExecutionAdmissionService,
} from "./autonomous-engineering-execution-admission.js";
import type {
  AutonomousEngineeringExecutionPreparationService,
  AutonomousEngineeringExecutionPreparationV1,
} from "./autonomous-engineering-execution-preparation.js";
import type {
  AutonomousEngineeringExecutionActivationContext,
  AutonomousEngineeringExecutionActivationCoordinator,
} from "./autonomous-engineering-execution-activation.js";
import type {
  AutonomousEngineeringRepairRuntimeContinuationBridge,
  AutonomousEngineeringRepairRuntimeContinuationResultV1,
} from "./autonomous-engineering-repair-runtime-continuation.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_REPAIR_CYCLE_LAUNCH_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_repair_cycle_launch_composition" as const,
  exactReviewedRepairOnly: true as const,
  composesTransitionAdmission: true as const,
  composesDurableTransitionApply: true as const,
  composesExecutionIntent: true as const,
  composesOneShotExecutionAdmission: true as const,
  composesDurablePreparation: true as const,
  composesLeaseBoundActivation: true as const,
  composesRepairRuntimeContinuation: true as const,
  acquiresWriterLease: false as const,
  directLoopMutation: false as const,
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

export interface AutonomousEngineeringRepairCycleLaunchResultV1 {
  schemaVersion: 1;
  loopId: string;
  startingRevision: number;
  executionRevision: number;
  repairDecisionId: string;
  repairStartAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
  repairStartApplyReceipt: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  intent: AutonomousEngineeringExecutionIntentV1;
  executionAdmissionReceipt: AutonomousEngineeringExecutionAdmissionReceiptV1;
  preparation: AutonomousEngineeringExecutionPreparationV1;
  activation: AutonomousEngineeringExecutionActivationContext["evidence"];
  runtimeResult: AutonomousEngineeringRepairRuntimeContinuationResultV1;
  authority: "autonomous_engineering_repair_cycle_launch_composition";
  acquiresWriterLease: false;
  directLoopMutation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringRepairCycleLaunchOptions {
  now?: () => Date;
}

export class AutonomousEngineeringRepairCycleLaunchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "input_invalid"
      | "repair_start_failed"
      | "intent_failed"
      | "execution_admission_failed"
      | "preparation_failed"
      | "activation_failed"
      | "runtime_failed"
      | "result_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringRepairCycleLaunchError";
  }
}

type TransitionAdmissionPort = Pick<AutonomousEngineeringLoopTransitionAdmissionService, "admit">;
type TransitionApplyPort = Pick<AutonomousEngineeringLoopTransitionApplyService, "apply">;
type IntentPort = Pick<AutonomousEngineeringExecutionIntentService, "create">;
type ExecutionAdmissionPort = Pick<AutonomousEngineeringExecutionAdmissionService, "issue" | "consume">;
type PreparationPort = Pick<AutonomousEngineeringExecutionPreparationService, "prepare">;
type ActivationPort = Pick<AutonomousEngineeringExecutionActivationCoordinator, "activate">;
type RepairRuntimePort = Pick<AutonomousEngineeringRepairRuntimeContinuationBridge, "continue">;

function assertInput(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
  progression: AutonomousEngineeringCompletionReviewProgressionResultV1,
): void {
  const review = progression.reviewDecision;
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.phase !== "repair_ready"
    || loop.authorityBinding.supervisorTaskId !== supervisor.supervisorTaskId
    || loop.authorityBinding.taskId !== supervisor.taskId
    || progression.schemaVersion !== 1
    || progression.authority !== "autonomous_engineering_completion_review_progression_composition"
    || progression.loopId !== loop.loopId
    || progression.resultingRevision !== loop.revision
    || progression.resultingPhase !== "repair_ready"
    || !review
    || !progression.reviewAdmission
    || !progression.reviewApplyReceipt
    || review.loopId !== loop.loopId
    || review.taskId !== supervisor.taskId
    || review.decision.kind !== "review_repair"
    || review.decision.provenance !== "reviewer"
    || !review.decision.repairInstruction?.trim()
    || progression.reviewAdmission.event.type !== "review_repair"
    || progression.reviewAdmission.decisionId !== review.decision.decisionId
    || progression.reviewApplyReceipt.admissionId !== progression.reviewAdmission.admissionId
    || progression.reviewApplyReceipt.resultingRevision !== loop.revision
    || progression.reviewApplyReceipt.priorRevision !== loop.revision - 1
    || progression.directLoopMutation !== false
    || progression.legacyRepairHandoff !== false
  ) {
    throw new AutonomousEngineeringRepairCycleLaunchError(
      "M14M requires the exact current repair_ready loop produced by the exact M14L review_repair progression",
      "input_invalid",
    );
  }
}

export class AutonomousEngineeringRepairCycleLaunchService {
  constructor(
    private readonly transitionAdmission: TransitionAdmissionPort,
    private readonly transitionApply: TransitionApplyPort,
    private readonly intentService: IntentPort,
    private readonly executionAdmission: ExecutionAdmissionPort,
    private readonly preparationService: PreparationPort,
    private readonly activationCoordinator: ActivationPort,
    private readonly repairRuntime: RepairRuntimePort,
    private readonly options: AutonomousEngineeringRepairCycleLaunchOptions = {},
  ) {}

  async launch(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    progressionInput: AutonomousEngineeringCompletionReviewProgressionResultV1,
    lease: WriterLeaseSession,
  ): Promise<AutonomousEngineeringRepairCycleLaunchResultV1> {
    const loop = structuredClone(loopInput);
    const progression = structuredClone(progressionInput);
    assertInput(loop, supervisor, progression);
    const repairDecision = progression.reviewDecision!.decision;

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "M14M repair launch clock is invalid",
        "input_invalid",
      );
    }

    let repairStartAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
    try {
      repairStartAdmission = await this.transitionAdmission.admit(
        loop,
        supervisor,
        { type: "repair_started", at: now.toISOString() },
        { decision: repairDecision },
      );
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "reviewed bounded repair could not be admitted",
        "repair_start_failed",
        { cause: error },
      );
    }

    let applied;
    try {
      applied = await this.transitionApply.apply(repairStartAdmission);
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "reviewed bounded repair start could not be durably applied",
        "repair_start_failed",
        { cause: error },
      );
    }
    if (
      applied.state.phase !== "implementation_in_progress"
      || applied.state.revision !== loop.revision + 1
      || repairStartAdmission.decisionId !== repairDecision.decisionId
    ) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "repair-start transition did not preserve exact reviewer provenance/current revision",
        "result_invalid",
      );
    }

    let intent: AutonomousEngineeringExecutionIntentV1;
    try {
      intent = await this.intentService.create(
        applied.state,
        supervisor,
        repairStartAdmission,
        applied.receipt,
        repairDecision,
      );
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair execution intent could not be derived",
        "intent_failed",
        { cause: error },
      );
    }
    if (
      intent.kind !== "bounded_repair"
      || intent.reviewerDecisionId !== repairDecision.decisionId
      || intent.repairInstruction !== repairDecision.repairInstruction
      || intent.loopRevision !== applied.state.revision
    ) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair intent widened or lost trusted reviewer provenance",
        "result_invalid",
      );
    }

    let ticket;
    let executionAdmissionReceipt: AutonomousEngineeringExecutionAdmissionReceiptV1;
    try {
      ticket = await this.executionAdmission.issue(intent);
      executionAdmissionReceipt = await this.executionAdmission.consume(ticket.token, intent);
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair one-shot execution admission failed",
        "execution_admission_failed",
        { cause: error },
      );
    }

    let preparation: AutonomousEngineeringExecutionPreparationV1;
    try {
      preparation = await this.preparationService.prepare(intent, executionAdmissionReceipt);
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair durable execution preparation failed",
        "preparation_failed",
        { cause: error },
      );
    }
    if (
      preparation.kind !== "bounded_repair"
      || preparation.reviewerDecisionId !== repairDecision.decisionId
      || preparation.repairInstruction !== repairDecision.repairInstruction
    ) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "durable repair preparation lost trusted reviewer provenance",
        "result_invalid",
      );
    }

    let activation: AutonomousEngineeringExecutionActivationContext;
    try {
      activation = await this.activationCoordinator.activate(preparation, lease);
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair activation failed",
        "activation_failed",
        { cause: error },
      );
    }
    if (
      activation.runtimeInput.kind !== "bounded_repair"
      || activation.runtimeInput.reviewerDecisionId !== repairDecision.decisionId
      || activation.runtimeInput.repairInstruction !== repairDecision.repairInstruction
      || activation.runtimeInput.loopRevision !== applied.state.revision
      || activation.lease !== lease
    ) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "repair activation lost exact loop/reviewer/lease binding",
        "result_invalid",
      );
    }

    let runtimeResult: AutonomousEngineeringRepairRuntimeContinuationResultV1;
    try {
      runtimeResult = await this.repairRuntime.continue(activation);
    } catch (error) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "bounded repair runtime continuation failed closed",
        "runtime_failed",
        { cause: error },
      );
    }
    if (
      runtimeResult.continued !== true
      || runtimeResult.reviewerDecisionId !== repairDecision.decisionId
      || runtimeResult.loopRevision !== applied.state.revision
    ) {
      throw new AutonomousEngineeringRepairCycleLaunchError(
        "repair runtime result does not match the admitted repair iteration",
        "result_invalid",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      loopId: loop.loopId,
      startingRevision: loop.revision,
      executionRevision: applied.state.revision,
      repairDecisionId: repairDecision.decisionId,
      repairStartAdmission,
      repairStartApplyReceipt: applied.receipt,
      intent,
      executionAdmissionReceipt,
      preparation,
      activation: activation.evidence,
      runtimeResult,
      authority: "autonomous_engineering_repair_cycle_launch_composition",
      acquiresWriterLease: false,
      directLoopMutation: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
