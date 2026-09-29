import path from "node:path";
import { ClineRunner } from "./cline-runner.js";
import type {
  ClineRuntime,
  ClineRuntimeCreateRequest,
  ClineRuntimeFactory,
} from "./cline-runtime.js";
import type {
  DistributedTargetRuntimeHandoffContext,
  DistributedTargetTaskLoader,
} from "./distributed-target-runtime-handoff.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { LeaseAwareHubRuntimeFactory } from "./lease-aware-hub-runtime.js";
import { preflightProvider } from "./provider-preflight.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

export const DISTRIBUTED_TARGET_RUNTIME_START_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresM12HProcessLocalContext: true as const,
  promptComesFromTargetLocalTaskOnly: true as const,
  requiresFreshTaskBeforeRun: true as const,
  requiresExpectedRunningTransitionImmediatelyBeforeSessionStart: true as const,
  requiresCurrentTaskSafetyAuthority: true as const,
  requiresCurrentLocalWriterLease: true as const,
  requiresCurrentDistributedFence: true as const,
  usesExistingLeaseAwareHubRuntime: true as const,
  targetClineStartEnabled: true as const,
  crossMachineDeliveryEnabled: false as const,
  networkListenerIncluded: false as const,
  commandTransportIncluded: false as const,
  distributedFenceRenewalIncluded: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type DistributedTargetWorkerProfileResolver = (
  workerProfileId: string,
) => Promise<WorkerConfig> | WorkerConfig;

export type DistributedTargetProviderPreflight = (
  worker: WorkerConfig,
) => Promise<ProviderPreflightResult>;

export interface DistributedTargetRuntimeStartOptions {
  tasks: DistributedTargetTaskLoader;
  resolveWorkerProfile: DistributedTargetWorkerProfileResolver;
  baseRuntimeFactory: ClineRuntimeFactory;
  providerPreflight?: DistributedTargetProviderPreflight;
}

export class DistributedTargetRuntimeStartError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "context_invalid"
      | "task_not_current"
      | "authority_not_current"
      | "lease_not_current"
      | "fence_not_current"
      | "worker_profile_unavailable"
      | "provider_preflight_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DistributedTargetRuntimeStartError";
  }
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameAuthority(left: LeaseAwareWriterAuthorityV1, right: LeaseAwareWriterAuthorityV1): boolean {
  return left.schemaVersion === 1
    && right.schemaVersion === 1
    && left.taskId === right.taskId
    && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId
    && left.workspaceRegistryRevision === right.workspaceRegistryRevision
    && left.safetyPlanId === right.safetyPlanId
    && left.policyVersion === right.policyVersion
    && left.safetyProfileId === right.safetyProfileId
    && left.safetyProfileRevision === right.safetyProfileRevision
    && left.workerProfileId === right.workerProfileId
    && left.ownerInstanceId === right.ownerInstanceId
    && sameStrings(left.allowedPathPatterns, right.allowedPathPatterns)
    && sameStrings(left.protectedPathPatterns, right.protectedPathPatterns);
}

function sameLeaseIdentity(
  claim: WorkspaceWriterClaimV1,
  expected: { taskId: string; workspaceId: string; ownerInstanceId: string; leaseId: string; fenceToken: string },
): boolean {
  return claim.authority === "coordination_only"
    && claim.taskId === expected.taskId
    && claim.workspaceId === expected.workspaceId
    && claim.ownerInstanceId === expected.ownerInstanceId
    && claim.leaseId === expected.leaseId
    && claim.fenceToken === expected.fenceToken;
}

function assertContextShape(context: DistributedTargetRuntimeHandoffContext): void {
  const evidence = context?.evidence;
  const task = context?.task;
  const safety = context?.safetyOptions;
  if (
    !evidence
    || evidence.schemaVersion !== 1
    || evidence.authority !== "local_runtime_handoff_evidence_only"
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
    || !task
    || !safety?.lease
    || !safety.authorityProvider
    || !safety.distributedFenceGuard
    || task.id !== evidence.taskId
    || task.workspaceId !== evidence.workspaceId
    || safety.lease.taskId !== evidence.taskId
    || safety.lease.workspaceId !== evidence.workspaceId
    || safety.distributedFenceGuard.taskId !== evidence.taskId
    || safety.distributedFenceGuard.workspaceId !== evidence.workspaceId
  ) {
    throw new DistributedTargetRuntimeStartError(
      "M12H process-local handoff context is incomplete or cross-bound",
      "context_invalid",
    );
  }
}

