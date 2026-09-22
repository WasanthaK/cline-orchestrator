# Milestone 5 — Machine MCP Gateway

Status: Unit 4 implementation contract

This document describes the first machine-level ChatGPT/MCP gateway above the existing workspace registry, Safety Preview/plan-token boundary, durable task state, and Hub-backed Cline runtime.

## Trust boundary

The MCP endpoint is not a general machine-control API. It exposes registered project/workspace IDs and task workflows only.

It deliberately does **not** expose:

- generic filesystem read/write by raw path;
- generic shell/command execution;
- raw Cline Hub attach/send/abort primitives;
- Cline Hub discovery/auth credentials;
- unrestricted daemon/process control;
- provider/API credentials;
- raw task prompts, full worker output, or unbounded event payloads.

Repository text, model output, web content, and task instructions cannot register a workspace, change a safety profile, replace the durable task envelope, or approve their own escalation.

## Public MCP tools

Read-only tools:

- `list_projects`
- `list_workspaces`
- `get_workspace_status`
- `find_tasks`
- `get_task`
- `get_task_events`
- `get_task_diff`
- `preview_task`

Write tools:

- `start_task(plan_token)`
- `continue_task(task_id, instruction)`
- `abort_task(task_id, reason?)`
- `approve_escalation(task_id, escalation_id)`
- `reject_escalation(task_id, escalation_id)`
- `rollback_task(task_id, checkpoint_id)`

`rollback_task` is annotated destructive. Discovery/status/diff/preview operations are annotated read-only. The annotations improve client UX; the local orchestrator remains the security boundary.

## Safety Preview workflow

The normal write flow is:

```text
list_workspaces
      |
      v
preview_task(workspace_id, goal, requested_scope?)
      |
      v
user reviews branch / HEAD / dirty state / scope / protected paths /
validation / policy / worker profile / expiry
      |
      v
start_task(plan_token)
      |
      v
single-use token is revalidated and consumed
      |
      v
durable approved task envelope
      |
      v
orchestrator-owned Hub-backed Cline execution
      |
      v
external validation + final diff safety
```

`start_task` accepts no workspace/path/policy/model override fields. Workspace identity and authority come only from the server-side Safety Plan and machine registry.

`continue_task` accepts only the existing task ID plus the new instruction. It reuses the durable approved workspace/path/policy/worker identity and refuses a stale registry/profile binding, rolled-back task, active task, or unresolved escalation.

## Escalation semantics

The first pilot does not implement one-shot broadening grants.

When a task requests an out-of-scope write, Unit 2/3 persists `waiting_for_human` with a durable action fingerprint. If the user calls `approve_escalation`, the gateway records the approval but **does not mutate or broaden the original safety envelope**. The old task is closed and the response instructs the client to obtain a new Safety Preview for the expanded scope.

Rejecting an escalation closes the paused task without granting any new authority.

This prevents an approval decision from becoming an implicit "approve all future actions" capability.

## Data minimization

Public task views omit:

- canonical workspace root;
- Cline/Hub session ID;
- raw `lastPrompt`;
- raw `lastOutput`;
- provider credentials;
- Hub credentials;
- checkpoint backup paths/private refs.

Task-event responses omit the raw `data` object and return only event ID/type/time/status plus a bounded/redacted message.

Task diff responses contain bounded changed-path metadata and safety findings, never file contents. The changed-path list is capped.

Rollback uses a derived opaque `checkpoint_id`; callers do not receive checkpoint backup paths or refs.

## Local HTTP authentication

The production entrypoint is:

```text
npm run mcp
```

Configuration:

- `ORCH_MCP_HOST` — loopback only; default `127.0.0.1`. Allowed values: `127.0.0.1`, `localhost`, `::1`.
- `ORCH_MCP_PORT` — default `4318`.
- `ORCH_MCP_PATH` — default `/mcp`.
- `ORCH_MCP_BEARER_TOKEN` — required local bearer secret, at least 32 characters.
- `ORCH_MCP_TUNNEL_PUBLIC_URL` — optional HTTPS metadata for the separately configured secure MCP tunnel. The orchestrator does not create/control the tunnel or log its credential.
- `ORCH_WORKER_PROFILE_ID` — local worker-profile ID expected by registered workspace safety profiles; default `default`.

The HTTP listener refuses non-loopback bind addresses. It applies localhost Host/Origin validation before protocol handling and requires a timing-safe bearer-token match. Do not bind this server directly to a public interface. Remote ChatGPT connectivity should use the separately managed secure MCP tunnel described by the product integration design.

The bearer secret and any tunnel credential remain machine-local and must not be stored in repository files, `.orchestrator` task/project memory, handoffs, logs, or MCP responses.

## Worker/runtime routing

Approved write tasks create/use a per-workspace controller. That controller preserves the existing `TaskStore` and `ClineRunner` lifecycle but instantiates the runner in `runtimeMode: "hub"`.

Before queued model work starts, the controller runs the existing metadata-only provider preflight. Model completion still flows through the existing external validation loop and `TaskStore` final diff-safety completion gate.

The first pilot keeps model shell and ungoverned network/MCP/plugin/subagent/team/provider-owned execution surfaces disabled through the Unit 3 Hub safety profile.

## Test boundary

Unit 4 automated tests use:

- temporary Git repositories;
- a fake Hub runtime/factory;
- a temporary local metadata HTTP server for provider preflight;
- an ephemeral loopback MCP HTTP listener.

They do not connect to a live Cline Hub, VS Code, Ollama, shared workspace, production provider, tunnel, deployment target, or external system.

The real shared-runtime proof remains Unit 5 and requires explicit user authorization with a disposable registered workspace.
