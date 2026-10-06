import type { OperatorMutationActionV1 } from "./operator-capabilities.js";
import type { OperatorActionService } from "./operator-action.js";
import type { OperatorWorkflowActionService } from "./operator-workflow-action.js";
import type { OperatorWorkerRecoveryActionService } from "./operator-worker-recovery-action.js";
import {
  RemoteMutationBridgeError,
  type RemoteMutationActionAdapter,
  type RemoteMutationPreparedActionV1,
  type RemoteMutationProposalV1,
} from "./remote-mutation-bridge.js";

type CoreOperatorActions = Pick<OperatorActionService,
  | "previewEscalationRejection"
  | "previewEscalationApproval"
  | "previewTaskAbort"
  | "previewTaskRollback"
  | "previewTaskContinuation"
  | "rejectEscalation"
  | "approveEscalation"
  | "abortTask"
  | "rollbackTask"
  | "continueTask"
>;

type WorkflowOperatorActions = Pick<OperatorWorkflowActionService,
  "previewWorkflowResume" | "resumeWorkflow"
>;

type WorkerOperatorActions = Pick<OperatorWorkerRecoveryActionService,
  "previewScheduledWriterRecovery" | "recoverScheduledWriter"
>;

export interface RemoteMutationM10AdapterDependencies {
  core: CoreOperatorActions;
  workflow?: WorkflowOperatorActions;
  workerRecovery?: WorkerOperatorActions;
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteMutationBridgeError("remote mutation payload must be an object", "proposal_invalid");
  }
  const record = value as Record<string, unknown>;
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new RemoteMutationBridgeError(
      `remote mutation payload contains unexpected field(s): ${extras.join(", ")}`,
      "proposal_invalid",
    );
  }
  return record;
}

function emptyPayload(value: unknown): void {
  exactObject(value, []);
}

function continuationInstruction(value: unknown): string {
  const record = exactObject(value, ["instruction"]);
  if (typeof record.instruction !== "string" || !record.instruction.trim()) {
    throw new RemoteMutationBridgeError("continue_task payload requires instruction", "proposal_invalid");
  }
  return record.instruction;
}

function binding(value: Record<string, unknown>): string {
  // This value is never persisted directly: RemoteMutationApprovalBridge hashes
  // it before durable storage. It deliberately excludes the M10 confirmation token.
  return JSON.stringify(value);
}

/**
 * Converts a locally approved remote proposal into the existing M10
 * preview/confirmation boundary. The M10 confirmation token is captured only in
 * the returned execute closure; it is never included in actionBinding or exposed
 * to the remote mutation bridge.
 */
export class RemoteMutationM10Adapter implements RemoteMutationActionAdapter {
  constructor(private readonly dependencies: RemoteMutationM10AdapterDependencies) {}

  async prepare(input: {
    proposal: RemoteMutationProposalV1;
    payload: unknown;
  }): Promise<RemoteMutationPreparedActionV1> {
    const { proposal, payload } = input;
    switch (proposal.action) {
      case "reject_escalation": {
        emptyPayload(payload);
        const preview = await this.dependencies.core.previewEscalationRejection(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            escalationId: preview.escalationId,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.core.rejectEscalation({
            taskId: preview.taskId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "approve_escalation": {
        emptyPayload(payload);
        const preview = await this.dependencies.core.previewEscalationApproval(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            escalationId: preview.escalationId,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.core.approveEscalation({
            taskId: preview.taskId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "abort_task": {
        emptyPayload(payload);
        const preview = await this.dependencies.core.previewTaskAbort(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.core.abortTask({
            taskId: preview.taskId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "rollback_task": {
        emptyPayload(payload);
        const preview = await this.dependencies.core.previewTaskRollback(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            checkpointId: preview.checkpointId,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.core.rollbackTask({
            taskId: preview.taskId,
            checkpointId: preview.checkpointId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "continue_task": {
        const instruction = continuationInstruction(payload);
        const preview = await this.dependencies.core.previewTaskContinuation(
          proposal.targetId,
          instruction,
        );
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            instructionDigest: preview.instructionDigest,
            instructionChars: preview.instructionChars,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.core.continueTask({
            taskId: preview.taskId,
            instructionDigest: preview.instructionDigest,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "resume_workflow": {
        emptyPayload(payload);
        if (!this.dependencies.workflow) {
          throw new RemoteMutationBridgeError("workflow resume is unavailable on this bridge", "proposal_invalid");
        }
        const preview = await this.dependencies.workflow.previewWorkflowResume(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            workflowId: preview.workflowId,
            expectedTaskId: preview.expectedTaskId,
            workflowStatus: preview.workflowStatus,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.workflow!.resumeWorkflow({
            workflowId: preview.workflowId,
            expectedTaskId: preview.expectedTaskId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      case "recover_scheduled_writer": {
        emptyPayload(payload);
        if (!this.dependencies.workerRecovery) {
          throw new RemoteMutationBridgeError("scheduled writer recovery is unavailable on this bridge", "proposal_invalid");
        }
        const preview = await this.dependencies.workerRecovery.previewScheduledWriterRecovery(proposal.targetId);
        return {
          actionBinding: binding({
            action: preview.action,
            taskId: preview.taskId,
            workspaceId: preview.workspaceId,
            runCount: preview.runCount,
            sessionGeneration: preview.sessionGeneration,
            expiresAt: preview.expiresAt,
          }),
          expiresAt: preview.expiresAt,
          execute: async () => await this.dependencies.workerRecovery!.recoverScheduledWriter({
            taskId: preview.taskId,
            confirmationToken: preview.confirmationToken,
            confirmed: true,
          }),
        };
      }
      default: {
        const neverAction: never = proposal.action;
        throw new RemoteMutationBridgeError(
          `unsupported remote mutation action: ${String(neverAction)}`,
          "proposal_invalid",
        );
      }
    }
  }
}

export const REMOTE_MUTATION_M10_ACTIONS: readonly OperatorMutationActionV1[] = Object.freeze([
  "reject_escalation",
  "approve_escalation",
  "abort_task",
  "rollback_task",
  "continue_task",
  "resume_workflow",
  "recover_scheduled_writer",
]);
