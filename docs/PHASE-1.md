# Phase 1 — Bootstrap

## Objective

Prove that a local orchestrator can start and resume Cline coding sessions against an arbitrary workspace while preserving orchestration state outside the model context window.

## Acceptance criteria

1. Start a task with a workspace path and natural-language goal.
2. Use ClineCore with Cline's built-in coding tools.
3. Persist the orchestrator task under `<workspace>/.orchestrator/tasks/`.
4. Record the Cline session ID for later continuation.
5. Stream worker output to the terminal.
6. Resume a previous task without creating a new orchestration record.
7. Keep command execution and file editing opt-in by default.
8. Support Ollama as the default local worker.

## Commands

```bash
npm install

export ORCH_PROVIDER=ollama
export ORCH_MODEL=qwen3.6:27b
export ORCH_BASE_URL=http://localhost:11434

npm run dev -- run /path/to/project "Inspect the authentication flow and explain the current architecture"

npm run dev -- status /path/to/project <task-id>

npm run dev -- resume /path/to/project <task-id> "Continue by proposing the smallest safe implementation plan"
```

To permit Cline to modify the workspace and run commands:

```bash
export ORCH_AUTO_APPROVE_COMMANDS=true
export ORCH_AUTO_APPROVE_EDITS=true
```

These switches are intentionally disabled by default during bootstrap.

## Phase 1.1

After the basic runner is validated locally:

- add a watchdog and retry policy;
- distinguish `waiting_for_human` from completed/failed;
- persist event logs and accumulated usage;
- add Git dirty-state and checkpoint metadata;
- add task acceptance criteria;
- add automatic validation commands;
- move from one-shot CLI process ownership toward Cline hub/RPC so VS Code and the orchestrator can observe the same running sessions.

## Later phases

- planner/reviewer model separate from worker model;
- task DAG and dependency scheduling;
- context packs and project memory;
- unattended overnight execution policy;
- VS Code orchestration dashboard;
- MCP server surface;
- multiple Cline workers and role-based agents.
