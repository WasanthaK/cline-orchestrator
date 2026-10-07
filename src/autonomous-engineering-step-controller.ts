import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringCompletionEvidenceService,
  AutonomousEngineeringCompletionEvidenceV1,
} from "./autonomous-engineering-completion-evidence.js";
import type {
  AutonomousEngineeringCompletionReviewProgressionService,
  AutonomousEngineeringCompletionReviewProgressionResultV1,
} from "./autonomous-engineering-completion-review-progression.js";
import type {
  AutonomousEngineeringInitialCycleLaunchService,
  AutonomousEngineeringInitialCycleLaunchResultV1,
} from "./autonomous-engineering-initial-cycle-launch.js";
import type {
  AutonomousEngineeringRepairCycleLaunchService,
  AutonomousEngineeringRepairCycleLaunchResultV1,
} from "./autonomous-engineering-repair-cycle-launch.js";
import type {
  AutonomousEngineeringReviewDecisionService,
  AutonomousEngineeringReviewDecisionV1,
} from "./autonomous-engineering-review-decision.js";
import type {
  AutonomousEngineeringLoopTransitionAdmissionService,
  AutonomousEngineeringLoopTransitionAdmissionV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type {
  AutonomousEngineeringLoopTransitionApplyService,
  AutonomousEngineeringLoopTransitionApplyReceiptV1,
} from "./autonomous-engineering-loop-transition-apply.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_STEP_CONTROLLER_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_step_controller_composition" as const,
  onePhaseStepPerCall: true as const,
  restartSafeAwaitingReview: true as const,
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

export type AutonomousEngineeringStepAction =
  | "initial_launch"
  | "completion_review_progression"
  | "awaiting_review_resume"
  | "repair_launch"
  | "terminal_noop";

export interface AutonomousEngineeringAwaitingReviewResumeResultV1 {
  schemaVersion: 1;
  loopId: string;
  startingRevision: number;
  resultingRevision: number;
  resultingPhase: AutonomousEngineeringLoopStateV1["phase"];
  evidence: AutonomousEngineeringCompletionEvidenceV1;
  reviewDecision: AutonomousEngineeringReviewDecisionV1;
  reviewAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
  reviewApplyReceipt: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  authority: "autonomous_engineering_awaiting_review_resume_composition";
  directLoopMutation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringStepResultV1 {
  schemaVersion: 1;
  loopId: string;
  startingRevision: number;
  startingPhase: AutonomousEngineeringLoopStateV1["phase"];
  action: AutonomousEngineeringStepAction;
  terminal: boolean;
  resultingRevision: number;
  resultingPhase: AutonomousEngineeringLoopStateV1["phase"];
  initialLaunch?: AutonomousEngineeringInitialCycleLaunchResultV1;
  progression?: AutonomousEngineeringCompletionReviewProgressionResultV1;
  reviewResume?: AutonomousEngineeringAwaitingReviewResumeResultV1;
  repairLaunch?: AutonomousEngineeringRepairCycleLaunchResultV1;
  authority: "autonomous_engineering_step_controller_composition";
  acquiresWriterLease: false;
  directLoopMutation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringStepInput {
  lease?: WriterLeaseSession;
  repairProgression?: AutonomousEngineeringCompletionReviewProgressionResultV1;
}

export class AutonomousEngineeringStepControllerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "input_invalid"
      | "lease_required"
      | "repair_provenance_required"
      | "completion_capture_failed"
      | "progression_failed"
      | "review_resume_failed"
      | "launch_failed"
      | "result_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringStepControllerError";
  }
}

type CompletionPort = Pick<AutonomousEngineeringCompletionEvidenceService, "capture">;
type ProgressionPort = Pick<AutonomousEngineeringCompletionReviewProgressionService, "progress">;
type InitialLaunchPort = Pick<AutonomousEngineeringInitialCycleLaunchService, "launch">;
type RepairLaunchPort = Pick<AutonomousEngineeringRepairCycleLaunchService, "launch">;
type ReviewPort = Pick<AutonomousEngineeringReviewDecisionService, "review">;
type AdmissionPort = Pick<AutonomousEngineeringLoopTransitionAdmissionService, "admit">;
type ApplyPort = Pick<AutonomousEngineeringLoopTransitionApplyService, "apply">;

function assertSupervisorBinding(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
): void {
  const binding = loop.authorityBinding;
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
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
  ) {
    throw new AutonomousEngineeringStepControllerError(
      "autonomous step loop no longer matches approved supervisor binding",
      "input_invalid",
    );
  }
}

