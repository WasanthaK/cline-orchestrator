import crypto from "node:crypto";
import { bindTaskToSafetyPlan, SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

export interface SafeTaskStartResult {
  task: OrchestratorTask;
  workspaceRoot: string;
}

/**
 * Starts durable task state from a previously approved Safety Plan.
 *
 * Deliberately accepts only the opaque plan token. Workspace, scope, validation,
 * policy, and worker identity all come from the server-side plan/registry.
 * This primitive does not start Cline; Hub/runtime execution is a later unit.
 */
export async function startApprovedTask(
  safetyPlans: SafetyPlanService,
  planToken: string,
): Promise<SafeTaskStartResult> {
  const approved = await safetyPlans.consumeForTask(planToken);
  const now = new Date().toISOString();
  const task = bindTaskToSafetyPlan(
    {
      id: crypto.randomUUID(),
      goal: approved.plan.goal,
      workspace: approved.workspace.canonicalRoot,
      status: "created",
      createdAt: now,
      updatedAt: now,
      validationCommands: [...approved.plan.validationCommands],
      expectedChangedPaths: [...approved.plan.allowedPathPatterns],
    },
    approved.binding,
  );

  const store = new TaskStore(approved.workspace.canonicalRoot);
  await store.save(task);
  return { task, workspaceRoot: approved.workspace.canonicalRoot };
}
