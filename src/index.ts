import path from "node:path";
import process from "node:process";
import { startDaemon } from "./daemon.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type {
  OrchestratorTask,
  ReasoningEffort,
  TaskEvent,
  WorkerConfig,
} from "./types.js";

function usage(): never {
  console.error(`
Cline Orchestrator

Usage:
  npm run dev -- daemon <workspace>
  npm run dev -- run <workspace> <goal...>
  npm run dev -- list <workspace>
  npm run dev -- status <workspace> <task-id>
  npm run dev -- events <workspace> <task-id>
  npm run dev -- resume <workspace> <task-id> <prompt...>
  npm run dev -- abort <workspace> <task-id> [reason...]

Environment:
  ORCH_PROVIDER=ollama-openai   # recommended for local Ollama
  ORCH_MODEL=qwen38-27b-192k:latest
  ORCH_BASE_URL=http://localhost:11434
  ORCH_API_KEY=
  ORCH_CONTEXT_WINDOW=196608
  ORCH_MAX_INPUT_TOKENS=180000
  ORCH_MAX_TOKENS_PER_TURN=4096
  ORCH_REASONING_EFFORT=none
  ORCH_TIMEOUT_MS=0
  ORCH_PREFLIGHT_TIMEOUT_MS=5000
  ORCH_VALIDATION_TIMEOUT_MS=600000
  ORCH_MAX_VALIDATION_OUTPUT_CHARS=20000
  ORCH_MAX_VALIDATION_REPAIRS=1
  ORCH_MAX_ITERATIONS=0
  ORCH_STALL_TIMEOUT_MS=300000
  ORCH_MAX_RETRIES=2
  ORCH_RETRY_DELAY_MS=5000
  ORCH_AUTO_APPROVE_COMMANDS=false
  ORCH_AUTO_APPROVE_EDITS=false
  ORCH_DAEMON_HOST=127.0.0.1
  ORCH_DAEMON_PORT=4317
  ORCH_DAEMON_URL=http://127.0.0.1:4317

Provider notes:
  ollama-openai  -> Cline openai-compatible provider via Ollama /v1 API
  ollama         -> Cline native Ollama provider

Architecture:
  daemon owns the long-lived ClineCore session runtime.
  run/resume/abort are thin localhost clients and require the daemon to be running.
`);
  process.exit(1);
}

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readReasoningEffort(): ReasoningEffort {
  const value = (process.env.ORCH_REASONING_EFFORT ?? "none").toLowerCase();
  if (value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "none";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function workerConfig(): WorkerConfig {
  const requestedProvider = process.env.ORCH_PROVIDER ?? "ollama-openai";
  const modelId = process.env.ORCH_MODEL ?? "qwen38-27b-192k:latest";
  const configuredBaseUrl = stripTrailingSlash(process.env.ORCH_BASE_URL ?? "http://localhost:11434");
  const common = {
    modelId,
    contextWindow: readInt("ORCH_CONTEXT_WINDOW", 196608),
    maxInputTokens: readInt("ORCH_MAX_INPUT_TOKENS", 180000),
    maxTokensPerTurn: readInt(
      "ORCH_MAX_TOKENS_PER_TURN",
      readInt("ORCH_MAX_OUTPUT_TOKENS", 4096),
    ),
    reasoningEffort: readReasoningEffort(),
    timeoutMs: readInt("ORCH_TIMEOUT_MS", 0),
    preflightTimeoutMs: Math.max(250, readInt("ORCH_PREFLIGHT_TIMEOUT_MS", 5000)),
    validationTimeoutMs: Math.max(1000, readInt("ORCH_VALIDATION_TIMEOUT_MS", 600000)),
    maxValidationOutputChars: Math.max(1000, readInt("ORCH_MAX_VALIDATION_OUTPUT_CHARS", 20000)),
    maxValidationRepairs: Math.max(0, readInt("ORCH_MAX_VALIDATION_REPAIRS", 1)),
    maxIterations: readInt("ORCH_MAX_ITERATIONS", 0),
    stallTimeoutMs: readInt("ORCH_STALL_TIMEOUT_MS", 300000),
    maxRetries: Math.max(0, readInt("ORCH_MAX_RETRIES", 2)),
    retryDelayMs: Math.max(0, readInt("ORCH_RETRY_DELAY_MS", 5000)),
    autoApproveCommands: process.env.ORCH_AUTO_APPROVE_COMMANDS === "true",
    autoApproveEdits: process.env.ORCH_AUTO_APPROVE_EDITS === "true",
  };

  if (requestedProvider === "ollama-openai") {
    const baseUrl = configuredBaseUrl.endsWith("/v1")
      ? configuredBaseUrl
      : `${configuredBaseUrl}/v1`;

    return {
      ...common,
      providerId: "openai-compatible",
      apiKey: process.env.ORCH_API_KEY || "ollama",
      baseUrl,
    };
  }

  return {
    ...common,
    providerId: requestedProvider,
    apiKey: process.env.ORCH_API_KEY,
    baseUrl: configuredBaseUrl,
  };
}

function daemonAddress() {
  const host = process.env.ORCH_DAEMON_HOST ?? "127.0.0.1";
  const port = readInt("ORCH_DAEMON_PORT", 4317);
  const url = stripTrailingSlash(process.env.ORCH_DAEMON_URL ?? `http://${host}:${port}`);
  return { host, port, url };
}

async function daemonRequest<T>(pathName: string, body?: unknown): Promise<T> {
  const { url } = daemonAddress();
  let response: Response;

  try {
    response = await fetch(`${url}${pathName}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Unable to reach the orchestrator daemon at ${url}. Start it first with: npm run dev -- daemon <workspace>`,
      { cause: error },
    );
  }

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || `HTTP ${response.status}` };
  }

  if (!response.ok) {
    const error = new Error(payload?.error ?? `Daemon request failed with HTTP ${response.status}`) as Error & {
      code?: string;
      sessionId?: string;
    };
    error.code = payload?.code;
    error.sessionId = payload?.sessionId;
    throw error;
  }

  return payload as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status: OrchestratorTask["status"]): boolean {
  return status === "completed" || status === "validation_failed" || status === "failed" || status === "aborted";
}

