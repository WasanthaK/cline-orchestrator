# Milestone 5 — ChatGPT Plugin UX and Safety Contract

Date: 2026-09-21
Status: design gate for the remaining Milestone 5 work

## Goal

The end-user experience should be: from any ChatGPT conversation, with or without a ChatGPT Project, the user can explicitly invoke **Cline Orchestrator**, select or resolve a local development workspace, approve a bounded coding task, leave the conversation, and later recover task/session state from durable orchestrator storage.

Safety is the primary design constraint. ChatGPT must not receive raw machine authority, raw Cline Hub credentials, unrestricted shell access, or an unrestricted filesystem tool.

## Product shape

Use a ChatGPT plugin/app composed of:

- a small workflow skill that teaches ChatGPT the safe task lifecycle;
- a custom MCP server exposing task-level tools rather than raw machine primitives;
- optional MCP Apps UI components for workspace selection, safety preview, approval, task status, escalation, and completion review.

The plugin must be useful from a normal chat. ChatGPT Project membership is optional context, not the identity or storage boundary of the coding project.

## Connectivity

```text
ChatGPT
   |
   | custom MCP app
   v
OpenAI Secure MCP Tunnel
   |
   | outbound-only private transport
   v
Local MCP Gateway
   |
   | narrow local IPC/API
   v
Cline Orchestrator daemon
   |
   | authenticated localhost Hub connection
   v
Cline Hub
   |            \
   v             v
VS Code Cline   authoritative Cline sessions
   |
   v
allowlisted workspace / Git / validation
```

### Security properties

1. Do not expose the Cline Hub or orchestrator daemon directly to the public internet.
2. Prefer Secure MCP Tunnel so the machine initiates outbound HTTPS and no inbound firewall port is required.
3. Prefer a local MCP gateway over stdio, or otherwise bind it to loopback only.
4. The MCP gateway must not own filesystem/shell authority itself. It can call only the orchestrator's narrow task API.
5. The Cline Hub token remains entirely local. It must never be copied to ChatGPT, MCP results, project memory, handoffs, logs, or Git.
6. Tunnel/API credentials stay in the local service environment and never in task prompts or durable project memory.

## Identity model

Do not bind coding continuity to a ChatGPT conversation ID or ChatGPT Project ID.

Durable identity is owned by the orchestrator:

```text
machine_id
  -> workspace_id
       -> task_id
            -> cline_session_id / generation
```

A ChatGPT Project may contribute explicitly selected requirements or files, but the plugin must not automatically ingest the whole project or whole conversation into the coding task.

## User experience

### 1. First-time setup

The user installs/enables Cline Orchestrator in ChatGPT and runs the local orchestrator plus Secure MCP Tunnel on the development machine. The plugin can then perform read-only discovery such as machine/workspace health.

The first release should support one trusted machine cleanly before multi-machine routing is added.

### 2. Discover

Example user request:

> @Cline Orchestrator show my coding workspaces

Read-only discovery returns only allowlisted workspaces and basic safe metadata: display name, root alias, branch, HEAD, dirty/clean state, and orchestrator health. Absolute paths may be shown only when useful to the user and must not be used as authorization by ChatGPT.

### 3. Safety preview before work

Example request:

> @Cline Orchestrator fix the KH Rentals password-reset flow

Before any edit is allowed, the plugin performs a read-only inspection and presents a **Safety Preview** containing:

- selected machine/workspace;
- task goal;
- current branch + HEAD;
- dirty-state warning and pre-existing changed paths;
- expected/allowed changed-path scope;
- explicitly protected paths;
- configured validation commands;
- runtime/model selection;
- maximum changed files;
- time/context/repair budgets;
- command policy;
- whether external/network side effects are allowed;
- actions that will require a later human escalation.

The user chooses **Start safely**, **Edit plan**, or **Cancel**.

Approval applies only to this bounded task envelope. It is not blanket authorization for the machine or repository.

### 4. Immutable task envelope

The safety preview returns a signed or server-verifiable `plan_token` derived from the current workspace fingerprint and policy. `start_task` re-validates branch, HEAD, dirty-state fingerprint, policy version, workspace identity, and allowed scope.

