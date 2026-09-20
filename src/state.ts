import crypto from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorTask, TaskEvent, TaskEventType, TaskStatus } from "./types.js";

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

  private eventsDir() {
    return path.join(this.rootDir, ".orchestrator", "events");
  }

  private taskPath(id: string) {
    return path.join(this.tasksDir(), `${id}.json`);
  }

  private eventPath(id: string) {
    return path.join(this.eventsDir(), `${id}.jsonl`);
  }

  async save(task: OrchestratorTask): Promise<void> {
    await mkdir(this.tasksDir(), { recursive: true });
    task.updatedAt = new Date().toISOString();
    await writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2) + "\n", "utf8");
  }

  async appendEvent(
    taskId: string,
    type: TaskEventType,
    options: {
      status?: TaskStatus;
      message?: string;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<TaskEvent> {
    await mkdir(this.eventsDir(), { recursive: true });
    const event: TaskEvent = {
      id: crypto.randomUUID(),
      taskId,
      type,
      timestamp: new Date().toISOString(),
      ...options,
    };
    await appendFile(this.eventPath(taskId), JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  async events(taskId: string): Promise<TaskEvent[]> {
    try {
      const raw = await readFile(this.eventPath(taskId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TaskEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        // Preserve the same not-found semantics for a genuinely unknown task,
        // while allowing older tasks created before event logging to return [].
        try {
          await this.load(taskId);
          return [];
        } catch (loadError) {
          throw loadError;
        }
      }
      throw error;
    }
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
