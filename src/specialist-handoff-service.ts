import {
  createSpecialistHandoff,
  SpecialistHandoffError,
  SpecialistHandoffStore,
  type CreateSpecialistHandoffInput,
  type SpecialistHandoffOptions,
  type SpecialistHandoffV1,
} from "./specialist-handoff.js";
import { TaskStore } from "./state.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { OrchestratorTask } from "./types.js";

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

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Revalidates the supervisor packet against current durable task authority before
 * any specialist provenance is appended. Handoffs are context/evidence only and
 * cannot keep an old Safety Plan, path envelope, or worker binding alive.
 */
export function assertSpecialistTaskBindingCurrent(
  supervisor: SupervisorTaskV1,
  rawTask: OrchestratorTask,
): void {
  const task = rawTask as BoundTask;
  const authority = supervisor.authority;
  if (
    supervisor.schemaVersion !== 1
    || supervisor.taskId !== task.id
    || authority.projectId !== task.projectId
    || authority.workspaceId !== task.workspaceId
    || authority.workspaceRegistryRevision !== task.workspaceRegistryRevision
    || authority.safetyPlanId !== task.safetyPlanId
    || authority.safetyPolicyVersion !== task.safetyPolicyVersion
    || authority.safetyProfileId !== task.safetyProfileId
    || authority.safetyProfileRevision !== task.safetyProfileRevision
    || authority.workerProfileId !== task.workerProfileId
    || !sameStrings(task.approvedAllowedPathPatterns, authority.allowedPathPatterns)
    || !sameStrings(task.approvedProtectedPathPatterns ?? [], authority.protectedPathPatterns)
  ) {
    throw new SpecialistHandoffError(
      "Specialist handoff binding no longer matches current durable approved task authority",
      "binding_mismatch",
    );
  }
}

export class SpecialistHandoffService {
  private readonly tasks: TaskStore;
  private readonly handoffs: SpecialistHandoffStore;

  constructor(
    workspaceRoot: string,
    private readonly options: SpecialistHandoffOptions = {},
  ) {
    this.tasks = new TaskStore(workspaceRoot);
    this.handoffs = new SpecialistHandoffStore(workspaceRoot);
  }

  async record(
    supervisor: SupervisorTaskV1,
    input: CreateSpecialistHandoffInput,
  ): Promise<SpecialistHandoffV1> {
    const task = await this.tasks.load(supervisor.taskId);
    assertSpecialistTaskBindingCurrent(supervisor, task);

    const existing = await this.handoffs.list(supervisor.taskId);
    const previous = existing.at(-1);
    const handoff = createSpecialistHandoff(
      supervisor,
      input,
      previous,
      this.options,
    );
    await this.handoffs.append(handoff);
    return handoff;
  }

  async list(taskId: string): Promise<SpecialistHandoffV1[]> {
    return await this.handoffs.list(taskId);
  }
}
