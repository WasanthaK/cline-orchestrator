import path from "node:path";
import { ClineRunner } from "./cline-runner.js";
import type { ClineRuntimeFactory } from "./cline-runtime.js";
import {
  type MultiAgentChildExecutionActivationContext,
} from "./multi-agent-child-execution-activation.js";
import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import {
  LeaseAwareHubRuntimeFactory,
} from "./lease-aware-hub-runtime.js";
import type {
  LeaseAwareWriterAuthorityProvider,
  LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { preflightProvider } from "./provider-preflight.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type {
  OrchestratorTask,
  ProviderPreflightResult,
  WorkerConfig,
} from "./types.js";

export const MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresM13FActivationContext: true as const,
  requiresFreshParentBindingImmediatelyBeforeStart: true as const,
  requiresFreshLocalWriterLeaseImmediatelyBeforeStart: true as const,
  requiresRegisteredWorkspaceResolution: true as const,
  persistsFreshChildTaskAtStart: true as const,
  resumesExistingChildTask: false as const,
  usesExistingClineRunner: true as const,
  usesExistingLeaseAwareHubSafety: true as const,
  nativeSubagentsEnabled: false as const,
  nativeAgentTeamsEnabled: false as const,
  modelShellEnabled: false as const,
  modelNetworkEnabled: false as const,
  mcpEnabled: false as const,
  pluginsEnabled: false as const,
  distributedChildExecutionEnabled: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRegisteredWorkspaceResolutionV1 {
  workspaceId: string;
  workspaceRegistryRevision: number;
  canonicalRoot: string;
}

export interface MultiAgentRegisteredWorkspaceResolver {
  resolveCurrent(workspaceId: string): Promise<MultiAgentRegisteredWorkspaceResolutionV1>;
}

export type MultiAgentChildWorkerProfileResolver = (
  workerProfileId: string,
) => Promise<WorkerConfig> | WorkerConfig;

export type MultiAgentChildProviderPreflight = (
  worker: WorkerConfig,
) => Promise<ProviderPreflightResult>;

export interface MultiAgentChildRuntimeStartOptions {
  parentBinding: MultiAgentParentExecutionBindingProvider;
  workspaces: MultiAgentRegisteredWorkspaceResolver;
  resolveWorkerProfile: MultiAgentChildWorkerProfileResolver;
  baseRuntimeFactory: ClineRuntimeFactory;
  providerPreflight?: MultiAgentChildProviderPreflight;
  taskStoreFactory?: (workspaceRoot: string) => TaskStore;
  runnerFactory?: (
    workspaceRoot: string,
    worker: WorkerConfig,
    runtimeFactory: ClineRuntimeFactory,
  ) => Pick<ClineRunner, "start" | "close" | "abort">;
  now?: () => Date;
}

export class MultiAgentChildRuntimeStartError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "context_invalid"
      | "parent_not_current"
      | "parent_not_executable"
      | "workspace_not_current"
      | "lease_not_current"
      | "worker_profile_unavailable"
      | "provider_preflight_failed"
      | "child_state_exists"
      | "runtime_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentChildRuntimeStartError";
  }
}

type DurableChildTask = OrchestratorTask & {
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  approvedAllowedPathPatterns: string[];
  approvedProtectedPathPatterns: string[];
  workerProfileId: string;
};

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertContext(context: MultiAgentChildExecutionActivationContext): void {
  const evidence = context?.evidence;
  const input = context?.runtimeInput;
  const lease = context?.lease;
  if (
    !evidence
    || evidence.schemaVersion !== 1
    || evidence.authority !== "child_execution_activation_evidence_only"
    || evidence.runtimeStartAuthorized !== false
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
    || !input
    || input.schemaVersion !== 1
    || input.authority !== "child_runtime_input_only"
    || input.runtimeStartAuthorized !== false
    || input.grantsTaskAuthority !== false
    || input.grantsFilesystemAuthority !== false
    || input.grantsSafetyPlanAuthority !== false
    || input.grantsWriterLeaseAuthority !== false
    || input.grantsCredentialAuthority !== false
    || input.grantsReleaseAuthority !== false
    || !lease
    || evidence.childTaskId !== input.childTaskId
    || evidence.parentTaskId !== input.parentTaskId
    || evidence.workspaceId !== input.workspaceId
    || lease.taskId !== input.childTaskId
    || lease.workspaceId !== input.workspaceId
  ) {
    throw new MultiAgentChildRuntimeStartError(
      "M13F activation context is incomplete or cross-bound",
      "context_invalid",
    );
  }
}

