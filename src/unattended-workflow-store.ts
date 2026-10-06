import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteUtf8 } from "./state.js";
import {
  selectRunnableWorkflowNodes,
  UnattendedWorkflowError,
  type UnattendedWorkflowV1,
} from "./unattended-workflow.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UnattendedWorkflowNotFoundError extends Error {
  constructor(public readonly workflowId: string) {
    super(`Unattended workflow '${workflowId}' was not found`);
    this.name = "UnattendedWorkflowNotFoundError";
  }
}

function requireWorkflowId(value: string): string {
  if (!UUID.test(value)) {
    throw new UnattendedWorkflowError("workflowId must be an opaque UUID", "workflow_invalid");
  }
  return value;
}

function validateWorkflow(value: UnattendedWorkflowV1): void {
  // The selector validates schema + dependency graph before considering evidence.
  // Passing no task evidence therefore gives us a side-effect-free structural check.
  selectRunnableWorkflowNodes(value, []);
}

/**
 * Machine-local durable storage for immutable workflow definitions. Runtime task
 * state remains in each task's existing TaskStore; the workflow file coordinates
 * dependency ordering only and therefore never becomes an authority source.
 */
export class UnattendedWorkflowStore {
  constructor(private readonly rootDir: string) {}

  private workflowsDir(): string {
    return path.join(this.rootDir, "workflows");
  }

  private workflowPath(workflowId: string): string {
    return path.join(this.workflowsDir(), `${requireWorkflowId(workflowId)}.json`);
  }

  async save(workflow: UnattendedWorkflowV1): Promise<void> {
    validateWorkflow(workflow);
    await mkdir(this.workflowsDir(), { recursive: true });
    await atomicWriteUtf8(
      this.workflowPath(workflow.workflowId),
      `${JSON.stringify(workflow, null, 2)}\n`,
    );
  }

  async load(workflowId: string): Promise<UnattendedWorkflowV1> {
    const id = requireWorkflowId(workflowId);
    try {
      const value = JSON.parse(await readFile(this.workflowPath(id), "utf8")) as UnattendedWorkflowV1;
      if (value.workflowId !== id) {
        throw new UnattendedWorkflowError(
          "Persisted workflow identity does not match its storage key",
          "workflow_invalid",
        );
      }
      validateWorkflow(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new UnattendedWorkflowNotFoundError(id);
      }
      throw error;
    }
  }

  async list(): Promise<UnattendedWorkflowV1[]> {
    let names: string[];
    try {
      names = await readdir(this.workflowsDir());
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }

    const workflows: UnattendedWorkflowV1[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!UUID.test(id)) continue;
      workflows.push(await this.load(id));
    }
    return workflows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.workflowId.localeCompare(b.workflowId));
  }
}
