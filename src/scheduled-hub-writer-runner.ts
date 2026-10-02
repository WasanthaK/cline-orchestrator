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
import { preflightProvider } from "./provider-preflight.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import { buildValidationRepairPrompt, runValidationCommands, validationFailureMessage } from "./validation.js";
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
      | "lease_lost"
      | "recovery_not_safe"
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

type RecoveryPermit = {
  taskId: string;
  workspaceId: string;
  runCount: number;
  sessionGeneration: number;
  previousSessionId?: string;
};

const LEASE_LOST_ABORT_REASON =
  "Scheduled writer lease was lost; execution aborted fail-safe before further writes";

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
  if (task.pendingEscalation) {
    throw new ScheduledHubWriterError(
      `Task ${task.id} has unresolved human attention and cannot be scheduled`,
      "task_not_runnable",
    );
  }
}

function assertRecoverableScheduledTask(task: OrchestratorTask, permit?: RecoveryPermit): void {
  if (task.status !== "running") {
    throw new ScheduledHubWriterError(
      `Only an interrupted running scheduled task may use restart recovery; task ${task.id} is ${task.status}`,
      "recovery_not_safe",
    );
  }
  if ((task.runCount ?? 0) < 1 || (task.sessionGeneration ?? 0) < 1) {
    throw new ScheduledHubWriterError(
      `Interrupted task ${task.id} lacks prior run/session evidence required for recovery`,
      "recovery_not_safe",
    );
  }
  if (!task.lastRunCheckpoint?.available || task.lastRunCheckpoint.restoredAt) {
    throw new ScheduledHubWriterError(
      `Interrupted task ${task.id} has no usable rollback checkpoint`,
      "recovery_not_safe",
    );
  }
  if (task.pendingEscalation) {
    throw new ScheduledHubWriterError(
      `Interrupted task ${task.id} has unresolved human attention and cannot be recovered automatically`,
      "recovery_not_safe",
    );
  }
  if (permit && (
    permit.taskId !== task.id
    || permit.workspaceId !== task.workspaceId
    || permit.runCount !== (task.runCount ?? 0)
    || permit.sessionGeneration !== (task.sessionGeneration ?? 0)
    || permit.previousSessionId !== task.clineSessionId
  )) {
    throw new ScheduledHubWriterError(
      `Interrupted task ${task.id} changed after restart recovery was prepared`,
      "recovery_not_safe",
    );
  }
}

/**
 * Scheduler-side trusted runner for Milestone 9.
 *
 * Fresh work creates a new orchestrator owner identity per task and refuses any
 * prior runtime/session history. Restart recovery is a separate explicit path:
 * trusted reconciliation must first call prepareInterruptedTaskRecovery(), which
 * revalidates the current durable binding/checkpoint and creates a process-local,
 * one-task recovery permit. Merely presenting a running task never grants takeover.
 *
 * Lease loss is a lifecycle boundary as well as a write boundary: the lease abort
 * signal actively aborts the ClineRunner, which durably marks the task aborted.
 * Later writes remain blocked by the lease-aware executors.
 */
