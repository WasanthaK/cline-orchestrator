# Milestone 5 — Workspace / Session Identity and Multi-client Safety

Date: 2026-09-21
Status: technical-spike decision for pinned Cline `0.0.83`

This document defines how the ChatGPT-facing Cline Orchestrator resolves the **user-approved project, workspace, and Cline Hub session** without allowing ChatGPT, repository content, or another Hub client to silently expand authority.

It is static design/research only. No live Hub, VS Code runtime, workspace, or Ollama process was mutated while producing it.

## 1. User-configured project and workspace registry

The user, not ChatGPT, owns the mapping from a friendly project/workspace name to a local filesystem root.

The local orchestrator should maintain a machine-local authorization registry outside every repository, conceptually:

```text
machine
  -> project_id
       -> workspace_id
            -> canonical local root
            -> safety defaults
```

Example:

```text
Project: KH Rentals          project_id=prj_kh_rentals
  Backend                    workspace_id=ws_kh_backend
  Web                        workspace_id=ws_kh_web

Project: Quixo               project_id=prj_quixo
  Quotes                     workspace_id=ws_quixo_quotes
```

The registry is an **authorization source**, not project memory. It must not live in `.orchestrator/` inside a repository because repository content must never be able to self-authorize another path.

Recommended storage is the orchestrator's per-user application/config directory, with local file permissions appropriate to the platform. The exact cross-platform path is an implementation detail for the migration-design unit.

### Registration rules

When a user adds a workspace, the local service must:

1. resolve the supplied directory to a canonical/real path;
2. verify it exists and is a directory;
3. resolve and record its Git root when applicable;
4. reject obviously unsafe roots such as a filesystem/drive root or OS system directory;
5. persist an opaque `workspace_id` and user-facing display name;
6. associate it with a user-configured `project_id`;
7. persist safety defaults such as protected paths, command policy, validation defaults, changed-file limits, and network/deployment policy.

Repository files may propose configuration, but cannot add/replace the authorized root or weaken machine-level policy.

### ChatGPT-facing identity

ChatGPT tools should use opaque IDs:

```text
project_id
workspace_id
task_id
```

The write path must **not** accept an arbitrary raw filesystem path as workspace authority.

A read-only discovery UI may display the path for user clarity, but a subsequent task starts against the registered `workspace_id` and a server-verifiable safety preview/plan token.

A ChatGPT Project is optional context only. If a future ChatGPT surface exposes a stable project identifier, the user may explicitly map that identifier to a local `project_id`; absence of that identifier must not affect continuity. No automatic name match may grant write authority.

## 2. Safe workspace selection UX

From any ChatGPT conversation:

```text
@Cline Orchestrator work on KH Rentals
```

The plugin may suggest registered choices, but before mutation it must resolve an exact registered target and show it in the Safety Preview:

```text
Project: KH Rentals
Workspace: Backend
Registered root: C:\Dev\kh-api
Branch: main
HEAD: <sha>
```

The user can choose **Start safely**, **Change workspace**, or **Cancel**.

If a project has several workspaces, only the selected workspace is authorized for the task. A later need to touch another workspace is a scope expansion and must persist `waiting_for_human` until the user explicitly approves that additional registered workspace.

No fuzzy/closest-name match may start edits. Fuzzy matching is suggestion-only.

## 3. What Cline 0.0.83 exposes for session identity

Pinned `SessionRecord` contains:

- `sessionId`;
- `workspaceRoot` and optional `cwd`;
- `createdByClientId`;
- session status/timestamps;
- current `participants` with `creator`, `participant`, or `observer` role;
- runtime/metadata information.

The record explicitly states that session participants do **not** own client-local capabilities. Capability routing belongs to the client that created/restored the runtime session and advertised those capabilities.

Cline client registration also carries `workspaceContext.workspaceRoot` and `cwd`. For token-authenticated native clients the Hub can accept the registered workspace context; the orchestrator must therefore populate that context only from its local allowlisted registry, never directly from a ChatGPT-supplied path.

## 4. Deterministic session resolution

### Existing durable task

A durable orchestrator task already stores its Cline session ID/generation. On resume:

1. load the registered `workspace_id` from the task;
2. resolve its canonical local root from the machine-local registry;
3. `session.get` the persisted Cline session ID;
4. require the returned session `workspaceRoot` to canonicalize to the registered root;
5. if it does not match, fail closed and require a new Safety Preview/recovery session;
6. if the session no longer exists, use the existing durable handoff/recovery model to create a replacement session for the same registered workspace.

A stored session ID alone is never enough authority.

### New write-capable task

For the first ChatGPT write-capable pilot, **create a new orchestrator-owned Hub session by default** after the user approves the Safety Preview.

Reasons:

- the creator identity is unambiguous;
- runtime/tool configuration is known at creation time;
- the session workspace is derived from the registered workspace, not inferred from another client;
- VS Code can still list/observe/attach to the same authoritative Hub session;
- we do not inherit unknown approval/tool-executor ownership from an unrelated existing session.

### Existing VS Code-created session

The plugin may list and read/observe an existing session whose canonical `workspaceRoot` matches the configured workspace.

However, **do not take write-capable ChatGPT control of an arbitrary VS Code-created session in the first pilot**. Attachment adds the orchestrator only as a participant; it does not transfer capability ownership or reconstruct the original session's safety policy.

If the user wants ChatGPT to continue that work, the safe first-release path is:

