import crypto from "node:crypto";
import { TaskStore } from "./state.js";
import type { HumanEscalation } from "./types.js";
import type { ActionDescriptor } from "./pre-execution-policy.js";

function fingerprintAction(action: ActionDescriptor): string {
  return crypto.createHash("sha256").update(JSON.stringify(action), "utf8").digest("hex");
}

export class HumanEscalationService {
  constructor(private readonly store: TaskStore) {}

  async request(taskId: string, action: ActionDescriptor, reason: string): Promise<HumanEscalation> {
    const task = await this.store.load(taskId);
    if (task.pendingEscalation?.status === "pending") return task.pendingEscalation;

    const escalation: HumanEscalation = {
      escalationId: crypto.randomUUID(),
      taskId,
      requestedAt: new Date().toISOString(),
      reason,
      actionKind: action.kind,
      actionFingerprint: fingerprintAction(action),
      safetyPolicyVersion: task.safetyPolicyVersion,
      status: "pending",
      reversible: action.kind === "edit" || action.kind === "patch",
    };

    task.status = "waiting_for_human";
    task.pendingEscalation = escalation;
    await this.store.save(task);
    await this.store.appendEvent(taskId, "human_escalation_requested", {
      status: task.status,
      message: reason,
      data: {
        escalationId: escalation.escalationId,
        actionKind: escalation.actionKind,
        actionFingerprint: escalation.actionFingerprint,
        safetyPolicyVersion: escalation.safetyPolicyVersion,
        reversible: escalation.reversible,
      },
    });
    return escalation;
  }
}
