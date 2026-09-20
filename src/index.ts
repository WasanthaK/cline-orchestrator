import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { ClineRunner } from "./cline-runner.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

function usage(): never {
  console.error(`
Cline Orchestrator

Usage:
  npm run dev -- run <workspace> <goal...>
  npm run dev -- status <workspace> <task-id>
  npm run dev -- resume <workspace> <task-id> <prompt...>

Environment:
  ORCH_PROVIDER=ollama
  ORCH_MODEL=qwen3.6:27b
  ORCH_BASE_URL=http://localhost:11434
  ORCH_API_KEY=
  ORCH_AUTO_APPROVE_COMMANDS=false
  ORCH_AUTO_APPROVE_EDITS=false
`);
  process.exit(1);
}

function workerConfig(): WorkerConfig {
  return {
    providerId: process.env.ORCH_PROVIDER ?? "ollama",
    modelId: process.env.ORCH_MODEL ?? "qwen3.6:27b",
    apiKey: process.env.ORCH_API_KEY,
    baseUrl: process.env.ORCH_BASE_URL ?? "http://localhost:11434",
    autoApproveCommands: process.env.ORCH_AUTO_APPROVE_COMMANDS === "true",
    autoApproveEdits: process.env.ORCH_AUTO_APPROVE_EDITS === "true",
  };
}

async function main() {
  const [, , command, workspaceArg, ...rest] = process.argv;
  if (!command || !workspaceArg) usage();

  const workspace = path.resolve(workspaceArg);
  const store = new TaskStore(workspace);

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
