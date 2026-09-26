import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { OperatorActionError } from "./operator-action.js";
import type { UnattendedExecutionBudgetV1 } from "./unattended-budget.js";
import {
  UnattendedBudgetDecisionStore,
  type UnattendedBudgetDecisionV1,
} from "./unattended-budget-store.js";
import type { BudgetedUnattendedTaskStarter } from "./unattended-budgeted-coordinator.js";
import { buildUnattendedWorkflowReport } from "./unattended-report.js";
import {
  resumeUnattendedWorkflow,
  type UnattendedResumeResult,
  type UnattendedResumeTaskReader,
} from "./unattended-resume.js";
import type { SentinelIncidentV1 } from "./sentinel.js";
import type { OrchestratorTask } from "./types.js";
import {
  selectRunnableWorkflowNodes,
  type UnattendedWorkflowV1,
  type WorkflowTaskEvidence,
} from "./unattended-workflow.js";
import { UnattendedWorkflowStore } from "./unattended-workflow-store.js";

const TOKEN_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export interface OperatorWorkflowResumePreview {
  action: "resume_workflow";
  workflowId: string;
  expectedTaskId: string;
  workflowStatus: "ready" | "budget_blocked";
  counts: {
    totalNodes: number;
    created: number;
    active: number;
    completed: number;
    waitingForHuman: number;
    terminalNonSuccess: number;
  };
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
}

export interface OperatorWorkflowAuditV1 {
  schemaVersion: 1;
  auditId: string;
  recordedAt: string;
  kind: "workflow_resume_confirmed";
  workflowId: string;
  expectedTaskId: string;
  confirmationId: string;
}

export interface OperatorWorkflowAuditStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new Error(`${field} must be an opaque UUID`);
  return value;
}

