import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HumanEscalationService } from "./human-escalation.js";
import type { SupervisorPlannerProposalV1 } from "./supervisor-planner.js";
import type { SupervisorReviewerResultV1 } from "./supervisor-reviewer.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

const MAX_DECISION_SUMMARY_CHARS = 4_000;
const MAX_DECISION_ITEMS = 20;
const MAX_DECISION_ITEM_CHARS = 1_000;

export type SupervisorDecisionKind =
  | "planner_proposal"
  | "planner_admission"
  | "review_pass"
  | "review_repair"
  | "review_escalation";

export interface SupervisorDecisionV1 {
  schemaVersion: 1;
  decisionId: string;
  createdAt: string;
  supervisorTaskId: string;
  taskId: string;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workspaceRegistryRevision: number;
  kind: SupervisorDecisionKind;
  provenance: "planner" | "reviewer" | "trusted_admission";
  summary: string;
  acceptanceCriteria?: string[];
  proposedValidationCommands?: string[];
  admittedValidationCommands?: string[];
  repairInstruction?: string;
  escalationReason?: string;
  escalationId?: string;
}

export interface PlannerAdmissionRequest {
  acceptAcceptanceCriteria: boolean;
  admittedValidationCommands: string[];
}

export interface SupervisorDecisionOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class SupervisorDecisionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "binding_stale"
      | "decision_invalid"
      | "proposal_not_admissible",
  ) {
    super(message);
    this.name = "SupervisorDecisionError";
  }
}

type BoundTask = OrchestratorTask & {
  workspaceRegistryRevision?: number;
  safetyPlanId?: string;
  safetyProfileId?: string;
  safetyProfileRevision?: number;
};

function boundedText(value: string, field: string, max = MAX_DECISION_SUMMARY_CHARS): string {
  const normalized = value.trim();
  if (!normalized) throw new SupervisorDecisionError(`${field} must not be empty`, "decision_invalid");
  if (normalized.includes("\0")) throw new SupervisorDecisionError(`${field} must not contain NUL bytes`, "decision_invalid");
  if (normalized.length > max) throw new SupervisorDecisionError(`${field} exceeds ${max} characters`, "decision_invalid");
  return normalized;
}

function boundedItems(values: string[], field: string): string[] {
  if (values.length > MAX_DECISION_ITEMS) {
    throw new SupervisorDecisionError(`${field} supports at most ${MAX_DECISION_ITEMS} items`, "decision_invalid");
  }
  return values.map((value, index) => boundedText(value, `${field}[${index}]`, MAX_DECISION_ITEM_CHARS));
}

function assertBindingCurrent(supervisor: SupervisorTaskV1, rawTask: OrchestratorTask): BoundTask {
  const task = rawTask as BoundTask;
  const authority = supervisor.authority;
  if (
    supervisor.taskId !== task.id
    || authority.safetyPlanId !== task.safetyPlanId
    || authority.safetyProfileId !== task.safetyProfileId
    || authority.safetyProfileRevision !== task.safetyProfileRevision
    || authority.workspaceRegistryRevision !== task.workspaceRegistryRevision
  ) {
    throw new SupervisorDecisionError(
      "Supervisor decision binding no longer matches the durable approved task authority",
      "binding_stale",
    );
  }
  return task;
}

function assertPlannerAdmissionIsPreRun(task: OrchestratorTask): void {
  const runCount = task.runCount ?? 0;
  if (runCount !== 0 || !["created", "waiting"].includes(task.status)) {
    throw new SupervisorDecisionError(
      `Planner admission is allowed only before implementation execution begins (status=${task.status}; runCount=${runCount})`,
      "proposal_not_admissible",
    );
  }
}

function decisionBase(
  supervisor: SupervisorTaskV1,
  kind: SupervisorDecisionKind,
  provenance: SupervisorDecisionV1["provenance"],
  summary: string,
  options: SupervisorDecisionOptions,
): SupervisorDecisionV1 {
  const decisionId = (options.idFactory ?? (() => crypto.randomUUID()))();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decisionId)) {
    throw new SupervisorDecisionError("decisionId must be an opaque UUID", "decision_invalid");
  }
  return {
    schemaVersion: 1,
    decisionId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    kind,
    provenance,
    summary: boundedText(summary, "summary"),
  };
}

export class SupervisorDecisionStore {
  constructor(private readonly workspaceRoot: string) {}

  private dir(): string {
    return path.join(this.workspaceRoot, ".orchestrator", "supervisor-decisions");
  }

  private file(taskId: string): string {
    return path.join(this.dir(), `${taskId}.jsonl`);
  }

