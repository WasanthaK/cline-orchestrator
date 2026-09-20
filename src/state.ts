import crypto from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureGitSnapshot } from "./git-state.js";
import type {
  GitSnapshot,
  OrchestratorTask,
  TaskEvent,
  TaskEventType,
  TaskStatus,
} from "./types.js";

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function gitSnapshotMessage(phase: "before" | "after", snapshot: GitSnapshot): string {
  if (!snapshot.available) return `Git ${phase} snapshot unavailable`;
  const branch = snapshot.branch ?? "(detached)";
  const head = snapshot.head?.slice(0, 8) ?? "unknown";
  return `Git ${phase}: ${branch}@${head}; dirty=${snapshot.dirty ? "yes" : "no"}; changed=${snapshot.changedFiles ?? 0}`;
}

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

  private async previousTask(id: string): Promise<OrchestratorTask | undefined> {
    try {
      const raw = await readFile(this.taskPath(id), "utf8");
      return JSON.parse(raw) as OrchestratorTask;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async inferEvents(previous: OrchestratorTask | undefined, task: OrchestratorTask) {
    if (!previous) return;

    const stallIncreased = (task.stallCount ?? 0) > (previous.stallCount ?? 0);
    const retryIncreased = (task.retryCount ?? 0) > (previous.retryCount ?? 0);
    const recoveryIncreased = (task.recoveryCount ?? 0) > (previous.recoveryCount ?? 0);
    const generationIncreased = (task.sessionGeneration ?? 0) > (previous.sessionGeneration ?? 0);
    const beforeSnapshot = task.lastRunGit?.before;
    const afterSnapshot = task.lastRunGit?.after;
    const beforeChanged =
      beforeSnapshot !== undefined &&
      beforeSnapshot.capturedAt !== previous.lastRunGit?.before?.capturedAt;
    const afterChanged =
      afterSnapshot !== undefined &&
      afterSnapshot.capturedAt !== previous.lastRunGit?.after?.capturedAt;

    if (beforeChanged && beforeSnapshot) {
      await this.appendEvent(task.id, "git_snapshot", {
        status: task.status,
        message: gitSnapshotMessage("before", beforeSnapshot),
        data: { phase: "before", snapshot: beforeSnapshot },
      });
    }

    if (stallIncreased) {
      await this.appendEvent(task.id, "stalled", {
        status: task.status,
        message: `Watchdog detected ${task.lastStallSilenceMs ?? "unknown"}ms without Cline activity`,
        data: {
          stallCount: task.stallCount ?? 0,
          silenceMs: task.lastStallSilenceMs,
          sessionId: task.clineSessionId,
        },
      });
    }

    if (retryIncreased) {
      await this.appendEvent(task.id, "retrying", {
        status: task.status,
        message: `Retrying task after ${task.lastRetryReason ?? "interruption"}`,
        data: {
          retryCount: task.retryCount ?? 0,
          reason: task.lastRetryReason,
        },
      });
    }

    if (generationIncreased) {
      if (recoveryIncreased) {
        await this.appendEvent(task.id, "session_recovered", {
          status: task.status,
          message: `Recovered Cline session generation ${task.sessionGeneration ?? 0}`,
          data: {
            generation: task.sessionGeneration,
            recoveryCount: task.recoveryCount,
            reason: task.lastRecoveryReason,
            previousSessionId: task.lastRecoveredFromSessionId,
            sessionId: task.clineSessionId,
          },
        });
      } else {
        await this.appendEvent(task.id, "session_started", {
          status: task.status,
          message: `Started Cline session generation ${task.sessionGeneration ?? 0}`,
          data: {
            generation: task.sessionGeneration,
            sessionId: task.clineSessionId,
          },
        });
      }
    }

    if (afterChanged && afterSnapshot) {
      await this.appendEvent(task.id, "git_snapshot", {
        status: task.status,
        message: gitSnapshotMessage("after", afterSnapshot),
        data: { phase: "after", snapshot: afterSnapshot },
      });
    }

    if (task.status !== previous.status) {
      if (task.status === "running" && !retryIncreased) {
        await this.appendEvent(task.id, "run_started", {
          status: task.status,
          message: `Run ${task.runCount ?? 1} started`,
          data: { runCount: task.runCount ?? 1 },
        });
      } else if (task.status === "completed") {
        await this.appendEvent(task.id, "completed", {
          status: task.status,
          message: "Task completed",
          data: { finishReason: task.finishReason },
        });
      } else if (task.status === "failed") {
        await this.appendEvent(task.id, "failed", {
          status: task.status,
          message: task.error ?? "Task failed",
          data: { finishReason: task.finishReason },
        });
      } else if (task.status === "aborted") {
        await this.appendEvent(task.id, "aborted", {
          status: task.status,
          message: task.abortReason ?? task.error ?? "Task aborted",
          data: {
            finishReason: task.finishReason,
            abortRequestedAt: task.abortRequestedAt,
          },
        });
      }
    }
  }

  async save(task: OrchestratorTask): Promise<void> {
    await mkdir(this.tasksDir(), { recursive: true });
    const previous = await this.previousTask(task.id);

    if (previous) {
      const runStarted =
        task.status === "running" &&
        previous.status !== "running" &&
        (task.runCount ?? 0) > (previous.runCount ?? 0);
      if (runStarted) {
        task.lastRunGit = {
          before: await captureGitSnapshot(this.rootDir),
        };
      }

      const terminalTransition =
        isTerminalStatus(task.status) && !isTerminalStatus(previous.status);
      if (terminalTransition && task.lastRunGit?.before && !task.lastRunGit.after) {
        task.lastRunGit = {
          ...task.lastRunGit,
          after: await captureGitSnapshot(this.rootDir),
        };
      }
    }

    task.updatedAt = new Date().toISOString();
    await writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2) + "\n", "utf8");
    await this.inferEvents(previous, task);
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
        // Older tasks created before event logging legitimately have no event file.
        // Confirm the task itself exists before returning an empty timeline.
        await this.load(taskId);
        return [];
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
