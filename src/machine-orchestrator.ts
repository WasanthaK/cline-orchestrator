import crypto from "node:crypto";
import { ClineRunner } from "./cline-runner.js";
import {
  SdkClineRuntimeFactory,
  type ClineRuntimeFactory,
} from "./cline-runtime.js";
import { evaluateDiffSafety } from "./diff-safety.js";
import { captureGitSnapshot } from "./git-state.js";
import { preflightProvider } from "./provider-preflight.js";
import { rollbackTask as restoreTaskCheckpoint } from "./rollback.js";
import { SafetyPlanService, type SafetyPreviewRequest } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type {
  HumanEscalation,
  OrchestratorTask,
  TaskEvent,
  TaskStatus,
  WorkerConfig,
} from "./types.js";
import {
  buildValidationRepairPrompt,
  runValidationCommands,
  validationFailureMessage,
} from "./validation.js";
import {
  WorkspaceRegistry,
  type RegisteredWorkspace,
  type WorkspaceDiscoveryRecord,
} from "./workspace-registry.js";

type BoundTask = OrchestratorTask & {
  projectId?: string;
  workspaceId?: string;
  workspaceRegistryRevision?: number;
  safetyPlanId?: string;
  safetyPolicyVersion?: string;
  safetyProfileId?: string;
  safetyProfileRevision?: number;
  approvedAllowedPathPatterns?: string[];
  approvedProtectedPathPatterns?: string[];
  workerProfileId?: string;
};

export type WorkerProfileResolver = (
  workerProfileId: string,
) => Promise<WorkerConfig> | WorkerConfig;

export interface PublicTaskView {
  taskId: string;
  projectId: string;
  workspaceId: string;
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  sessionGeneration: number;
  recoveryCount: number;
  contextRotationCount: number;
  validation: {
    configuredCommands: number;
    runCount: number;
    repairCount: number;
    lastPassed?: boolean;
    lastCompletedAt?: string;
  };
  safety: {
    safetyPlanId: string;
    policyVersion: string;
    workerProfileId: string;
    allowedPathPatterns: string[];
    protectedPathPatterns: string[];
  };
  pendingEscalation?: HumanEscalation;
  checkpoint?: {
    checkpointId: string;
    runCount: number;
    createdAt: string;
    available: boolean;
    restoredAt?: string;
  };
  diffSafety?: {
    checkedAt: string;
    passed: boolean;
    finalDiffSummary: string;
    changedFiles: number;
    warningCount: number;
    failureCount: number;
  };
  finishReason?: string;
  error?: string;
}

export interface PublicTaskEvent {
  eventId: string;
  taskId: string;
  type: TaskEvent["type"];
  timestamp: string;
  status?: TaskStatus;
  message?: string;
}

export interface PublicTaskDiff {
  taskId: string;
  checkedAt?: string;
  available: boolean;
  passed?: boolean;
  summary?: string;
  changedFiles?: number;
  changedPaths: Array<{
    path: string;
    previousPath?: string;
    status: string;
    source: string;
  }>;
  warnings: Array<{ code: string; message: string; path?: string }>;
  failures: Array<{ code: string; message: string; path?: string }>;
  truncated: boolean;
}

export interface PublicWorkspaceStatus {
  workspaceId: string;
  projectId: string;
  displayName: string;
  rootAlias: string;
  revision: number;
  safetyProfileId: string;
  safetyProfileRevision: number;
  policyVersion: string;
  git: {
    available: boolean;
    branch?: string;
    head?: string;
    dirty?: boolean;
    changedFiles?: number;
    error?: string;
  };
  tasks: {
    total: number;
    active: number;
    waitingForHuman: number;
  };
  runtime: {
    activeTaskId?: string;
    activeValidationTaskId?: string;
    queuedJobs: number;
    rollbackInProgress: boolean;
  };
}

export class MachineGatewayError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_argument"
      | "task_not_found"
      | "invalid_task_state"
      | "worker_profile_unavailable"
      | "task_binding_stale"
      | "checkpoint_mismatch",
  ) {
    super(message);
    this.name = "MachineGatewayError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INSTRUCTION_CHARS = 20_000;
const MAX_EVENT_MESSAGE_CHARS = 2_000;
const MAX_DIFF_PATHS = 200;

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new MachineGatewayError(`${field} must be an opaque UUID`, "invalid_argument");
  }
  return normalized;
}

