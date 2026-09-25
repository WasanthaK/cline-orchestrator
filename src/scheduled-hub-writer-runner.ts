import crypto from "node:crypto";
import path from "node:path";
import { ClineRunner } from "./cline-runner.js";
import type { ClineRuntimeFactory } from "./cline-runtime.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type LeaseAwareWriterAuthorityProvider,
  type LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { LeaseAwareHubRuntimeFactory } from "./lease-aware-hub-runtime.js";
import { preflightProvider, type ProviderPreflightResult } from "./provider-preflight.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { RegisteredWorkspace, WorkspaceRegistry } from "./workspace-registry.js";
import type {
  ApprovedWriterBindingV1,
  WriterAuthorityRunner,
  WriterLeaseSession,
} from "./writer-concurrency-scheduler.js";

export type ScheduledWorkerProfileResolver = (
  workerProfileId: string,
) => Promise<WorkerConfig> | WorkerConfig;

export type ScheduledProviderPreflight = (
  worker: WorkerConfig,
) => Promise<ProviderPreflightResult>;

export class ScheduledHubWriterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "task_not_found"
      | "task_not_runnable"
      | "task_binding_stale"
      | "worker_profile_unavailable"
      | "provider_preflight_failed"
      | "lease_binding_mismatch"
      | "worker_result_invalid",
  ) {
    super(message);
    this.name = "ScheduledHubWriterError";
  }
}

type LocatedTask = {
  task: OrchestratorTask;
  workspace: RegisteredWorkspace;
  store: TaskStore;
};

type OwnerBinding = {
  taskId: string;
  ownerInstanceId: string;
};

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function assertCurrentTaskBinding(task: OrchestratorTask, workspace: RegisteredWorkspace): void {
  if (
    task.workspaceId !== workspace.workspaceId
    || task.projectId !== workspace.projectId
    || task.workspaceRegistryRevision !== workspace.revision
    || task.safetyProfileId !== workspace.safetyProfile.profileId
    || task.safetyProfileRevision !== workspace.safetyProfile.revision
    || task.safetyPolicyVersion !== workspace.safetyProfile.policyVersion
    || task.workerProfileId !== workspace.safetyProfile.workerProfileId
    || normalizePath(task.workspace) !== normalizePath(workspace.canonicalRoot)
    || !Array.isArray(task.approvedAllowedPathPatterns)
    || !Array.isArray(task.approvedProtectedPathPatterns)
    || !sameStrings(task.approvedProtectedPathPatterns, workspace.safetyProfile.protectedPathPatterns)
  ) {
    throw new ScheduledHubWriterError(
      `Task ${task.id} no longer matches current registered workspace authority`,
      "task_binding_stale",
    );
  }
}

function assertFreshScheduledTask(task: OrchestratorTask): void {
  if (task.status !== "created") {
    throw new ScheduledHubWriterError(
      `Scheduled writer may only start a fresh created task; task ${task.id} is ${task.status}`,
      "task_not_runnable",
    );
  }
  if (task.clineSessionId || (task.sessionGeneration ?? 0) > 0 || (task.runCount ?? 0) > 0) {
    throw new ScheduledHubWriterError(
      `Task ${task.id} already has runtime/session history and cannot be silently taken over by the scheduled writer path`,
      "task_not_runnable",
    );
  }
  if (task.pendingEscalation || task.status === "waiting_for_human") {
    throw new ScheduledHubWriterError(
      `Task ${task.id} has unresolved human attention and cannot be scheduled`,
      "task_not_runnable",
    );
  }
}

/**
 * Scheduler-side trusted runner for Slice 9B.
 *
 * It creates a fresh orchestrator owner identity per task in this gateway process,
 * revalidates the durable task/registry/profile binding on every scheduler pass,
 * refuses takeover of any task with prior Hub/session/run history, and starts the
 * task through a per-task lease-aware Hub runtime wrapper.
 *
 * This class does not expose a public scheduling endpoint and does not by itself
 * enable shared-runtime concurrency. The caller still owns candidate selection,
 * workflow/budget admission and the WriterConcurrencyScheduler lifecycle.
 */
