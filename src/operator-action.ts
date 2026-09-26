import crypto from "node:crypto";
import type { MachineOrchestratorService, PublicTaskView } from "./machine-orchestrator.js";

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;
const OPERATOR_ABORT_REASON = "Task aborted by local operator";

type OperatorService = Pick<MachineOrchestratorService, "getTask" | "rejectEscalation"> &
  Partial<Pick<MachineOrchestratorService, "abortTask">>;

export class OperatorActionError extends Error {
  constructor(message: string, readonly code: "invalid_action" | "stale_action" | "expired_action" | "capacity_exceeded") {
    super(message);
    this.name = "OperatorActionError";
  }
}

export interface EscalationRejectionPreview {
  action: "reject_escalation";
  taskId: string;
  workspaceId: string;
  escalationId: string;
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
}

export interface TaskAbortPreview {
  action: "abort_task";
  taskId: string;
  workspaceId: string;
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
}

interface PendingActionBase {
  taskId: string;
  fingerprint: string;
  expiresAtMs: number;
}

interface PendingRejection extends PendingActionBase {
  action: "reject_escalation";
  escalationId: string;
}

interface PendingAbort extends PendingActionBase {
  action: "abort_task";
}

type PendingAction = PendingRejection | PendingAbort;

function pendingFingerprint(task: PublicTaskView): string {
  return JSON.stringify({
    taskId: task.taskId,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    goal: task.goal,
    status: task.status,
    updatedAt: task.updatedAt,
    runCount: task.runCount,
    sessionGeneration: task.sessionGeneration,
    escalationId: task.pendingEscalation?.escalationId,
    escalationStatus: task.pendingEscalation?.status,
    safetyPlanId: task.safety.safetyPlanId,
    policyVersion: task.safety.policyVersion,
    workerProfileId: task.safety.workerProfileId,
    allowedPathPatterns: task.safety.allowedPathPatterns,
    protectedPathPatterns: task.safety.protectedPathPatterns,
  });
}

function isTerminal(task: PublicTaskView): boolean {
  return ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(task.status);
}

/** Local, process-bound confirmation for bounded service-backed operator actions. */
export class OperatorActionService {
  private readonly pending = new Map<string, PendingAction>();

  constructor(
    private readonly service: OperatorService,
    private readonly now: () => number = Date.now,
  ) {}

  private preparePending(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAtMs <= now) this.pending.delete(token);
    }
    if (this.pending.size >= MAX_PENDING) {
      throw new OperatorActionError("Too many pending operator confirmations", "capacity_exceeded");
    }
  }

  async previewEscalationRejection(taskId: string): Promise<EscalationRejectionPreview> {
    const task = await this.service.getTask(taskId);
    const escalation = task.pendingEscalation;
    if (task.status !== "waiting_for_human" || escalation?.status !== "pending" || escalation.taskId !== task.taskId) {
      throw new OperatorActionError("Task has no pending safety escalation to reject", "invalid_action");
    }
    const now = this.now();
    this.preparePending(now);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    this.pending.set(confirmationToken, {
      action: "reject_escalation",
      taskId: task.taskId,
      escalationId: escalation.escalationId,
      fingerprint: pendingFingerprint(task),
      expiresAtMs,
    });
    return {
      action: "reject_escalation",
      taskId: task.taskId,
      workspaceId: task.workspaceId,
      escalationId: escalation.escalationId,
      confirmationText: "Reject this pending safety escalation and close the task",
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken,
    };
  }

  async rejectEscalation(input: {
    taskId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<PublicTaskView> {
    if (input.confirmed !== true) {
      throw new OperatorActionError("Explicit operator confirmation is required", "invalid_action");
    }
    const entry = this.pending.get(input.confirmationToken);
    if (!entry || entry.action !== "reject_escalation" || entry.taskId !== input.taskId) {
      throw new OperatorActionError("Operator confirmation is invalid or already used", "invalid_action");
    }
    // Consume before the first await: concurrent submissions and failed actions cannot replay.
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }
    const current = await this.service.getTask(entry.taskId);
    if (pendingFingerprint(current) !== entry.fingerprint) {
      throw new OperatorActionError("Task or safety authority changed after preview", "stale_action");
    }
    // The machine service rechecks the registered authority and pending decision
    // and writes its existing human_escalation_rejected audit event.
    return await this.service.rejectEscalation(entry.taskId, entry.escalationId);
  }

  async previewTaskAbort(taskId: string): Promise<TaskAbortPreview> {
    if (!this.service.abortTask) {
      throw new OperatorActionError("Task abort is unavailable on this operator surface", "invalid_action");
    }
    const task = await this.service.getTask(taskId);
    if (isTerminal(task)) {
      throw new OperatorActionError(`Task is already ${task.status}`, "invalid_action");
    }
    const now = this.now();
    this.preparePending(now);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    this.pending.set(confirmationToken, {
      action: "abort_task",
      taskId: task.taskId,
      fingerprint: pendingFingerprint(task),
      expiresAtMs,
    });
    return {
      action: "abort_task",
      taskId: task.taskId,
      workspaceId: task.workspaceId,
      confirmationText: "Abort this task using its existing orchestrator abort path",
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken,
    };
  }

  async abortTask(input: {
    taskId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<PublicTaskView> {
    if (input.confirmed !== true) {
      throw new OperatorActionError("Explicit operator confirmation is required", "invalid_action");
    }
    const entry = this.pending.get(input.confirmationToken);
    if (!entry || entry.action !== "abort_task" || entry.taskId !== input.taskId) {
      throw new OperatorActionError("Operator confirmation is invalid or already used", "invalid_action");
    }
    // Consume before the first await so replay and concurrent submissions fail closed.
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }
    const current = await this.service.getTask(entry.taskId);
    if (pendingFingerprint(current) !== entry.fingerprint) {
      throw new OperatorActionError("Task or safety authority changed after preview", "stale_action");
    }
    if (!this.service.abortTask) {
      throw new OperatorActionError("Task abort is unavailable on this operator surface", "invalid_action");
    }
    // The machine service revalidates the durable workspace/task safety binding.
    // Its existing abort path records abort_requested before making the task terminal.
    return await this.service.abortTask(entry.taskId, OPERATOR_ABORT_REASON);
  }
}
