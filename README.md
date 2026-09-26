# Cline Orchestrator

A local-first orchestration layer for supervising long-running Cline coding sessions across large codebases.

The product goal is simple: hand over a substantial engineering objective, let Cline work in bounded resumable tasks, preserve state outside the model context window, validate progress, and safely continue unattended.

## Phase 1

Phase 1 proves the core control loop:

- start a Cline coding session against any workspace;
- stream its progress;
- persist orchestration state outside the model context;
- record the Cline session ID;
- inspect task status later;
- resume the same Cline session after interruption;
- use Ollama/local models as first-class workers;
- keep shell execution and file edits opt-in during bootstrap.

Cline itself owns model interaction, coding tools, and session persistence. This project adds the supervisory layer above it.

## Requirements

- Node.js 22+
- Cline SDK (installed by `npm install`)
- Ollama for the default local-worker setup
- A model available in Ollama, for example `qwen3.6:27b`

## Install

```bash
git clone https://github.com/WasanthaK/cline-orchestrator.git
cd cline-orchestrator
git checkout phase-1/bootstrap
npm install
```

## Configure a local Ollama worker

```bash
export ORCH_PROVIDER=ollama
export ORCH_MODEL=qwen3.6:27b
export ORCH_BASE_URL=http://localhost:11434
```

PowerShell:

```powershell
$env:ORCH_PROVIDER="ollama"
$env:ORCH_MODEL="qwen3.6:27b"
$env:ORCH_BASE_URL="http://localhost:11434"
```

## Run a supervised task

```bash
npm run dev -- run /path/to/project "Inspect the authentication flow and explain the current architecture"
```

The orchestrator creates a persistent task record under:

```text
<target-workspace>/.orchestrator/tasks/<task-id>.json
```

Check it later:

```bash
npm run dev -- status /path/to/project <task-id>
```

Resume the same Cline session:

```bash
npm run dev -- resume /path/to/project <task-id> "Continue by proposing the smallest safe implementation plan"
```

## Allow code changes

During bootstrap, command execution and edits are deliberately not auto-approved.

Enable them explicitly when you are ready to let the worker act unattended:

```bash
export ORCH_AUTO_APPROVE_COMMANDS=true
export ORCH_AUTO_APPROVE_EDITS=true
```

PowerShell:

```powershell
$env:ORCH_AUTO_APPROVE_COMMANDS="true"
$env:ORCH_AUTO_APPROVE_EDITS="true"
```

## Architecture direction

```text
ChatGPT / Planner / Reviewer
            |
            v
     Cline Orchestrator
     - task state
     - retries/watchdog
     - context memory
     - validation gates
     - Git checkpoints
            |
            v
        ClineCore
     - model/provider
     - coding tools
     - Cline sessions
            |
            v
       target workspace
```

## Roadmap

1. **Bootstrap** — start, stream, persist and resume a Cline task.
2. **Supervision** — watchdog, retries, waiting-for-human state, usage/event logs and validation commands.
3. **Project memory** — architecture summaries, decision log, task DAG and context packs.
4. **Autonomous runs** — Git checkpoints, acceptance gates and overnight execution policies.
5. **VS Code** — live orchestration dashboard sharing sessions through Cline Hub/RPC.
6. **MCP** — expose orchestrator actions to external supervisors such as ChatGPT/API agents.
7. **Multi-worker** — investigator, implementer, tester and reviewer Cline agents.

See [`docs/PHASE-1.md`](docs/PHASE-1.md) for the current acceptance criteria.
