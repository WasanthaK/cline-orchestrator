import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { ClineRunner } from "./cline-runner.js";
import { TaskNotFoundError, TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

function usage(): never {
  console.error(`
Cline Orchestrator

Usage:
  npm run dev -- run <workspace> <goal...>
  npm run dev -- list <workspace>
  npm run dev -- status <workspace> <task-id>
  npm run dev -- resume <workspace> <task-id> <prompt...>

Environment:
  ORCH_PROVIDER=ollama
  ORCH_MODEL=qwen38-27b-192k:latest
  ORCH_BASE_URL=http://localhost:11434
  ORCH_API_KEY=
  ORCH_MAX_INPUT_TOKENS=180000
  ORCH_MAX_OUTPUT_TOKENS=16000
  ORCH_TIMEOUT_MS=0
  ORCH_MAX_ITERATIONS=0
  ORCH_AUTO_APPROVE_COMMANDS=false
  ORCH_AUTO_APPROVE_EDITS=false
`);
  process.exit(1);
}

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function workerConfig(): WorkerConfig {
  return {
    providerId: process.env.ORCH_PROVIDER ?? "ollama",
    modelId: process.env.ORCH_MODEL ?? "qwen38-27b-192k:latest",
    apiKey: process.env.ORCH_API_KEY,
    baseUrl: process.env.ORCH_BASE_URL ?? "http://localhost:11434",
    maxInputTokens: readInt("ORCH_MAX_INPUT_TOKENS", 180000),
    maxOutputTokens: readInt("ORCH_MAX_OUTPUT_TOKENS", 16000),
    timeoutMs: readInt("ORCH_TIMEOUT_MS", 0),
    maxIterations: readInt("ORCH_MAX_ITERATIONS", 0),
    autoApproveCommands: process.env.ORCH_AUTO_APPROVE_COMMANDS === "true",
    autoApproveEdits: process.env.ORCH_AUTO_APPROVE_EDITS === "true",
  };
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

  const runner = new ClineRunner(workspace, workerConfig());

  if (command === "run") {
    const goal = rest.join(" ").trim();
    if (!goal) usage();

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
    console.log(`[orchestrator task: ${task.id}]`);
    const completed = await runner.start(task);
    console.log(`\n[status: ${completed.status}]`);
    return;
  }

  if (command === "resume") {
    const [taskId, ...promptParts] = rest;
    const prompt = promptParts.join(" ").trim();
    if (!taskId || !prompt) usage();

    const task = await store.load(taskId);
    const completed = await runner.resume(task, prompt);
    console.log(`\n[status: ${completed.status}]`);
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
