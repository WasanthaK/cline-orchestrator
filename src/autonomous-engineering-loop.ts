import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REASON_CHARS = 500;
const MAX_IMPLEMENTATION_ITERATIONS = 8;
const MAX_REPAIR_ATTEMPTS = 2;

export const AUTONOMOUS_ENGINEERING_LOOP_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_loop_state_only" as const,
  durable: true as const,
  restartSafeByRevisionedState: true as const,
  plannerOutputAdvisoryOnly: true as const,
  reviewerOutputAdvisoryOnly: true as const,
  completionProseAdvisoryOnly: true as const,
  requiresIndependentValidationEvidence: true as const,
  requiresIndependentDiffSafetyEvidence: true as const,
  requiresCheckpointEvidence: true as const,
  requiresCurrentTaskSafetyBindingBeforeExecution: true as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDistributedDispatch: false as const,
  performsGitDelivery: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export type AutonomousEngineeringLoopPhase =
  | "ready"
  | "implementation_in_progress"
  | "awaiting_review"
  | "repair_ready"
  | "succeeded"
  | "failed"
  | "waiting_for_human";

export interface AutonomousEngineeringLoopAuthorityBindingV1 {
  supervisorTaskId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
}

export interface AutonomousEngineeringLoopBudgetV1 {
  maxImplementationIterations: number;
  maxRepairAttempts: number;
}

export interface AutonomousEngineeringLoopCountersV1 {
  implementationIterationsStarted: number;
  repairAttemptsStarted: number;
}

export interface AutonomousEngineeringLoopStateV1 {
  schemaVersion: 1;
  loopId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  phase: AutonomousEngineeringLoopPhase;
  authorityBinding: AutonomousEngineeringLoopAuthorityBindingV1;
  budget: AutonomousEngineeringLoopBudgetV1;
  counters: AutonomousEngineeringLoopCountersV1;
  stopReason?: string;
  authority: "autonomous_engineering_loop_state_only";
  executable: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export type AutonomousEngineeringLoopEventV1 =
  | { type: "implementation_started"; at: string }
  | { type: "completion_evidence_captured"; at: string }
  | { type: "review_pass"; at: string }
  | { type: "review_repair"; at: string }
  | { type: "repair_started"; at: string }
  | { type: "human_escalation"; at: string; reason: string }
  | { type: "terminal_failure"; at: string; reason: string };

export interface CreateAutonomousEngineeringLoopOptions {
  now?: () => Date;
  idFactory?: () => string;
  maxImplementationIterations?: number;
  maxRepairAttempts?: number;
}

export class AutonomousEngineeringLoopError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "loop_invalid"
      | "budget_invalid"
      | "binding_invalid"
      | "transition_invalid"
      | "store_invalid"
      | "revision_conflict",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringLoopError";
  }
}

function validDate(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function boundedReason(value: string): string {
  if (typeof value !== "string") {
    throw new AutonomousEngineeringLoopError("stop reason must be a string", "transition_invalid");
  }
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0") || normalized.length > MAX_REASON_CHARS) {
    throw new AutonomousEngineeringLoopError("stop reason is invalid", "transition_invalid");
  }
  return normalized;
}

function budgetValue(value: number | undefined, fallback: number, max: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > max) {
    throw new AutonomousEngineeringLoopError(
      `${field} must be an integer between 0 and ${max}`,
      "budget_invalid",
    );
  }
  return resolved;
}

function assertSupervisorTask(task: SupervisorTaskV1): void {
  if (
    task.schemaVersion !== 1
    || !UUID.test(task.supervisorTaskId)
    || !UUID.test(task.taskId)
    || !UUID.test(task.authority.projectId)
    || !UUID.test(task.authority.workspaceId)
    || !UUID.test(task.authority.safetyPlanId)
    || !UUID.test(task.authority.safetyProfileId)
    || !Number.isSafeInteger(task.authority.workspaceRegistryRevision)
    || task.authority.workspaceRegistryRevision < 1
    || !Number.isSafeInteger(task.authority.safetyProfileRevision)
    || task.authority.safetyProfileRevision < 1
    || !task.authority.safetyPolicyVersion.trim()
    || !task.authority.workerProfileId.trim()
    || task.authority.allowedPathPatterns.length === 0
    || task.constraints.scopeExpansion !== "stop_and_escalate"
    || task.constraints.repositoryInstructionsGrantAuthority !== false
    || task.constraints.modelShellAllowed !== false
    || task.constraints.modelNetworkAllowed !== false
    || task.constraints.modelMcpAllowed !== false
    || task.constraints.modelPluginsAllowed !== false
    || task.constraints.subagentsAllowed !== false
    || task.constraints.agentTeamsAllowed !== false
    || task.constraints.validationRunsExternally !== true
    || task.constraints.completionRequiresOrchestratorValidation !== true
    || task.constraints.completionRequiresDiffSafety !== true
  ) {
    throw new AutonomousEngineeringLoopError(
      "supervisor task is invalid or wider than the autonomous-loop contract",
      "binding_invalid",
    );
  }
}

