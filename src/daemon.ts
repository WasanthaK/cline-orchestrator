import crypto from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ClineRunner } from "./cline-runner.js";
import { preflightProvider } from "./provider-preflight.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, ProviderPreflightResult, WorkerConfig } from "./types.js";

interface DaemonOptions {
  host: string;
  port: number;
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
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  return task.status === "completed" || task.status === "failed" || task.status === "aborted";
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

  async function abortIfPending(taskId: string, reason: string): Promise<void> {
    const task = await store.load(taskId);
    if (isTerminal(task)) return;
    try {
      await runner.abort(taskId, reason);
    } catch (error) {
      const latest = await store.load(taskId);
      if (!isTerminal(latest)) throw error;
    }
  }

  function enqueue(taskId: string, label: string, job: () => Promise<unknown>) {
    void serial(async () => {
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
        json(res, 200, await runner.abort(taskId, reason));
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        if (closing) {
          json(res, 503, { error: "Orchestrator daemon is shutting down" });
          return;
        }

        const body = await readJson(req);
        const goal = String(body?.goal ?? "").trim();
        if (!goal) {
          json(res, 400, { error: "goal is required" });
          return;
        }

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
        };
        await store.save(task);
        await store.appendEvent(task.id, "queued", {
          status: task.status,
          message: "Task queued for execution",
          data: { goal },
        });
        process.stdout.write(`\n[orchestrator task queued: ${task.id}]\n`);

        json(res, 202, task);
        enqueue(task.id, `run ${task.id}`, () => runner.start(task));
        return;
      }

      if (req.method === "POST" && url.pathname === "/resume") {
        if (closing) {
          json(res, 503, { error: "Orchestrator daemon is shutting down" });
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
        if (task.status === "running" || task.status === "waiting" || task.status === "stalled") {
          json(res, 409, { error: `Task ${task.id} is already ${task.status}` });
          return;
        }

        if (!(await requireProviderReady(res))) return;

        task.status = "waiting";
        task.lastPrompt = prompt;
        task.error = undefined;
        task.finishReason = undefined;
        await store.save(task);
        await store.appendEvent(task.id, "resume_queued", {
          status: task.status,
          message: "Task queued for resume",
          data: { prompt },
        });
        process.stdout.write(`\n[orchestrator task queued for resume: ${task.id}]\n`);

        json(res, 202, task);
        enqueue(task.id, `resume ${task.id}`, () => runner.resume(task, prompt));
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
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