function reviewEvent(review: AutonomousEngineeringReviewDecisionV1) {
  const decision = review.decision;
  if (decision.kind === "review_pass") {
    return { type: "review_pass" as const, at: decision.createdAt };
  }
  if (decision.kind === "review_repair") {
    return { type: "review_repair" as const, at: decision.createdAt };
  }
  if (decision.kind === "review_escalation" && decision.escalationReason?.trim()) {
    return {
      type: "human_escalation" as const,
      at: decision.createdAt,
      reason: decision.escalationReason,
    };
  }
  throw new AutonomousEngineeringStepControllerError(
    "trusted reviewer decision cannot map to an awaiting-review transition",
    "review_resume_failed",
  );
}

function expectedReviewPhase(review: AutonomousEngineeringReviewDecisionV1) {
  if (review.decision.kind === "review_pass") return "succeeded" as const;
  if (review.decision.kind === "review_repair") return "repair_ready" as const;
  return "waiting_for_human" as const;
}

export class AutonomousEngineeringStepController {
  constructor(
    private readonly completion: CompletionPort,
    private readonly progression: ProgressionPort,
    private readonly initialLaunch: InitialLaunchPort,
    private readonly repairLaunch: RepairLaunchPort,
    private readonly review: ReviewPort,
    private readonly admission: AdmissionPort,
    private readonly apply: ApplyPort,
  ) {}

