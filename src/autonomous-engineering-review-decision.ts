import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { AutonomousEngineeringCompletionEvidenceV1 } from "./autonomous-engineering-completion-evidence.js";
import {
  runSupervisorCompletionReviewer,
} from "./supervisor-completion-review.js";
import {
  SupervisorDecisionService,
  type SupervisorDecisionV1,
} from "./supervisor-decision.js";
import {
  createSupervisorReviewerEvidence,
  type SupervisorReviewerModel,
  type SupervisorReviewerResultV1,
} from "./supervisor-reviewer.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

export const AUTONOMOUS_ENGINEERING_REVIEW_DECISION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_review_decision_evidence_only" as const,
  requiresExactCompletionEvidence: true as const,
  requiresFreshDurableTaskRun: true as const,
  usesTrustedSupervisorDecisionAdmission: true as const,
  queuesRepair: false as const,
  mutatesLoopState: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface AutonomousEngineeringReviewDecisionV1 {
  schemaVersion: 1;
  loopId: string;
  loopRevision: number;
  taskId: string;
  observedRunCount: number;
  completionCapturedAt: string;
  reviewerResult: SupervisorReviewerResultV1;
  decision: SupervisorDecisionV1;
  authority: "autonomous_engineering_review_decision_evidence_only";
  queuesRepair: false;
  mutatesLoopState: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringReviewTaskSnapshot {
  workspaceRoot: string;
  task: OrchestratorTask;
}

export type AutonomousEngineeringReviewTaskProvider = (
  machine: MachineOrchestratorService,
  supervisor: SupervisorTaskV1,
) => Promise<AutonomousEngineeringReviewTaskSnapshot>;

export type AutonomousEngineeringDecisionApplier = (
  workspaceRoot: string,
  supervisor: SupervisorTaskV1,
  reviewerResult: SupervisorReviewerResultV1,
) => Promise<SupervisorDecisionV1>;

export class AutonomousEngineeringReviewDecisionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "evidence_invalid"
      | "task_stale"
      | "reviewer_failed"
      | "decision_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringReviewDecisionError";
  }
}

function assertEvidence(
  supervisor: SupervisorTaskV1,
  evidence: AutonomousEngineeringCompletionEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "autonomous_engineering_completion_evidence_only"
    || evidence.invokesReviewer !== false
    || evidence.mutatesLoopState !== false
    || evidence.mutatesTaskState !== false
    || evidence.taskId !== supervisor.taskId
    || evidence.projectId !== supervisor.authority.projectId
    || evidence.workspaceId !== supervisor.authority.workspaceId
    || evidence.packet.taskId !== supervisor.taskId
    || evidence.packet.projectId !== supervisor.authority.projectId
    || evidence.packet.workspaceId !== supervisor.authority.workspaceId
    || evidence.packet.capturedAt === ""
    || !Number.isFinite(Date.parse(evidence.packet.capturedAt))
    || evidence.packet.independentEvidence.recovery.runCount !== evidence.observedRunCount
  ) {
    throw new AutonomousEngineeringReviewDecisionError(
      "M14J completion evidence does not match the current supervisor binding",
      "evidence_invalid",
    );
  }
}

async function defaultTaskProvider(
  machine: MachineOrchestratorService,
  supervisor: SupervisorTaskV1,
): Promise<AutonomousEngineeringReviewTaskSnapshot> {
  const publicTask = await machine.getTask(supervisor.taskId);
  if (
    publicTask.taskId !== supervisor.taskId
    || publicTask.projectId !== supervisor.authority.projectId
    || publicTask.workspaceId !== supervisor.authority.workspaceId
  ) {
    throw new AutonomousEngineeringReviewDecisionError(
      "current machine task no longer matches supervisor binding",
      "task_stale",
    );
  }
  const workspace = await machine.registry.resolveVerifiedWorkspace(publicTask.workspaceId);
  const task = await new TaskStore(workspace.canonicalRoot).load(publicTask.taskId);
  return { workspaceRoot: workspace.canonicalRoot, task };
}

async function defaultDecisionApplier(
  workspaceRoot: string,
  supervisor: SupervisorTaskV1,
  reviewerResult: SupervisorReviewerResultV1,
): Promise<SupervisorDecisionV1> {
  return await new SupervisorDecisionService(workspaceRoot).applyReviewerResult(
    supervisor,
    reviewerResult,
  );
}

export class AutonomousEngineeringReviewDecisionService {
  constructor(
    private readonly machine: MachineOrchestratorService,
    private readonly model: SupervisorReviewerModel,
    private readonly taskProvider: AutonomousEngineeringReviewTaskProvider = defaultTaskProvider,
    private readonly decisionApplier: AutonomousEngineeringDecisionApplier = defaultDecisionApplier,
  ) {}

  async review(
    supervisor: SupervisorTaskV1,
    evidenceInput: AutonomousEngineeringCompletionEvidenceV1,
  ): Promise<AutonomousEngineeringReviewDecisionV1> {
    const evidence = structuredClone(evidenceInput);
    assertEvidence(supervisor, evidence);

    let snapshot: AutonomousEngineeringReviewTaskSnapshot;
    try {
      snapshot = await this.taskProvider(this.machine, supervisor);
    } catch (error) {
      if (error instanceof AutonomousEngineeringReviewDecisionError) throw error;
      throw new AutonomousEngineeringReviewDecisionError(
        "current durable task could not be reloaded for autonomous review",
        "task_stale",
        { cause: error },
      );
    }

    const task = snapshot.task;
    if (
      task.id !== supervisor.taskId
      || task.status !== evidence.packet.status
      || (task.runCount ?? 0) !== evidence.observedRunCount
      || task.pendingEscalation?.status === "pending"
    ) {
      throw new AutonomousEngineeringReviewDecisionError(
        "durable task changed after M14J completion evidence was captured",
        "task_stale",
      );
    }

    const reviewerEvidence = createSupervisorReviewerEvidence(supervisor, task);
    let reviewerResult: SupervisorReviewerResultV1;
    try {
      reviewerResult = await runSupervisorCompletionReviewer(
        reviewerEvidence,
        evidence.packet,
        this.model,
      );
    } catch (error) {
      throw new AutonomousEngineeringReviewDecisionError(
        "autonomous supervisor reviewer failed",
        "reviewer_failed",
        { cause: error },
      );
    }

    let decision: SupervisorDecisionV1;
    try {
      decision = await this.decisionApplier(
        snapshot.workspaceRoot,
        supervisor,
        reviewerResult,
      );
    } catch (error) {
      throw new AutonomousEngineeringReviewDecisionError(
        "trusted supervisor reviewer decision admission failed",
        "decision_failed",
        { cause: error },
      );
    }

    if (
      decision.supervisorTaskId !== supervisor.supervisorTaskId
      || decision.taskId !== supervisor.taskId
      || decision.provenance !== "reviewer"
      || !["review_pass", "review_repair", "review_escalation"].includes(decision.kind)
    ) {
      throw new AutonomousEngineeringReviewDecisionError(
        "admitted supervisor decision is cross-bound or not reviewer-derived",
        "decision_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      loopId: evidence.loopId,
      loopRevision: evidence.loopRevision,
      taskId: supervisor.taskId,
      observedRunCount: evidence.observedRunCount,
      completionCapturedAt: evidence.packet.capturedAt,
      reviewerResult: structuredClone(reviewerResult),
      decision: structuredClone(decision),
      authority: "autonomous_engineering_review_decision_evidence_only",
      queuesRepair: false,
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