If anything relevant changed between preview and start, the server rejects the start and requires a new preview. ChatGPT cannot weaken the plan by changing tool arguments after approval.

### 5. Local execution

After the approved `start_task`, the local orchestrator:

1. creates/persists the durable task;
2. captures the existing Git checkpoint and dirty state;
3. attaches to or creates the correct authoritative Cline session according to the eventual Hub policy;
4. supplies only bounded goal/project memory/handoff context;
5. allows read operations automatically;
6. allows code edits only inside the approved task/workspace scope;
7. executes configured validation outside the model;
8. runs final diff-safety checks before persisting completion.

The ChatGPT MCP request should return the durable `task_id` promptly. Long-running execution remains local and must survive closing the browser, changing ChatGPT conversations, or model-context rotation.

### 6. Status and continuity

From any later chat the user can ask:

> @Cline Orchestrator status of the KH Rentals password-reset task

The plugin resolves the durable workspace/task state and shows:

- running / waiting_for_human / validating / completed / failed / aborted;
- current Cline session generation;
- bounded recent events;
- validation state;
- diff-safety state;
- pending escalation, if any.

Do not rely on a ChatGPT conversation remaining open and do not assume MCP can push a new assistant message into an old chat. `waiting_for_human` must therefore be durable. A later local desktop/VS Code notification may be added, but execution must remain safe without it.

### 7. Human escalation

When a requested action exceeds the approved task envelope, the local orchestrator pauses before performing it and persists `waiting_for_human`.

The approval UI must show the concrete proposed action, reason, affected scope, reversibility, and relevant before-state. Approve/reject decisions are durable audit events.

### 8. Completion review

On completion the plugin presents:

- goal and result summary;
- files changed;
- validation evidence;
- warnings/failures from diff safety;
- branch/HEAD before and after;
- checkpoint identity;
- whether any escalated actions were approved;
- next safe actions.

Initial release should not push or deploy automatically. Keeping changes in the local working tree is the default. Commit, push, rollback, migration, or deployment are separate explicit actions.

## Safety classes

### Read-only — no action confirmation required

Examples: list machines/workspaces/tasks, task status, bounded events, Git status/diff summaries, validation evidence, project-memory references, and read-only Hub/session discovery.

These MCP tools must set accurate `readOnlyHint: true` annotations. The server still enforces workspace authorization and data minimization.

### Bounded reversible write — explicit task approval required

Examples: `start_task`, `continue_task`, and scoped source-file edits performed inside an already-approved task envelope.

The MCP entry action is a write operation and must be annotated accordingly. Once the bounded task is approved, repeated internal file edits do not each require a new ChatGPT confirmation, because the local policy engine enforces the immutable envelope and can pause on any expansion.

### High-risk / scope-expanding — always pause for human

Default examples:

- command execution with material side effects;
- dependency installation or package-manager mutation;
- file deletion or rename outside an explicitly approved edit plan;
- changes to protected paths, credentials, secrets, auth configuration, CI/deployment configuration, or system/service configuration;
- database/schema migration;
- network calls to unapproved external destinations;
- Git branch movement, reset, rebase, force operations, push, release, or tag creation;
- deployment or production mutation;
- access outside the allowlisted workspace root;
- disabling validation, checkpoint, diff-safety, path-scope, or audit controls.

The model cannot approve its own escalation. Only an explicit user action can resolve it.

### Destructive — separate explicit action and confirmation

Examples: rollback that discards task-created changes, permanent delete, force Git operations, destructive migration, or production deletion.

These tools/actions must carry `destructiveHint: true` and also require server-side confirmation/authorization. MCP annotations are advisory UX metadata, not the security boundary.

## Initial execution policy

For the first write-capable pilot:

- read tools: allowed automatically inside the allowlisted workspace;
- code edits: allowed only after Start safely and only inside approved paths;
- arbitrary Cline shell-command auto-approval: disabled;
- configured validation commands: executed by the orchestrator outside the model;
- additional commands: pause and request approval;
- external network side effects: disabled unless explicitly approved;
- Git push/deploy: disabled;
- secret-file reads (`.env`, private keys, credential stores, token caches): denied by default;
- sibling/parent directory access: denied;
- symlink/path traversal outside the workspace: denied after canonical path resolution.