  async step(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    input: AutonomousEngineeringStepInput = {},
  ): Promise<AutonomousEngineeringStepResultV1> {
    const loop = structuredClone(loopInput);
    assertSupervisorBinding(loop, supervisor);

    if (["succeeded", "failed", "waiting_for_human"].includes(loop.phase)) {
      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        startingPhase: loop.phase,
        action: "terminal_noop",
        terminal: true,
        resultingRevision: loop.revision,
        resultingPhase: loop.phase,
        authority: "autonomous_engineering_step_controller_composition",
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

    if (loop.phase === "ready") {
      if (!input.lease) {
        throw new AutonomousEngineeringStepControllerError(
          "ready phase requires a supplied live scheduler writer lease",
          "lease_required",
        );
      }
      let result: AutonomousEngineeringInitialCycleLaunchResultV1;
      try {
        result = await this.initialLaunch.launch(loop, supervisor, input.lease);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "initial-cycle launch failed closed",
          "launch_failed",
          { cause: error },
        );
      }
      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        startingPhase: loop.phase,
        action: "initial_launch",
        terminal: false,
        resultingRevision: result.executionRevision,
        resultingPhase: "implementation_in_progress",
        initialLaunch: result,
        authority: "autonomous_engineering_step_controller_composition",
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

    if (loop.phase === "implementation_in_progress") {
      let evidence: AutonomousEngineeringCompletionEvidenceV1;
      try {
        evidence = await this.completion.capture(loop);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "current completion evidence could not be captured",
          "completion_capture_failed",
          { cause: error },
        );
      }
      let result: AutonomousEngineeringCompletionReviewProgressionResultV1;
      try {
        result = await this.progression.progress(loop, supervisor, evidence);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "completion/review progression failed closed",
          "progression_failed",
          { cause: error },
        );
      }
      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        startingPhase: loop.phase,
        action: "completion_review_progression",
        terminal: ["succeeded", "failed", "waiting_for_human"].includes(result.resultingPhase),
        resultingRevision: result.resultingRevision,
        resultingPhase: result.resultingPhase,
        progression: result,
        authority: "autonomous_engineering_step_controller_composition",
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

    if (loop.phase === "awaiting_review") {
      let evidence: AutonomousEngineeringCompletionEvidenceV1;
      try {
        evidence = await this.completion.capture(loop);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review completion evidence could not be recaptured",
          "completion_capture_failed",
          { cause: error },
        );
      }
      let reviewDecision: AutonomousEngineeringReviewDecisionV1;
      try {
        reviewDecision = await this.review.review(supervisor, evidence);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review trusted reviewer decision failed",
          "review_resume_failed",
          { cause: error },
        );
      }
      if (
        reviewDecision.loopId !== loop.loopId
        || reviewDecision.loopRevision !== loop.revision
        || reviewDecision.taskId !== supervisor.taskId
        || reviewDecision.observedRunCount !== evidence.observedRunCount
        || reviewDecision.completionCapturedAt !== evidence.packet.capturedAt
      ) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review decision is stale or cross-bound relative to recaptured evidence",
          "review_resume_failed",
        );
      }

      let reviewAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
      try {
        reviewAdmission = await this.admission.admit(
          loop,
          supervisor,
          reviewEvent(reviewDecision),
          {
            completionPacket: evidence.packet,
            decision: reviewDecision.decision,
          },
        );
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review decision transition could not be admitted",
          "review_resume_failed",
          { cause: error },
        );
      }

      let applied;
      try {
        applied = await this.apply.apply(reviewAdmission);
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review decision transition could not be durably applied",
          "review_resume_failed",
          { cause: error },
        );
      }
      const expected = expectedReviewPhase(reviewDecision);
      if (
        applied.state.phase !== expected
        || applied.state.revision !== loop.revision + 1
      ) {
        throw new AutonomousEngineeringStepControllerError(
          "awaiting-review resume produced an unexpected durable loop state",
          "result_invalid",
        );
      }

      const reviewResume: AutonomousEngineeringAwaitingReviewResumeResultV1 = Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        resultingRevision: applied.state.revision,
        resultingPhase: applied.state.phase,
        evidence,
        reviewDecision,
        reviewAdmission,
        reviewApplyReceipt: applied.receipt,
        authority: "autonomous_engineering_awaiting_review_resume_composition",
        directLoopMutation: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      });

      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        startingPhase: loop.phase,
        action: "awaiting_review_resume",
        terminal: ["succeeded", "failed", "waiting_for_human"].includes(applied.state.phase),
        resultingRevision: applied.state.revision,
        resultingPhase: applied.state.phase,
        reviewResume,
        authority: "autonomous_engineering_step_controller_composition",
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

    if (loop.phase === "repair_ready") {
      if (!input.lease) {
        throw new AutonomousEngineeringStepControllerError(
          "repair_ready phase requires a supplied live scheduler writer lease",
          "lease_required",
        );
      }
      if (!input.repairProgression) {
        throw new AutonomousEngineeringStepControllerError(
          "repair_ready phase requires exact prior M14L repair progression evidence",
          "repair_provenance_required",
        );
      }
      let result: AutonomousEngineeringRepairCycleLaunchResultV1;
      try {
        result = await this.repairLaunch.launch(
          loop,
          supervisor,
          input.repairProgression,
          input.lease,
        );
      } catch (error) {
        throw new AutonomousEngineeringStepControllerError(
          "bounded repair-cycle launch failed closed",
          "launch_failed",
          { cause: error },
        );
      }
      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        startingPhase: loop.phase,
        action: "repair_launch",
        terminal: false,
        resultingRevision: result.executionRevision,
        resultingPhase: "implementation_in_progress",
        repairLaunch: result,
        authority: "autonomous_engineering_step_controller_composition",
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

    throw new AutonomousEngineeringStepControllerError(
      `unsupported autonomous loop phase ${loop.phase}`,
      "input_invalid",
    );
  }
}
