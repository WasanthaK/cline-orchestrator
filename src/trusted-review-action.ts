import {
  OperatorActionService,
  type EscalationApprovalPreview,
  type EscalationRejectionPreview,
  type TaskAbortPreview,
  type TaskRollbackPreview,
} from "./operator-action.js";
import type { TaskReviewProjectionV1 } from "./task-review-projection.js";

/**
 * UX-D3: an IN-PROCESS trusted-operator adapter. The passive UX-D2 HTML
 * remains action-free. This file adds no HTTP/browser route, generic task
 * execution, credential handling, or additional service authority.
 */
export const TRUSTED_REVIEW_ACTION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  browserExposure: "none" as const,
  requiresTrustedHostConfirmation: true as const,
  serviceRevalidatesAtExecution: true as const,
  actionTokenExposedToHost: false as const,
  noAutomaticRetry: true as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type TrustedReviewAction =
  | "reject_escalation"
  | "approve_escalation"
  | "abort_task"
  | "rollback_task";

export interface TrustedReviewActionPreviewV1 {
  schemaVersion: 1;
  authority: "operator_action_service_preview_only";
  action: TrustedReviewAction;
  taskId: string;
  workspaceId: string;
  confirmationText: string;
  expiresAt: string;
  consequence: "close_after_rejection" | "new_safety_preview_required" | "abort" | "restore_checkpoint";
  checkpointId?: string;
  grantsAuthority: false;
}

export interface TrustedReviewActionResultV1 {
  schemaVersion: 1;
  authority: "existing_operator_action_service_receipt_only";
  action: TrustedReviewAction;
  taskId: string;
  workspaceId: string;
  outcome: "cancelled" | "completed";
  resultingTaskStatus?: string;
  nextAction?: "new_safety_preview_required";
  grantsAuthority: false;
}

export interface TrustedReviewActionHost {
  /**
   * This must be an independent, authenticated, local, HUMAN confirmation
   * mechanism, not model/worker output or an untrusted web callback.
   *
   * Adding a browser implementation requires a separate origin/session/CSRF
   * design review. The current browser UI remains rejection-only.
   */
  confirmOperatorReview(review: TrustedReviewActionPreviewV1): Promise<boolean>;
}

export class TrustedReviewActionError extends Error {
  constructor(public readonly code: "invalid_review" | "confirmation_unavailable" | "action_failed") {
    super({
      invalid_review: "Trusted task review identity is invalid",
      confirmation_unavailable: "A trusted local operator confirmation is required",
      action_failed: "The operator action was not verified; refresh trusted task state before retrying",
    }[code]);
    this.name = "TrustedReviewActionError";
  }
}

type ActionPreview =
  | EscalationApprovalPreview
  | EscalationRejectionPreview
  | TaskAbortPreview
  | TaskRollbackPreview;

const actions: readonly TrustedReviewAction[] = [
  "reject_escalation", "approve_escalation", "abort_task", "rollback_task",
];

const consequence: Record<TrustedReviewAction, TrustedReviewActionPreviewV1["consequence"]> = {
  reject_escalation: "close_after_rejection",
  approve_escalation: "new_safety_preview_required",
  abort_task: "abort",
  rollback_task: "restore_checkpoint",
};

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

function requireReview(review: TaskReviewProjectionV1): void {
  if (!review || review.schemaVersion !== 1
    || review.authority !== "trusted_completion_packet_projection_only"
    || review.readOnly !== true || review.grantsAuthority !== false
    || !Array.isArray(review.actions) || review.actions.length !== 0
    || typeof review.taskId !== "string" || !ID.test(review.taskId)
    || typeof review.workspaceId !== "string" || !ID.test(review.workspaceId)
    || typeof review.projectId !== "string" || !ID.test(review.projectId)
    || review.caution !== "independent_evidence_not_supervisor_decision") {
    throw new TrustedReviewActionError("invalid_review");
  }
}

/**
 * Runs ONE chosen action through the existing independently enforcing operator
 * service, never from the passive renderer. Snapshot evidence is a task identity
 * selector only; it is not an authority grant. Only the current service can
 * decide if the requested action is eligible and still fresh.
 *
 * The service confirmation token and any raw task/goal/Safety/path details
 * remain private to this in-process bridge. A declined preview is never used.
 */
