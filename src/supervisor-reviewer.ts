import type { OrchestratorTask } from "./types.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const MAX_REVIEW_SUMMARY_CHARS = 2_000;
const MAX_REPAIR_INSTRUCTION_CHARS = 4_000;
const MAX_ESCALATION_REASON_CHARS = 2_000;
const MAX_DIFF_SUMMARY_CHARS = 2_000;
const MAX_REVIEWER_PROMPT_CHARS = 24_000;

export const SUPERVISOR_REVIEWER_LIMITS = Object.freeze({
  maxSummaryChars: MAX_REVIEW_SUMMARY_CHARS,
  maxRepairInstructionChars: MAX_REPAIR_INSTRUCTION_CHARS,
  maxEscalationReasonChars: MAX_ESCALATION_REASON_CHARS,
  maxDiffSummaryChars: MAX_DIFF_SUMMARY_CHARS,
  maxPromptChars: MAX_REVIEWER_PROMPT_CHARS,
});

export interface SupervisorReviewerEvidenceV1 {
  schemaVersion: 1;
  supervisorTaskId: string;
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  approvedWriteScope: string[];
  protectedPaths: string[];
  taskState: {
    status: OrchestratorTask["status"];
    runCount: number;
    sessionGeneration: number;
    recoveryCount: number;
    validationRepairCount: number;
    finishReason?: string;
    hasPendingHumanEscalation: boolean;
  };
  checkpoint: {
    available: boolean;
    runCount?: number;
    restored: boolean;
  };
  validation: {
    required: boolean;
    available: boolean;
    passed?: boolean;
    commandsRequested?: number;
    commandsRun?: number;
    durationMs?: number;
  };
  diffSafety: {
    available: boolean;
    passed?: boolean;
    changedFiles?: number;
    warningCount?: number;
    failureCount?: number;
    summary?: string;
  };
}

export type SupervisorReviewerDecision = "pass" | "repair" | "escalate";

export interface SupervisorReviewerResultV1 {
  schemaVersion: 1;
  supervisorTaskId: string;
  taskId: string;
  decision: SupervisorReviewerDecision;
  summary: string;
  repairInstruction?: string;
  escalationReason?: string;
  completionAuthority: "advisory_only";
}

export interface SupervisorReviewerModelRequest {
  schemaVersion: 1;
  supervisorTaskId: string;
  taskId: string;
  prompt: string;
}

export interface SupervisorReviewerModel {
  review(request: SupervisorReviewerModelRequest): Promise<unknown>;
}

export class SupervisorReviewerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "evidence_invalid"
      | "result_invalid"
      | "task_mismatch"
      | "evidence_insufficient"
      | "prompt_too_large"
      | "reviewer_failed",
  ) {
    super(message);
    this.name = "SupervisorReviewerError";
  }
}

function boundedString(
  value: unknown,
  field: string,
  maxChars: number,
  code: "evidence_invalid" | "result_invalid",
): string {
  if (typeof value !== "string") {
    throw new SupervisorReviewerError(`${field} must be a string`, code);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new SupervisorReviewerError(`${field} must not be empty`, code);
  }
  if (normalized.includes("\0")) {
    throw new SupervisorReviewerError(`${field} must not contain NUL bytes`, code);
  }
  if (normalized.length > maxChars) {
    throw new SupervisorReviewerError(`${field} exceeds ${maxChars} characters`, code);
  }
  return normalized;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxChars: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, field, maxChars, "result_invalid");
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extras.length > 0) {
    throw new SupervisorReviewerError(
      `Reviewer result contains forbidden field(s): ${extras.join(", ")}`,
      "result_invalid",
    );
  }
}