function assertState(value: AutonomousEngineeringLoopStateV1): void {
  const terminal = ["succeeded", "failed", "waiting_for_human"].includes(value.phase);
  if (
    value.schemaVersion !== 1
    || value.authority !== "autonomous_engineering_loop_state_only"
    || value.executable !== false
    || !UUID.test(value.loopId)
    || !validDate(value.createdAt)
    || !validDate(value.updatedAt)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !UUID.test(value.authorityBinding.supervisorTaskId)
    || !UUID.test(value.authorityBinding.taskId)
    || !UUID.test(value.authorityBinding.projectId)
    || !UUID.test(value.authorityBinding.workspaceId)
    || !UUID.test(value.authorityBinding.safetyPlanId)
    || !UUID.test(value.authorityBinding.safetyProfileId)
    || !Number.isSafeInteger(value.authorityBinding.workspaceRegistryRevision)
    || value.authorityBinding.workspaceRegistryRevision < 1
    || !Number.isSafeInteger(value.authorityBinding.safetyProfileRevision)
    || value.authorityBinding.safetyProfileRevision < 1
    || !value.authorityBinding.safetyPolicyVersion.trim()
    || !value.authorityBinding.workerProfileId.trim()
    || value.authorityBinding.allowedPathPatterns.length === 0
    || !Number.isSafeInteger(value.budget.maxImplementationIterations)
    || value.budget.maxImplementationIterations < 1
    || value.budget.maxImplementationIterations > MAX_IMPLEMENTATION_ITERATIONS
    || !Number.isSafeInteger(value.budget.maxRepairAttempts)
    || value.budget.maxRepairAttempts < 0
    || value.budget.maxRepairAttempts > MAX_REPAIR_ATTEMPTS
    || value.budget.maxRepairAttempts > value.budget.maxImplementationIterations - 1
    || !Number.isSafeInteger(value.counters.implementationIterationsStarted)
    || value.counters.implementationIterationsStarted < 0
    || value.counters.implementationIterationsStarted > value.budget.maxImplementationIterations
    || !Number.isSafeInteger(value.counters.repairAttemptsStarted)
    || value.counters.repairAttemptsStarted < 0
    || value.counters.repairAttemptsStarted > value.budget.maxRepairAttempts
    || value.counters.repairAttemptsStarted > value.counters.implementationIterationsStarted
    || (terminal && !value.stopReason)
    || (!terminal && value.stopReason !== undefined)
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringLoopError(
      "autonomous engineering loop state is invalid or widened",
      "loop_invalid",
    );
  }
}

function eventTime(event: AutonomousEngineeringLoopEventV1): string {
  if (!validDate(event.at)) {
    throw new AutonomousEngineeringLoopError("transition timestamp is invalid", "transition_invalid");
  }
  return new Date(event.at).toISOString();
}

export function createAutonomousEngineeringLoop(
  task: SupervisorTaskV1,
  options: CreateAutonomousEngineeringLoopOptions = {},
): AutonomousEngineeringLoopStateV1 {
  assertSupervisorTask(task);
  const maxImplementationIterations = budgetValue(
    options.maxImplementationIterations,
    4,
    MAX_IMPLEMENTATION_ITERATIONS,
    "maxImplementationIterations",
  );
  if (maxImplementationIterations < 1) {
    throw new AutonomousEngineeringLoopError(
      "maxImplementationIterations must be at least 1",
      "budget_invalid",
    );
  }
  const maxRepairAttempts = budgetValue(
    options.maxRepairAttempts,
    Math.min(2, maxImplementationIterations - 1),
    MAX_REPAIR_ATTEMPTS,
    "maxRepairAttempts",
  );
  if (maxRepairAttempts > maxImplementationIterations - 1) {
    throw new AutonomousEngineeringLoopError(
      "repair budget must fit inside the implementation-iteration budget",
      "budget_invalid",
    );
  }

  const now = (options.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AutonomousEngineeringLoopError("loop clock is invalid", "loop_invalid");
  }
  const loopId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!UUID.test(loopId)) {
    throw new AutonomousEngineeringLoopError("loopId must be an opaque UUID", "loop_invalid");
  }

  const state: AutonomousEngineeringLoopStateV1 = {
    schemaVersion: 1,
    loopId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    phase: "ready",
    authorityBinding: {
      supervisorTaskId: task.supervisorTaskId,
      taskId: task.taskId,
      projectId: task.authority.projectId,
      workspaceId: task.authority.workspaceId,
      workspaceRegistryRevision: task.authority.workspaceRegistryRevision,
      safetyPlanId: task.authority.safetyPlanId,
      safetyPolicyVersion: task.authority.safetyPolicyVersion,
      safetyProfileId: task.authority.safetyProfileId,
      safetyProfileRevision: task.authority.safetyProfileRevision,
      workerProfileId: task.authority.workerProfileId,
      allowedPathPatterns: [...task.authority.allowedPathPatterns],
      protectedPathPatterns: [...task.authority.protectedPathPatterns],
    },
    budget: { maxImplementationIterations, maxRepairAttempts },
    counters: { implementationIterationsStarted: 0, repairAttemptsStarted: 0 },
    authority: "autonomous_engineering_loop_state_only",
    executable: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  assertState(state);
  return Object.freeze(structuredClone(state));
}

