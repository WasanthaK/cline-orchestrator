import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorTask } from "./types.js";

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
    const raw = await readFile(this.taskPath(id), "utf8");
    return JSON.parse(raw) as OrchestratorTask;
  }
}
