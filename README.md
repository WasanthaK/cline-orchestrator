# Cline Orchestrator

A local-first orchestration layer for supervising Cline coding sessions across large codebases.

The goal is to let a developer hand over a substantial objective, allow Cline to work in bounded resumable tasks, preserve project/task state outside the model context window, validate work, and safely continue unattended.

## Direction

- Cline SDK / ClineCore for coding sessions and built-in tools
- Persistent project and task state outside the LLM context
- Ollama/local models as first-class workers
- Optional cloud-model supervision for planning and review
- Resume/retry/watchdog support for long-running jobs
- Git checkpoints and validation gates
- VS Code dashboard in a later phase
- MCP interface in a later phase

## Status

Phase 1 bootstrap in progress.
