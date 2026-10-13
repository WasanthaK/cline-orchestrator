import type { MachineOrchestratorService } from "./machine-orchestrator.js";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";
import {
  getTaskCompletionPacket,
  type TaskCompletionPacketV1,
} from "./task-completion-packet.js";

export const AUTONOMOUS_ENGINEERING_COMPLETION_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_completion_evidence_only" as const,
  requiresCurrentLoopRevision: true as const,
  requiresFreshTaskSafetyBinding: true as const,
  requiresCurrentRunCount: true as const,
  requiresIndependentCheckpoint: true as const,
  requiresIndependentDiffSafety: true as const,
  requiresIndependentValidationForSuccess: true as const,
  invokesReviewer: false as const,
  mutatesLoopState: false as const,
  mutatesTaskState: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface AutonomousEngineeringCompletionEvidenceV1 {
  schemaVersion: 1;
  loopId: string;
  loopRevision: number;
  taskId: string;
  projectId: string;
  workspaceId: string;
  observedRunCount: number;
  packet: TaskCompletionPacketV1;
  authority: "autonomous_engineering_completion_evidence_only";
  invokesReviewer: false;
  mutatesLoopState: false;
  mutatesTaskState: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class AutonomousEngineeringCompletionEvidenceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "loop_invalid"
      | "binding_stale"
      | "packet_invalid"
      | "run_stale"
      | "evidence_incomplete",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringCompletionEvidenceError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertLoop(loop: AutonomousEngineeringLoopStateV1): void {
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.executable !== false
    || !["implementation_in_progress", "awaiting_review"].includes(loop.phase)
    || loop.grantsTaskAuthority !== false
    || loop.grantsFilesystemAuthority !== false
    || loop.grantsSafetyPlanAuthority !== false
    || loop.grantsWriterLeaseAuthority !== false
    || loop.grantsCredentialAuthority !== false
    || loop.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      "completion evidence requires a current implementation_in_progress or awaiting_review autonomous loop",
      "loop_invalid",
    );
  }
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
    || !Number.isSafeInteger(current.runCount)
    || current.runCount < 1
    || current.hasPendingEscalation
  ) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      "current task/Safety binding no longer matches the autonomous loop",
      "binding_stale",
    );
  }
}

function assertPacket(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
  packet: TaskCompletionPacketV1,
): void {
  if (
    packet.schemaVersion !== 1
    || packet.taskId !== loop.authorityBinding.taskId
    || packet.projectId !== loop.authorityBinding.projectId
    || packet.workspaceId !== loop.authorityBinding.workspaceId
    || packet.status !== current.status
    || packet.completionSignal.terminal !== true
    || packet.reviewState !== "ready_for_supervisor_review"
    || !Number.isFinite(Date.parse(packet.capturedAt))
  ) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      "completion packet is stale, cross-bound, non-terminal or not reviewable",
      "packet_invalid",
    );
  }

  if (packet.independentEvidence.recovery.runCount !== current.runCount) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      "completion packet run count is stale relative to current durable task state",
      "run_stale",
    );
  }

  const checkpoint = packet.independentEvidence.checkpoint;
  const diff = packet.independentEvidence.diffSafety;
  if (
    checkpoint.available !== true
    || checkpoint.restored !== false
    || checkpoint.runCount !== current.runCount
    || diff.available !== true
    || diff.passed !== true
  ) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      "completion packet lacks current independent checkpoint/diff-safety evidence",
      "evidence_incomplete",
    );
  }

  if (packet.status === "completed") {
    const validation = packet.independentEvidence.validation;
    if (validation.available !== true || validation.passed !== true) {
      throw new AutonomousEngineeringCompletionEvidenceError(
        "successful completion lacks passing independent validation evidence",
        "evidence_incomplete",
      );
    }
  } else if (!["failed", "validation_failed"].includes(packet.status)) {
    throw new AutonomousEngineeringCompletionEvidenceError(
      `task status ${packet.status} is not admissible as autonomous post-runtime completion evidence`,
      "packet_invalid",
    );
  }
}

export type AutonomousEngineeringCompletionPacketProvider = (
  machine: MachineOrchestratorService,
  taskId: string,
) => Promise<TaskCompletionPacketV1>;

export class AutonomousEngineeringCompletionEvidenceService {
  constructor(
    private readonly machine: MachineOrchestratorService,
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly packetProvider: AutonomousEngineeringCompletionPacketProvider = getTaskCompletionPacket,
  ) {}

  async capture(
    loopInput: AutonomousEngineeringLoopStateV1,
  ): Promise<AutonomousEngineeringCompletionEvidenceV1> {
    const loop = structuredClone(loopInput);
    assertLoop(loop);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(loop.authorityBinding.taskId);
    } catch (error) {
      throw new AutonomousEngineeringCompletionEvidenceError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(loop, current);

    let packet: TaskCompletionPacketV1;
    try {
      packet = await this.packetProvider(this.machine, current.taskId);
    } catch (error) {
      throw new AutonomousEngineeringCompletionEvidenceError(
        "current durable completion packet could not be captured",
        "packet_invalid",
        { cause: error },
      );
    }
    assertPacket(loop, current, packet);

    return Object.freeze({
      schemaVersion: 1,
      loopId: loop.loopId,
      loopRevision: loop.revision,
      taskId: current.taskId,
      projectId: current.projectId,
      workspaceId: current.workspaceId,
      observedRunCount: current.runCount,
      packet: structuredClone(packet),
      authority: "autonomous_engineering_completion_evidence_only",
      invokesReviewer: false,
      mutatesLoopState: false,
      mutatesTaskState: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
