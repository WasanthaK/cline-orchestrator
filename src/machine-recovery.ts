import {
  MachineGatewayError,
  MachineOrchestratorService,
} from "./machine-orchestrator.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { buildValidationRepairPrompt } from "./validation.js";
import type { RegisteredWorkspace } from "./workspace-registry.js";

const INTERRUPTED_STATUSES = new Set([
  "waiting",
  "running",
  "stalled",
  "validating",
  "repairing",
]);

interface RecoveryController {
  readonly store: TaskStore;
  enqueueStart(task: OrchestratorTask): void;
  enqueueContinue(task: OrchestratorTask, instruction: string): void;
}

interface ControllerAccessor {
  getController(workspace: RegisteredWorkspace): Promise<RecoveryController>;
}

export interface InterruptedTaskRecoverySummary {
  scanned: number;
  queued: number;
  failedClosed: number;
}

function recoveryInstruction(task: OrchestratorTask): string {
  const lastPrompt = task.lastPrompt?.trim();
  return lastPrompt || task.goal;
}

function recoveryErrorMessage(error: unknown): string {
  if (error instanceof MachineGatewayError) {
    return `Interrupted task was not resumed because its approved authority is no longer valid: ${error.message}`;
  }
  return `Interrupted task was not resumed safely: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Adds process-restart reconciliation to the existing machine gateway without
 * creating a second runtime or authority path. Recovery deliberately reuses
 * the base service's registered-workspace controller and ClineRunner.
 */
export class RestartAwareMachineOrchestratorService extends MachineOrchestratorService {
  private async controllerForRecovery(
    workspace: RegisteredWorkspace,
  ): Promise<RecoveryController> {
    // MachineOrchestratorService intentionally keeps controller creation private.
    // This same-package restart adapter calls that existing path at runtime so
    // worker resolution, Hub mode, and owner-bound safety contributions stay
    // identical to normal start/continue execution.
    return await (this as unknown as ControllerAccessor).getController(workspace);
  }

  private async failClosed(
    store: TaskStore,
    task: OrchestratorTask,
    message: string,
  ): Promise<void> {
    task.status = "failed";
    task.finishReason = "gateway_recovery_denied";
    task.error = message;
    await store.save(task);
  }

  private async validateRecoveryEnvelope(task: OrchestratorTask): Promise<void> {
    // getTaskDiff re-resolves the registered workspace and invokes the base
    // service's current durable-binding assertion before evaluating any diff.
    const diff = await this.getTaskDiff(task.id);

    if ((task.runCount ?? 0) > 0) {
      const checkpoint = task.lastRunCheckpoint;
      if (!checkpoint?.available || checkpoint.restoredAt) {
        throw new Error("an active interrupted run has no usable rollback checkpoint");
      }
      if (diff.available && diff.passed === false) {
        throw new Error(`the checkpoint-relative workspace diff is unsafe: ${diff.summary ?? "policy failed"}`);
      }
    }
  }

  private async queueReplacementOwner(
    controller: RecoveryController,
    task: OrchestratorTask,
    instruction: string,
  ): Promise<void> {
    const previousSessionId = task.clineSessionId;

    // Attaching from a new process does not transfer creator/client-local Hub
    // capabilities. Remove the stale session identity before resume so the
    // existing ClineRunner takes its durable missing-session recovery path,
    // creates a handoff, and starts a fresh owner session with current safety
    // contributions. The previous ID remains only in private event evidence.
    task.clineSessionId = undefined;
    task.finishReason = undefined;
    task.error = undefined;
    await controller.store.save(task);
    await controller.store.appendEvent(task.id, "resume_queued", {
      status: task.status,
      message: "Gateway restart detected; queued durable recovery with a replacement Hub owner session",
      data: {
        reason: "gateway_owner_loss",
        previousSessionId,
      },
    });
    controller.enqueueContinue(task, instruction);
  }

  async recoverInterruptedTasks(): Promise<InterruptedTaskRecoverySummary> {
    const summary: InterruptedTaskRecoverySummary = {
      scanned: 0,
      queued: 0,
      failedClosed: 0,
    };

    for (const record of await this.registry.listWorkspaces()) {
      const workspace = await this.registry.resolveVerifiedWorkspace(record.workspaceId);
      const store = new TaskStore(workspace.canonicalRoot);

      for (const task of await store.list()) {
        if (!INTERRUPTED_STATUSES.has(task.status)) continue;
        summary.scanned += 1;

        try {
          await this.validateRecoveryEnvelope(task);
        } catch (error) {
          await this.failClosed(store, task, recoveryErrorMessage(error));
          summary.failedClosed += 1;
          continue;
        }

        if (task.status === "stalled") {
          await this.failClosed(
            store,
            task,
            "Interrupted stalled task was not resumed automatically; its rollback checkpoint remains available for operator review",
          );
          summary.failedClosed += 1;
          continue;
        }

        if (task.status === "validating") {
          await this.failClosed(
            store,
            task,
            "Interrupted validation was not replayed automatically after gateway owner loss; the task was closed fail-safe with its rollback checkpoint preserved",
          );
          summary.failedClosed += 1;
          continue;
        }

        const controller = await this.controllerForRecovery(workspace);

        if (
          task.status === "waiting"
          && (task.runCount ?? 0) === 0
          && !task.clineSessionId
        ) {
          await controller.store.appendEvent(task.id, "queued", {
            status: task.status,
            message: "Gateway restart recovered an approved task that had not started its first run",
          });
          controller.enqueueStart(task);
          summary.queued += 1;
          continue;
        }

        if (task.status === "repairing") {
          if (!task.lastValidation) {
            await this.failClosed(
              store,
              task,
              "Interrupted repair task is missing the validation evidence required to construct a bounded repair prompt",
            );
            summary.failedClosed += 1;
            continue;
          }
          await this.queueReplacementOwner(
            controller,
            task,
            buildValidationRepairPrompt(task, task.lastValidation),
          );
          summary.queued += 1;
          continue;
        }

        await this.queueReplacementOwner(
          controller,
          task,
          recoveryInstruction(task),
        );
        summary.queued += 1;
      }
    }

    return summary;
  }
}