function boundedDiffSummary(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= MAX_DIFF_SUMMARY_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_DIFF_SUMMARY_CHARS)}…`;
}

/**
 * Builds reviewer evidence from an approved supervisor task and durable task state.
 * Raw workspace paths, session IDs, prompts/output, validation stdout/stderr,
 * checkpoint refs/paths and credentials are deliberately omitted.
 */
export function createSupervisorReviewerEvidence(
  supervisor: SupervisorTaskV1,
  task: OrchestratorTask,
): SupervisorReviewerEvidenceV1 {
  if (supervisor.schemaVersion !== 1) {
    throw new SupervisorReviewerError("Unsupported supervisor task schema", "evidence_invalid");
  }
  if (supervisor.taskId !== task.id) {
    throw new SupervisorReviewerError(
      "Reviewer evidence task does not match the supervisor task binding",
      "task_mismatch",
    );
  }

  const validation = task.lastValidation;
  const diffSafety = task.lastDiffSafety;
  const checkpoint = task.lastRunCheckpoint;

  return {
    schemaVersion: 1,
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    objective: supervisor.objective,
    acceptanceCriteria: [...supervisor.acceptanceCriteria],
    approvedWriteScope: [...supervisor.authority.allowedPathPatterns],
    protectedPaths: [...supervisor.authority.protectedPathPatterns],
    taskState: {
      status: task.status,
      runCount: task.runCount ?? 0,
      sessionGeneration: task.sessionGeneration ?? 0,
      recoveryCount: task.recoveryCount ?? 0,
      validationRepairCount: task.validationRepairCount ?? 0,
      finishReason: task.finishReason,
      hasPendingHumanEscalation: task.pendingEscalation?.status === "pending",
    },
    checkpoint: {
      available: checkpoint?.available === true,
      runCount: checkpoint?.runCount,
      restored: Boolean(checkpoint?.restoredAt),
    },
    validation: {
      required: supervisor.trustedValidationCommands.length > 0,
      available: validation !== undefined,
      passed: validation?.passed,
      commandsRequested: validation?.commandsRequested,
      commandsRun: validation?.commandsRun,
      durationMs: validation?.durationMs,
    },
    diffSafety: {
      available: diffSafety !== undefined,
      passed: diffSafety?.passed,
      changedFiles: diffSafety?.summary.changedFiles,
      warningCount: diffSafety?.warnings.length,
      failureCount: diffSafety?.failures.length,
      summary: boundedDiffSummary(diffSafety?.finalDiffSummary),
    },
  };
}

export function renderSupervisorReviewerPrompt(evidence: SupervisorReviewerEvidenceV1): string {
  if (evidence.schemaVersion !== 1) {
    throw new SupervisorReviewerError("Unsupported reviewer evidence schema", "evidence_invalid");
  }

  const criteria = evidence.acceptanceCriteria.length > 0
    ? evidence.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
    : "- No explicit acceptance criteria recorded.";
  const scope = evidence.approvedWriteScope.map((item) => `- ${item}`).join("\n");
  const protectedPaths = evidence.protectedPaths.length > 0
    ? evidence.protectedPaths.map((item) => `- ${item}`).join("\n")
    : "- None additionally recorded.";

  const prompt = [
    "# Supervisor Reviewer Request v1",
    "",
    `Supervisor task: ${evidence.supervisorTaskId}`,
    `Orchestrator task: ${evidence.taskId}`,
    "",
    "## Objective",
    evidence.objective,
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "## Approved write scope",
    scope,
    "",
    "## Protected paths",
    protectedPaths,
    "",
    "## Sanitized task evidence",
    `- status: ${evidence.taskState.status}`,
    `- runCount: ${evidence.taskState.runCount}`,
    `- sessionGeneration: ${evidence.taskState.sessionGeneration}`,
    `- recoveryCount: ${evidence.taskState.recoveryCount}`,
    `- validationRepairCount: ${evidence.taskState.validationRepairCount}`,
    `- pendingHumanEscalation: ${evidence.taskState.hasPendingHumanEscalation}`,
    `- checkpointAvailable: ${evidence.checkpoint.available}`,
    `- checkpointRestored: ${evidence.checkpoint.restored}`,
    `- validationRequired: ${evidence.validation.required}`,
    `- validationAvailable: ${evidence.validation.available}`,
    `- validationPassed: ${evidence.validation.passed ?? "unknown"}`,
    `- validationCommandsRun: ${evidence.validation.commandsRun ?? "unknown"}`,
    `- diffSafetyAvailable: ${evidence.diffSafety.available}`,
    `- diffSafetyPassed: ${evidence.diffSafety.passed ?? "unknown"}`,
    `- changedFiles: ${evidence.diffSafety.changedFiles ?? "unknown"}`,
    `- diffWarnings: ${evidence.diffSafety.warningCount ?? "unknown"}`,
    `- diffFailures: ${evidence.diffSafety.failureCount ?? "unknown"}`,
    `- diffSummary: ${evidence.diffSafety.summary ?? "unavailable"}`,
    "",
    "## Reviewer rules",
    "- Return only pass, repair, or escalate.",
    "- Pass is advisory only and cannot mark the orchestrator task complete.",
    "- Request repair only when it can be performed entirely inside the existing approved write scope and existing disabled-capability policy.",
    "- A repair instruction cannot change trusted validation commands, Safety Plan, worker/policy identity, scope, protected paths, shell/network/MCP/plugin authority, subagents, or agent teams.",
    "- Recommend escalation when broader authority, human judgment, or unavailable evidence is required.",
    "- Do not infer success from model claims. Use only the sanitized durable evidence above.",
    "",
    "Return JSON only with exactly these fields:",
    `{\"schemaVersion\":1,\"supervisorTaskId\":\"${evidence.supervisorTaskId}\",\"taskId\":\"${evidence.taskId}\",\"decision\":\"pass\",\"summary\":\"...\",\"completionAuthority\":\"advisory_only\"}`,
    "For repair add repairInstruction. For escalate add escalationReason. Do not add either field for pass.",
  ].join("\n");

  if (prompt.length > MAX_REVIEWER_PROMPT_CHARS) {
    throw new SupervisorReviewerError(
      `Rendered reviewer prompt exceeds ${MAX_REVIEWER_PROMPT_CHARS} characters`,
      "prompt_too_large",
    );
  }
  return prompt;
}

