import path from "node:path";
import { ClineRunner } from "./cline-runner.js";
import type { ClineRuntimeFactory } from "./cline-runtime.js";
import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type {
  MultiAgentRegisteredWorkspaceResolutionV1,
  MultiAgentRegisteredWorkspaceResolver,
  MultiAgentChildWorkerProfileResolver,
  MultiAgentChildProviderPreflight,
} from "./multi-agent-child-runtime-start.js";
import type {
  MultiAgentRepairChildActivationContext,
} from "./multi-agent-repair-child-activation.js";
import { LeaseAwareHubRuntimeFactory } from "./lease-aware-hub-runtime.js";
import type {
  LeaseAwareWriterAuthorityProvider,
  LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { preflightProvider } from "./provider-preflight.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type {
  OrchestratorTask,
  WorkerConfig,
} from "./types.js";

export const MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresM13NActivationContext: true as const,
  requiresFreshParentBindingImmediatelyBeforeStart: true as const,
  requiresFreshLocalWriterLeaseImmediatelyBeforeStart: true as const,
  requiresRegisteredWorkspaceResolution: true as const,
  persistsFreshRepairChildTaskAtStart: true as const,
  resumesExistingRepairChildTask: false as const,
  reusesPriorChildTaskState: false as const,
  reusesPriorChildSessionState: false as const,
  reusesPriorChildCheckpointState: false as const,
  usesExistingClineRunner: true as const,
  usesExistingLeaseAwareHubSafety: true as const,
  nativeSubagentsEnabled: false as const,
  nativeAgentTeamsEnabled: false as const,
  modelShellEnabled: false as const,
  modelNetworkEnabled: false as const,
  mcpEnabled: false as const,
  pluginsEnabled: false as const,
  distributedRepairExecutionEnabled: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRepairChildRuntimeStartOptions {
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

export class MultiAgentRepairChildRuntimeStartError extends Error {
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
      | "repair_child_state_exists"
      | "prior_child_reuse"
      | "runtime_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentRepairChildRuntimeStartError";
  }
}

type DurableRepairChildTask = OrchestratorTask & {
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
  parentTaskId: string;
  priorChildTaskId: string;
  repairAttempt: number;
};

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertContext(context: MultiAgentRepairChildActivationContext): void {
  const evidence = context?.evidence;
  const input = context?.runtimeInput;
  const lease = context?.lease;
  if (
    !evidence
    || evidence.schemaVersion !== 1
    || evidence.authority !== "repair_child_activation_evidence_only"
    || evidence.runtimeStartAuthorized !== false
    || evidence.grantsTaskAuthority !== false
    || evidence.grantsFilesystemAuthority !== false
    || evidence.grantsSafetyPlanAuthority !== false
    || evidence.grantsWriterLeaseAuthority !== false
    || evidence.grantsCredentialAuthority !== false
    || evidence.grantsReleaseAuthority !== false
    || !input
    || input.schemaVersion !== 1
    || input.authority !== "repair_child_runtime_input_only"
    || input.runtimeStartAuthorized !== false
    || input.priorChildResumeAllowed !== false
    || input.grantsTaskAuthority !== false
    || input.grantsFilesystemAuthority !== false
    || input.grantsSafetyPlanAuthority !== false
    || input.grantsWriterLeaseAuthority !== false
    || input.grantsCredentialAuthority !== false
    || input.grantsReleaseAuthority !== false
    || !lease
    || evidence.repairChildTaskId !== input.repairChildTaskId
    || evidence.priorChildTaskId !== input.priorChildTaskId
    || evidence.parentTaskId !== input.parentTaskId
    || evidence.workspaceId !== input.workspaceId
    || lease.taskId !== input.repairChildTaskId
    || lease.taskId === input.priorChildTaskId
    || lease.workspaceId !== input.workspaceId
    || input.repairChildTaskId === input.priorChildTaskId
  ) {
    throw new MultiAgentRepairChildRuntimeStartError(
      "M13N repair-child activation context is incomplete, widened, or cross-bound",
      "context_invalid",
    );
  }
}

