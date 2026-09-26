import crypto from "node:crypto";
import type { MachineOrchestratorService, PublicTaskView } from "./machine-orchestrator.js";

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;
const OPERATOR_ABORT_REASON = "Task aborted by local operator";

type OperatorService = Pick<MachineOrchestratorService, "getTask" | "rejectEscalation"> &
  Partial<Pick<MachineOrchestratorService, "abortTask" | "approveEscalation">>;

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

export interface EscalationApprovalPreview {
  action: "approve_escalation";
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

interface PendingEscalationDecision extends PendingActionBase {
  action: "reject_escalation" | "approve_escalation";
  escalationId: string;
}

interface PendingAbort extends PendingActionBase {
  action: "abort_task";
}

type PendingAction = PendingEscalationDecision | PendingAbort;

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

  private async previewEscalationDecision(
    taskId: string,
    action: "reject_escalation" | "approve_escalation",
  ): Promise<{ task: PublicTaskView; escalationId: string; expiresAtMs: number; confirmationToken: string }> {
    if (action === "approve_escalation" && !this.service.approveEscalation) {
      throw new OperatorActionError("Escalation approval is unavailable on this operator surface", "invalid_action");
    }
    const task = await this.service.getTask(taskId);
    const escalation = task.pendingEscalation;
    if (task.status !== "waiting_for_human" || escalation?.status !== "pending" || escalation.taskId !== task.taskId) {
      throw new OperatorActionError("Task has no pending safety escalation", "invalid_action");
    }
    const now = this.now();
    this.preparePending(now);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    this.pending.set(confirmationToken, {
      action,
      taskId: task.taskId,
      escalationId: escalation.escalationId,
      fingerprint: pendingFingerprint(task),
      expiresAtMs,
    });
    return { task, escalationId: escalation.escalationId, expiresAtMs, confirmationToken };
  }

  async previewEscalationRejection(taskId: string): Promise<EscalationRejectionPreview> {
    const preview = await this.previewEscalationDecision(taskId, "reject_escalation");
    return {
      action: "reject_escalation",
      taskId: preview.task.taskId,
      workspaceId: preview.task.workspaceId,
      escalationId: preview.escalationId,
      confirmationText: "Reject this pending safety escalation and close the task",
      expiresAt: new Date(preview.expiresAtMs).toISOString(),
      confirmationToken: preview.confirmationToken,
    };
  }

  async previewEscalationApproval(taskId: string): Promise<EscalationApprovalPreview> {
    const preview = await this.previewEscalationDecision(taskId, "approve_escalation");
    return {
      action: "approve_escalation",
      taskId: preview.task.taskId,
      workspaceId: preview.task.workspaceId,
      escalationId: preview.escalationId,
      confirmationText: "Approve this scope-expansion request and close the old task; a new Safety Preview is still required",
      expiresAt: new Date(preview.expiresAtMs).toISOString(),
      confirmationToken: preview.confirmationToken,
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
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }
    const current = await this.service.getTask(entry.taskId);
    if (pendingFingerprint(current) !== entry.fingerprint) {
      throw new OperatorActionError("Task or safety authority changed after preview", "stale_action");
    }
    return await this.service.rejectEscalation(entry.taskId, entry.escalationId);
  }

  async approveEscalation(input: {
    taskId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<{ task: PublicTaskView; nextAction: "new_safety_preview_required" }> {
    if (input.confirmed !== true) {
      throw new OperatorActionError("Explicit operator confirmation is required", "invalid_action");
    }
    const entry = this.pending.get(input.confirmationToken);
    if (!entry || entry.action !== "approve_escalation" || entry.taskId !== input.taskId) {
      throw new OperatorActionError("Operator confirmation is invalid or already used", "invalid_action");
    }
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }
    const current = await this.service.getTask(entry.taskId);
    if (pendingFingerprint(current) !== entry.fingerprint) {
      throw new OperatorActionError("Task or safety authority changed after preview", "stale_action");
    }
    if (!this.service.approveEscalation) {
      throw new OperatorActionError("Escalation approval is unavailable on this operator surface", "invalid_action");
    }
    // Approval never enlarges the old task envelope. The machine service closes
    // it, revalidates authority, audits the decision, and requires a new preview.
    return await this.service.approveEscalation(entry.taskId, entry.escalationId);
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
    return await this.service.abortTask(entry.taskId, OPERATOR_ABORT_REASON);
  }
}
