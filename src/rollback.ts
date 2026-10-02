import { checkpointLimitsFromEnvironment } from "./checkpoint-config.js";
import { restoreGitRollbackCheckpoint } from "./git-checkpoint.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

export class RollbackStateError extends Error {
  readonly code = "invalid_task_state";

  constructor(message: string) {
    super(message);
    this.name = "RollbackStateError";
  }
}

function isRollbackEligible(task: OrchestratorTask): boolean {
  return (
    task.status === "completed" ||
    task.status === "validation_failed" ||
    task.status === "failed" ||
    task.status === "aborted"
  );
}

export async function rollbackTask(
  store: TaskStore,
  workspace: string,
  taskId: string,
): Promise<OrchestratorTask> {
  const task = await store.load(taskId);
  if (task.status === "rolled_back") {
    throw new RollbackStateError(`Task ${task.id} is already rolled_back`);
  }
  if (!isRollbackEligible(task)) {
    throw new RollbackStateError(`Task ${task.id} must be terminal before rollback; current status=${task.status}`);
  }

  const checkpoint = task.lastRunCheckpoint;
  if (!checkpoint) {
    throw new RollbackStateError(`Task ${task.id} has no rollback checkpoint`);
  }
  if (!checkpoint.available) {
    throw new RollbackStateError(
      `Task ${task.id} rollback checkpoint is unavailable: ${checkpoint.error ?? "unknown error"}`,
    );
  }
  if (!checkpoint.afterFingerprint?.available) {
    throw new RollbackStateError(
      `Task ${task.id} rollback checkpoint has no terminal workspace fingerprint`,
    );
  }

  await store.appendEvent(task.id, "rollback_requested", {
    status: task.status,
    message: `Rollback requested for run ${checkpoint.runCount}`,
    data: {
      runCount: checkpoint.runCount,
      head: checkpoint.head,
      branch: checkpoint.branch,
    },
  });

  try {
    const restored = await restoreGitRollbackCheckpoint(
      workspace,
      checkpoint,
      checkpointLimitsFromEnvironment(),
    );

    task.lastRunCheckpoint = restored;
    task.status = "rolled_back";
    task.finishReason = "rolled_back";
    task.error = undefined;
    await store.save(task);
    await store.appendEvent(task.id, "rollback_completed", {
      status: task.status,
      message: `Rollback completed for run ${restored.runCount}`,
      data: {
        runCount: restored.runCount,
        restoredAt: restored.restoredAt,
        head: restored.head,
        branch: restored.branch,
      },
    });
    return task;
  } catch (error) {
    await store.appendEvent(task.id, "rollback_failed", {
      status: task.status,
      message: error instanceof Error ? error.message : String(error),
      data: { runCount: checkpoint.runCount },
    });
    throw error;
  }
}