export class ScheduledHubWriterAuthorityRunner implements WriterAuthorityRunner {
  private readonly owners = new Map<string, OwnerBinding>();

  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly resolveWorkerProfile: ScheduledWorkerProfileResolver,
    private readonly runtimeFactory: ClineRuntimeFactory,
    private readonly providerPreflight: ScheduledProviderPreflight = preflightProvider,
  ) {}

  private ownerFor(taskId: string): OwnerBinding {
    const existing = this.owners.get(taskId);
    if (existing) return existing;
    const created = { taskId, ownerInstanceId: crypto.randomUUID() };
    this.owners.set(taskId, created);
    return created;
  }

  private async locateTask(taskId: string): Promise<LocatedTask> {
    let match: LocatedTask | undefined;
    for (const record of await this.registry.listWorkspaces()) {
      const workspace = await this.registry.resolveVerifiedWorkspace(record.workspaceId);
      const store = new TaskStore(workspace.canonicalRoot);
      try {
        const task = await store.load(taskId);
        if (task.workspaceId !== workspace.workspaceId) continue;
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

  private async currentAuthority(
    taskId: string,
    ownerInstanceId: string,
    requireFresh = true,
  ): Promise<{ located: LocatedTask; authority: LeaseAwareWriterAuthorityV1 }> {
    const located = await this.locateTask(taskId);
    assertCurrentTaskBinding(located.task, located.workspace);
    if (requireFresh) assertFreshScheduledTask(located.task);
    return {
      located,
      authority: leaseAwareWriterAuthorityFromTask(located.task, ownerInstanceId),
    };
  }

  async revalidateApprovedTask(taskId: string): Promise<ApprovedWriterBindingV1> {
    const owner = this.ownerFor(taskId);
    const { located } = await this.currentAuthority(taskId, owner.ownerInstanceId, true);
    return {
      taskId: located.task.id,
      workspaceId: located.workspace.workspaceId,
      ownerInstanceId: owner.ownerInstanceId,
    };
  }

  async runApprovedTask(taskId: string, lease: WriterLeaseSession): Promise<void> {
    const owner = this.ownerFor(taskId);
    if (
      lease.taskId !== taskId
      || lease.ownerInstanceId !== owner.ownerInstanceId
    ) {
      throw new ScheduledHubWriterError(
        "Scheduler lease task/owner identity does not match the orchestrator-owned writer",
        "lease_binding_mismatch",
      );
    }

    const { located } = await this.currentAuthority(taskId, owner.ownerInstanceId, true);
    if (lease.workspaceId !== located.workspace.workspaceId) {
      throw new ScheduledHubWriterError(
        "Scheduler lease workspace does not match current registered task workspace",
        "lease_binding_mismatch",
      );
    }
    await lease.validateCurrent();

    let worker: WorkerConfig;
    try {
      worker = await this.resolveWorkerProfile(located.workspace.safetyProfile.workerProfileId);
    } catch (error) {
      throw new ScheduledHubWriterError(
        `Worker profile '${located.workspace.safetyProfile.workerProfileId}' is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        "worker_profile_unavailable",
      );
    }

    const preflight = await this.providerPreflight(worker);
    if (!preflight.ok) {
      throw new ScheduledHubWriterError(
        `Provider preflight failed: ${preflight.message}`,
        "provider_preflight_failed",
      );
    }

    const authorityProvider: LeaseAwareWriterAuthorityProvider = {
      revalidateCurrent: async (requestedTaskId: string) => {
        if (requestedTaskId !== taskId) {
          throw new ScheduledHubWriterError(
            "Lease-aware executor requested authority for another task",
            "task_binding_stale",
          );
        }
        const current = await this.currentAuthority(taskId, owner.ownerInstanceId, false);
        return current.authority;
      },
    };

    const scheduledRuntimeFactory = new LeaseAwareHubRuntimeFactory(
      this.runtimeFactory,
      located.task,
      worker,
      { lease, authorityProvider },
    );
    const runner = new ClineRunner(located.workspace.canonicalRoot, worker, {
      runtimeMode: "hub",
      runtimeFactory: scheduledRuntimeFactory,
    });

    try {
      const result = await runner.start(located.task);
      if (result.status !== "completed" && result.status !== "waiting_for_human") {
        throw new ScheduledHubWriterError(
          `Scheduled Hub worker ended in unexpected task state ${result.status}`,
          "worker_result_invalid",
        );
      }
    } finally {
      await runner.close("scheduled Hub writer complete");
    }
  }
}
