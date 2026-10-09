import type {
  AutonomousEngineeringLoopEventV1,
  AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopTransitionAdmissionService,
  AutonomousEngineeringLoopTransitionAdmissionV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type {
  AutonomousEngineeringLoopTransitionApplyReceiptV1,
  AutonomousEngineeringLoopTransitionApplyService,
} from "./autonomous-engineering-loop-transition-apply.js";
import type {
  AutonomousEngineeringCompletionEvidenceV1,
} from "./autonomous-engineering-completion-evidence.js";
import type {
  AutonomousEngineeringReviewDecisionService,
  AutonomousEngineeringReviewDecisionV1,
} from "./autonomous-engineering-review-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

export const AUTONOMOUS_ENGINEERING_COMPLETION_REVIEW_PROGRESSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_completion_review_progression_composition" as const,
  composesTransitionAdmission: true as const,
  composesDurableTransitionApply: true as const,
  composesTrustedReviewerDecision: true as const,
  directLoopMutation: false as const,
  legacyRepairHandoff: false as const,
  startsWorker: false as const,
  startsCline: false as const,
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

export interface AutonomousEngineeringCompletionReviewProgressionResultV1 {
  schemaVersion: 1;
  loopId: string;
  startingRevision: number;
  resultingRevision: number;
  resultingPhase: AutonomousEngineeringLoopStateV1["phase"];
  completionAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
  completionApplyReceipt: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  reviewDecision?: AutonomousEngineeringReviewDecisionV1;
  reviewAdmission?: AutonomousEngineeringLoopTransitionAdmissionV1;
  reviewApplyReceipt?: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  authority: "autonomous_engineering_completion_review_progression_composition";
  directLoopMutation: false;
  legacyRepairHandoff: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class AutonomousEngineeringCompletionReviewProgressionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "evidence_invalid"
      | "completion_transition_failed"
      | "review_failed"
      | "review_transition_failed"
      | "result_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringCompletionReviewProgressionError";
  }
}

type AdmissionPort = Pick<AutonomousEngineeringLoopTransitionAdmissionService, "admit">;
type ApplyPort = Pick<AutonomousEngineeringLoopTransitionApplyService, "apply">;
type ReviewPort = Pick<AutonomousEngineeringReviewDecisionService, "review">;

function assertInput(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
  evidence: AutonomousEngineeringCompletionEvidenceV1,
): void {
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.phase !== "implementation_in_progress"
    || loop.authorityBinding.supervisorTaskId !== supervisor.supervisorTaskId
    || loop.authorityBinding.taskId !== supervisor.taskId
    || loop.authorityBinding.projectId !== supervisor.authority.projectId
    || loop.authorityBinding.workspaceId !== supervisor.authority.workspaceId
    || evidence.schemaVersion !== 1
    || evidence.authority !== "autonomous_engineering_completion_evidence_only"
    || evidence.loopId !== loop.loopId
    || evidence.loopRevision !== loop.revision
    || evidence.taskId !== supervisor.taskId
    || evidence.projectId !== supervisor.authority.projectId
    || evidence.workspaceId !== supervisor.authority.workspaceId
    || evidence.packet.taskId !== supervisor.taskId
    || evidence.packet.projectId !== supervisor.authority.projectId
    || evidence.packet.workspaceId !== supervisor.authority.workspaceId
    || evidence.packet.independentEvidence.recovery.runCount !== evidence.observedRunCount
  ) {
    throw new AutonomousEngineeringCompletionReviewProgressionError(
      "M14J completion evidence does not match the current autonomous loop/supervisor binding",
      "evidence_invalid",
    );
  }
}

function decisionEvent(
  review: AutonomousEngineeringReviewDecisionV1,
): AutonomousEngineeringLoopEventV1 {
  const decision = review.decision;
  if (decision.kind === "review_pass") {
    return { type: "review_pass", at: decision.createdAt };
  }
  if (decision.kind === "review_repair") {
    return { type: "review_repair", at: decision.createdAt };
  }
  if (decision.kind === "review_escalation" && decision.escalationReason?.trim()) {
    return {
      type: "human_escalation",
      at: decision.createdAt,
      reason: decision.escalationReason,
    };
  }
  throw new AutonomousEngineeringCompletionReviewProgressionError(
    "M14K reviewer decision cannot be mapped to a trusted M14 loop event",
    "review_failed",
  );
}

function expectedPhase(kind: AutonomousEngineeringReviewDecisionV1["decision"]["kind"]) {
  if (kind === "review_pass") return "succeeded" as const;
  if (kind === "review_repair") return "repair_ready" as const;
  return "waiting_for_human" as const;
}

export class AutonomousEngineeringCompletionReviewProgressionService {
  constructor(
    private readonly admission: AdmissionPort,
    private readonly apply: ApplyPort,
    private readonly review: ReviewPort,
  ) {}