function printEvent(event: TaskEvent) {
  const suffix = event.message ? `: ${event.message}` : "";
  console.log(`[event: ${event.type}${suffix}]`);
}

async function waitForDaemonTask(taskId: string, store: TaskStore): Promise<OrchestratorTask> {
  let lastStatus: OrchestratorTask["status"] | undefined;
  let fallbackAnnounced = false;
  const seenEvents = new Set<string>();
  const encodedTaskId = encodeURIComponent(taskId);

  const announceFallback = () => {
    if (fallbackAnnounced) return;
    fallbackAnnounced = true;
    console.log("[daemon unavailable; using persisted terminal task state]");
  };

  const readTask = async (): Promise<OrchestratorTask> => {
    try {
      return await daemonRequest<OrchestratorTask>(`/tasks/${encodedTaskId}`);
    } catch (daemonError) {
      const persisted = await store.load(taskId);
      if (!isTerminalStatus(persisted.status)) throw daemonError;
      announceFallback();
      return persisted;
    }
  };

  const readEvents = async (): Promise<TaskEvent[]> => {
    try {
      return await daemonRequest<TaskEvent[]>(`/tasks/${encodedTaskId}/events`);
    } catch (daemonError) {
      const persisted = await store.load(taskId);
      if (!isTerminalStatus(persisted.status)) throw daemonError;
      announceFallback();
      return store.events(taskId);
    }
  };

  const printNewEvents = async () => {
    const events = await readEvents();
    for (const event of events) {
      if (seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      printEvent(event);
    }
  };

  while (true) {
    const task = await readTask();
    await printNewEvents();

    if (task.status !== lastStatus) {
      console.log(`[status: ${task.status}]`);
      lastStatus = task.status;
    }

    if (isTerminalStatus(task.status)) {
      await sleep(100);
      await printNewEvents();
      return task;
    }

    await sleep(1000);
  }
}

async function printAvailableTasks(store: TaskStore) {
  const tasks = await store.list();
  if (tasks.length === 0) {
    console.error("No orchestrator tasks were found for this workspace.");
    return;
  }

  console.error("Available tasks:");
  for (const task of tasks) {
    console.error(`  ${task.id}  ${task.status.padEnd(10)}  ${task.updatedAt}  ${task.goal.slice(0, 80)}`);
  }
}

async function main() {
  const [, , command, workspaceArg, ...rest] = process.argv;
  if (!command || !workspaceArg) usage();

  const workspace = path.resolve(workspaceArg);
  const store = new TaskStore(workspace);

  if (command === "list") {
    const tasks = await store.list();
    if (tasks.length === 0) {
      console.log("No orchestrator tasks found.");
      return;
    }

    for (const task of tasks) {
      console.log(`${task.id}\t${task.status}\t${task.updatedAt}\t${task.goal}`);
    }
    return;
  }

  if (command === "status") {
    const [taskId] = rest;
    if (!taskId) usage();
    const task = await store.load(taskId);
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (command === "events") {
    const [taskId] = rest;
    if (!taskId) usage();
    console.log(JSON.stringify(await store.events(taskId), null, 2));
    return;
  }

  if (command === "daemon") {
    const config = workerConfig();
    const { host, port } = daemonAddress();
    console.log(
      `[worker: ${config.providerId} ${config.modelId} @ ${config.baseUrl ?? "default"}; context=${config.contextWindow}; input=${config.maxInputTokens}; turn=${config.maxTokensPerTurn}; reasoning=${config.reasoningEffort}; preflight=${config.preflightTimeoutMs}ms; validation=${config.validationTimeoutMs}ms; validationRepairs=${config.maxValidationRepairs}; stall=${config.stallTimeoutMs}ms; retries=${config.maxRetries}]`,
    );
    await startDaemon(workspace, config, { host, port });
    return;
  }

  if (command === "run") {
    const goal = rest.join(" ").trim();
    if (!goal) usage();

    const queued = await daemonRequest<OrchestratorTask>("/run", { goal });
    console.log(`[orchestrator task: ${queued.id}]`);
    const completed = await waitForDaemonTask(queued.id, store);
    if (completed.lastOutput) console.log(`\n${completed.lastOutput}`);
    if (completed.error) console.error(`\n[error: ${completed.error}]`);
    return;
  }

  if (command === "resume") {
    const [taskId, ...promptParts] = rest;
    const prompt = promptParts.join(" ").trim();
    if (!taskId || !prompt) usage();

    const queued = await daemonRequest<OrchestratorTask>("/resume", { taskId, prompt });
    console.log(`[orchestrator task: ${queued.id}; resume queued]`);
    const completed = await waitForDaemonTask(queued.id, store);
    if (completed.lastOutput) console.log(`\n${completed.lastOutput}`);
    if (completed.error) console.error(`\n[error: ${completed.error}]`);
    return;
  }

  if (command === "abort") {
    const [taskId, ...reasonParts] = rest;
    if (!taskId) usage();
    const reason = reasonParts.join(" ").trim() || "Task aborted by user";
    const task = await daemonRequest<OrchestratorTask>(
      `/tasks/${encodeURIComponent(taskId)}/abort`,
      { reason },
    );
    console.log(`[orchestrator task: ${task.id}; status=${task.status}]`);
    console.log(`[abort reason: ${task.abortReason ?? reason}]`);
    return;
  }

  usage();
}

main().catch(async (error) => {
  if (error instanceof TaskNotFoundError) {
    console.error(error.message);
    const store = new TaskStore(error.workspace);
    await printAvailableTasks(store);
    process.exitCode = 2;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});
