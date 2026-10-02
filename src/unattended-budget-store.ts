import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  UnattendedBudgetDimension,
  UnattendedStartGuardResult,
} from "./unattended-budget.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCOUNTING_ISSUES = 50;

export interface UnattendedBudgetDecisionV1 {
  schemaVersion: 1;
  decisionId: string;
  workflowId: string;
  taskId: string;
  decidedAt: string;
  allowed: boolean;
  reason: UnattendedStartGuardResult["reason"];
  exhausted: UnattendedBudgetDimension[];
  accountingIssues: string[];
  dependencyTaskId?: string;
}

export interface UnattendedBudgetDecisionStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new Error(`${field} must be an opaque UUID`);
  return value;
}

function boundedIssues(values: string[]): string[] {
  return values.slice(0, MAX_ACCOUNTING_ISSUES).map((value) =>
    value.length <= 500 ? value : `${value.slice(0, 500)}…`
  );
}

/** Durable append-only budget/start decisions for later human/report visibility. */
export class UnattendedBudgetDecisionStore {
  constructor(
    private readonly rootDir: string,
    private readonly options: UnattendedBudgetDecisionStoreOptions = {},
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "budget-decisions");
  }

  private journal(workflowId: string): string {
    return path.join(this.dir(), `${requireUuid(workflowId, "workflowId")}.jsonl`);
  }

  async append(
    workflowId: string,
    taskId: string,
    guard: UnattendedStartGuardResult,
  ): Promise<UnattendedBudgetDecisionV1> {
    workflowId = requireUuid(workflowId, "workflowId");
    taskId = requireUuid(taskId, "taskId");
    const decision: UnattendedBudgetDecisionV1 = {
      schemaVersion: 1,
      decisionId: requireUuid(
        (this.options.idFactory ?? (() => crypto.randomUUID()))(),
        "decisionId",
      ),
      workflowId,
      taskId,
      decidedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      allowed: guard.allowed,
      reason: guard.reason,
      exhausted: [...guard.exhausted],
      accountingIssues: boundedIssues(guard.accountingIssues),
      dependencyTaskId: guard.dependencyTaskId,
    };
    await mkdir(this.dir(), { recursive: true });
    await appendFile(this.journal(workflowId), `${JSON.stringify(decision)}\n`, "utf8");
    return decision;
  }

  async list(workflowId: string): Promise<UnattendedBudgetDecisionV1[]> {
    try {
      const raw = await readFile(this.journal(workflowId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as UnattendedBudgetDecisionV1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }
}