function assertCurrentParent(
  input: MultiAgentChildExecutionActivationContext["runtimeInput"],
  current: MultiAgentParentExecutionBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_execution_binding"
    || current.taskId !== input.parentTaskId
    || current.projectId !== input.projectId
    || current.workspaceId !== input.workspaceId
    || current.workspaceRegistryRevision !== input.workspaceRegistryRevision
    || current.safetyPlanId !== input.safetyPlanId
    || current.safetyPolicyVersion !== input.safetyPolicyVersion
    || current.safetyProfileId !== input.safetyProfileId
    || current.safetyProfileRevision !== input.safetyProfileRevision
    || current.workerProfileId !== input.workerProfileId
    || !input.allowedPathPatterns.every((pattern) =>
      current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, input.protectedPathPatterns)
    || !sameStrings(current.trustedValidationCommands, input.trustedValidationCommands)
  ) {
    throw new MultiAgentChildRuntimeStartError(
      "current parent task/Safety binding no longer matches the activated child",
      "parent_not_current",
    );
  }
  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentChildRuntimeStartError(
      "current parent state does not permit child runtime start",
      "parent_not_executable",
    );
  }
}

async function assertLeaseCurrent(
  context: MultiAgentChildExecutionActivationContext,
): Promise<void> {
  const lease = context.lease;
  const evidence = context.evidence;
  if (lease.signal.aborted) {
    throw new MultiAgentChildRuntimeStartError(
      "child local writer lease is already aborted",
      "lease_not_current",
    );
  }
  const before = lease.currentClaim();
  if (
    before.authority !== "coordination_only"
    || before.taskId !== context.runtimeInput.childTaskId
    || before.workspaceId !== context.runtimeInput.workspaceId
    || before.ownerInstanceId !== lease.ownerInstanceId
    || before.leaseId !== evidence.leaseId
    || before.fenceToken !== evidence.fenceToken
  ) {
    throw new MultiAgentChildRuntimeStartError(
      "child local writer lease no longer matches M13F activation evidence",
      "lease_not_current",
    );
  }
  try {
    await lease.validateCurrent();
  } catch (error) {
    throw new MultiAgentChildRuntimeStartError(
      "child local writer lease is no longer current",
      "lease_not_current",
      { cause: error },
    );
  }
  const after = lease.currentClaim();
  if (
    lease.signal.aborted
    || after.leaseId !== before.leaseId
    || after.fenceToken !== before.fenceToken
    || after.taskId !== before.taskId
    || after.workspaceId !== before.workspaceId
    || after.ownerInstanceId !== before.ownerInstanceId
  ) {
    throw new MultiAgentChildRuntimeStartError(
      "child local writer lease identity changed before runtime start",
      "lease_not_current",
    );
  }
}

function childAuthorityProvider(
  input: MultiAgentChildExecutionActivationContext["runtimeInput"],
  ownerInstanceId: string,
  parentBinding: MultiAgentParentExecutionBindingProvider,
): LeaseAwareWriterAuthorityProvider {
  return {
    async revalidateCurrent(taskId: string): Promise<LeaseAwareWriterAuthorityV1> {
      if (taskId !== input.childTaskId) {
        throw new MultiAgentChildRuntimeStartError(
          "child runtime requested authority for a different task",
          "context_invalid",
        );
      }
      const current = await parentBinding.revalidateCurrent(input.parentTaskId);
      assertCurrentParent(input, current);
      return {
        schemaVersion: 1,
        taskId: input.childTaskId,
        ownerInstanceId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        workspaceRegistryRevision: input.workspaceRegistryRevision,
        safetyPlanId: input.safetyPlanId,
        policyVersion: input.safetyPolicyVersion,
        safetyProfileId: input.safetyProfileId,
        safetyProfileRevision: input.safetyProfileRevision,
        workerProfileId: input.workerProfileId,
        allowedPathPatterns: [...input.allowedPathPatterns],
        protectedPathPatterns: [...input.protectedPathPatterns],
      };
    },
  };
}

export class MultiAgentChildRuntimeStarter {
  private readonly providerPreflight: MultiAgentChildProviderPreflight;
  private readonly taskStoreFactory: (workspaceRoot: string) => TaskStore;
  private readonly runnerFactory: MultiAgentChildRuntimeStartOptions["runnerFactory"];

  constructor(private readonly options: MultiAgentChildRuntimeStartOptions) {
    this.providerPreflight = options.providerPreflight ?? preflightProvider;
    this.taskStoreFactory = options.taskStoreFactory ?? ((root) => new TaskStore(root));
    this.runnerFactory = options.runnerFactory;
  }

