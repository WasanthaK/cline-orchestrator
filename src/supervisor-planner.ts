import type { SupervisorTaskV1 } from "./supervisor-task.js";

const MAX_PLANNER_ACCEPTANCE_CRITERIA = 20;
const MAX_PLANNER_ACCEPTANCE_CRITERION_CHARS = 600;
const MAX_PLANNER_VALIDATION_COMMANDS = 20;
const MAX_PLANNER_VALIDATION_COMMAND_CHARS = 1_000;
const MAX_PLANNER_PROMPT_CHARS = 24_000;

export const SUPERVISOR_PLANNER_LIMITS = Object.freeze({
  maxAcceptanceCriteria: MAX_PLANNER_ACCEPTANCE_CRITERIA,
  maxAcceptanceCriterionChars: MAX_PLANNER_ACCEPTANCE_CRITERION_CHARS,
  maxValidationCommands: MAX_PLANNER_VALIDATION_COMMANDS,
  maxValidationCommandChars: MAX_PLANNER_VALIDATION_COMMAND_CHARS,
  maxPromptChars: MAX_PLANNER_PROMPT_CHARS,
});

export interface SupervisorPlannerProposalV1 {
  schemaVersion: 1;
  supervisorTaskId: string;
  taskId: string;
  acceptanceCriteria: string[];
  proposedValidationCommands: string[];
  validationAuthority: "proposal_only";
}

export interface SupervisorPlannerModelRequest {
  schemaVersion: 1;
  supervisorTaskId: string;
  taskId: string;
  prompt: string;
}

export interface SupervisorPlannerModel {
  plan(request: SupervisorPlannerModelRequest): Promise<unknown>;
}

export class SupervisorPlannerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "proposal_invalid"
      | "task_mismatch"
      | "prompt_too_large"
      | "planner_failed",
  ) {
    super(message);
    this.name = "SupervisorPlannerError";
  }
}

function boundedString(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") {
    throw new SupervisorPlannerError(`${field} must be a string`, "proposal_invalid");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new SupervisorPlannerError(`${field} must not be empty`, "proposal_invalid");
  }
  if (normalized.includes("\0")) {
    throw new SupervisorPlannerError(`${field} must not contain NUL bytes`, "proposal_invalid");
  }
  if (normalized.length > maxChars) {
    throw new SupervisorPlannerError(`${field} exceeds ${maxChars} characters`, "proposal_invalid");
  }
  return normalized;
}

function boundedStringList(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new SupervisorPlannerError(`${field} must be an array`, "proposal_invalid");
  }
  if (value.length > maxItems) {
    throw new SupervisorPlannerError(`${field} supports at most ${maxItems} items`, "proposal_invalid");
  }
  return value.map((item, index) => boundedString(item, `${field}[${index}]`, maxChars));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extras.length > 0) {
    throw new SupervisorPlannerError(
      `Planner proposal contains forbidden field(s): ${extras.join(", ")}`,
      "proposal_invalid",
    );
  }
}

/**
 * Renders the bounded planning request for a previously approved supervisor task.
 * The planner receives opaque identity plus objective/evidence only. It may suggest
 * acceptance criteria and validation commands as data, but it receives no raw
 * workspace path, Hub/session identity, or mechanism to alter durable authority.
 */
