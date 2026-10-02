const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WRITERS = 64;
const MAX_STARTS_PER_PASS = 16;

export const CONCURRENCY_BUDGET_LIMITS = Object.freeze({
  maxActiveWriters: MAX_WRITERS,
  maxStartsPerPass: MAX_STARTS_PER_PASS,
  maxActiveWritersPerWorkspace: 1,
});

export interface WriterConcurrencyBudgetV1 {
  schemaVersion: 1;
  maxActiveWriters: number;
  maxStartsPerPass: number;
  maxActiveWritersPerWorkspace: 1;
}

export interface ActiveWriterEvidenceV1 {
  workspaceId: string;
  taskId: string;
  ownerInstanceId: string;
  leaseId: string;
  fenceToken: string;
  expiresAt: string;
}

export interface WriterStartCandidateV1 {
  workspaceId: string;
  taskId: string;
}

export type WriterAdmissionReason =
  | "admitted"
  | "global_budget_exhausted"
  | "workspace_writer_conflict"
  | "pass_start_budget_exhausted"
  | "evidence_invalid";

export interface WriterAdmissionDecisionV1 {
  schemaVersion: 1;
  workspaceId: string;
  taskId: string;
  allowed: boolean;
  reason: WriterAdmissionReason;
  authority: "coordination_only";
}

export interface WriterConcurrencyPlanV1 {
  schemaVersion: 1;
  activeWriterCount: number;
  admittedCount: number;
  decisions: WriterAdmissionDecisionV1[];
  authority: "coordination_only";
}

export class ConcurrencyBudgetError extends Error {
  constructor(
    message: string,
    public readonly code: "budget_invalid" | "evidence_invalid",
  ) {
    super(message);
    this.name = "ConcurrencyBudgetError";
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new ConcurrencyBudgetError(`${field} must be an opaque UUID`, "evidence_invalid");
  }
  return value.trim();
}

function positiveBoundedInteger(value: unknown, field: string, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new ConcurrencyBudgetError(`${field} must be an integer between 1 and ${max}`, "budget_invalid");
  }
  return value as number;
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ConcurrencyBudgetError(`${field} must be an ISO timestamp`, "evidence_invalid");
  }
  return new Date(Date.parse(value)).toISOString();
}

export function validateWriterConcurrencyBudget(
  budget: WriterConcurrencyBudgetV1,
): WriterConcurrencyBudgetV1 {
  if (budget.schemaVersion !== 1) {
    throw new ConcurrencyBudgetError("Unsupported concurrency budget schema", "budget_invalid");
  }
  positiveBoundedInteger(budget.maxActiveWriters, "maxActiveWriters", MAX_WRITERS);
  positiveBoundedInteger(budget.maxStartsPerPass, "maxStartsPerPass", MAX_STARTS_PER_PASS);
  if (budget.maxActiveWritersPerWorkspace !== 1) {
    throw new ConcurrencyBudgetError(
      "maxActiveWritersPerWorkspace is fixed at 1 for the first concurrency slice",
      "budget_invalid",
    );
  }
  return structuredClone(budget);
}

function validateActiveWriter(item: ActiveWriterEvidenceV1, now: Date): ActiveWriterEvidenceV1 {
  const evidence = {
    workspaceId: uuid(item.workspaceId, "activeWriter.workspaceId"),
    taskId: uuid(item.taskId, "activeWriter.taskId"),
    ownerInstanceId: uuid(item.ownerInstanceId, "activeWriter.ownerInstanceId"),
    leaseId: uuid(item.leaseId, "activeWriter.leaseId"),
    fenceToken: uuid(item.fenceToken, "activeWriter.fenceToken"),
    expiresAt: iso(item.expiresAt, "activeWriter.expiresAt"),
  };
  if (Date.parse(evidence.expiresAt) <= now.getTime()) {
    throw new ConcurrencyBudgetError(
      "active writer evidence must contain only a currently live durable lease",
      "evidence_invalid",
    );
  }
  return evidence;
}

function validateCandidate(item: WriterStartCandidateV1): WriterStartCandidateV1 {
  return {
    workspaceId: uuid(item.workspaceId, "candidate.workspaceId"),
    taskId: uuid(item.taskId, "candidate.taskId"),
  };
}

/**
 * Computes writer-slot admission from already-validated durable lock evidence.
 *
 * This function grants no task, Safety Plan, filesystem, command, Hub or model
 * authority. A scheduler must independently revalidate task authority, then acquire
 * the durable workspace writer lease, then revalidate the returned fenced claim
 * immediately before a write-capable worker starts. Admission alone is never enough.
 */
export function planWriterConcurrency(
  budget: WriterConcurrencyBudgetV1,
  activeWriters: ActiveWriterEvidenceV1[],
  candidates: WriterStartCandidateV1[],
  now: Date = new Date(),
): WriterConcurrencyPlanV1 {
  const checkedBudget = validateWriterConcurrencyBudget(budget);
  if (!Number.isFinite(now.getTime())) {
    throw new ConcurrencyBudgetError("concurrency clock is invalid", "evidence_invalid");
  }

  const active = activeWriters.map((item) => validateActiveWriter(item, now));
  const occupiedWorkspaces = new Set<string>();
  const activeTasks = new Set<string>();
  for (const writer of active) {
    if (occupiedWorkspaces.has(writer.workspaceId)) {
      throw new ConcurrencyBudgetError(
        "durable writer evidence contains more than one active writer for a workspace",
        "evidence_invalid",
      );
    }
    if (activeTasks.has(writer.taskId)) {
      throw new ConcurrencyBudgetError(
        "durable writer evidence contains a duplicate active task",
        "evidence_invalid",
      );
    }
    occupiedWorkspaces.add(writer.workspaceId);
    activeTasks.add(writer.taskId);
  }
  if (active.length > checkedBudget.maxActiveWriters) {
    throw new ConcurrencyBudgetError(
      "current active writer evidence already exceeds the configured global budget",
      "evidence_invalid",
    );
  }

  const decisions: WriterAdmissionDecisionV1[] = [];
  let admittedCount = 0;
  const seenCandidateTasks = new Set<string>();
  const reservedWorkspaces = new Set(occupiedWorkspaces);

  for (const rawCandidate of candidates) {
    const candidate = validateCandidate(rawCandidate);
    if (seenCandidateTasks.has(candidate.taskId) || activeTasks.has(candidate.taskId)) {
      throw new ConcurrencyBudgetError(
        "candidate list contains a duplicate or already-active task",
        "evidence_invalid",
      );
    }
    seenCandidateTasks.add(candidate.taskId);

    let reason: WriterAdmissionReason = "admitted";
    let allowed = true;
    if (reservedWorkspaces.has(candidate.workspaceId)) {
      allowed = false;
      reason = "workspace_writer_conflict";
    } else if (active.length + admittedCount >= checkedBudget.maxActiveWriters) {
      allowed = false;
      reason = "global_budget_exhausted";
    } else if (admittedCount >= checkedBudget.maxStartsPerPass) {
      allowed = false;
      reason = "pass_start_budget_exhausted";
    }

    if (allowed) {
      admittedCount += 1;
      reservedWorkspaces.add(candidate.workspaceId);
    }
    decisions.push({
      schemaVersion: 1,
      workspaceId: candidate.workspaceId,
      taskId: candidate.taskId,
      allowed,
      reason,
      authority: "coordination_only",
    });
  }

  return {
    schemaVersion: 1,
    activeWriterCount: active.length,
    admittedCount,
    decisions,
    authority: "coordination_only",
  };
}