function requireInstruction(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new MachineGatewayError("instruction must not be empty", "invalid_argument");
  }
  if (normalized.length > MAX_INSTRUCTION_CHARS) {
    throw new MachineGatewayError(
      `instruction exceeds ${MAX_INSTRUCTION_CHARS} characters`,
      "invalid_argument",
    );
  }
  return normalized;
}

function requirePlanToken(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(normalized)) {
    throw new MachineGatewayError("plan_token is malformed", "invalid_argument");
  }
  return normalized;
}

function isTerminal(task: OrchestratorTask): boolean {
  return [
    "completed",
    "validation_failed",
    "failed",
    "aborted",
    "rolled_back",
  ].includes(task.status);
}

function boundedText(value: string | undefined, max = MAX_EVENT_MESSAGE_CHARS): string | undefined {
  if (!value) return undefined;
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}…`;
}

function checkpointId(task: OrchestratorTask): string | undefined {
  const checkpoint = task.lastRunCheckpoint;
  if (!checkpoint) return undefined;
  return crypto
    .createHash("sha256")
    .update(
      [
        task.id,
        String(checkpoint.runCount),
        checkpoint.createdAt,
        checkpoint.beforeFingerprint?.digest ?? "",
      ].join("\n"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
}

function requiredBinding(task: BoundTask): {
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  policyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
} {
  const strings: Array<[string, string | undefined]> = [
    ["projectId", task.projectId],
    ["workspaceId", task.workspaceId],
    ["safetyPlanId", task.safetyPlanId],
    ["safetyPolicyVersion", task.safetyPolicyVersion],
    ["safetyProfileId", task.safetyProfileId],
    ["workerProfileId", task.workerProfileId],
  ];
  for (const [name, value] of strings) {
    if (!value) {
      throw new MachineGatewayError(
        `Task ${task.id} is missing durable safety binding field ${name}`,
        "task_binding_stale",
      );
    }
  }
  if (!Number.isInteger(task.workspaceRegistryRevision) || !Number.isInteger(task.safetyProfileRevision)) {
    throw new MachineGatewayError(
      `Task ${task.id} is missing durable safety binding revisions`,
      "task_binding_stale",
    );
  }
  return {
    projectId: task.projectId!,
    workspaceId: task.workspaceId!,
    workspaceRegistryRevision: task.workspaceRegistryRevision!,
    safetyPlanId: task.safetyPlanId!,
    policyVersion: task.safetyPolicyVersion!,
    safetyProfileId: task.safetyProfileId!,
    safetyProfileRevision: task.safetyProfileRevision!,
    workerProfileId: task.workerProfileId!,
    allowedPathPatterns: [...(task.approvedAllowedPathPatterns ?? [])],
    protectedPathPatterns: [...(task.approvedProtectedPathPatterns ?? [])],
  };
}

function assertTaskBindingCurrent(task: BoundTask, workspace: RegisteredWorkspace): ReturnType<typeof requiredBinding> {
  const binding = requiredBinding(task);
  if (
    binding.workspaceId !== workspace.workspaceId ||
    binding.projectId !== workspace.projectId ||
    binding.workspaceRegistryRevision !== workspace.revision ||
    binding.safetyProfileId !== workspace.safetyProfile.profileId ||
    binding.safetyProfileRevision !== workspace.safetyProfile.revision ||
    binding.policyVersion !== workspace.safetyProfile.policyVersion ||
    binding.workerProfileId !== workspace.safetyProfile.workerProfileId
  ) {
    throw new MachineGatewayError(
      `Task ${task.id} safety binding no longer matches the registered workspace profile`,
      "task_binding_stale",
    );
  }
  return binding;
}

function publicTask(task: BoundTask): PublicTaskView {
  const binding = requiredBinding(task);
  const id = checkpointId(task);
  return {
    taskId: task.id,
    projectId: binding.projectId,
    workspaceId: binding.workspaceId,
    goal: boundedText(task.goal, 4_000) ?? "",
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    runCount: task.runCount ?? 0,
    sessionGeneration: task.sessionGeneration ?? 0,
    recoveryCount: task.recoveryCount ?? 0,
    contextRotationCount: task.contextRotationCount ?? 0,
    validation: {
      configuredCommands: task.validationCommands?.length ?? 0,
      runCount: task.validationRunCount ?? 0,
      repairCount: task.validationRepairCount ?? 0,
      lastPassed: task.lastValidation?.passed,
      lastCompletedAt: task.lastValidation?.completedAt,
    },
    safety: {
      safetyPlanId: binding.safetyPlanId,
      policyVersion: binding.policyVersion,
      workerProfileId: binding.workerProfileId,
      allowedPathPatterns: binding.allowedPathPatterns,
      protectedPathPatterns: binding.protectedPathPatterns,
    },
    pendingEscalation: task.pendingEscalation
      ? { ...task.pendingEscalation }
      : undefined,
    checkpoint: task.lastRunCheckpoint && id
      ? {
          checkpointId: id,
          runCount: task.lastRunCheckpoint.runCount,
          createdAt: task.lastRunCheckpoint.createdAt,
          available: task.lastRunCheckpoint.available,
          restoredAt: task.lastRunCheckpoint.restoredAt,
        }
      : undefined,
    diffSafety: task.lastDiffSafety
      ? {
          checkedAt: task.lastDiffSafety.checkedAt,
          passed: task.lastDiffSafety.passed,
          finalDiffSummary: boundedText(task.lastDiffSafety.finalDiffSummary, 2_000) ?? "",
          changedFiles: task.lastDiffSafety.summary.changedFiles,
          warningCount: task.lastDiffSafety.warnings.length,
          failureCount: task.lastDiffSafety.failures.length,
        }
      : undefined,
    finishReason: task.finishReason,
    error: boundedText(task.error),
  };
}

function publicEvent(event: TaskEvent): PublicTaskEvent {
  return {
    eventId: event.id,
    taskId: event.taskId,
    type: event.type,
    timestamp: event.timestamp,
    status: event.status,
    message: boundedText(event.message),
  };
}

class WorkspaceController {
  readonly store: TaskStore;
  readonly runner: ClineRunner;
  private tail: Promise<void> = Promise.resolve();
  private activeTaskIdValue: string | undefined;
  private activeValidationTaskIdValue: string | undefined;
  private activeValidationAbort: AbortController | undefined;
  private queuedJobsValue = 0;
  private rollbackInProgressValue = false;

  constructor(
    readonly workspaceId: string,
    readonly workspaceRoot: string,
    readonly workerProfileId: string,
    private readonly worker: WorkerConfig,
    runtimeFactory: ClineRuntimeFactory,
  ) {
    this.store = new TaskStore(workspaceRoot);
    this.runner = new ClineRunner(workspaceRoot, worker, {
      runtimeMode: "hub",
      runtimeFactory,
    });
  }

  status() {
    return {
      activeTaskId: this.activeTaskIdValue,
      activeValidationTaskId: this.activeValidationTaskIdValue,
      queuedJobs: this.queuedJobsValue,
      rollbackInProgress: this.rollbackInProgressValue,
    };
  }

  isIdle(): boolean {
    return !this.activeTaskIdValue && !this.activeValidationTaskIdValue && this.queuedJobsValue === 0 && !this.rollbackInProgressValue;
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async markExecutionFailure(taskId: string, error: unknown): Promise<void> {
    try {
      const task = await this.store.load(taskId);
      if (isTerminal(task) || task.status === "waiting_for_human") return;
      task.status = "failed";
      task.finishReason = "gateway_execution_failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.store.save(task);
    } catch {
      // Preserve the original failure; status persistence is best effort here.
    }
  }

  private enqueue(taskId: string, job: () => Promise<unknown>): void {
    this.queuedJobsValue += 1;
    void this.serial(async () => {
      this.queuedJobsValue = Math.max(0, this.queuedJobsValue - 1);
      const latest = await this.store.load(taskId);
      if (isTerminal(latest)) return;
      this.activeTaskIdValue = taskId;
      try {
        const preflight = await preflightProvider(this.worker);
        if (!preflight.ok) {
          latest.status = "failed";
          latest.finishReason = "provider_preflight_failed";
          latest.error = preflight.message;
          await this.store.save(latest);
          return;
        }
        await job();
      } finally {
        if (this.activeTaskIdValue === taskId) this.activeTaskIdValue = undefined;
      }
    }).catch((error) => {
      void this.markExecutionFailure(taskId, error);
    });
  }

  enqueueStart(task: OrchestratorTask): void {
    this.enqueue(task.id, () => this.executeWithValidation(task, () => this.runner.start(task)));
  }

  enqueueContinue(task: OrchestratorTask, instruction: string): void {
    this.enqueue(task.id, () =>
      this.executeWithValidation(task, () => this.runner.resume(task, instruction)),
    );
  }

  private async executeWithValidation(
    task: OrchestratorTask,
    modelJob: () => Promise<OrchestratorTask>,
  ): Promise<OrchestratorTask> {
    let result = await modelJob();

    while (result.status === "validating") {
      const commands = result.validationCommands ?? [];
      if (commands.length === 0) {
        result.status = "completed";
        result.finishReason = "completed";
        await this.store.save(result);
        return result;
      }

      const controller = new AbortController();
      this.activeValidationTaskIdValue = result.id;
      this.activeValidationAbort = controller;
      let validation;
      try {
        validation = await runValidationCommands(this.workspaceRoot, commands, {
          timeoutMs: this.worker.validationTimeoutMs,
          maxOutputChars: this.worker.maxValidationOutputChars,
          signal: controller.signal,
        });
      } finally {
        if (this.activeValidationTaskIdValue === result.id) {
          this.activeValidationTaskIdValue = undefined;
        }
        if (this.activeValidationAbort === controller) this.activeValidationAbort = undefined;
      }

      const latest = await this.store.load(result.id);
      if (latest.status === "aborted" || controller.signal.aborted) return latest;
      latest.lastValidation = validation;

      if (validation.passed) {
        latest.status = "completed";
        latest.finishReason = "completed";
        latest.error = undefined;
        await this.store.save(latest);
        return latest;
      }

      const failure = validationFailureMessage(validation);
      const repairsUsed = latest.validationRepairCount ?? 0;
      if (repairsUsed >= this.worker.maxValidationRepairs) {
        latest.status = "validation_failed";
        latest.finishReason = "validation_failed";
        latest.error = failure;
        await this.store.save(latest);
        return latest;
      }

      latest.validationRepairCount = repairsUsed + 1;
      latest.status = "repairing";
      latest.finishReason = undefined;
      latest.error = failure;
      await this.store.save(latest);
      result = await this.runner.resume(latest, buildValidationRepairPrompt(latest, validation));
    }

    return result;
  }

  async abort(taskId: string, reason: string): Promise<OrchestratorTask> {
    const task = await this.store.load(taskId);
    if (isTerminal(task)) {
      throw new MachineGatewayError(
        `Task ${taskId} is already ${task.status}`,
        "invalid_task_state",
      );
    }

    if (task.status === "validating" || this.activeValidationTaskIdValue === taskId) {
      const requestedAt = new Date().toISOString();
      await this.store.appendEvent(taskId, "abort_requested", {
        status: task.status,
        message: reason,
      });
      if (this.activeValidationTaskIdValue === taskId) this.activeValidationAbort?.abort();
      task.abortRequestedAt = requestedAt;
      task.abortReason = reason;
      task.status = "aborted";
      task.finishReason = "aborted";
      task.error = undefined;
      await this.store.save(task);
      return task;
    }

    return await this.runner.abort(taskId, reason);
  }

  async rollback(taskId: string): Promise<OrchestratorTask> {
    if (!this.isIdle()) {
      throw new MachineGatewayError(
        "Rollback requires an idle workspace with no active or queued work",
        "invalid_task_state",
      );
    }
    this.rollbackInProgressValue = true;
    try {
      return await this.serial(() =>
        restoreTaskCheckpoint(this.store, this.workspaceRoot, taskId),
      );
    } finally {
      this.rollbackInProgressValue = false;
    }
  }

  async close(): Promise<void> {
    await this.tail;
    await this.runner.close("machine gateway shutdown");
  }
}

export class MachineOrchestratorService {
  private readonly controllers = new Map<string, WorkspaceController>();
  private readonly escalationDecisions = new Set<string>();

  constructor(
    readonly registry: WorkspaceRegistry,
    readonly safetyPlans: SafetyPlanService,
    private readonly resolveWorkerProfile: WorkerProfileResolver,
    private readonly runtimeFactory: ClineRuntimeFactory = new SdkClineRuntimeFactory(),
  ) {}

  async listProjects() {
    return await this.registry.listProjects();
  }

  async listWorkspaces(): Promise<WorkspaceDiscoveryRecord[]> {
    return await this.registry.listWorkspaces();
  }

  private async getController(workspace: RegisteredWorkspace): Promise<WorkspaceController> {
    const existing = this.controllers.get(workspace.workspaceId);
    if (existing && existing.workerProfileId === workspace.safetyProfile.workerProfileId) {
      return existing;
    }
    if (existing && !existing.isIdle()) {
      throw new MachineGatewayError(
        `Workspace ${workspace.workspaceId} changed worker profile while work is active`,
        "invalid_task_state",
      );
    }
    if (existing) await existing.close();

    let worker: WorkerConfig;
    try {
      worker = await this.resolveWorkerProfile(workspace.safetyProfile.workerProfileId);
    } catch (error) {
      throw new MachineGatewayError(
        `Worker profile '${workspace.safetyProfile.workerProfileId}' is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        "worker_profile_unavailable",
      );
    }
    const controller = new WorkspaceController(
      workspace.workspaceId,
      workspace.canonicalRoot,
      workspace.safetyProfile.workerProfileId,
      worker,
      this.runtimeFactory,
    );
    this.controllers.set(workspace.workspaceId, controller);
    return controller;
  }

  async getWorkspaceStatus(workspaceId: string): Promise<PublicWorkspaceStatus> {
    workspaceId = requireUuid(workspaceId, "workspace_id");
    const workspace = await this.registry.resolveVerifiedWorkspace(workspaceId);
    const [git, tasks] = await Promise.all([
      captureGitSnapshot(workspace.canonicalRoot),
      new TaskStore(workspace.canonicalRoot).list(),
    ]);
    const discovery = (await this.registry.listWorkspaces()).find(
      (item) => item.workspaceId === workspaceId,
    );
    if (!discovery) {
      throw new MachineGatewayError("Registered workspace disappeared", "invalid_argument");
    }
    const controller = this.controllers.get(workspaceId);
    return {
      ...discovery,
      git: {
        available: git.available,
        branch: git.branch,
        head: git.head,
        dirty: git.dirty,
        changedFiles: git.changedFiles,
        error: boundedText(git.error),
      },
      tasks: {
        total: tasks.length,
        active: tasks.filter((task) => ["running", "waiting", "stalled", "validating", "repairing"].includes(task.status)).length,
        waitingForHuman: tasks.filter((task) => task.status === "waiting_for_human").length,
      },
      runtime: controller?.status() ?? {
        queuedJobs: 0,
        rollbackInProgress: false,
      },
    };
  }

  private async candidateWorkspaces(projectId?: string, workspaceId?: string): Promise<RegisteredWorkspace[]> {
    if (workspaceId) {
      const workspace = await this.registry.resolveVerifiedWorkspace(
        requireUuid(workspaceId, "workspace_id"),
      );
      if (projectId && workspace.projectId !== requireUuid(projectId, "project_id")) return [];
      return [workspace];
    }
    const records = await this.registry.listWorkspaces();
    const filtered = projectId
      ? records.filter((item) => item.projectId === requireUuid(projectId, "project_id"))
      : records;
    return await Promise.all(
      filtered.map((item) => this.registry.resolveVerifiedWorkspace(item.workspaceId)),
    );
  }

  async findTasks(options: {
    projectId?: string;
    workspaceId?: string;
    status?: TaskStatus;
    query?: string;
    limit?: number;
  } = {}): Promise<PublicTaskView[]> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 25));
    const query = options.query?.trim().toLowerCase();
    const workspaces = await this.candidateWorkspaces(options.projectId, options.workspaceId);
    const values: PublicTaskView[] = [];
    for (const workspace of workspaces) {
      for (const rawTask of await new TaskStore(workspace.canonicalRoot).list()) {
        const task = rawTask as BoundTask;
        try {
          const binding = requiredBinding(task);
          if (binding.workspaceId !== workspace.workspaceId) continue;
          if (options.status && task.status !== options.status) continue;
          if (query && !`${task.id} ${task.goal} ${task.status}`.toLowerCase().includes(query)) continue;
          values.push(publicTask(task));
        } catch {
          // Legacy/unapproved tasks are deliberately not exposed through the write-capable gateway.
        }
      }
    }
    return values
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  private async locateTask(taskId: string): Promise<{
    task: BoundTask;
    workspace: RegisteredWorkspace;
    store: TaskStore;
  }> {
    taskId = requireUuid(taskId, "task_id");
    const records = await this.registry.listWorkspaces();
    let match:
      | { task: BoundTask; workspace: RegisteredWorkspace; store: TaskStore }
      | undefined;

    for (const record of records) {
      const workspace = await this.registry.resolveVerifiedWorkspace(record.workspaceId);
      const store = new TaskStore(workspace.canonicalRoot);
      try {
        const task = (await store.load(taskId)) as BoundTask;
        const binding = requiredBinding(task);
        if (binding.workspaceId !== workspace.workspaceId) continue;
        if (match) {
          throw new MachineGatewayError(
            `Task ${taskId} is ambiguous across registered workspaces`,
            "invalid_task_state",
          );
        }
        match = { task, workspace, store };
      } catch (error) {
        if (error instanceof TaskNotFoundError) continue;
        throw error;
      }
    }

    if (!match) {
      throw new MachineGatewayError(`Task ${taskId} was not found`, "task_not_found");
    }
    return match;
  }

  async getTask(taskId: string): Promise<PublicTaskView> {
    const { task } = await this.locateTask(taskId);
    return publicTask(task);
  }

  async getTaskEvents(taskId: string): Promise<PublicTaskEvent[]> {
    const { task, store } = await this.locateTask(taskId);
    return (await store.events(task.id)).map(publicEvent);
  }

  async getTaskDiff(taskId: string): Promise<PublicTaskDiff> {
    const { task, workspace } = await this.locateTask(taskId);
    const binding = assertTaskBindingCurrent(task, workspace);
    if (!task.lastRunCheckpoint) {
      return {
        taskId: task.id,
        available: false,
        changedPaths: [],
        warnings: [],
        failures: [],
        truncated: false,
      };
    }
    const result = await evaluateDiffSafety(
      workspace.canonicalRoot,
      task.lastRunCheckpoint,
      {
        maxChangedFiles: workspace.safetyProfile.maxChangedFiles,
        protectedPatterns: binding.protectedPathPatterns,
        warningPatterns: [],
        expectedChangedPaths: binding.allowedPathPatterns,
      },
      binding.allowedPathPatterns,
    );
    const changedPaths = result.changedPaths.slice(0, MAX_DIFF_PATHS).map((item) => ({
      path: item.path,
      previousPath: item.previousPath,
      status: item.status,
      source: item.source,
    }));
    return {
      taskId: task.id,
      checkedAt: result.checkedAt,
      available: true,
      passed: result.passed,
      summary: boundedText(result.finalDiffSummary, 2_000),
      changedFiles: result.summary.changedFiles,
      changedPaths,
      warnings: result.warnings.map((item) => ({
        code: item.code,
        message: boundedText(item.message) ?? "",
        path: item.path,
      })),
      failures: result.failures.map((item) => ({
        code: item.code,
        message: boundedText(item.message) ?? "",
        path: item.path,
      })),
      truncated: result.changedPaths.length > changedPaths.length,
    };
  }

  async previewTask(request: SafetyPreviewRequest) {
    requireUuid(request.workspaceId, "workspace_id");
    if (request.goal.length > MAX_INSTRUCTION_CHARS) {
      throw new MachineGatewayError(
        `goal exceeds ${MAX_INSTRUCTION_CHARS} characters`,
        "invalid_argument",
      );
    }
    return await this.safetyPlans.preview(request);
  }

  async startTask(planToken: string): Promise<PublicTaskView> {
    const started = await startApprovedTask(this.safetyPlans, requirePlanToken(planToken));
    const task = started.task as BoundTask;
    const binding = requiredBinding(task);
    const workspace = await this.registry.resolveVerifiedWorkspace(binding.workspaceId);
    assertTaskBindingCurrent(task, workspace);
    const controller = await this.getController(workspace);

    task.status = "waiting";
    task.lastPrompt = task.goal;
    await controller.store.save(task);
    await controller.store.appendEvent(task.id, "queued", {
      status: task.status,
      message: "Approved task queued through the machine MCP gateway",
    });
    controller.enqueueStart(task);
    return publicTask(task);
  }

  async continueTask(taskId: string, instruction: string): Promise<PublicTaskView> {
    instruction = requireInstruction(instruction);
    const { task, workspace, store } = await this.locateTask(taskId);
    assertTaskBindingCurrent(task, workspace);
    if (["running", "waiting", "stalled", "validating", "repairing"].includes(task.status)) {
      throw new MachineGatewayError(
        `Task ${task.id} is already ${task.status}`,
        "invalid_task_state",
      );
    }
    if (task.status === "rolled_back") {
      throw new MachineGatewayError(
        `Task ${task.id} was rolled back; create a new Safety Preview instead`,
        "invalid_task_state",
      );
    }
    if (task.status === "waiting_for_human" || task.pendingEscalation) {
      throw new MachineGatewayError(
        `Task ${task.id} has an unresolved/escalated safety decision; it cannot be continued inside the old envelope`,
        "invalid_task_state",
      );
    }

    const controller = await this.getController(workspace);
    task.status = "waiting";
    task.lastPrompt = instruction;
    task.error = undefined;
    task.finishReason = undefined;
    task.lastValidation = undefined;
    task.validationRepairCount = 0;
    await store.save(task);
    await store.appendEvent(task.id, "resume_queued", {
      status: task.status,
      message: "Task continuation queued inside the existing approved safety envelope",
    });
    controller.enqueueContinue(task, instruction);
    return publicTask(task);
  }

  async abortTask(taskId: string, reason = "Task aborted by user"): Promise<PublicTaskView> {
    const { task, workspace } = await this.locateTask(taskId);
    assertTaskBindingCurrent(task, workspace);
    const controller = await this.getController(workspace);
    return publicTask((await controller.abort(task.id, boundedText(reason, 500) ?? "Task aborted by user")) as BoundTask);
  }

  async approveEscalation(taskId: string, escalationId: string): Promise<{
    task: PublicTaskView;
    nextAction: "new_safety_preview_required";
  }> {
    const task = await this.decideEscalation(taskId, escalationId, "approved");
    return { task, nextAction: "new_safety_preview_required" };
  }

  async rejectEscalation(taskId: string, escalationId: string): Promise<PublicTaskView> {
    return await this.decideEscalation(taskId, escalationId, "rejected");
  }

  private async decideEscalation(
    taskId: string,
    escalationId: string,
    decision: "approved" | "rejected",
  ): Promise<PublicTaskView> {
    taskId = requireUuid(taskId, "task_id");
    escalationId = requireUuid(escalationId, "escalation_id");
    if (this.escalationDecisions.has(taskId)) {
      throw new MachineGatewayError("A safety decision is already in progress for this task", "invalid_task_state");
    }
    this.escalationDecisions.add(taskId);
    try {
      const located = await this.locateTask(taskId);
      const task = located.task;
      assertTaskBindingCurrent(task, located.workspace);
      const escalation = task.pendingEscalation;
      if (task.status !== "waiting_for_human" || !escalation || escalation.escalationId !== escalationId || escalation.status !== "pending") {
        throw new MachineGatewayError("Pending escalation does not match", "invalid_task_state");
      }

      escalation.status = decision;
      task.status = "aborted";
      task.finishReason = "aborted";
      task.abortReason = decision === "approved"
        ? "Scope expansion was approved; a new Safety Preview is required before any broader authority is granted"
        : "Safety escalation rejected by user";
      await located.store.save(task);
      await located.store.appendEvent(task.id, decision === "approved" ? "human_escalation_approved" : "human_escalation_rejected", {
        status: task.status,
        message: decision === "approved"
          ? "Escalation approved; original task envelope remains immutable and is closed"
          : "Safety escalation rejected; task closed",
        data: { escalationId },
      });
      return publicTask(task);
    } finally {
      this.escalationDecisions.delete(taskId);
    }
  }

  async rollbackTask(taskId: string, requestedCheckpointId: string): Promise<PublicTaskView> {
    const { task, workspace } = await this.locateTask(taskId);
    assertTaskBindingCurrent(task, workspace);
    const expected = checkpointId(task);
    if (!expected || requestedCheckpointId.trim() !== expected) {
      throw new MachineGatewayError(
        "checkpoint_id does not match the task's current rollback checkpoint",
        "checkpoint_mismatch",
      );
    }
    const controller = await this.getController(workspace);
    return publicTask((await controller.rollback(task.id)) as BoundTask);
  }

  async close(): Promise<void> {
    await Promise.all([...this.controllers.values()].map((controller) => controller.close()));
    this.controllers.clear();
  }
}