function passEvidenceIsSufficient(evidence: SupervisorReviewerEvidenceV1): boolean {
  if (evidence.taskState.hasPendingHumanEscalation) return false;
  if (!evidence.checkpoint.available || evidence.checkpoint.restored) return false;
  if (evidence.validation.required && evidence.validation.passed !== true) return false;
  if (!evidence.diffSafety.available || evidence.diffSafety.passed !== true) return false;
  return true;
}

export function validateSupervisorReviewerResult(
  evidence: SupervisorReviewerEvidenceV1,
  value: unknown,
): SupervisorReviewerResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupervisorReviewerError("Reviewer result must be an object", "result_invalid");
  }
  const result = value as Record<string, unknown>;
  exactKeys(result, [
    "schemaVersion",
    "supervisorTaskId",
    "taskId",
    "decision",
    "summary",
    "repairInstruction",
    "escalationReason",
    "completionAuthority",
  ]);

  if (result.schemaVersion !== 1) {
    throw new SupervisorReviewerError("Reviewer result schemaVersion must be 1", "result_invalid");
  }
  if (result.supervisorTaskId !== evidence.supervisorTaskId || result.taskId !== evidence.taskId) {
    throw new SupervisorReviewerError(
      "Reviewer result does not match the approved supervisor/orchestrator task binding",
      "task_mismatch",
    );
  }
  if (result.completionAuthority !== "advisory_only") {
    throw new SupervisorReviewerError(
      "Reviewer completion authority must remain advisory_only",
      "result_invalid",
    );
  }
  if (!(["pass", "repair", "escalate"] as const).includes(result.decision as SupervisorReviewerDecision)) {
    throw new SupervisorReviewerError("Reviewer decision must be pass, repair, or escalate", "result_invalid");
  }

  const decision = result.decision as SupervisorReviewerDecision;
  const summary = boundedString(result.summary, "summary", MAX_REVIEW_SUMMARY_CHARS, "result_invalid");
  const repairInstruction = optionalBoundedString(
    result.repairInstruction,
    "repairInstruction",
    MAX_REPAIR_INSTRUCTION_CHARS,
  );
  const escalationReason = optionalBoundedString(
    result.escalationReason,
    "escalationReason",
    MAX_ESCALATION_REASON_CHARS,
  );

  if (decision === "pass") {
    if (repairInstruction !== undefined || escalationReason !== undefined) {
      throw new SupervisorReviewerError(
        "Pass result must not include repairInstruction or escalationReason",
        "result_invalid",
      );
    }
    if (!passEvidenceIsSufficient(evidence)) {
      throw new SupervisorReviewerError(
        "Reviewer cannot recommend pass because required durable validation/diff/checkpoint evidence is not satisfied",
        "evidence_insufficient",
      );
    }
  } else if (decision === "repair") {
    if (!repairInstruction || escalationReason !== undefined) {
      throw new SupervisorReviewerError(
        "Repair result requires repairInstruction and must not include escalationReason",
        "result_invalid",
      );
    }
  } else if (!escalationReason || repairInstruction !== undefined) {
    throw new SupervisorReviewerError(
      "Escalate result requires escalationReason and must not include repairInstruction",
      "result_invalid",
    );
  }

  return {
    schemaVersion: 1,
    supervisorTaskId: evidence.supervisorTaskId,
    taskId: evidence.taskId,
    decision,
    summary,
    ...(repairInstruction !== undefined ? { repairInstruction } : {}),
    ...(escalationReason !== undefined ? { escalationReason } : {}),
    completionAuthority: "advisory_only",
  };
}

export async function runSupervisorReviewer(
  evidence: SupervisorReviewerEvidenceV1,
  model: SupervisorReviewerModel,
): Promise<SupervisorReviewerResultV1> {
  const prompt = renderSupervisorReviewerPrompt(evidence);
  let raw: unknown;
  try {
    raw = await model.review({
      schemaVersion: 1,
      supervisorTaskId: evidence.supervisorTaskId,
      taskId: evidence.taskId,
      prompt,
    });
  } catch (error) {
    throw new SupervisorReviewerError(
      `Reviewer model failed: ${error instanceof Error ? error.message : String(error)}`,
      "reviewer_failed",
    );
  }
  return validateSupervisorReviewerResult(evidence, raw);
}