  async start(
    context: MultiAgentChildExecutionActivationContext,
  ): Promise<OrchestratorTask> {
    assertContext(context);
    const input = context.runtimeInput;

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.options.parentBinding.revalidateCurrent(input.parentTaskId);
    } catch (error) {
      throw new MultiAgentChildRuntimeStartError(
        "current parent execution binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(input, current);
    await assertLeaseCurrent(context);

    let workspace: MultiAgentRegisteredWorkspaceResolutionV1;
    try {
      workspace = await this.options.workspaces.resolveCurrent(input.workspaceId);
    } catch (error) {
      throw new MultiAgentChildRuntimeStartError(
        "registered workspace could not be resolved",
        "workspace_not_current",
        { cause: error },
      );
    }
    if (
      workspace.workspaceId !== input.workspaceId
      || workspace.workspaceRegistryRevision !== input.workspaceRegistryRevision
      || !path.isAbsolute(workspace.canonicalRoot)
    ) {
      throw new MultiAgentChildRuntimeStartError(
        "registered workspace binding changed before child runtime start",
        "workspace_not_current",
      );
    }

    let worker: WorkerConfig;
    try {
      worker = await this.options.resolveWorkerProfile(input.workerProfileId);
    } catch (error) {
      throw new MultiAgentChildRuntimeStartError(
        `child worker profile '${input.workerProfileId}' is unavailable`,
        "worker_profile_unavailable",
        { cause: error },
      );
    }
    const preflight = await this.providerPreflight(worker);
    if (!preflight.ok) {
      throw new MultiAgentChildRuntimeStartError(
        `child provider preflight failed: ${preflight.message}`,
        "provider_preflight_failed",
      );
    }

    const store = this.taskStoreFactory(workspace.canonicalRoot);
    try {
      await store.load(input.childTaskId);
      throw new MultiAgentChildRuntimeStartError(
        "child durable task state already exists; M13G does not resume or replay child runtime",
        "child_state_exists",
      );
    } catch (error) {
      if (!(error instanceof TaskNotFoundError)) {
        if (error instanceof MultiAgentChildRuntimeStartError) throw error;
        throw error;
      }
    }

    await assertLeaseCurrent(context);
    const startedAt = (this.options.now ?? (() => new Date()))();
    if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
      throw new MultiAgentChildRuntimeStartError(
        "child runtime start clock is invalid",
        "context_invalid",
      );
    }

    const childTask: DurableChildTask = {
      id: input.childTaskId,
      goal: input.objective,
      workspace: workspace.canonicalRoot,
      status: "created",
      createdAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      acceptanceCriteria: [...input.acceptanceCriteria],
      validationCommands: [...input.trustedValidationCommands],
      expectedChangedPaths: [...input.allowedPathPatterns],
      sessionGeneration: 0,
      runCount: 0,
      recoveryCount: 0,
      retryCount: 0,
      stallCount: 0,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      workspaceRegistryRevision: input.workspaceRegistryRevision,
      safetyPlanId: input.safetyPlanId,
      safetyPolicyVersion: input.safetyPolicyVersion,
      safetyProfileId: input.safetyProfileId,
      safetyProfileRevision: input.safetyProfileRevision,
      approvedAllowedPathPatterns: [...input.allowedPathPatterns],
      approvedProtectedPathPatterns: [...input.protectedPathPatterns],
      workerProfileId: input.workerProfileId,
    };
    await store.save(childTask);

    const authorityProvider = childAuthorityProvider(
      input,
      context.lease.ownerInstanceId,
      this.options.parentBinding,
    );
    const leaseAwareFactory = new LeaseAwareHubRuntimeFactory(
      this.options.baseRuntimeFactory,
      childTask,
      worker,
      {
        lease: context.lease,
        authorityProvider,
      },
    );
    const runner = this.runnerFactory
      ? this.runnerFactory(workspace.canonicalRoot, worker, leaseAwareFactory)
      : new ClineRunner(workspace.canonicalRoot, worker, {
          runtimeMode: "hub",
          runtimeFactory: leaseAwareFactory,
        });

    let abortPromise: Promise<void> | undefined;
    const abortForLeaseLoss = () => {
      if (abortPromise) return;
      abortPromise = (async () => {
        try {
          await runner.abort(
            input.childTaskId,
            "M13G child local writer lease was lost; execution aborted fail-safe",
          );
        } catch {
          // If the child already became terminal, the lease-aware write boundary
          // still prevents any stale write from proceeding.
        }
      })();
    };
    context.lease.signal.addEventListener("abort", abortForLeaseLoss, { once: true });
    try {
      await assertLeaseCurrent(context);
      if (context.lease.signal.aborted) {
        abortForLeaseLoss();
        await abortPromise;
        throw new MultiAgentChildRuntimeStartError(
          "child local writer lease was lost before runtime start",
          "lease_not_current",
        );
      }
      const result = await runner.start(childTask);
      if (abortPromise) await abortPromise;
      return result;
    } catch (error) {
      throw new MultiAgentChildRuntimeStartError(
        "single child Cline runtime failed closed",
        "runtime_failed",
        { cause: error },
      );
    } finally {
      context.lease.signal.removeEventListener("abort", abortForLeaseLoss);
      if (abortPromise) await abortPromise;
      await runner.close("M13G child runtime complete");
    }
  }
}
