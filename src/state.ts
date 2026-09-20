import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorTask } from "./types.js";

export class TaskNotFoundError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly workspace: string,
  ) {
    super(`Task '${taskId}' was not found in ${path.join(workspace, ".orchestrator", "tasks")}`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskStore {
  constructor(private readonly rootDir: string) {}

  private tasksDir() {
    return path.join(this.rootDir, ".orchestrator", "tasks");
  }

  private taskPath(id: string) {
    return path.join(this.tasksDir(), `${id}.json`);
  }

  async save(task: OrchestratorTask): Promise<void> {
    await mkdir(this.tasksDir(), { recursive: true });
    task.updatedAt = new Date().toISOString();
    await writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2) + "\n", "utf8");
  }

  async load(id: string): Promise<OrchestratorTask> {
    try {
      const raw = await readFile(this.taskPath(id), "utf8");
      return JSON.parse(raw) as OrchestratorTask;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new TaskNotFoundError(id, this.rootDir);
      }
      throw error;
    }
  }

  async list(): Promise<OrchestratorTask[]> {
    let filenames: string[];
    try {
      filenames = await readdir(this.tasksDir());
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const tasks = await Promise.all(
      filenames
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const raw = await readFile(path.join(this.tasksDir(), name), "utf8");
          return JSON.parse(raw) as OrchestratorTask;
        }),
    );

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