export class ScheduledHubWriterAuthorityRunner implements WriterAuthorityRunner {
  private readonly owners = new Map<string, OwnerBinding>();
  private readonly recoveries = new Map<string, RecoveryPermit>();

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
  ): Promise<{ located: LocatedTask; authority: LeaseAwareWriterAuthorityV1 }> {
    const located = await this.locateTask(taskId);
    assertCurrentTaskBinding(located.task, located.workspace);
    return {
      located,
      authority: leaseAwareWriterAuthorityFromTask(located.task, ownerInstanceId),
    };
  }

  /**
   * Trusted restart-only admission. This does not acquire a writer lease or start
   * work. It only permits the normal scheduler to consider one specific interrupted
   * task after current durable authority/checkpoint evidence has been revalidated.
   */
  async prepareInterruptedTaskRecovery(taskId: string): Promise<ApprovedWriterBindingV1> {
    const owner = this.ownerFor(taskId);
    const { located } = await this.currentAuthority(taskId, owner.ownerInstanceId);
    assertRecoverableScheduledTask(located.task);
    const permit: RecoveryPermit = {
      taskId: located.task.id,
      workspaceId: located.workspace.workspaceId,
      runCount: located.task.runCount ?? 0,
      sessionGeneration: located.task.sessionGeneration ?? 0,
      previousSessionId: located.task.clineSessionId,
    };
    this.recoveries.set(taskId, permit);
    return {
      taskId: located.task.id,
      workspaceId: located.workspace.workspaceId,
      ownerInstanceId: owner.ownerInstanceId,
    };
  }

  async revalidateApprovedTask(taskId: string): Promise<ApprovedWriterBindingV1> {
    const owner = this.ownerFor(taskId);
    const { located } = await this.currentAuthority(taskId, owner.ownerInstanceId);
    const recovery = this.recoveries.get(taskId);
    if (recovery) assertRecoverableScheduledTask(located.task, recovery);
    else assertFreshScheduledTask(located.task);
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

    const { located } = await this.currentAuthority(taskId, owner.ownerInstanceId);
    const recovery = this.recoveries.get(taskId);
    if (recovery) assertRecoverableScheduledTask(located.task, recovery);
    else assertFreshScheduledTask(located.task);
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

    let instruction = located.task.goal;
    let recovering = false;
    if (recovery) {
      await lease.validateCurrent();
      assertRecoverableScheduledTask(located.task, recovery);
      recovering = true;
      instruction = located.task.lastPrompt?.trim() || located.task.goal;
      const previousSessionId = located.task.clineSessionId;
      located.task.clineSessionId = undefined;
      located.task.finishReason = undefined;
      located.task.error = undefined;
      await located.store.save(located.task);
      await located.store.appendEvent(taskId, "resume_queued", {
        status: located.task.status,
        message: "Scheduled gateway restart queued durable recovery with a replacement Hub owner session",
        data: {
          reason: "scheduled_gateway_owner_loss",
          previousSessionId,
        },
      });
      this.recoveries.delete(taskId);
    }

    const authorityProvider: LeaseAwareWriterAuthorityProvider = {
      revalidateCurrent: async (requestedTaskId: string) => {
        if (requestedTaskId !== taskId) {
          throw new ScheduledHubWriterError(
            "Lease-aware executor requested authority for another task",
            "task_binding_stale",
          );
        }
        const current = await this.currentAuthority(taskId, owner.ownerInstanceId);
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

    let leaseLost = lease.signal.aborted;
    let abortPromise: Promise<void> | undefined;
    const abortForLeaseLoss = () => {
      leaseLost = true;
      if (abortPromise) return;
      abortPromise = (async () => {
        try {
          await runner.abort(taskId, LEASE_LOST_ABORT_REASON);
        } catch {
          // The run may have become terminal in the same turn. Lease-aware write
          // executors still reject the stale claim, so never convert this race into
          // authority or retry/recovery.
        }
      })();
    };
    lease.signal.addEventListener("abort", abortForLeaseLoss, { once: true });

    try {
      if (lease.signal.aborted) {
        abortForLeaseLoss();
        await abortPromise;
        throw new ScheduledHubWriterError(LEASE_LOST_ABORT_REASON, "lease_lost");
      }
      await lease.validateCurrent();

      let result = recovering
        ? await runner.resume(located.task, instruction)
        : await runner.start(located.task);
      while (result.status === "validating") {
        await lease.validateCurrent();
        const commands = result.validationCommands ?? [];
        if (commands.length === 0) {
          throw new ScheduledHubWriterError(
            "Scheduled Hub worker entered validation without approved commands",
            "worker_result_invalid",
          );
        }
        const validation = await runValidationCommands(located.workspace.canonicalRoot, commands, {
          timeoutMs: worker.validationTimeoutMs,
          maxOutputChars: worker.maxValidationOutputChars,
          signal: lease.signal,
        });
        await lease.validateCurrent();
        const latest = await located.store.load(taskId);
        if (latest.status === "aborted") {
          throw new ScheduledHubWriterError(LEASE_LOST_ABORT_REASON, "lease_lost");
        }
        latest.lastValidation = validation;
        if (validation.passed) {
          latest.status = "completed";
          latest.finishReason = "completed";
          latest.error = undefined;
          await lease.validateCurrent();
          await located.store.save(latest); // Also applies the final diff safety gate.
          result = latest;
          break;
        }

        const failure = validationFailureMessage(validation);
        const repairsUsed = latest.validationRepairCount ?? 0;
        if (repairsUsed >= worker.maxValidationRepairs) {
          latest.status = "validation_failed";
          latest.finishReason = "validation_failed";
          latest.error = failure;
          await lease.validateCurrent();
          await located.store.save(latest);
          result = latest;
          break;
        }

        latest.validationRepairCount = repairsUsed + 1;
        latest.status = "repairing";
        latest.finishReason = undefined;
        latest.error = failure;
        await lease.validateCurrent();
        await located.store.save(latest);
        result = await runner.resume(latest, buildValidationRepairPrompt(latest, validation));
      }
      if (abortPromise) await abortPromise;
      if (leaseLost || lease.signal.aborted) {
        throw new ScheduledHubWriterError(LEASE_LOST_ABORT_REASON, "lease_lost");
      }
      if (result.status !== "completed" && result.status !== "waiting_for_human") {
        throw new ScheduledHubWriterError(
          `Scheduled Hub worker ended in unexpected task state ${result.status}`,
          "worker_result_invalid",
        );
      }
    } finally {
      lease.signal.removeEventListener("abort", abortForLeaseLoss);
      if (abortPromise) await abortPromise;
      await runner.close("scheduled Hub writer complete");
    }
  }
}