export function renderSupervisorPlannerPrompt(task: SupervisorTaskV1): string {
  if (task.schemaVersion !== 1) {
    throw new SupervisorPlannerError("Unsupported supervisor task schema", "proposal_invalid");
  }

  const existingCriteria = task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
    : "- None recorded yet.";
  const trustedValidation = task.trustedValidationCommands.length > 0
    ? task.trustedValidationCommands.map((item) => `- ${item}`).join("\n")
    : "- None configured yet.";

  const prompt = [
    "# Supervisor Planner Request v1",
    "",
    `Supervisor task: ${task.supervisorTaskId}`,
    `Orchestrator task: ${task.taskId}`,
    "",
    "## Objective",
    task.objective,
    "",
    "## Existing acceptance criteria",
    existingCriteria,
    "",
    "## Existing trusted external validation",
    trustedValidation,
    "",
    "## Approved write scope (read-only planning context)",
    ...task.authority.allowedPathPatterns.map((pattern) => `- ${pattern}`),
    "",
    "## Protected paths",
    ...(task.authority.protectedPathPatterns.length > 0
      ? task.authority.protectedPathPatterns.map((pattern) => `- ${pattern}`)
      : ["- None additionally recorded."]),
    "",
    "## Planner rules",
    "- Produce acceptance criteria that are objective, observable, and testable.",
    "- Propose validation commands only when they directly verify the objective.",
    "- Validation commands are proposal data only. They do not grant model shell authority and are not trusted until separately admitted by the orchestrator.",
    "- Do not widen or replace the approved write scope or protected-path policy.",
    "- Do not propose changes to project/workspace identity, worker profile, Safety Plan, policy version, Hub/session identity, credentials, model permissions, shell/network/MCP/plugin access, subagents, or agent teams.",
    "- Do not claim the implementation is complete; the planner plans only.",
    "- If the objective cannot be safely planned inside the approved envelope, return empty acceptanceCriteria and proposedValidationCommands rather than inventing authority.",
    "",
    "Return JSON only with exactly these fields:",
    `{\"schemaVersion\":1,\"supervisorTaskId\":\"${task.supervisorTaskId}\",\"taskId\":\"${task.taskId}\",\"acceptanceCriteria\":[],\"proposedValidationCommands\":[],\"validationAuthority\":\"proposal_only\"}`,
  ].join("\n");

  if (prompt.length > MAX_PLANNER_PROMPT_CHARS) {
    throw new SupervisorPlannerError(
      `Rendered planner prompt exceeds ${MAX_PLANNER_PROMPT_CHARS} characters`,
      "prompt_too_large",
    );
  }
  return prompt;
}

/**
 * Validates untrusted planner output against the immutable supervisor-task binding.
 * Extra keys are rejected rather than ignored so a model cannot smuggle authority
 * changes into fields the orchestrator did not explicitly define.
 */
export function validateSupervisorPlannerProposal(
  task: SupervisorTaskV1,
  value: unknown,
): SupervisorPlannerProposalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupervisorPlannerError("Planner proposal must be an object", "proposal_invalid");
  }
  const proposal = value as Record<string, unknown>;
  exactKeys(proposal, [
    "schemaVersion",
    "supervisorTaskId",
    "taskId",
    "acceptanceCriteria",
    "proposedValidationCommands",
    "validationAuthority",
  ]);

  if (proposal.schemaVersion !== 1) {
    throw new SupervisorPlannerError("Planner proposal schemaVersion must be 1", "proposal_invalid");
  }
  if (proposal.supervisorTaskId !== task.supervisorTaskId || proposal.taskId !== task.taskId) {
    throw new SupervisorPlannerError(
      "Planner proposal does not match the approved supervisor/orchestrator task binding",
      "task_mismatch",
    );
  }
  if (proposal.validationAuthority !== "proposal_only") {
    throw new SupervisorPlannerError(
      "Planner validation commands must remain proposal_only",
      "proposal_invalid",
    );
  }

  return {
    schemaVersion: 1,
    supervisorTaskId: task.supervisorTaskId,
    taskId: task.taskId,
    acceptanceCriteria: boundedStringList(
      proposal.acceptanceCriteria,
      "acceptanceCriteria",
      MAX_PLANNER_ACCEPTANCE_CRITERIA,
      MAX_PLANNER_ACCEPTANCE_CRITERION_CHARS,
    ),
    proposedValidationCommands: boundedStringList(
      proposal.proposedValidationCommands,
      "proposedValidationCommands",
      MAX_PLANNER_VALIDATION_COMMANDS,
      MAX_PLANNER_VALIDATION_COMMAND_CHARS,
    ),
    validationAuthority: "proposal_only",
  };
}

/**
 * Executes one planner turn through an injected model adapter and validates the
 * untrusted result locally before returning it. The adapter receives planning
 * text only; it is not given a workspace handle, tool executor, shell, or any
 * method that can mutate orchestrator authority.
 */
export async function runSupervisorPlanner(
  task: SupervisorTaskV1,
  model: SupervisorPlannerModel,
): Promise<SupervisorPlannerProposalV1> {
  const prompt = renderSupervisorPlannerPrompt(task);
  let raw: unknown;
  try {
    raw = await model.plan({
      schemaVersion: 1,
      supervisorTaskId: task.supervisorTaskId,
      taskId: task.taskId,
      prompt,
    });
  } catch (error) {
    throw new SupervisorPlannerError(
      `Planner model failed: ${error instanceof Error ? error.message : String(error)}`,
      "planner_failed",
    );
  }
  return validateSupervisorPlannerProposal(task, raw);
}