export function transitionAutonomousEngineeringLoop(
  input: AutonomousEngineeringLoopStateV1,
  event: AutonomousEngineeringLoopEventV1,
): AutonomousEngineeringLoopStateV1 {
  assertState(input);
  const state = structuredClone(input);
  const at = eventTime(event);

  if (["succeeded", "failed", "waiting_for_human"].includes(state.phase)) {
    throw new AutonomousEngineeringLoopError("terminal loop state cannot transition", "transition_invalid");
  }

  const next = (): AutonomousEngineeringLoopStateV1 => {
    state.revision += 1;
    state.updatedAt = at;
    assertState(state);
    return Object.freeze(structuredClone(state));
  };

  if (event.type === "human_escalation") {
    state.phase = "waiting_for_human";
    state.stopReason = boundedReason(event.reason);
    return next();
  }
  if (event.type === "terminal_failure") {
    state.phase = "failed";
    state.stopReason = boundedReason(event.reason);
    return next();
  }

  switch (state.phase) {
    case "ready":
      if (event.type !== "implementation_started") break;
      if (state.counters.implementationIterationsStarted >= state.budget.maxImplementationIterations) {
        state.phase = "waiting_for_human";
        state.stopReason = "implementation_iteration_budget_exhausted";
        return next();
      }
      state.counters.implementationIterationsStarted += 1;
      state.phase = "implementation_in_progress";
      return next();

    case "implementation_in_progress":
      if (event.type !== "completion_evidence_captured") break;
      state.phase = "awaiting_review";
      return next();

    case "awaiting_review":
      if (event.type === "review_pass") {
        state.phase = "succeeded";
        state.stopReason = "acceptance_criteria_satisfied";
        return next();
      }
      if (event.type === "review_repair") {
        if (
          state.counters.repairAttemptsStarted >= state.budget.maxRepairAttempts
          || state.counters.implementationIterationsStarted >= state.budget.maxImplementationIterations
        ) {
          state.phase = "waiting_for_human";
          state.stopReason = "autonomous_repair_budget_exhausted";
          return next();
        }
        state.phase = "repair_ready";
        return next();
      }
      break;

    case "repair_ready":
      if (event.type !== "repair_started") break;
      if (
        state.counters.repairAttemptsStarted >= state.budget.maxRepairAttempts
        || state.counters.implementationIterationsStarted >= state.budget.maxImplementationIterations
      ) {
        state.phase = "waiting_for_human";
        state.stopReason = "autonomous_repair_budget_exhausted";
        return next();
      }
      state.counters.repairAttemptsStarted += 1;
      state.counters.implementationIterationsStarted += 1;
      state.phase = "implementation_in_progress";
      return next();
  }

  throw new AutonomousEngineeringLoopError(
    `event ${event.type} is not valid from phase ${state.phase}`,
    "transition_invalid",
  );
}

export class FileAutonomousEngineeringLoopStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "autonomous-engineering-loops");
  }

  private file(loopId: string): string {
    if (!UUID.test(loopId)) {
      throw new AutonomousEngineeringLoopError("loopId must be an opaque UUID", "store_invalid");
    }
    return path.join(this.dir(), `${loopId}.json`);
  }

  async create(value: AutonomousEngineeringLoopStateV1): Promise<void> {
    assertState(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.loopId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AutonomousEngineeringLoopError("loop state already exists", "revision_conflict");
      }
      throw error;
    }
  }

  async load(loopId: string): Promise<AutonomousEngineeringLoopStateV1> {
    let parsed: AutonomousEngineeringLoopStateV1;
    try {
      parsed = JSON.parse(await readFile(this.file(loopId), "utf8")) as AutonomousEngineeringLoopStateV1;
    } catch (error) {
      throw new AutonomousEngineeringLoopError(
        `loop state cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
    assertState(parsed);
    if (parsed.loopId !== loopId) {
      throw new AutonomousEngineeringLoopError("loop state file identity mismatch", "store_invalid");
    }
    return structuredClone(parsed);
  }

  async replaceExact(
    expectedRevision: number,
    value: AutonomousEngineeringLoopStateV1,
  ): Promise<void> {
    assertState(value);
    const current = await this.load(value.loopId);
    if (current.revision !== expectedRevision || value.revision !== expectedRevision + 1) {
      throw new AutonomousEngineeringLoopError(
        "loop state revision changed before durable replacement",
        "revision_conflict",
      );
    }
    await mkdir(this.dir(), { recursive: true });
    const target = this.file(value.loopId);
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      throw new AutonomousEngineeringLoopError(
        `loop state cannot be replaced: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
  }
}