function assertFreshTask(task: OrchestratorTask, context: DistributedTargetRuntimeHandoffContext): void {
  if (
    task.id !== context.evidence.taskId
    || task.workspaceId !== context.evidence.workspaceId
    || task.status !== "created"
    || Boolean(task.clineSessionId)
    || (task.sessionGeneration ?? 0) > 0
    || (task.runCount ?? 0) > 0
    || Boolean(task.pendingEscalation)
  ) {
    throw new DistributedTargetRuntimeStartError(
      "target runtime start requires the same fresh target-local created task admitted by M12H",
      "task_not_current",
    );
  }
}

function assertExpectedRunningTransition(
  task: OrchestratorTask,
  initial: OrchestratorTask,
  context: DistributedTargetRuntimeHandoffContext,
): void {
  if (
    task.id !== context.evidence.taskId
    || task.workspaceId !== context.evidence.workspaceId
    || task.status !== "running"
    || Boolean(task.clineSessionId)
    || (task.sessionGeneration ?? 0) !== 0
    || (task.runCount ?? 0) !== 1
    || Boolean(task.pendingEscalation)
    || task.goal !== initial.goal
    || task.lastPrompt !== initial.goal
    || normalizePath(task.workspace) !== normalizePath(initial.workspace)
  ) {
    throw new DistributedTargetRuntimeStartError(
      "target task changed outside the expected ClineRunner first-start transition",
      "task_not_current",
    );
  }
}

async function revalidateAuthority(
  task: OrchestratorTask,
  context: DistributedTargetRuntimeHandoffContext,
): Promise<void> {
  const lease = context.safetyOptions.lease;
  let expected: LeaseAwareWriterAuthorityV1;
  try {
    expected = leaseAwareWriterAuthorityFromTask(task, lease.ownerInstanceId);
  } catch (error) {
    throw new DistributedTargetRuntimeStartError(
      "target-local task cannot produce current lease-aware authority",
      "authority_not_current",
      { cause: error },
    );
  }

  let current: LeaseAwareWriterAuthorityV1;
  try {
    current = await context.safetyOptions.authorityProvider.revalidateCurrent(task.id);
  } catch (error) {
    throw new DistributedTargetRuntimeStartError(
      "current target task/Safety/registry authority could not be revalidated",
      "authority_not_current",
      { cause: error },
    );
  }
  if (!sameAuthority(expected, current)) {
    throw new DistributedTargetRuntimeStartError(
      "current target task/Safety/registry authority changed before runtime start",
      "authority_not_current",
    );
  }
}

async function revalidateLease(context: DistributedTargetRuntimeHandoffContext): Promise<void> {
  const lease = context.safetyOptions.lease;
  if (lease.signal.aborted) {
    throw new DistributedTargetRuntimeStartError("local writer lease is already aborted", "lease_not_current");
  }
  const before = lease.currentClaim();
  const expected = {
    taskId: context.evidence.taskId,
    workspaceId: context.evidence.workspaceId,
    ownerInstanceId: lease.ownerInstanceId,
    leaseId: before.leaseId,
    fenceToken: before.fenceToken,
  };
  if (!sameLeaseIdentity(before, expected)) {
    throw new DistributedTargetRuntimeStartError(
      "local writer lease does not match the M12H target handoff",
      "lease_not_current",
    );
  }
  try {
    await lease.validateCurrent();
  } catch (error) {
    throw new DistributedTargetRuntimeStartError(
      "local writer lease is no longer current",
      "lease_not_current",
      { cause: error },
    );
  }
  if (lease.signal.aborted || !sameLeaseIdentity(lease.currentClaim(), expected)) {
    throw new DistributedTargetRuntimeStartError(
      "local writer lease identity changed during runtime-start validation",
      "lease_not_current",
    );
  }
}

async function revalidateFence(context: DistributedTargetRuntimeHandoffContext): Promise<void> {
  try {
    await context.safetyOptions.distributedFenceGuard!.validateCurrent();
  } catch (error) {
    throw new DistributedTargetRuntimeStartError(
      "shared distributed fence is no longer current before runtime start",
      "fence_not_current",
      { cause: error },
    );
  }
}

