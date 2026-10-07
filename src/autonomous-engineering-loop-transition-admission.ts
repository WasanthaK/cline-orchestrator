import crypto from "node:crypto";
import type {
  AutonomousEngineeringLoopEventV1,
  AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import type { SupervisorDecisionV1 } from "./supervisor-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { TaskStatus } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TTL_MS = 60_000;

export const AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_loop_transition_admission_only" as const,
  shortLived: true as const,
  evidenceOnly: true as const,
  mutatesLoopState: false as const,
  mutatesTaskState: false as const,
  requiresCurrentTaskSafetyBinding: true as const,
  requiresIndependentCompletionEvidence: true as const,
  reviewerOutputAdvisoryUntilTrustedDecision: true as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
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

export interface AutonomousEngineeringLoopCurrentTaskBindingV1 {
  schemaVersion: 1;
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
  status: TaskStatus;
  runCount: number;
  hasPendingEscalation: boolean;
  authority: "current_autonomous_loop_task_binding";
}

export interface AutonomousEngineeringLoopTaskBindingProvider {
  revalidateCurrent(taskId: string): Promise<AutonomousEngineeringLoopCurrentTaskBindingV1>;
}

export interface AutonomousEngineeringLoopTransitionEvidenceV1 {
  completionPacket?: TaskCompletionPacketV1;
  decision?: SupervisorDecisionV1;
}

export interface AutonomousEngineeringLoopTransitionAdmissionV1 {
  schemaVersion: 1;
  admissionId: string;
  admittedAt: string;
  expiresAt: string;
  loopId: string;
  expectedLoopRevision: number;
  event: AutonomousEngineeringLoopEventV1;
  taskId: string;
  observedTaskStatus: TaskStatus;
  observedRunCount: number;
  completionCapturedAt?: string;
  decisionId?: string;
  authority: "autonomous_loop_transition_admission_only";
  executable: false;
  mutatesLoopState: false;
  mutatesTaskState: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringLoopTransitionAdmissionOptions {
  now?: () => Date;
  idFactory?: () => string;
  ttlMs?: number;
}

export class AutonomousEngineeringLoopTransitionAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "loop_invalid"
      | "binding_stale"
      | "transition_not_admissible"
      | "completion_evidence_invalid"
      | "decision_invalid"
      | "admission_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringLoopTransitionAdmissionError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validDate(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function boundedTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      `admission ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
      "admission_invalid",
    );
  }
  return ttl;
}

function assertLoopBinding(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
): void {
  const binding = loop.authorityBinding;
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.executable !== false
    || !UUID.test(loop.loopId)
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
    || loop.grantsTaskAuthority !== false
    || loop.grantsFilesystemAuthority !== false
    || loop.grantsSafetyPlanAuthority !== false
    || loop.grantsWriterLeaseAuthority !== false
    || loop.grantsCredentialAuthority !== false
    || loop.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "autonomous loop no longer matches the approved supervisor task binding",
      "loop_invalid",
    );
  }
}

function assertCurrentBinding(
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
    || current.runCount < 0
  ) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "current task/Safety binding no longer matches the autonomous loop",
      "binding_stale",
    );
  }
}

function assertCompletionPacket(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
  packet: TaskCompletionPacketV1 | undefined,
  requireSuccessfulEvidence: boolean,
): TaskCompletionPacketV1 {
  if (
    !packet
    || packet.schemaVersion !== 1
    || packet.taskId !== loop.authorityBinding.taskId
    || packet.projectId !== loop.authorityBinding.projectId
    || packet.workspaceId !== loop.authorityBinding.workspaceId
    || packet.status !== current.status
    || packet.completionSignal.terminal !== true
    || packet.reviewState !== "ready_for_supervisor_review"
    || !validDate(packet.capturedAt)
    || packet.independentEvidence.recovery.runCount !== current.runCount
    || packet.independentEvidence.checkpoint.available !== true
    || packet.independentEvidence.diffSafety.available !== true
    || packet.independentEvidence.diffSafety.passed !== true
  ) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "completion packet is missing, stale, cross-bound or lacks required independent evidence",
      "completion_evidence_invalid",
    );
  }
  if (
    requireSuccessfulEvidence
    && (
      packet.status !== "completed"
      || packet.independentEvidence.validation.available !== true
      || packet.independentEvidence.validation.passed !== true
    )
  ) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "successful completion transition requires passing independent validation",
      "completion_evidence_invalid",
    );
  }
  return packet;
}

function assertDecision(
  loop: AutonomousEngineeringLoopStateV1,
  packet: TaskCompletionPacketV1,
  decision: SupervisorDecisionV1 | undefined,
  expectedKind: "review_pass" | "review_repair" | "review_escalation",
): SupervisorDecisionV1 {
  if (
    !decision
    || decision.schemaVersion !== 1
    || !UUID.test(decision.decisionId)
    || decision.supervisorTaskId !== loop.authorityBinding.supervisorTaskId
    || decision.taskId !== loop.authorityBinding.taskId
    || decision.safetyPlanId !== loop.authorityBinding.safetyPlanId
    || decision.safetyProfileId !== loop.authorityBinding.safetyProfileId
    || decision.safetyProfileRevision !== loop.authorityBinding.safetyProfileRevision
    || decision.workspaceRegistryRevision !== loop.authorityBinding.workspaceRegistryRevision
    || decision.kind !== expectedKind
    || decision.provenance !== "reviewer"
    || !validDate(decision.createdAt)
    || Date.parse(decision.createdAt) < Date.parse(packet.capturedAt)
  ) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "trusted supervisor decision is missing, stale, cross-bound or of the wrong kind",
      "decision_invalid",
    );
  }
  if (expectedKind === "review_repair" && !decision.repairInstruction?.trim()) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "repair decision is missing its bounded repair instruction",
      "decision_invalid",
    );
  }
  if (expectedKind === "review_escalation" && !decision.escalationReason?.trim()) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "escalation decision is missing its reason",
      "decision_invalid",
    );
  }
  return decision;
}

