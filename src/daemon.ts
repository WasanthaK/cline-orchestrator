import crypto from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ClineRunner } from "./cline-runner.js";
import { preflightProvider } from "./provider-preflight.js";
import { rollbackTask } from "./rollback.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";
import {
  buildValidationRepairPrompt,
  runValidationCommands,
  validationFailureMessage,
} from "./validation.js";

interface DaemonOptions {
  host: string;
  port: number;
}

class BadRequestError extends Error {
  readonly code = "bad_request";
}

class DaemonTaskStateError extends Error {
  readonly code = "invalid_task_state";
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) {
      throw new BadRequestError("Request body is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
}

function readStringList(
  value: unknown,
  field: string,
  maxItems: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be an array of strings`);
  if (value.length > maxItems) throw new BadRequestError(`${field} supports at most ${maxItems} items`);

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new BadRequestError(`${field}[${index}] must be a string`);
    }
    const normalized = item.trim();
    if (!normalized) throw new BadRequestError(`${field}[${index}] must not be empty`);
    if (normalized.length > 2000) {
      throw new BadRequestError(`${field}[${index}] exceeds 2000 characters`);
    }
    return normalized;
  });
}

function errorPayload(error: unknown) {
  const value = error as any;
  return {
    error: error instanceof Error ? error.message : String(error),
    code: value?.code,
    sessionId: value?.sessionId,
  };
}

function isTerminal(task: OrchestratorTask): boolean {
  return (
    task.status === "completed" ||
    task.status === "validation_failed" ||
    task.status === "failed" ||
    task.status === "aborted" ||
    task.status === "rolled_back"
  );
}

export async function startDaemon(
  workspace: string,
  worker: WorkerConfig,
  options: DaemonOptions,
): Promise<void> {
  const store = new TaskStore(workspace);
  const runner = new ClineRunner(workspace, worker);

  let tail: Promise<void> = Promise.resolve();
  let closing = false;
  let activeTaskId: string | undefined;
  let activeValidationTaskId: string | undefined;
  let activeValidationAbort: AbortController | undefined;
  let queuedJobs = 0;
  let rollbackInProgress = false;
  let lastProviderPreflight: ProviderPreflightResult | undefined;

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const next = tail.then(job, job);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function runProviderPreflight(): Promise<ProviderPreflightResult> {
    lastProviderPreflight = await preflightProvider(worker);
    return lastProviderPreflight;
  }

  async function requireProviderReady(res: ServerResponse): Promise<boolean> {
    const result = await runProviderPreflight();
    if (result.ok) return true;

    json(res, 503, {
      error: result.message,
      code: result.code,
      preflight: result,
    });
    return false;
  }

  async function abortValidationTask(taskId: string, reason: string): Promise<OrchestratorTask> {
    const task = await store.load(taskId);
    if (isTerminal(task)) {
      throw new DaemonTaskStateError(`Task ${taskId} is already ${task.status}`);
    }

    const requestedAt = new Date().toISOString();
    await store.appendEvent(taskId, "abort_requested", {
      status: task.status,
      message: reason,
      data: {
        sessionId: task.clineSessionId,
        requestedAt,
        phase: "validation",
      },
    });

    if (activeValidationTaskId === taskId) {
      activeValidationAbort?.abort();
    }

    task.abortRequestedAt = requestedAt;
    task.abortReason = reason;
    task.status = "aborted";
    task.finishReason = "aborted";
    task.error = undefined;
    await store.save(task);
    process.stdout.write(`\n[orchestrator validation aborted: ${taskId}; reason=${reason}]\n`);
    return task;
  }

  async function abortIfPending(taskId: string, reason: string): Promise<void> {
    const task = await store.load(taskId);
    if (isTerminal(task)) return;
    if (task.status === "validating" || activeValidationTaskId === taskId) {
      await abortValidationTask(taskId, reason);
      return;
    }

    try {
      await runner.abort(taskId, reason);
    } catch (error) {
      const latest = await store.load(taskId);
      if (!isTerminal(latest)) throw error;
    }
  }

  async function executeWithValidation(
    task: OrchestratorTask,
    modelJob: () => Promise<OrchestratorTask>,
  ): Promise<OrchestratorTask> {
    let result = await modelJob();

    while (result.status === "validating") {
      const commands = result.validationCommands ?? [];
      if (commands.length === 0) {
        result.status = "completed";
        result.finishReason = "completed";
        await store.save(result);
        return result;
      }

      const controller = new AbortController();
      activeValidationTaskId = result.id;
      activeValidationAbort = controller;

      let validation;
      try {
        process.stdout.write(
          `\n[orchestrator validation: ${commands.length} command(s); timeout=${worker.validationTimeoutMs}ms each]\n`,
        );
        validation = await runValidationCommands(workspace, commands, {
          timeoutMs: worker.validationTimeoutMs,
          maxOutputChars: worker.maxValidationOutputChars,
          signal: controller.signal,
        });
      } finally {
        if (activeValidationTaskId === result.id) activeValidationTaskId = undefined;
        if (activeValidationAbort === controller) activeValidationAbort = undefined;
      }

      const latest = await store.load(result.id);
      if (latest.status === "aborted" || controller.signal.aborted) return latest;

      latest.lastValidation = validation;
      if (validation.passed) {
        latest.status = "completed";
        latest.finishReason = "completed";
        latest.error = undefined;
        process.stdout.write(
          `\n[orchestrator validation passed: ${validation.commandsRun}/${validation.commandsRequested} commands]\n`,
        );
        await store.save(latest);
        return latest;
      }

      const failure = validationFailureMessage(validation);
      const repairsUsed = latest.validationRepairCount ?? 0;
      if (repairsUsed >= worker.maxValidationRepairs) {
        latest.status = "validation_failed";
        latest.finishReason = "validation_failed";
        latest.error = failure;
        process.stdout.write(`\n[orchestrator validation failed: ${failure}]\n`);
        await store.save(latest);
        return latest;
      }

      latest.validationRepairCount = repairsUsed + 1;
      latest.status = "repairing";
      latest.finishReason = undefined;
      latest.error = failure;
      await store.save(latest);

      const repairPrompt = buildValidationRepairPrompt(latest, validation);
      process.stdout.write(
        `\n[orchestrator validation repair: ${latest.validationRepairCount}/${worker.maxValidationRepairs}]\n`,
      );
      result = await runner.resume(latest, repairPrompt);
      if (result.status !== "validating") return result;
    }

    return result;
  }

  function enqueue(taskId: string, label: string, job: () => Promise<unknown>) {
    queuedJobs += 1;
    void serial(async () => {
      queuedJobs = Math.max(0, queuedJobs - 1);
      if (closing) {
        await abortIfPending(taskId, "Daemon shutting down before task started");
        return;
      }

      activeTaskId = taskId;
      try {
        await job();
      } finally {
        if (activeTaskId === taskId) activeTaskId = undefined;
      }
    }).catch((error) => {
      process.stderr.write(
        `\n[orchestrator job failed: ${label}: ${error instanceof Error ? error.message : String(error)}]\n`,
      );
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          status: closing ? "shutting_down" : "running",
          workspace,
          activeTaskId,
          activeValidationTaskId,
          queuedJobs,
          rollbackInProgress,
          providerPreflight: lastProviderPreflight,
          worker: {
            providerId: worker.providerId,
            modelId: worker.modelId,
            baseUrl: worker.baseUrl,
            contextWindow: worker.contextWindow,
            maxInputTokens: worker.maxInputTokens,
            maxTokensPerTurn: worker.maxTokensPerTurn,
            reasoningEffort: worker.reasoningEffort,
            preflightTimeoutMs: worker.preflightTimeoutMs,
            validationTimeoutMs: worker.validationTimeoutMs,
            maxValidationOutputChars: worker.maxValidationOutputChars,
            maxValidationRepairs: worker.maxValidationRepairs,
            checkpointMaxUntrackedFiles: worker.checkpointMaxUntrackedFiles,
            checkpointMaxUntrackedBytes: worker.checkpointMaxUntrackedBytes,
            stallTimeoutMs: worker.stallTimeoutMs,
            maxRetries: worker.maxRetries,
            retryDelayMs: worker.retryDelayMs,
          },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/preflight") {
        const result = await runProviderPreflight();
        json(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/tasks") {
        json(res, 200, await store.list());
        return;
      }

      const eventsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/events$/);
      if (req.method === "GET" && eventsMatch) {
        const taskId = decodeURIComponent(eventsMatch[1]);
        json(res, 200, await store.events(taskId));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/tasks/")) {
        const taskId = decodeURIComponent(url.pathname.slice("/tasks/".length));
        json(res, 200, await store.load(taskId));
        return;
      }

      const abortMatch = url.pathname.match(/^\/tasks\/([^/]+)\/abort$/);
      if (req.method === "POST" && abortMatch) {
        const taskId = decodeURIComponent(abortMatch[1]);
        const body = await readJson(req);
        const reason = String(body?.reason ?? "").trim() || "Task aborted by user";
        const task = await store.load(taskId);
        if (isTerminal(task)) {
          throw new DaemonTaskStateError(`Task ${taskId} is already ${task.status}`);
        }
        if (task.status === "validating" || activeValidationTaskId === taskId) {
          json(res, 200, await abortValidationTask(taskId, reason));
        } else {
          json(res, 200, await runner.abort(taskId, reason));
        }
        return;
      }

      const rollbackMatch = url.pathname.match(/^\/tasks\/([^/]+)\/rollback$/);
      if (req.method === "POST" && rollbackMatch) {
        if (closing) {
          json(res, 503, { error: "Orchestrator daemon is shutting down" });
          return;
        }
        if (rollbackInProgress || activeTaskId || activeValidationTaskId || queuedJobs > 0) {
          json(res, 409, {
            error: "Rollback requires an idle orchestrator with no active or queued work",
            code: "invalid_task_state",
          });
          return;
        }

        const taskId = decodeURIComponent(rollbackMatch[1]);
        rollbackInProgress = true;
        try {
          const task = await serial(() => rollbackTask(store, workspace, taskId));
          json(res, 200, task);
        } finally {
          rollbackInProgress = false;
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        if (closing) {
          json(res, 503, { error: "Orchestrator daemon is shutting down" });
          return;
        }
        if (rollbackInProgress) {
          json(res, 409, { error: "Rollback is in progress", code: "invalid_task_state" });
          return;
        }

        const body = await readJson(req);
        const goal = String(body?.goal ?? "").trim();
        if (!goal) {
          json(res, 400, { error: "goal is required" });
          return;
        }

        const acceptanceCriteria = readStringList(body?.acceptanceCriteria, "acceptanceCriteria", 50);
        const validationCommands = readStringList(body?.validationCommands, "validationCommands", 20);

        if (!(await requireProviderReady(res))) return;

        const now = new Date().toISOString();
        const task: OrchestratorTask = {
          id: crypto.randomUUID(),
          goal,
          workspace,
          status: "waiting",
          createdAt: now,
          updatedAt: now,
          lastPrompt: goal,
          ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
          ...(validationCommands ? { validationCommands } : {}),
        };
        await store.save(task);
        await store.appendEvent(task.id, "queued", {
          status: task.status,
          message: "Task queued for execution",
          data: { goal, acceptanceCriteria, validationCommands },
        });
        process.stdout.write(`\n[orchestrator task queued: ${task.id}]\n`);

        json(res, 202, task);
        enqueue(task.id, `run ${task.id}`, () =>
          executeWithValidation(task, () => runner.start(task)),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/resume") {
        if (closing) {
          json(res, 503, { error: "Orchestrator daemon is shutting down" });
          return;
        }
        if (rollbackInProgress) {
          json(res, 409, { error: "Rollback is in progress", code: "invalid_task_state" });
          return;
        }

        const body = await readJson(req);
        const taskId = String(body?.taskId ?? "").trim();
        const prompt = String(body?.prompt ?? "").trim();
        if (!taskId || !prompt) {
          json(res, 400, { error: "taskId and prompt are required" });
          return;
        }

        const task = await store.load(taskId);
        if (
          task.status === "running" ||
          task.status === "waiting" ||
          task.status === "stalled" ||
          task.status === "validating" ||
          task.status === "repairing"
        ) {
          json(res, 409, { error: `Task ${task.id} is already ${task.status}` });
          return;
        }
        if (task.status === "rolled_back") {
          json(res, 409, {
            error: `Task ${task.id} was rolled back; start a new task instead of resuming stale model context`,
            code: "invalid_task_state",
          });
          return;
        }

        const acceptanceCriteria = readStringList(body?.acceptanceCriteria, "acceptanceCriteria", 50);
        const validationCommands = readStringList(body?.validationCommands, "validationCommands", 20);

        if (!(await requireProviderReady(res))) return;

        task.status = "waiting";
        task.lastPrompt = prompt;
        task.error = undefined;
        task.finishReason = undefined;
        task.lastValidation = undefined;
        task.validationRepairCount = 0;
        if (acceptanceCriteria !== undefined) task.acceptanceCriteria = acceptanceCriteria;
        if (validationCommands !== undefined) task.validationCommands = validationCommands;
        await store.save(task);
        await store.appendEvent(task.id, "resume_queued", {
          status: task.status,
          message: "Task queued for resume",
          data: {
            prompt,
            acceptanceCriteria: task.acceptanceCriteria,
            validationCommands: task.validationCommands,
          },
        });
        process.stdout.write(`\n[orchestrator task queued for resume: ${task.id}]\n`);

        json(res, 202, task);
        enqueue(task.id, `resume ${task.id}`, () =>
          executeWithValidation(task, () => runner.resume(task, prompt)),
        );
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof BadRequestError) {
        json(res, 400, errorPayload(error));
        return;
      }
      if (error instanceof TaskNotFoundError) {
        json(res, 404, errorPayload(error));
        return;
      }

      const code = (error as any)?.code;
      json(
        res,
        code === "session_not_found" || code === "invalid_task_state" ? 409 : 500,
        errorPayload(error),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  process.stdout.write(
    `[orchestrator daemon: http://${options.host}:${options.port}; workspace=${workspace}; concurrency=1]\n`,
  );

  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      const reason = `Daemon shutdown (${signal})`;
      process.stdout.write(`\n[orchestrator daemon shutting down: ${signal}]\n`);

      try {
        if (activeTaskId) {
          await abortIfPending(activeTaskId, reason);
        }

        await tail;
        await runner.close(reason);
        await new Promise<void>((serverClosed) => {
          server.close(() => serverClosed());
        });
        process.stdout.write("[orchestrator daemon shutdown complete]\n");
      } catch (error) {
        process.stderr.write(
          `\n[orchestrator shutdown warning: ${error instanceof Error ? error.message : String(error)}]\n`,
        );
        try {
          await runner.close(reason);
        } finally {
          server.close(() => resolve());
        }
        return;
      }

      resolve();
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });
}