  async progress(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    evidenceInput: AutonomousEngineeringCompletionEvidenceV1,
  ): Promise<AutonomousEngineeringCompletionReviewProgressionResultV1> {
    const loop = structuredClone(loopInput);
    const evidence = structuredClone(evidenceInput);
    assertInput(loop, supervisor, evidence);

    if (evidence.packet.status === "failed" || evidence.packet.status === "validation_failed") {
      let completionAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
      try {
        completionAdmission = await this.admission.admit(
          loop,
          supervisor,
          {
            type: "terminal_failure",
            at: evidence.packet.capturedAt,
            reason: `durable_task_${evidence.packet.status}`,
          },
          { completionPacket: evidence.packet },
        );
      } catch (error) {
        throw new AutonomousEngineeringCompletionReviewProgressionError(
          "terminal completion evidence could not be admitted",
          "completion_transition_failed",
          { cause: error },
        );
      }

      let applied;
      try {
        applied = await this.apply.apply(completionAdmission);
      } catch (error) {
        throw new AutonomousEngineeringCompletionReviewProgressionError(
          "terminal completion transition could not be durably applied",
          "completion_transition_failed",
          { cause: error },
        );
      }
      if (applied.state.phase !== "failed" || applied.state.revision !== loop.revision + 1) {
        throw new AutonomousEngineeringCompletionReviewProgressionError(
          "terminal completion transition produced an unexpected durable loop state",
          "result_invalid",
        );
      }

      return Object.freeze({
        schemaVersion: 1,
        loopId: loop.loopId,
        startingRevision: loop.revision,
        resultingRevision: applied.state.revision,
        resultingPhase: applied.state.phase,
        completionAdmission,
        completionApplyReceipt: applied.receipt,
        authority: "autonomous_engineering_completion_review_progression_composition",
        directLoopMutation: false,
        legacyRepairHandoff: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      });
    }

    if (evidence.packet.status !== "completed") {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        `M14L does not support completion packet status ${evidence.packet.status}`,
        "evidence_invalid",
      );
    }

    let completionAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
    try {
      completionAdmission = await this.admission.admit(
        loop,
        supervisor,
        {
          type: "completion_evidence_captured",
          at: evidence.packet.capturedAt,
        },
        { completionPacket: evidence.packet },
      );
    } catch (error) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "successful completion evidence could not be admitted",
        "completion_transition_failed",
        { cause: error },
      );
    }

    let completionApplied;
    try {
      completionApplied = await this.apply.apply(completionAdmission);
    } catch (error) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "successful completion transition could not be durably applied",
        "completion_transition_failed",
        { cause: error },
      );
    }
    const awaitingReview = completionApplied.state;
    if (
      awaitingReview.phase !== "awaiting_review"
      || awaitingReview.revision !== loop.revision + 1
    ) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "completion transition did not produce the expected awaiting_review revision",
        "result_invalid",
      );
    }

    let reviewDecision: AutonomousEngineeringReviewDecisionV1;
    try {
      reviewDecision = await this.review.review(supervisor, evidence);
    } catch (error) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "M14K autonomous reviewer decision failed",
        "review_failed",
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
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "M14K reviewer decision evidence does not match the exact M14J completion evidence",
        "review_failed",
      );
    }

    const event = decisionEvent(reviewDecision);
    let reviewAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
    try {
      reviewAdmission = await this.admission.admit(
        awaitingReview,
        supervisor,
        event,
        {
          completionPacket: evidence.packet,
          decision: reviewDecision.decision,
        },
      );
    } catch (error) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "trusted reviewer decision could not be admitted as the next loop transition",
        "review_transition_failed",
        { cause: error },
      );
    }

    let reviewApplied;
    try {
      reviewApplied = await this.apply.apply(reviewAdmission);
    } catch (error) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "trusted reviewer transition could not be durably applied",
        "review_transition_failed",
        { cause: error },
      );
    }

    const expected = expectedPhase(reviewDecision.decision.kind);
    if (
      reviewApplied.state.phase !== expected
      || reviewApplied.state.revision !== awaitingReview.revision + 1
    ) {
      throw new AutonomousEngineeringCompletionReviewProgressionError(
        "review transition produced an unexpected durable loop state",
        "result_invalid",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      loopId: loop.loopId,
      startingRevision: loop.revision,
      resultingRevision: reviewApplied.state.revision,
      resultingPhase: reviewApplied.state.phase,
      completionAdmission,
      completionApplyReceipt: completionApplied.receipt,
      reviewDecision,
      reviewAdmission,
      reviewApplyReceipt: reviewApplied.receipt,
      authority: "autonomous_engineering_completion_review_progression_composition",
      directLoopMutation: false,
      legacyRepairHandoff: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