1. inspect the existing session read-only;
2. build a bounded handoff from its visible/durable state;
3. show a new Safety Preview;
4. create a new orchestrator-owned session for the same registered workspace;
5. allow VS Code to observe/attach to the replacement session.

This is semantic continuation, not hidden authority takeover.

### Ambiguous sessions

Never choose the “most recent” session as write authority when multiple candidates exist unless a future user-configured policy explicitly permits that behavior and the Safety Preview names the chosen session.

For the first pilot, ambiguity means either:

- user selects an existing session for read-only inspection; or
- a fresh orchestrator-owned write session is created after approval.

## 5. Multi-client capability ownership at 0.0.83

Pinned Hub behavior is explicit:

- `session.create` / restore establishes `createdByClientId` in live Hub session state;
- client contributions/tool executors created with that session target the creating client ID;
- `capability.request` carries an explicit `targetClientId`;
- `capability.progress` and `capability.respond` reject a responder whose client ID does not equal that target;
- attaching another client does not transfer those capabilities;
- when the capability-owner client disconnects, Hub clears that live owner and cancels pending capability requests targeted at it.

Therefore an attached orchestrator cannot safely pretend to be the tool-executor owner of a VS Code-created session.

For orchestrator-owned write sessions, an owner disconnect that invalidates client-local capability routing must be treated as a recoverable semantic session loss: persist evidence/handoff and create a replacement owner session rather than silently assuming attachment restored ownership.

## 6. Tool approval behavior is different — and unsafe as an authorization boundary

Pinned `approval.requested` behavior is broader than capability routing:

- approval requests are published as session events;
- session subscriptions re-issue pending approval events after reconnect;
- Hub event fan-out sends the event to every subscriber matching the session;
- `approval.respond` resolves the pending approval by `approvalId` and does not require the responder to be the session creator or a targeted capability owner.

`HubRuntimeHost` also listens for `approval.requested` and, when configured with `requestToolApproval`, can answer it through its own client.

With multiple approval-capable clients attached, this creates a possible **first-response race**. A VS Code UI and the orchestrator could both see and answer the same approval.

### Safety decision

**Hub approval UI is not the Cline Orchestrator security boundary.**

The ChatGPT plugin must never rely on “the orchestrator will be the client that answers the Hub approval” as proof that a dangerous action was authorized.

For the first write-capable pilot:

1. raw Hub approvals may be observed for UX/diagnostics;
2. the orchestrator must not automatically answer approvals for a third-party/VS Code-owned session;
3. high-risk/scope-expanding actions use the orchestrator's own durable `waiting_for_human` + escalation approval flow;
4. the approved task envelope and local policy must be enforced **before a dangerous action can execute**, not merely detected by final diff safety;
5. no write-capable shared-session implementation is accepted until the migration design identifies a non-bypassable pre-execution enforcement point.

This requirement is stricter than Hub's native approval model by design.

## 7. Shared VS Code experience without authority confusion

The desired first-release ownership model is:

```text
User-configured workspace
        |
        v
Local Orchestrator creates authoritative session
        |                         \
        | owner/control            \ observe/attach
        v                           v
Cline Hub  <--------------------- VS Code Cline UI
        |
        v
bounded workspace execution
```

ChatGPT controls the **orchestrator task**, not the VS Code process and not arbitrary Hub commands.

VS Code remains useful for visibility, manual inspection, and user interaction, but attaching VS Code must not expand the task's filesystem/command/network authority.

If we cannot prove that property at the pre-execution layer, the first pilot must keep VS Code participation observational while a ChatGPT write task is active.

## 8. Consequences for the next migration-design unit

The migration design from owned `ClineCore` to Hub-backed operation must now answer these concrete implementation questions before runtime code changes:

1. What machine-local registry/storage module owns `project_id` / `workspace_id` and canonical roots?
2. What MCP/configuration UI safely adds, disables, and selects workspaces without accepting arbitrary write paths at task start?
3. What Hub adapter creates orchestrator-owned sessions and verifies workspace identity on every resume/recovery?
4. What pre-execution enforcement point guarantees approved path/command/network policy even if another Hub client can answer a native approval event?
5. How does owner-client disconnect map into existing `session_not_found`/handoff recovery semantics?
6. How does VS Code attach for shared visibility without becoming an unintended authority-escalation path?

Until these are designed, no live Hub write-control implementation should begin.

## Pinned upstream evidence

Inspected at `cline/cline` tag `sdk/sdk/v0.0.83`:

- `sdk/packages/shared/src/hub.ts`
- `sdk/packages/core/src/hub/server/browser-websocket.ts`
- `sdk/packages/core/src/hub/server/hub-server-transport.ts`
- `sdk/packages/core/src/hub/server/handlers/client-handlers.ts`
- `sdk/packages/core/src/hub/server/handlers/session-handlers.ts`
- `sdk/packages/core/src/hub/server/handlers/approval-handlers.ts`
- `sdk/packages/core/src/hub/server/handlers/capability-handlers.ts`
- `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`

## Decision summary

- **User configuration is the authority for project/workspace selection.**
- **Opaque registered IDs, not ChatGPT-supplied paths, drive write operations.**
- **New ChatGPT write tasks create orchestrator-owned Hub sessions by default.**
- **Existing VS Code-owned sessions are read-only/observational in the first pilot.**
- **Capability ownership follows the creator and is not transferred by attach.**
- **Native Hub approval responses are multi-client and therefore not a sufficient security boundary.**
- **A non-bypassable local pre-execution policy gate is mandatory before shared-session writes are implemented.**