function assertEventAdmissible(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
  event: AutonomousEngineeringLoopEventV1,
  evidence: AutonomousEngineeringLoopTransitionEvidenceV1,
): { completionCapturedAt?: string; decisionId?: string } {
  if (["succeeded", "failed", "waiting_for_human"].includes(loop.phase)) {
    throw new AutonomousEngineeringLoopTransitionAdmissionError(
      "terminal autonomous loop state cannot admit another transition",
      "transition_not_admissible",
    );
  }

  if (event.type === "implementation_started") {
    if (loop.phase !== "ready" || current.hasPendingEscalation) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "implementation start is not admissible from the current loop/task state",
        "transition_not_admissible",
      );
    }
    if (!["created", "waiting", "running", "validating"].includes(current.status)) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "current task state cannot support implementation start admission",
        "transition_not_admissible",
      );
    }
    if (evidence.completionPacket || evidence.decision) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "implementation start admission must not consume completion/review evidence",
        "transition_not_admissible",
      );
    }
    return {};
  }

  if (event.type === "repair_started") {
    if (loop.phase !== "repair_ready" || current.hasPendingEscalation) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "repair start is not admissible from the current loop/task state",
        "transition_not_admissible",
      );
    }
    if (!["completed", "waiting", "repairing", "running", "validating"].includes(current.status)) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "current task state cannot support repair start admission",
        "transition_not_admissible",
      );
    }
    if (evidence.completionPacket || evidence.decision) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "repair start admission must not consume stale completion/review evidence",
        "transition_not_admissible",
      );
    }
    return {};
  }

  if (event.type === "completion_evidence_captured") {
    if (loop.phase !== "implementation_in_progress" || current.hasPendingEscalation) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "completion evidence is not admissible from the current loop/task state",
        "transition_not_admissible",
      );
    }
    const packet = assertCompletionPacket(loop, current, evidence.completionPacket, true);
    if (evidence.decision) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "completion evidence admission must precede reviewer-decision admission",
        "transition_not_admissible",
      );
    }
    return { completionCapturedAt: packet.capturedAt };
  }

  if (event.type === "review_pass" || event.type === "review_repair") {
    if (loop.phase !== "awaiting_review" || current.hasPendingEscalation) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "review decision is not admissible from the current loop/task state",
        "transition_not_admissible",
      );
    }
    const packet = assertCompletionPacket(loop, current, evidence.completionPacket, true);
    const decision = assertDecision(
      loop,
      packet,
      evidence.decision,
      event.type === "review_pass" ? "review_pass" : "review_repair",
    );
    return { completionCapturedAt: packet.capturedAt, decisionId: decision.decisionId };
  }

  if (event.type === "human_escalation") {
    if (loop.phase !== "awaiting_review") {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "review escalation is not admissible from the current loop phase",
        "transition_not_admissible",
      );
    }
    const packet = assertCompletionPacket(loop, current, evidence.completionPacket, false);
    const decision = assertDecision(loop, packet, evidence.decision, "review_escalation");
    if (event.reason.trim() !== decision.escalationReason!.trim()) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "loop escalation reason does not match the trusted supervisor decision",
        "decision_invalid",
      );
    }
    return { completionCapturedAt: packet.capturedAt, decisionId: decision.decisionId };
  }

  if (event.type === "terminal_failure") {
    if (loop.phase !== "implementation_in_progress") {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "terminal failure is not admissible from the current loop phase",
        "transition_not_admissible",
      );
    }
    const packet = assertCompletionPacket(loop, current, evidence.completionPacket, false);
    if (!["failed", "validation_failed"].includes(packet.status)) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "terminal failure admission requires failed or validation_failed task evidence",
        "completion_evidence_invalid",
      );
    }
    if (evidence.decision) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "terminal failure admission does not consume reviewer decisions",
        "transition_not_admissible",
      );
    }
    return { completionCapturedAt: packet.capturedAt };
  }

  throw new AutonomousEngineeringLoopTransitionAdmissionError(
    "unsupported autonomous loop transition event",
    "transition_not_admissible",
  );
}

export class AutonomousEngineeringLoopTransitionAdmissionService {
  constructor(
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly options: AutonomousEngineeringLoopTransitionAdmissionOptions = {},
  ) {}

  async admit(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    event: AutonomousEngineeringLoopEventV1,
    evidence: AutonomousEngineeringLoopTransitionEvidenceV1 = {},
  ): Promise<AutonomousEngineeringLoopTransitionAdmissionV1> {
    const loop = structuredClone(loopInput);
    assertLoopBinding(loop, supervisor);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(loop.authorityBinding.taskId);
    } catch (error) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrentBinding(loop, current);
    const linkage = assertEventAdmissible(loop, current, event, evidence);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "transition admission clock is invalid",
        "admission_invalid",
      );
    }
    const admissionId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(admissionId)) {
      throw new AutonomousEngineeringLoopTransitionAdmissionError(
        "admissionId must be an opaque UUID",
        "admission_invalid",
      );
    }
    const ttl = boundedTtl(this.options.ttlMs);

    return Object.freeze({
      schemaVersion: 1,
      admissionId,
      admittedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      loopId: loop.loopId,
      expectedLoopRevision: loop.revision,
      event: structuredClone(event),
      taskId: current.taskId,
      observedTaskStatus: current.status,
      observedRunCount: current.runCount,
      ...linkage,
      authority: "autonomous_loop_transition_admission_only",
      executable: false,
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
