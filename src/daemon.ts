import crypto from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ClineRunner } from "./cline-runner.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

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

export async function startDaemon(
  workspace: string,
  worker: WorkerConfig,
  options: DaemonOptions,
): Promise<void> {
  const store = new TaskStore(workspace);
  const runner = new ClineRunner(workspace, worker);

  // Deliberately serialize all model work. This mirrors OLLAMA_NUM_PARALLEL=1
  // and prevents multiple client requests from competing for the local model.
  let tail: Promise<void> = Promise.resolve();
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const next = tail.then(job, job);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          status: "running",
          workspace,
          worker: {
            providerId: worker.providerId,
            modelId: worker.modelId,
            baseUrl: worker.baseUrl,
            contextWindow: worker.contextWindow,
            maxInputTokens: worker.maxInputTokens,
            maxTokensPerTurn: worker.maxTokensPerTurn,
            reasoningEffort: worker.reasoningEffort,
          },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/tasks") {
        json(res, 200, await store.list());
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/tasks/")) {
        const taskId = decodeURIComponent(url.pathname.slice("/tasks/".length));
        json(res, 200, await store.load(taskId));
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        const body = await readJson(req);
        const goal = String(body?.goal ?? "").trim();
        if (!goal) {
          json(res, 400, { error: "goal is required" });
          return;
        }

        const now = new Date().toISOString();
        const task: OrchestratorTask = {
          id: crypto.randomUUID(),
          goal,
          workspace,
          status: "created",
          createdAt: now,
          updatedAt: now,
        };
        await store.save(task);
        process.stdout.write(`\n[orchestrator task: ${task.id}]\n`);

        const completed = await serial(() => runner.start(task));
        json(res, 200, completed);
        return;
      }

      if (req.method === "POST" && url.pathname === "/resume") {
        const body = await readJson(req);
        const taskId = String(body?.taskId ?? "").trim();
        const prompt = String(body?.prompt ?? "").trim();
        if (!taskId || !prompt) {
          json(res, 400, { error: "taskId and prompt are required" });
          return;
        }

        const task = await store.load(taskId);
        const completed = await serial(() => runner.resume(task, prompt));
        json(res, 200, completed);
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        json(res, 404, errorPayload(error));
        return;
      }

      const code = (error as any)?.code;
      json(res, code === "session_not_found" ? 409 : 500, errorPayload(error));
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
    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      process.stdout.write(`\n[orchestrator daemon shutting down: ${signal}]\n`);

      server.close(async () => {
        try {
          await runner.close(`daemon ${signal}`);
        } finally {
          resolve();
        }
      });
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });
}