class StartGuardRuntime implements ClineRuntime {
  constructor(
    private readonly base: ClineRuntime,
    private readonly beforeStart: () => Promise<void>,
  ) {}

  async start(input: unknown): Promise<any> {
    await this.beforeStart();
    return await this.base.start(input);
  }
  async send(input: unknown): Promise<any> { return await this.base.send(input); }
  async abort(sessionId: string, reason?: Error): Promise<any> { return await this.base.abort(sessionId, reason); }
  subscribe(listener: (event: any) => void, options?: unknown): unknown { return this.base.subscribe(listener, options); }
  async get(sessionId: string): Promise<any> {
    if (!this.base.get) throw new Error("Wrapped Hub runtime does not expose session lookup");
    return await this.base.get(sessionId);
  }
  async dispose(reason?: string): Promise<void> { await this.base.dispose(reason); }
}

class StartGuardRuntimeFactory implements ClineRuntimeFactory {
  constructor(
    private readonly base: ClineRuntimeFactory,
    private readonly beforeStart: () => Promise<void>,
  ) {}

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    return new StartGuardRuntime(await this.base.create(request), this.beforeStart);
  }
}

/**
 * M12I target-local executor. It starts the existing ClineRunner only after M12H
 * has produced a process-local context. No dispatch/network payload is accepted.
 * The model prompt is always the current target-local task goal.
 */
export class DistributedTargetRuntimeStarter {
  private readonly providerPreflight: DistributedTargetProviderPreflight;

  constructor(private readonly options: DistributedTargetRuntimeStartOptions) {
    this.providerPreflight = options.providerPreflight ?? preflightProvider;
  }

  async start(context: DistributedTargetRuntimeHandoffContext): Promise<OrchestratorTask> {
    assertContextShape(context);

    const initial = await this.options.tasks.loadCurrent(
      context.evidence.taskId,
      context.evidence.workspaceId,
    );
    assertFreshTask(initial, context);
    await revalidateAuthority(initial, context);
    await revalidateLease(context);
    await revalidateFence(context);

    let worker: WorkerConfig;
    try {
      worker = await this.options.resolveWorkerProfile(initial.workerProfileId!);
    } catch (error) {
      throw new DistributedTargetRuntimeStartError(
        `target worker profile '${initial.workerProfileId ?? "unknown"}' is unavailable`,
        "worker_profile_unavailable",
        { cause: error },
      );
    }
    const preflight = await this.providerPreflight(worker);
    if (!preflight.ok) {
      throw new DistributedTargetRuntimeStartError(
        `target provider preflight failed: ${preflight.message}`,
        "provider_preflight_failed",
      );
    }

    const leaseAware = new LeaseAwareHubRuntimeFactory(
      this.options.baseRuntimeFactory,
      initial,
      worker,
      context.safetyOptions,
    );
    const guardedFactory = new StartGuardRuntimeFactory(leaseAware, async () => {
      const current = await this.options.tasks.loadCurrent(
        context.evidence.taskId,
        context.evidence.workspaceId,
      );
      assertExpectedRunningTransition(current, initial, context);
      await revalidateAuthority(current, context);
      await revalidateLease(context);
      await revalidateFence(context);
    });
    const runner = new ClineRunner(initial.workspace, worker, {
      runtimeMode: "hub",
      runtimeFactory: guardedFactory,
    });

    let abortPromise: Promise<void> | undefined;
    const abortForLeaseLoss = () => {
      if (abortPromise) return;
      abortPromise = (async () => {
        try {
          await runner.abort(
            initial.id,
            "Distributed target local writer lease was lost; execution aborted fail-safe",
          );
        } catch {
          // If the run became terminal in the same turn, M12F still rejects stale
          // writes and the durable terminal state remains authoritative.
        }
      })();
    };
    context.safetyOptions.lease.signal.addEventListener("abort", abortForLeaseLoss, { once: true });

    try {
      if (context.safetyOptions.lease.signal.aborted) {
        abortForLeaseLoss();
        await abortPromise;
        throw new DistributedTargetRuntimeStartError("local writer lease was lost before runtime start", "lease_not_current");
      }
      const result = await runner.start(initial);
      if (abortPromise) await abortPromise;
      return result;
    } finally {
      context.safetyOptions.lease.signal.removeEventListener("abort", abortForLeaseLoss);
      if (abortPromise) await abortPromise;
      await runner.close("distributed target runtime complete");
    }
  }
}