function assertCurrentParent(
  input: MultiAgentRepairChildActivationContext["runtimeInput"],
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
    throw new MultiAgentRepairChildRuntimeStartError(
      "current parent task/Safety binding no longer matches activated repair child",
      "parent_not_current",
    );
  }
  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentRepairChildRuntimeStartError(
      "current parent state does not permit repair-child runtime start",
      "parent_not_executable",
    );
  }
}

async function assertLeaseCurrent(
  context: MultiAgentRepairChildActivationContext,
): Promise<void> {
  const lease = context.lease;
  const evidence = context.evidence;
  const input = context.runtimeInput;
  if (lease.signal.aborted || lease.taskId === input.priorChildTaskId) {
    throw new MultiAgentRepairChildRuntimeStartError(
      "repair-child local writer lease is aborted or reuses prior-child identity",
      lease.taskId === input.priorChildTaskId ? "prior_child_reuse" : "lease_not_current",
    );
  }
  const before = lease.currentClaim();
  if (
    before.authority !== "coordination_only"
    || before.taskId !== input.repairChildTaskId
    || before.taskId === input.priorChildTaskId
    || before.workspaceId !== input.workspaceId
    || before.ownerInstanceId !== lease.ownerInstanceId
    || before.leaseId !== evidence.leaseId
    || before.fenceToken !== evidence.fenceToken
  ) {
    throw new MultiAgentRepairChildRuntimeStartError(
      "repair-child local writer lease no longer matches M13N activation evidence",
      "lease_not_current",
    );
  }
  try {
    await lease.validateCurrent();
  } catch (error) {
    throw new MultiAgentRepairChildRuntimeStartError(
      "repair-child local writer lease is no longer current",
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
    throw new MultiAgentRepairChildRuntimeStartError(
      "repair-child local writer lease identity changed before runtime start",
      "lease_not_current",
    );
  }
}

function repairAuthorityProvider(
  input: MultiAgentRepairChildActivationContext["runtimeInput"],
  ownerInstanceId: string,
  parentBinding: MultiAgentParentExecutionBindingProvider,
): LeaseAwareWriterAuthorityProvider {
  return {
    async revalidateCurrent(taskId: string): Promise<LeaseAwareWriterAuthorityV1> {
      if (taskId !== input.repairChildTaskId || taskId === input.priorChildTaskId) {
        throw new MultiAgentRepairChildRuntimeStartError(
          "repair-child runtime requested authority for the wrong task identity",
          "prior_child_reuse",
        );
      }
      const current = await parentBinding.revalidateCurrent(input.parentTaskId);
      assertCurrentParent(input, current);
      return {
        schemaVersion: 1,
        taskId: input.repairChildTaskId,
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

function repairGoal(
  input: MultiAgentRepairChildActivationContext["runtimeInput"],
): string {
  return [
    input.objective.trim(),
    "",
    `Repair attempt ${input.repairAttempt}.`,
    `Repair instruction: ${input.repairInstruction.trim()}`,
    "",
    "Stay strictly within the existing child objective, acceptance criteria, and approved write scope.",
    "Do not broaden scope, alter trusted validation/Safety/worker policy, or reuse prior-child runtime/session/checkpoint state.",
  ].join("\n");
}

export class MultiAgentRepairChildRuntimeStarter {
  private readonly providerPreflight: MultiAgentChildProviderPreflight;
  private readonly taskStoreFactory: (workspaceRoot: string) => TaskStore;
  private readonly runnerFactory: MultiAgentRepairChildRuntimeStartOptions["runnerFactory"];

  constructor(private readonly options: MultiAgentRepairChildRuntimeStartOptions) {
    this.providerPreflight = options.providerPreflight ?? preflightProvider;
    this.taskStoreFactory = options.taskStoreFactory ?? ((root) => new TaskStore(root));
    this.runnerFactory = options.runnerFactory;
  }

  async start(
    context: MultiAgentRepairChildActivationContext,
  ): Promise<OrchestratorTask> {
    assertContext(context);
    const input = context.runtimeInput;

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.options.parentBinding.revalidateCurrent(input.parentTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildRuntimeStartError(
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
      throw new MultiAgentRepairChildRuntimeStartError(
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
      throw new MultiAgentRepairChildRuntimeStartError(
        "registered workspace binding changed before repair-child runtime start",
        "workspace_not_current",
      );
    }

    let worker: WorkerConfig;
    try {
      worker = await this.options.resolveWorkerProfile(input.workerProfileId);
    } catch (error) {
      throw new MultiAgentRepairChildRuntimeStartError(
        `repair-child worker profile '${input.workerProfileId}' is unavailable`,
        "worker_profile_unavailable",
        { cause: error },
      );
    }
    const preflight = await this.providerPreflight(worker);
    if (!preflight.ok) {
      throw new MultiAgentRepairChildRuntimeStartError(
        `repair-child provider preflight failed: ${preflight.message}`,
        "provider_preflight_failed",
      );
    }

    const store = this.taskStoreFactory(workspace.canonicalRoot);
    try {
      await store.load(input.repairChildTaskId);
      throw new MultiAgentRepairChildRuntimeStartError(
        "repair-child durable task state already exists; M13O never resumes or replays repair-child runtime",
        "repair_child_state_exists",
      );
    } catch (error) {
      if (!(error instanceof TaskNotFoundError)) {
        if (error instanceof MultiAgentRepairChildRuntimeStartError) throw error;
        throw error;
      }
    }

    if (input.repairChildTaskId === input.priorChildTaskId) {
      throw new MultiAgentRepairChildRuntimeStartError(
        "repair child cannot reuse prior child task identity",
        "prior_child_reuse",
      );
    }

    await assertLeaseCurrent(context);
    const startedAt = (this.options.now ?? (() => new Date()))();
    if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
      throw new MultiAgentRepairChildRuntimeStartError(
        "repair-child runtime start clock is invalid",
        "context_invalid",
      );
    }

    const repairTask: DurableRepairChildTask = {
      id: input.repairChildTaskId,
      goal: repairGoal(input),
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
      parentTaskId: input.parentTaskId,
      priorChildTaskId: input.priorChildTaskId,
      repairAttempt: input.repairAttempt,
    };
    await store.save(repairTask);

    const authorityProvider = repairAuthorityProvider(
      input,
      context.lease.ownerInstanceId,
      this.options.parentBinding,
    );
    const leaseAwareFactory = new LeaseAwareHubRuntimeFactory(
      this.options.baseRuntimeFactory,
      repairTask,
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
            input.repairChildTaskId,
            "M13O repair-child local writer lease was lost; execution aborted fail-safe",
          );
        } catch {
          // Terminal state or failed abort remains fail-safe because the lease-aware
          // write boundary rejects any stale write after lease loss.
        }
      })();
    };

    context.lease.signal.addEventListener("abort", abortForLeaseLoss, { once: true });
    try {
      await assertLeaseCurrent(context);
      if (context.lease.signal.aborted) {
        abortForLeaseLoss();
        await abortPromise;
        throw new MultiAgentRepairChildRuntimeStartError(
          "repair-child local writer lease was lost before runtime start",
          "lease_not_current",
        );
      }
      const result = await runner.start(repairTask);
      if (abortPromise) await abortPromise;
      return result;
    } catch (error) {
      throw new MultiAgentRepairChildRuntimeStartError(
        "single repair-child Cline runtime failed closed",
        "runtime_failed",
        { cause: error },
      );
    } finally {
      context.lease.signal.removeEventListener("abort", abortForLeaseLoss);
      if (abortPromise) await abortPromise;
      await runner.close("M13O repair-child runtime complete");
    }
  }
}
