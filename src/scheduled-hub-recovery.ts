import crypto from "node:crypto";
import path from "node:path";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import type { RegisteredWorkspace, WorkspaceRegistry } from "./workspace-registry.js";
import {
  ScheduledHubWriterAuthorityRunner,
  ScheduledHubWriterError,
} from "./scheduled-hub-writer-runner.js";
import {
  WriterConcurrencyScheduler,
  type WriterScheduleResultV1,
} from "./writer-concurrency-scheduler.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ScheduledHubRecoverySummaryV1 {
  schemaVersion: 1;
  scanned: number;
  prepared: number;
  deferredLiveLease: number;
  failedClosed: number;
  schedule?: WriterScheduleResultV1;
}

export interface ScheduledHubTargetRecoveryPreviewV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  runCount: number;
  sessionGeneration: number;
  fingerprint: string;
}

export interface ScheduledHubTargetRecoveryResultV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  schedule: WriterScheduleResultV1;
}

type LocatedRecoveryTask = {
  task: OrchestratorTask;
  workspace: RegisteredWorkspace;
  store: TaskStore;
};

function requireTaskId(value: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new ScheduledHubWriterError("taskId must be an opaque UUID", "task_not_found");
  }
  return normalized;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function assertPreviewBindingCurrent(task: OrchestratorTask, workspace: RegisteredWorkspace): void {
  if (
    task.workspaceId !== workspace.workspaceId
    || task.projectId !== workspace.projectId
    || task.workspaceRegistryRevision !== workspace.revision
    || task.safetyProfileId !== workspace.safetyProfile.profileId
    || task.safetyProfileRevision !== workspace.safetyProfile.revision
    || task.safetyPolicyVersion !== workspace.safetyProfile.policyVersion
    || task.workerProfileId !== workspace.safetyProfile.workerProfileId
    || normalizePath(task.workspace) !== normalizePath(workspace.canonicalRoot)
    || !task.safetyPlanId
    || !Array.isArray(task.approvedAllowedPathPatterns)
    || !Array.isArray(task.approvedProtectedPathPatterns)
    || !sameStrings(task.approvedProtectedPathPatterns, workspace.safetyProfile.protectedPathPatterns)
    || !sameStrings(task.validationCommands, workspace.safetyProfile.validationCommands)
  ) {
    throw new ScheduledHubWriterError(
      `Task ${task.id} no longer matches current registered workspace authority`,
      "task_binding_stale",
    );
  }
}

function assertPreviewRecoverable(task: OrchestratorTask): void {
  if (
    task.status !== "running"
    || (task.runCount ?? 0) < 1
    || (task.sessionGeneration ?? 0) < 1
    || !task.lastRunCheckpoint?.available
    || Boolean(task.lastRunCheckpoint?.restoredAt)
    || Boolean(task.pendingEscalation)
  ) {
    throw new ScheduledHubWriterError(
      `Task ${task.id} is not a safely recoverable interrupted scheduled writer`,
      "recovery_not_safe",
    );
  }
}