/** Durable operator provenance. Confirmation tokens are never persisted. */
export class OperatorWorkflowAuditStore {
  constructor(
    private readonly rootDir: string,
    private readonly options: OperatorWorkflowAuditStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "operator-workflow-audit");
  }

  private journal(workflowId: string): string {
    return path.join(this.dir(), `${requireUuid(workflowId, "workflowId")}.jsonl`);
  }

  async appendConfirmed(
    workflowId: string,
    expectedTaskId: string,
    confirmationId: string,
  ): Promise<OperatorWorkflowAuditV1> {
    workflowId = requireUuid(workflowId, "workflowId");
    expectedTaskId = requireUuid(expectedTaskId, "expectedTaskId");
    confirmationId = requireUuid(confirmationId, "confirmationId");
    const audit: OperatorWorkflowAuditV1 = {
      schemaVersion: 1,
      auditId: requireUuid(
        (this.options.idFactory ?? (() => crypto.randomUUID()))(),
        "auditId",
      ),
      recordedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      kind: "workflow_resume_confirmed",
      workflowId,
      expectedTaskId,
      confirmationId,
    };
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.journal(workflowId), `${JSON.stringify(audit)}\n`, "utf8");
    return audit;
  }

  async list(workflowId: string): Promise<OperatorWorkflowAuditV1[]> {
    try {
      const raw = await readFile(this.journal(workflowId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OperatorWorkflowAuditV1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }
}

interface OperatorWorkflowResumeDependencies {
  workflowStore: UnattendedWorkflowStore;
  budgetDecisionStore: UnattendedBudgetDecisionStore;
  taskReader: UnattendedResumeTaskReader;
  budget: UnattendedExecutionBudgetV1;
  starter: BudgetedUnattendedTaskStarter;
  auditStore: OperatorWorkflowAuditStore;
  incidents?: SentinelIncidentV1[];
}

interface WorkflowSnapshot {
  workflow: UnattendedWorkflowV1;
  tasks: OrchestratorTask[];
  decisions: UnattendedBudgetDecisionV1[];
  expectedTaskId?: string;
  status: ReturnType<typeof buildUnattendedWorkflowReport>["status"];
  counts: ReturnType<typeof buildUnattendedWorkflowReport>["counts"];
  fingerprint: string;
}

interface PendingWorkflowResume {
  action: "resume_workflow";
  workflowId: string;
  expectedTaskId: string;
  confirmationId: string;
  fingerprint: string;
  expiresAtMs: number;
}

function evidenceForTask(task: OrchestratorTask, validationRequired: boolean): WorkflowTaskEvidence {
  return {
    taskId: task.id,
    status: task.status,
    validationPassed: validationRequired ? task.lastValidation?.passed : true,
    diffSafetyPassed: task.lastDiffSafety?.passed,
    pendingHumanEscalation: task.status === "waiting_for_human"
      || task.pendingEscalation?.status === "pending",
  };
}

function taskFingerprint(task: OrchestratorTask): Record<string, unknown> {
  const bound = task as BoundTask;
  return {
    taskId: task.id,
    status: task.status,
    updatedAt: task.updatedAt,
    runCount: task.runCount ?? 0,
    sessionGeneration: task.sessionGeneration ?? 0,
    recoveryCount: task.recoveryCount ?? 0,
    validationRunCount: task.validationRunCount ?? 0,
    validationRepairCount: task.validationRepairCount ?? 0,
    projectId: bound.projectId,
    workspaceId: bound.workspaceId,
    workspaceRegistryRevision: bound.workspaceRegistryRevision,
    safetyPlanId: bound.safetyPlanId,
    safetyPolicyVersion: bound.safetyPolicyVersion,
    safetyProfileId: bound.safetyProfileId,
    safetyProfileRevision: bound.safetyProfileRevision,
    workerProfileId: bound.workerProfileId,
    allowedPathPatterns: bound.approvedAllowedPathPatterns,
    protectedPathPatterns: bound.approvedProtectedPathPatterns,
    validationCommands: task.validationCommands,
    expectedChangedPaths: task.expectedChangedPaths,
    escalationId: task.pendingEscalation?.escalationId,
    escalationStatus: task.pendingEscalation?.status,
    checkpoint: task.lastRunCheckpoint ? {
      createdAt: task.lastRunCheckpoint.createdAt,
      available: task.lastRunCheckpoint.available,
      runCount: task.lastRunCheckpoint.runCount,
      restoredAt: task.lastRunCheckpoint.restoredAt,
      beforeDigest: task.lastRunCheckpoint.beforeFingerprint?.digest,
      afterDigest: task.lastRunCheckpoint.afterFingerprint?.digest,
    } : undefined,
    validation: task.lastValidation ? {
      completedAt: task.lastValidation.completedAt,
      passed: task.lastValidation.passed,
      commandsRequested: task.lastValidation.commandsRequested,
      commandsRun: task.lastValidation.commandsRun,
      durationMs: task.lastValidation.durationMs,
    } : undefined,
    diffSafety: task.lastDiffSafety ? {
      checkedAt: task.lastDiffSafety.checkedAt,
      passed: task.lastDiffSafety.passed,
      changedFiles: task.lastDiffSafety.summary.changedFiles,
      warningCount: task.lastDiffSafety.warnings.length,
      failureCount: task.lastDiffSafety.failures.length,
    } : undefined,
    metrics: task.lastRunMetrics ? {
      startedAt: task.lastRunMetrics.startedAt,
      completedAt: task.lastRunMetrics.completedAt,
      durationMs: task.lastRunMetrics.durationMs,
      iterations: task.lastRunMetrics.iterations,
      toolCalls: task.lastRunMetrics.toolCalls,
      totalInputTokens: task.lastRunMetrics.totalInputTokens,
      totalOutputTokens: task.lastRunMetrics.totalOutputTokens,
      attempts: task.lastRunMetrics.attempts,
      retries: task.lastRunMetrics.retries,
      stalls: task.lastRunMetrics.stalls,
    } : undefined,
  };
}

function snapshotFingerprint(
  workflow: UnattendedWorkflowV1,
  tasks: OrchestratorTask[],
  decisions: UnattendedBudgetDecisionV1[],
  budget: UnattendedExecutionBudgetV1,
): string {
  const payload = {
    workflow,
    budget,
    tasks: tasks.map(taskFingerprint),
    decisions: decisions.map((decision) => ({
      decisionId: decision.decisionId,
      taskId: decision.taskId,
      decidedAt: decision.decidedAt,
      allowed: decision.allowed,
      reason: decision.reason,
      exhausted: decision.exhausted,
      dependencyTaskId: decision.dependencyTaskId,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Process-local confirmation wrapper for advancing one already-approved workflow
 * node. The workflow grants no task authority: confirmation pins the exact current
 * runnable task, while resumeUnattendedWorkflow and the injected starter re-check
 * durable budget/checkpoint/task authority before any execution.
 */
export class OperatorWorkflowActionService {
  private readonly pending = new Map<string, PendingWorkflowResume>();

  constructor(
    private readonly dependencies: OperatorWorkflowResumeDependencies,
    private readonly now: () => number = Date.now,
  ) {}

  private preparePending(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAtMs <= now) this.pending.delete(token);
    }
    if (this.pending.size >= MAX_PENDING) {
      throw new OperatorActionError("Too many pending operator confirmations", "capacity_exceeded");
    }
  }

  private async snapshot(workflowId: string): Promise<WorkflowSnapshot> {
    const workflow = await this.dependencies.workflowStore.load(workflowId);
    const tasks = await Promise.all(
      workflow.nodes.map((node) => this.dependencies.taskReader.loadTask(node.taskId)),
    );
    const decisions = await this.dependencies.budgetDecisionStore.list(workflow.workflowId);
    const report = buildUnattendedWorkflowReport(workflow, tasks, {
      budgetDecisions: decisions,
      incidents: this.dependencies.incidents,
      now: new Date(this.now()),
    });
    const evidence = workflow.nodes.map((node) => {
      const task = tasks.find((item) => item.id === node.taskId)!;
      return evidenceForTask(task, node.validationRequired);
    });
    const expectedTaskId = selectRunnableWorkflowNodes(workflow, evidence).runnable[0]?.taskId;
    return {
      workflow,
      tasks,
      decisions,
      expectedTaskId,
      status: report.status,
      counts: report.counts,
      fingerprint: snapshotFingerprint(workflow, tasks, decisions, this.dependencies.budget),
    };
  }

  async previewWorkflowResume(workflowId: string): Promise<OperatorWorkflowResumePreview> {
    const snapshot = await this.snapshot(workflowId);
    if (!snapshot.expectedTaskId) {
      throw new OperatorActionError(
        `Workflow has no runnable task in status ${snapshot.status}`,
        "invalid_action",
      );
    }
    if (snapshot.status !== "ready" && snapshot.status !== "budget_blocked") {
      throw new OperatorActionError(
        `Workflow status ${snapshot.status} cannot be resumed by this operator action`,
        "invalid_action",
      );
    }

    const now = this.now();
    this.preparePending(now);
    const expiresAtMs = now + TOKEN_LIFETIME_MS;
    const confirmationToken = crypto.randomBytes(32).toString("hex");
    const confirmationId = crypto.randomUUID();
    this.pending.set(confirmationToken, {
      action: "resume_workflow",
      workflowId: snapshot.workflow.workflowId,
      expectedTaskId: snapshot.expectedTaskId,
      confirmationId,
      fingerprint: snapshot.fingerprint,
      expiresAtMs,
    });

    return {
      action: "resume_workflow",
      workflowId: snapshot.workflow.workflowId,
      expectedTaskId: snapshot.expectedTaskId,
      workflowStatus: snapshot.status,
      counts: { ...snapshot.counts },
      confirmationText: "Advance only this workflow's currently previewed approved task after rechecking durable workflow, budget and task authority",
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken,
    };
  }

  async resumeWorkflow(input: {
    workflowId: string;
    expectedTaskId: string;
    confirmationToken: string;
    confirmed: true;
  }): Promise<UnattendedResumeResult> {
    if (input.confirmed !== true) {
      throw new OperatorActionError("Explicit operator confirmation is required", "invalid_action");
    }
    const entry = this.pending.get(input.confirmationToken);
    if (
      !entry
      || entry.action !== "resume_workflow"
      || entry.workflowId !== input.workflowId
      || entry.expectedTaskId !== input.expectedTaskId
    ) {
      throw new OperatorActionError("Operator confirmation is invalid or already used", "invalid_action");
    }

    // Burn the token before the first await so concurrent/replayed submissions
    // cannot both reach a mutating workflow boundary.
    this.pending.delete(input.confirmationToken);
    if (this.now() >= entry.expiresAtMs) {
      throw new OperatorActionError("Operator confirmation expired", "expired_action");
    }

    const current = await this.snapshot(entry.workflowId);
    if (
      current.expectedTaskId !== entry.expectedTaskId
      || current.fingerprint !== entry.fingerprint
    ) {
      throw new OperatorActionError(
        "Workflow, runnable task, budget evidence, or task authority changed after preview",
        "stale_action",
      );
    }

    // Durable operator provenance is recorded before execution. No confirmation
    // token is persisted. The subsequent budget decision/task lifecycle remains
    // the authoritative durable execution evidence.
    await this.dependencies.auditStore.appendConfirmed(
      entry.workflowId,
      entry.expectedTaskId,
      entry.confirmationId,
    );

    return await resumeUnattendedWorkflow(entry.workflowId, {
      workflowStore: this.dependencies.workflowStore,
      budgetDecisionStore: this.dependencies.budgetDecisionStore,
      taskReader: this.dependencies.taskReader,
      budget: this.dependencies.budget,
      starter: this.dependencies.starter,
      expectedTaskId: entry.expectedTaskId,
      incidents: this.dependencies.incidents,
      now: new Date(this.now()),
    });
  }
}
