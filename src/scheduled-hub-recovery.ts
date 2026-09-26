import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";
import {
  ScheduledHubWriterAuthorityRunner,
  ScheduledHubWriterError,
} from "./scheduled-hub-writer-runner.js";
import {
  WriterConcurrencyScheduler,
  type WriterScheduleResultV1,
} from "./writer-concurrency-scheduler.js";

export interface ScheduledHubRecoverySummaryV1 {
  schemaVersion: 1;
  scanned: number;
  prepared: number;
  deferredLiveLease: number;
  failedClosed: number;
  schedule?: WriterScheduleResultV1;
}

function recoveryErrorMessage(error: unknown): string {
  if (error instanceof ScheduledHubWriterError) {
    return `Scheduled interrupted task was not recovered because its current durable authority is unsafe: ${error.message}`;
  }
  return `Scheduled interrupted task was not recovered safely: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Restart reconciliation for the Milestone 9 scheduled-writer path.
 *
 * This service never takes over a live writer. It first enumerates current durable
 * leases; a workspace with a live lease is deferred. Only an interrupted `running`
 * task with no live lease is passed through the runner's explicit recovery-permit
 * boundary, which independently revalidates the task/registry/Safety Plan binding
 * and rollback checkpoint. The normal scheduler then acquires a new fenced lease
 * before the runner clears stale Hub session identity and creates replacement-owner
 * handoff evidence.
 *
 * Locks remain coordination only: this reconciler grants no path/tool/model/runtime
 * authority and cannot bypass the runner or scheduler validation paths.
 */
export class ScheduledHubRestartReconciler {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly locks: WorkspaceLockStore,
    private readonly runner: ScheduledHubWriterAuthorityRunner,
    private readonly scheduler: WriterConcurrencyScheduler,
  ) {}

  private async failClosed(
    store: TaskStore,
    task: OrchestratorTask,
    message: string,
  ): Promise<void> {
    task.status = "failed";
    task.finishReason = "scheduled_recovery_denied";
    task.error = message;
    await store.save(task);
  }

  async recoverInterruptedTasks(): Promise<ScheduledHubRecoverySummaryV1> {
    const summary: ScheduledHubRecoverySummaryV1 = {
      schemaVersion: 1,
      scanned: 0,
      prepared: 0,
      deferredLiveLease: 0,
      failedClosed: 0,
    };

    const liveWorkspaces = new Set(
      (await this.locks.listActive()).map((state) => state.workspaceId),
    );
    const candidates: string[] = [];

    for (const record of await this.registry.listWorkspaces()) {
      const workspace = await this.registry.resolveVerifiedWorkspace(record.workspaceId);
      const store = new TaskStore(workspace.canonicalRoot);
      const interrupted = (await store.list()).filter((task) => task.status === "running");
      if (interrupted.length === 0) continue;

      summary.scanned += interrupted.length;

      if (liveWorkspaces.has(workspace.workspaceId)) {
        summary.deferredLiveLease += interrupted.length;
        continue;
      }

      if (interrupted.length > 1) {
        for (const task of interrupted) {
          await this.failClosed(
            store,
            task,
            "Multiple interrupted running tasks claim one workspace; automatic scheduled recovery is ambiguous and was denied",
          );
          summary.failedClosed += 1;
        }
        continue;
      }

      const task = interrupted[0];
      try {
        await this.runner.prepareInterruptedTaskRecovery(task.id);
        candidates.push(task.id);
        summary.prepared += 1;
      } catch (error) {
        await this.failClosed(store, task, recoveryErrorMessage(error));
        summary.failedClosed += 1;
      }
    }

    if (candidates.length > 0) {
      summary.schedule = await this.scheduler.schedule(candidates);
    }
    return summary;
  }
}
