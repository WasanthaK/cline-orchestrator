import crypto from "node:crypto";
import type { MachineOrchestratorService, PublicTaskView } from "./machine-orchestrator.js";

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;

type EscalationService = Pick<MachineOrchestratorService, "getTask" | "rejectEscalation">;

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

interface PendingRejection {
  taskId: string;
  escalationId: string;
  fingerprint: string;
  expiresAtMs: number;
}

function pendingFingerprint(task: PublicTaskView): string {
  return JSON.stringify({
    taskId: task.taskId,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
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

/** Local, process-bound confirmation for one service-backed operator action. */
export class OperatorActionService {
  private readonly pending = new Map<string, PendingRejection>();

  constructor(
    private readonly service: EscalationService,
    private readonly now: () => number = Date.now,
  ) {}

  async previewEscalationRejection(taskId: string): Promise<EscalationRejectionPreview> {
    const task = await this.service.getTask(taskId);
    const escalation = task.pendingEscalation;
    if (task.status !== "waiting_for_human" || escalation?.status !== "pending" || escalation.taskId !== task.taskId) {
      throw new OperatorActionError("Task has no pending safety escalation to reject", "invalid_action");
    }
    const now = this.now();
    for (const [token, entry] of this.pending) {
      if (entry.expiresAtMs <= now) this.pending.delete(token);
    }
    if (this.pending.size >= MAX_PENDING) {
      throw new OperatorActionError("Too many pending operator confirmations", "capacity_exceeded");
    }
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    this.pending.set(confirmationToken, {
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
    if (!entry || entry.taskId !== input.taskId) {
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
}