  async append(decision: SupervisorDecisionV1): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.file(decision.taskId), `${JSON.stringify(decision)}\n`, "utf8");
  }

  async list(taskId: string): Promise<SupervisorDecisionV1[]> {
    try {
      const raw = await readFile(this.file(taskId), "utf8");
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SupervisorDecisionV1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export class SupervisorDecisionService {
  private readonly decisions: SupervisorDecisionStore;
  private readonly tasks: TaskStore;
  private readonly escalations: HumanEscalationService;

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: SupervisorDecisionOptions = {},
  ) {
    this.decisions = new SupervisorDecisionStore(workspaceRoot);
    this.tasks = new TaskStore(workspaceRoot);
    this.escalations = new HumanEscalationService(this.tasks);
  }

  async recordPlannerProposal(
    supervisor: SupervisorTaskV1,
    proposal: SupervisorPlannerProposalV1,
  ): Promise<SupervisorDecisionV1> {
    const task = await this.tasks.load(supervisor.taskId);
    assertBindingCurrent(supervisor, task);
    if (proposal.supervisorTaskId !== supervisor.supervisorTaskId || proposal.taskId !== supervisor.taskId) {
      throw new SupervisorDecisionError("Planner proposal does not match supervisor task binding", "binding_stale");
    }

    const decision: SupervisorDecisionV1 = {
      ...decisionBase(
        supervisor,
        "planner_proposal",
        "planner",
        "Planner proposed bounded acceptance criteria and validation commands",
        this.options,
      ),
      acceptanceCriteria: boundedItems(proposal.acceptanceCriteria, "acceptanceCriteria"),
      proposedValidationCommands: boundedItems(proposal.proposedValidationCommands, "proposedValidationCommands"),
    };
    await this.decisions.append(decision);
    return decision;
  }

  async admitPlannerProposal(
    supervisor: SupervisorTaskV1,
    proposal: SupervisorPlannerProposalV1,
    request: PlannerAdmissionRequest,
  ): Promise<SupervisorDecisionV1> {
    const task = await this.tasks.load(supervisor.taskId);
    assertBindingCurrent(supervisor, task);
    assertPlannerAdmissionIsPreRun(task);
    if (proposal.supervisorTaskId !== supervisor.supervisorTaskId || proposal.taskId !== supervisor.taskId) {
      throw new SupervisorDecisionError("Planner proposal does not match supervisor task binding", "binding_stale");
    }

    const proposedValidation = new Set(proposal.proposedValidationCommands);
    const admittedValidationCommands = boundedItems(
      request.admittedValidationCommands,
      "admittedValidationCommands",
    );
    if (admittedValidationCommands.some((command) => !proposedValidation.has(command))) {
      throw new SupervisorDecisionError(
        "Trusted admission may select only exact validation commands from the planner proposal",
        "proposal_not_admissible",
      );
    }

    if (request.acceptAcceptanceCriteria) {
      task.acceptanceCriteria = boundedItems(proposal.acceptanceCriteria, "acceptanceCriteria");
    }
    if (admittedValidationCommands.length > 0) {
      task.validationCommands = admittedValidationCommands;
    }
    await this.tasks.save(task);

    const decision: SupervisorDecisionV1 = {
      ...decisionBase(
        supervisor,
        "planner_admission",
        "trusted_admission",
        "Trusted admission accepted bounded planner output",
        this.options,
      ),
      ...(request.acceptAcceptanceCriteria
        ? { acceptanceCriteria: boundedItems(proposal.acceptanceCriteria, "acceptanceCriteria") }
        : {}),
      admittedValidationCommands,
    };
    await this.decisions.append(decision);
    return decision;
  }

  async applyReviewerResult(
    supervisor: SupervisorTaskV1,
    result: SupervisorReviewerResultV1,
  ): Promise<SupervisorDecisionV1> {
    const task = await this.tasks.load(supervisor.taskId);
    assertBindingCurrent(supervisor, task);
    if (result.supervisorTaskId !== supervisor.supervisorTaskId || result.taskId !== supervisor.taskId) {
      throw new SupervisorDecisionError("Reviewer result does not match supervisor task binding", "binding_stale");
    }

    if (result.decision === "pass") {
      const decision: SupervisorDecisionV1 = {
        ...decisionBase(supervisor, "review_pass", "reviewer", result.summary, this.options),
      };
      await this.decisions.append(decision);
      return decision;
    }

    if (result.decision === "repair") {
      const decision: SupervisorDecisionV1 = {
        ...decisionBase(supervisor, "review_repair", "reviewer", result.summary, this.options),
        repairInstruction: boundedText(result.repairInstruction ?? "", "repairInstruction"),
      };
      await this.decisions.append(decision);
      return decision;
    }

    const escalationReason = boundedText(result.escalationReason ?? "", "escalationReason");
    const escalation = await this.escalations.request(
      task.id,
      {
        kind: "unknown",
        toolName: "supervisor_reviewer",
        reason: escalationReason,
      },
      escalationReason,
    );
    const decision: SupervisorDecisionV1 = {
      ...decisionBase(supervisor, "review_escalation", "reviewer", result.summary, this.options),
      escalationReason,
      escalationId: escalation.escalationId,
    };
    await this.decisions.append(decision);
    return decision;
  }

  async list(taskId: string): Promise<SupervisorDecisionV1[]> {
    return await this.decisions.list(taskId);
  }
}