export async function runTrustedReviewAction(
  review: TaskReviewProjectionV1,
  action: TrustedReviewAction,
  service: OperatorActionService,
  host: TrustedReviewActionHost,
): Promise<TrustedReviewActionResultV1> {
  requireReview(review);
  if (!actions.includes(action)) throw new TrustedReviewActionError("invalid_review");
  if (!service || typeof host?.confirmOperatorReview !== "function") {
    throw new TrustedReviewActionError("confirmation_unavailable");
  }

  try {
    let preview: ActionPreview;
    switch (action) {
      case "reject_escalation": preview = await service.previewEscalationRejection(review.taskId); break;
      case "approve_escalation": preview = await service.previewEscalationApproval(review.taskId); break;
      case "abort_task": preview = await service.previewTaskAbort(review.taskId); break;
      case "rollback_task": preview = await service.previewTaskRollback(review.taskId); break;
    }

    if (preview.action !== action
      || preview.taskId !== review.taskId || preview.workspaceId !== review.workspaceId
      || typeof preview.confirmationText !== "string" || !preview.confirmationText.trim()
      || preview.confirmationText.length > 300
      || !Number.isFinite(Date.parse(preview.expiresAt))
      || typeof preview.confirmationToken !== "string"
      || preview.confirmationToken.length < 32) {
      throw new TrustedReviewActionError("action_failed");
    }

    const safe: TrustedReviewActionPreviewV1 = Object.freeze({
      schemaVersion: 1,
      authority: "operator_action_service_preview_only",
      action, taskId: preview.taskId, workspaceId: preview.workspaceId,
      confirmationText: preview.confirmationText,
      expiresAt: preview.expiresAt,
      consequence: consequence[action],
      ...(action === "rollback_task"
        ? { checkpointId: (preview as TaskRollbackPreview).checkpointId }
        : {}),
      grantsAuthority: false,
    });

    const confirmed = (await host.confirmOperatorReview(safe)) === true;
    if (!confirmed) {
      return Object.freeze({
        schemaVersion: 1,
        authority: "existing_operator_action_service_receipt_only",
        action, taskId: review.taskId, workspaceId: review.workspaceId,
        outcome: "cancelled",
        grantsAuthority: false,
      });
    }

    let status: string;
    let nextAction: "new_safety_preview_required" | undefined;
    switch (action) {
      case "reject_escalation": {
        const result = await service.rejectEscalation({
          taskId: preview.taskId, confirmationToken: preview.confirmationToken, confirmed: true,
        });
        if (result.taskId !== review.taskId || result.workspaceId !== review.workspaceId) {
          throw new TrustedReviewActionError("action_failed");
        }
        status = result.status;
        break;
      }
      case "approve_escalation": {
        const result = await service.approveEscalation({
          taskId: preview.taskId, confirmationToken: preview.confirmationToken, confirmed: true,
        });
        if (result.task.taskId !== review.taskId || result.task.workspaceId !== review.workspaceId
          || result.nextAction !== "new_safety_preview_required") {
          throw new TrustedReviewActionError("action_failed");
        }
        status = result.task.status;
        nextAction = result.nextAction;
        break;
      }
      case "abort_task": {
        const result = await service.abortTask({
          taskId: preview.taskId, confirmationToken: preview.confirmationToken, confirmed: true,
        });
        if (result.taskId !== review.taskId || result.workspaceId !== review.workspaceId) {
          throw new TrustedReviewActionError("action_failed");
        }
        status = result.status;
        break;
      }
      case "rollback_task": {
        const rollback = preview as TaskRollbackPreview;
        const result = await service.rollbackTask({
          taskId: rollback.taskId,
          checkpointId: rollback.checkpointId,
          confirmationToken: rollback.confirmationToken,
          confirmed: true,
        });
        if (result.taskId !== review.taskId || result.workspaceId !== review.workspaceId) {
          throw new TrustedReviewActionError("action_failed");
        }
        status = result.status;
        break;
      }
    }

    return Object.freeze({
      schemaVersion: 1,
      authority: "existing_operator_action_service_receipt_only",
      action, taskId: review.taskId, workspaceId: review.workspaceId,
      outcome: "completed",
      resultingTaskStatus: status,
      ...(nextAction ? { nextAction } : {}),
      grantsAuthority: false,
    });
  } catch {
    // Intentionally never expose raw service output, task data, identifiers
    // beyond the sanitized selector, credentials or confirmation tokens.
    // There is no automatic retry after ambiguous execution.
    throw new TrustedReviewActionError("action_failed");
  }
}