function targetFingerprint(task: OrchestratorTask, workspace: RegisteredWorkspace): string {
  const payload = {
    task: {
      id: task.id,
      goal: task.goal,
      workspace: normalizePath(task.workspace),
      status: task.status,
      updatedAt: task.updatedAt,
      runCount: task.runCount ?? 0,
      sessionGeneration: task.sessionGeneration ?? 0,
      recoveryCount: task.recoveryCount ?? 0,
      clineSessionId: task.clineSessionId,
      lastPrompt: task.lastPrompt,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      workspaceRegistryRevision: task.workspaceRegistryRevision,
      safetyPlanId: task.safetyPlanId,
      safetyPolicyVersion: task.safetyPolicyVersion,
      safetyProfileId: task.safetyProfileId,
      safetyProfileRevision: task.safetyProfileRevision,
      approvedAllowedPathPatterns: task.approvedAllowedPathPatterns,
      approvedProtectedPathPatterns: task.approvedProtectedPathPatterns,
      workerProfileId: task.workerProfileId,
      validationCommands: task.validationCommands,
      expectedChangedPaths: task.expectedChangedPaths,
      escalationId: task.pendingEscalation?.escalationId,
      escalationStatus: task.pendingEscalation?.status,
      checkpoint: task.lastRunCheckpoint ? {
        runCount: task.lastRunCheckpoint.runCount,
        createdAt: task.lastRunCheckpoint.createdAt,
        available: task.lastRunCheckpoint.available,
        restoredAt: task.lastRunCheckpoint.restoredAt,
        beforeDigest: task.lastRunCheckpoint.beforeFingerprint?.digest,
        afterDigest: task.lastRunCheckpoint.afterFingerprint?.digest,
      } : undefined,
    },
    workspace: {
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      revision: workspace.revision,
      canonicalRoot: normalizePath(workspace.canonicalRoot),
      safetyProfile: {
        profileId: workspace.safetyProfile.profileId,
        revision: workspace.safetyProfile.revision,
        policyVersion: workspace.safetyProfile.policyVersion,
        protectedPathPatterns: workspace.safetyProfile.protectedPathPatterns,
        validationCommands: workspace.safetyProfile.validationCommands,
        workerProfileId: workspace.safetyProfile.workerProfileId,
        maxChangedFiles: workspace.safetyProfile.maxChangedFiles,
      },
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
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

  private async locateTarget(taskId: string): Promise<LocatedRecoveryTask> {
    taskId = requireTaskId(taskId);
    let match: LocatedRecoveryTask | undefined;
    for (const record of await this.registry.listWorkspaces()) {
      const workspace = await this.registry.resolveVerifiedWorkspace(record.workspaceId);
      const store = new TaskStore(workspace.canonicalRoot);
      try {
        const task = await store.load(taskId);
        if (match) {
          throw new ScheduledHubWriterError(
            `Task ${taskId} is ambiguous across registered workspaces`,
            "task_binding_stale",
          );
        }
        match = { task, workspace, store };
      } catch (error) {
        if (error instanceof TaskNotFoundError) continue;
        throw error;
      }
    }
    if (!match) {
      throw new ScheduledHubWriterError(`Task ${taskId} was not found`, "task_not_found");
    }
    return match;
  }

  /**
   * Read-only targeted recovery snapshot for an operator confirmation boundary.
   * This is not authority: the runner and scheduler independently revalidate again
   * before a recovery permit, lease, replacement owner, or write can exist.
   */
  async previewInterruptedTaskRecovery(taskId: string): Promise<ScheduledHubTargetRecoveryPreviewV1> {
    const located = await this.locateTarget(taskId);
    assertPreviewBindingCurrent(located.task, located.workspace);
    assertPreviewRecoverable(located.task);
    const live = (await this.locks.listActive())
      .some((state) => state.workspaceId === located.workspace.workspaceId);
    if (live) {
      throw new ScheduledHubWriterError(
        `Workspace ${located.workspace.workspaceId} still has a live writer lease`,
        "recovery_not_safe",
      );
    }
    return {
      schemaVersion: 1,
      taskId: located.task.id,
      workspaceId: located.workspace.workspaceId,
      runCount: located.task.runCount ?? 0,
      sessionGeneration: located.task.sessionGeneration ?? 0,
      fingerprint: targetFingerprint(located.task, located.workspace),
    };
  }

  /** Recover exactly one previewed interrupted scheduled writer. */
  async recoverInterruptedTask(
    taskId: string,
    expectedFingerprint: string,
  ): Promise<ScheduledHubTargetRecoveryResultV1> {
    const preview = await this.previewInterruptedTaskRecovery(taskId);
    if (preview.fingerprint !== expectedFingerprint) {
      throw new ScheduledHubWriterError(
        `Interrupted task ${preview.taskId} changed after recovery preview`,
        "recovery_not_safe",
      );
    }

    const located = await this.locateTarget(preview.taskId);
    try {
      const binding = await this.runner.prepareInterruptedTaskRecovery(preview.taskId);
      if (binding.workspaceId !== preview.workspaceId) {
        throw new ScheduledHubWriterError(
          `Interrupted task ${preview.taskId} changed workspace during recovery preparation`,
          "task_binding_stale",
        );
      }
    } catch (error) {
      await this.failClosed(located.store, located.task, recoveryErrorMessage(error));
      throw error;
    }

    return {
      schemaVersion: 1,
      taskId: preview.taskId,
      workspaceId: preview.workspaceId,
      schedule: await this.scheduler.schedule([preview.taskId]),
    };
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