This deliberately trades speed for safety in the first version. Later policy can relax only after audit evidence shows where it is safe.

## Tool surface

Do not expose raw `shell`, `read_file(path)`, `write_file(path)`, or generic Hub command tools to ChatGPT.

Preferred MCP surface:

### Read tools

- `list_machines`
- `list_workspaces`
- `get_workspace_status`
- `find_tasks`
- `get_task`
- `get_task_events`
- `get_task_diff`
- `preview_task`

`preview_task` performs no workspace mutation and returns the safety preview plus a server-verifiable plan token.

### Write tools

- `start_task(plan_token)`
- `continue_task(task_id, instruction)`
- `abort_task(task_id)`
- `approve_escalation(task_id, escalation_id)`
- `reject_escalation(task_id, escalation_id)`
- `rollback_task(task_id, checkpoint_id)`

Hub attach/detach, Cline session selection, tool-executor routing, validation, and Git bookkeeping should remain internal implementation details rather than public ChatGPT tools unless a later UX requirement proves otherwise.

## Prompt-injection boundary

Repository files, web content, issue text, generated code comments, and model output are untrusted data. They cannot modify safety policy or grant capabilities.

The local server must ignore instructions found in content that attempt to:

- broaden workspace/path scope;
- enable shell/network/deployment capability;
- reveal credentials or Hub/tunnel tokens;
- disable validation/checkpoints/audit;
- approve an escalation;
- rewrite the task's immutable policy.

Only server policy plus an explicit authenticated user action can authorize those changes.

## Data minimization

The plugin returns bounded structured evidence, not raw local state by default.

Do not automatically send:

- entire ChatGPT conversations;
- entire ChatGPT Project contents;
- full repository contents;
- `.env` or credential material;
- raw Cline Hub discovery/auth records;
- unbounded command stdout/stderr;
- unbounded task transcripts.

Use explicit selection and existing bounded project memory/handoff mechanisms.

## Audit requirements

Every write-capable action must be attributable to:

- user/plugin identity where available;
- machine + workspace;
- task ID;
- immutable plan/policy version;
- timestamp;
- requested operation;
- approval/escalation evidence when applicable;
- pre/post Git evidence where relevant;
- validation/diff-safety outcome.

Audit records must redact credentials and secret values.

## ChatGPT Project behavior

The plugin works identically inside or outside a ChatGPT Project.

A Project may help ChatGPT reason from uploaded requirements, but project membership never grants local machine authority. ChatGPT should pass only the specific requirement/context needed for the task; the local orchestrator remains authoritative for workspace identity, durable project memory, task state, safety policy, and Cline session state.

## Current platform constraint

As of 2026-09-21, OpenAI documentation states that full custom MCP support with write/modify actions in ChatGPT is in beta for Business, Enterprise, and Edu workspaces. Secure MCP Tunnel supports private MCP servers without public ingress, but ChatGPT developer-mode/app permissions are separate from tunnel permissions.

Therefore:

- build the plugin/MCP contract against the standard now;
- use Secure MCP Tunnel for private connectivity;
- run the actual ChatGPT write-capable pilot only on a ChatGPT workspace with current full-MCP write support;
- do not weaken the architecture by exposing a public local endpoint merely to work around plan availability.

Official references:

- https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/plugins/concepts/plugins
- https://developers.openai.com/plugins/plan/tools

## Milestone 5 implications

The remaining Hub research is still required, but it is subordinate to this user-facing safety contract.

The next research unit remains **workspace/session identity and multi-client approval/tool-executor behavior**, now with these constraints:

1. session resolution must be deterministic enough for `preview_task` to show the exact target before write approval;
2. attaching ChatGPT/orchestrator must not steal approval/tool-executor ownership from VS Code accidentally;
3. capability ownership must support the pause-for-human model above;
4. no Hub credential crosses the local MCP boundary;
5. the eventual migration design must preserve existing Milestones 1–4 checkpoint, validation, diff-safety, handoff, project-memory, and audit semantics.
