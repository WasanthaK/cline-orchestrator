# Milestone 5 — Safe ChatGPT Plugin / Hub Migration Design

Date: 2026-09-22
Status: final technical-spike design for pinned Cline `0.0.83`

This document defines the migration from the current in-process `ClineCore` worker to the ChatGPT-plugin / Cline Hub architecture while preserving Milestones 1–4 and making the local orchestrator the non-bypassable safety boundary.

It is design/research only. No live Hub, VS Code runtime, workspace, or shared Ollama process was mutated while producing it.

## 1. Safety invariants

The migration is acceptable only if all of these remain true:

1. ChatGPT never receives arbitrary filesystem, shell, Cline Hub, or machine authority.
2. The user locally registers the project/workspace that may be changed.
3. A write task starts only from a user-approved Safety Preview represented by a server-verifiable plan token.
4. `start_task` accepts the plan token, not a replacement workspace path/policy envelope supplied by ChatGPT.
5. The local orchestrator re-validates workspace/Git/policy state immediately before consuming the plan token.
6. New ChatGPT write tasks use an orchestrator-owned Hub session by default.
7. Cline Hub credentials remain local and never enter ChatGPT, task prompts, project memory, handoffs, logs, or Git.
8. Every model-requested filesystem mutation is checked before execution and again at the executor that performs the mutation.
9. Unknown tools fail closed.
10. Arbitrary model-issued shell commands are disabled in the first write-capable pilot.
11. Repository-configured MCP/plugin tools, subagents, teams, and other ungoverned execution surfaces are disabled in the first pilot.
12. Provider-executed/model-owned tools are outside the first pilot; the worker/model preflight must reject a configuration that can execute un-intercepted provider tools.
13. Scope expansion persists `waiting_for_human` before the requested side effect occurs.
14. Native Hub approval UI is defense-in-depth only and is not an authorization boundary.
15. Validation remains orchestrator-owned and executes outside the model from trusted configuration.
16. Final diff-safety and checkpoint/rollback remain mandatory postconditions.
17. Git push, deployment, destructive migration, force/reset/rebase, and secret access are not silently enabled by a task approval.

## 2. Target architecture

```text
ChatGPT conversation (Project optional)
        |
        | narrow Cline Orchestrator plugin / MCP tools
        v
Secure MCP Tunnel
        |
        v
Machine-local MCP Gateway
        |
        | opaque project_id / workspace_id / task_id / plan_token
        v
Machine Orchestrator Service
        |
        +--> Workspace Registry (outside repositories)
        +--> Safety Plan Store
        +--> Task / event / project-memory services
        +--> Safety Policy Engine
        +--> Workspace Controller keyed by workspace_id
                 |
                 v
             ClineRunner
                 |
                 | ClineCore API, backendMode="hub"
                 v
              Cline Hub
              /       \
             /         \ observe/attach
   orchestrator-owned   VS Code Cline UI
      session
             |
             | owner-targeted hooks + client-owned tool executors
             v
       registered workspace
```

The ChatGPT Project, conversation ID, repository name, and filesystem path are never authorization primitives.

## 3. Preserve the current ClineRunner contract

The current `ClineRunner` already keeps durability, watchdog, context rotation, recovery, metrics, abort, and task-state logic above a small Cline runtime surface:

- create/start a session;
- send a turn to a session;
- abort a run;
- subscribe to normalized session events;
- get/list session state as needed.

Pinned Cline `0.0.83` already exposes the same `ClineCore` methods over different `RuntimeHost` backends. Therefore the lowest-risk migration is **not** to rewrite Milestones 1–4 around raw Hub commands.

The first Hub-backed worker should continue to use `ClineCore` but instantiate it with a required Hub backend, conceptually:

```ts
ClineCore.create({
  clientName: "cline-orchestrator",
  backendMode: "hub",
  hub: {
    strategy: "require-hub",
    workspaceRoot: registeredWorkspaceRoot,
    cwd: registeredWorkspaceRoot,
  },
})
```

The endpoint/token are resolved from Cline-managed discovery and remain process-local.

This preserves `cline.start`, `cline.send`, `cline.abort`, `cline.subscribe`, `cline.get`, and existing normalized event semantics while moving execution into the shared Hub runtime.

### Internal seam

Before the backend switch, introduce a narrow internal runtime factory/interface so `ClineRunner` does not construct backend details itself. Conceptually:

```text
ClineRunner
   |
   v
WorkerRuntime / ClineRuntimeFactory
   |-------------------------------|
   v                               v
Local ClineCore                 Hub ClineCore
(current compatibility)        (new default for plugin write tasks)
```

The orchestrator, not ChatGPT, chooses the runtime mode from local configuration/policy.

## 4. Machine-local project/workspace registry

The registry defined in `MILESTONE-5-WORKSPACE-SESSION-IDENTITY.md` becomes a prerequisite for every plugin write.

Minimum durable record:

```ts
interface RegisteredProject {
  projectId: string;
  displayName: string;
}

interface RegisteredWorkspace {
  workspaceId: string;
  projectId: string;
  displayName: string;
  canonicalRoot: string;
  gitRoot?: string;
  policyProfileId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

The registry lives in a per-user application/config directory outside all repositories. Repository content cannot create or broaden a registration.

Registration canonicalizes the root, rejects drive/filesystem roots and system-sensitive roots, verifies containment expectations, and stores opaque IDs. A write API never accepts an arbitrary raw path in place of `workspaceId`.

## 5. Safety Preview and plan token

### Preview is read-only

`preview_task(workspace_id, goal, requested_scope?)` may inspect:

- registered project/workspace identity;
- canonical root alias/display path;
- branch and HEAD;
- dirty state and pre-existing changed-path digest;
- configured protected/secret path policy;
- expected changed-path scope;
- trusted validation commands;
- worker/model identity and supported safety profile;
- edit/file budgets and context/repair budgets;
- disabled execution surfaces;
- actions that would require a later escalation.

It performs no workspace mutation.

### Opaque server-side plan

The preview creates an immutable local `SafetyPlan` and returns an opaque cryptographically-random `plan_token`.

Recommended first-pilot properties:

- at least 256 bits of randomness;
- token value is never persisted in repository/task/project memory;
- server stores only a token hash plus the immutable plan;
- single use;
- short TTL (for example 15 minutes, configurable locally);
- invalidated on service restart unless a secure persistent plan store is deliberately implemented later.

The plan records at least:

```ts
interface SafetyPlan {
  planId: string;
  tokenHash: string;
  workspaceId: string;
  workspaceRevision: number;
  projectId: string;
  goal: string;
  gitBranch?: string;
  gitHead?: string;
  dirtyFingerprint: string;
  policyVersion: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  validationCommands: string[];
  workerProfileId: string;
  maxChangedFiles: number;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}
```

### Atomic start validation

`start_task(plan_token)` must atomically:

1. look up the unexpired unconsumed plan by token hash;
2. re-resolve `workspaceId` from the machine registry;
3. require the same workspace registry revision;
4. re-canonicalize the workspace root;
5. recompute branch, HEAD, and dirty fingerprint;
6. require the same policy version and worker safety profile;
7. consume the token exactly once;
8. create the durable task with a copy/reference of the approved safety envelope.

Any mismatch rejects the start and requires a new preview.

ChatGPT cannot alter workspace, model, allowed paths, validation, or side-effect policy by changing `start_task` arguments because the write call carries only the opaque plan token.

## 6. Durable task safety envelope

The durable task must retain the approved security identity independently of the ChatGPT conversation:

```text
projectId
workspaceId
workspaceRegistryRevision
safetyPlanId
policyVersion
allowedPathPatterns
protectedPathPatterns
workerProfileId
```

Later `continue_task` calls inherit this envelope. They may refine the goal/instruction but cannot broaden authority.

Scope expansion becomes a durable escalation/grant, never a silent mutation of the original envelope.

For the first pilot, a request to modify a **different registered workspace** requires a new Safety Preview and a new linked task rather than an inline cross-workspace grant.

## 7. Hub session creation policy

After `start_task` consumes the approved plan, the workspace controller creates a fresh orchestrator-owned Hub session for that registered workspace.

Required start properties:

- `workspaceRoot` and `cwd` come only from the registry;
- interactive session;
- `enableSpawnAgent: false`;
- `enableAgentTeams: false`;
- repository/global MCP settings tools disabled for the pilot;
- plugin/config-extension surfaces disabled unless individually security-reviewed;
- model/provider profile must be on the locally-approved safe worker list;
- provider/model-owned execution tools must not be available in the pilot;
- tool policy exposes only the deliberately supported Cline tools.

The resulting `sessionId` is stored on the task as today. Resume verifies the Hub session workspace against the registered workspace before sending another turn.

If the owner client/session is lost, existing structured handoff recovery creates a replacement orchestrator-owned session for the same registered workspace.

## 8. Non-bypassable pre-execution enforcement

Pinned Cline `0.0.83` provides two useful owner-targeted mechanisms:

1. `localRuntime.hooks.beforeTool`, proxied by Hub as a capability targeted to the session-owning client;
2. client-owned `RuntimeCapabilities.toolExecutors`, also proxied to the creating client and rejected if a different client attempts to answer the capability request.

Use **both**.

### Layer A — owner-targeted beforeTool policy gate

Every declared runtime tool call first passes through a mandatory orchestrator `beforeTool` hook.

The hook converts tool name/input into a normalized `ActionDescriptor`, for example:

```ts
type ActionDescriptor =
  | { kind: "read"; paths: string[] }
  | { kind: "search"; workspaceRoot: string; queries: string[] }
  | { kind: "edit"; paths: string[]; operation: "create" | "modify" }
  | { kind: "patch"; paths: string[]; operations: string[] }
  | { kind: "command"; commands: string[] }
  | { kind: "network"; urls: string[] }
  | { kind: "unknown"; toolName: string };
```

The policy engine returns one of:

```text
ALLOW
DENY
ESCALATE_AND_STOP
```

- `ALLOW`: continue to tool policy/executor.
- `DENY`: return `skip` with a sanitized reason; no side effect occurs.
- `ESCALATE_AND_STOP`: persist an escalation and task `waiting_for_human`, then return `stop: true`. The Cline run ends before tool execution.

Hook failure, capability-owner disconnect, malformed input, missing task/session mapping, or policy-engine failure is **fail closed**. It must never fall through to execution.

### Layer B — client-owned executors are the mutation boundary

For supported built-in tools, supply orchestrator-owned executor overrides through per-session `RuntimeCapabilities.toolExecutors`:

- `readFile`;
- `search`;
- `editor`;
- `applyPatch`.

Hub routes these executor calls back to the creating orchestrator client. The executor **re-evaluates the current durable safety envelope immediately before performing the operation** and then delegates to a known SDK executor or an equivalent narrow local implementation.

This means another attached Hub client cannot bypass file policy merely by racing `approval.respond`.

`applyPatch` must parse/preview all file changes before execution (the pinned SDK exports `computePatchChanges`) and policy-check every affected path/action. A multi-file patch is rejected/stopped if any one change is outside policy.

### Why both layers

The hook is an early semantic guard and can stop the entire run cleanly for escalation. The executor is the final operation boundary and protects against stale/malformed policy decisions between model output and filesystem mutation.

Final checkpoint-relative diff safety remains a third, post-execution backstop; it is not a substitute for either pre-execution layer.

## 9. Path containment policy

All path decisions use the registered canonical root, never string-prefix comparison alone.

First-pilot rules:

1. Normalize platform separators and reject NUL/invalid paths.
2. Resolve existing paths with real-path semantics.
3. For a new file, resolve the nearest existing ancestor and reconstruct the candidate below it.
4. Require the resolved candidate/ancestor to remain inside the registered root.
5. Reject path traversal outside the root.
6. Reject write operations through symlink/reparse-point path components in the first pilot.
7. Deny secret/credential paths before ordinary allow-path matching.
8. Deny protected paths before ordinary allow-path matching.
9. Require edit/patch paths to match the task's approved path scope.
10. Re-check immediately inside the client-owned executor before the filesystem call.

Examples of default secret/protected classes include `.env*`, private keys, credential/token caches, `.git` internals, deployment credentials, and locally configured sensitive paths. Exact policy remains locally configurable and versioned.

## 10. First-pilot tool policy

### Automatically available after task approval

- `read_files` — only through the client-owned read executor; workspace-contained, non-secret paths.
- `search_codebase` — client-owned search executor constrained to the registered workspace.
- `editor` — client-owned editor executor; approved paths only; no protected/secret path.
- `apply_patch` — client-owned patch executor; every parsed change must be approved.
- non-mutating completion/status mechanics needed by Cline.

These tools may use `autoApprove: true` because the **orchestrator hook/executor**, not Hub approval UI, is the security decision point.

### Disabled in the first write-capable pilot

- `run_commands` / arbitrary shell;
- `fetch_web_content` unless a later explicit allowlisted network policy is implemented;
- skills that can execute unreviewed behavior;
- repository/global MCP tools;
- agent plugins not individually reviewed;
- subagents and teams;
- provider/model-executed tools not intercepted by the orchestrator;
- Git push/release/deploy/production tools.

Trusted validation commands continue to execute through the existing orchestrator validation service, outside the model, after model completion.

This deliberate restriction is acceptable for the first pilot. Capability can be widened only after an execution surface has its own enforceable policy and tests.

## 11. Do not use native Hub approval as the gate

The earlier multi-client analysis proved that `approval.requested` is session-broadcast and `approval.respond` is not bound to the creating client. Therefore:

- safety-critical tools should not depend on generic Hub approval;
- allowed file tools use auto-approval only **after** the owner-targeted hook/executor policy;
- disabled tools stay disabled rather than waiting on a generic approval race;
- human escalation is an orchestrator task event/state, not a Hub approval record.

The plugin's `approve_escalation`/`reject_escalation` works on orchestrator escalation IDs and durable policy grants, not raw Cline approval IDs.

## 12. Escalation and grants

A durable escalation records:

```text
escalation_id
 task_id
 action descriptor
 reason
 requested_at
 safety-envelope version
 reversible/non-reversible classification
 status
 decision provenance
```

First-pilot behavior:

- ordinary out-of-scope edit: stop and require a new/expanded Safety Preview;
- another workspace: new linked task + new Safety Preview;
- arbitrary command/package install: not executable in the pilot even after a normal task approval; a future command-broker feature must define a separate safe capability;
- secret access: denied by default, not auto-escalated;
- push/deploy/destructive operation: separate explicit feature/tool, not `continue_task` authority.

A later one-shot grant mechanism should bind to a normalized action fingerprint, expiry, task/policy version, and bounded use count. It must not be a broad “approve all future commands” switch.

## 13. Provider/model preflight

The existing provider metadata preflight should gain a safety-profile check before Hub write mode is enabled.

For the first pilot it must reject:

- a provider/model configuration that can execute provider-owned/model-owned tools outside the `AgentRuntime` tool pipeline;
- worker profiles enabling subagents/teams;
- worker profiles enabling ungoverned MCP/plugin/network/shell surfaces;
- a missing/unsupported Hub protocol/runtime generation.

This keeps the safety proof tied to the execution path actually inspected at Cline `0.0.83`.

## 14. Machine-level gateway without discarding per-workspace durability

The current daemon is instantiated for one raw workspace path. The plugin requires one machine entry point that can expose several user-configured workspaces safely.

Refactor toward:

```text
MachineOrchestratorService
   |
   +-- WorkspaceRegistry
   +-- SafetyPlanStore
   +-- WorkspaceController(ws_a)
   |      +-- TaskStore(root_a)
   |      +-- ClineRunner(root_a)
   |
   +-- WorkspaceController(ws_b)
          +-- TaskStore(root_b)
          +-- ClineRunner(root_b)
```

`WorkspaceController` preserves the existing per-workspace `.orchestrator/` task/project-memory/checkpoint layout.

The machine-level MCP surface resolves only registered IDs and delegates to the appropriate controller. The existing CLI can remain as a compatibility/debug path during migration, but the ChatGPT plugin must never receive a raw-path write endpoint.

## 15. Plugin/MCP boundary

The MCP gateway exposes task workflows, not runtime primitives.

Read-only first:

- `list_projects`
- `list_workspaces`
- `get_workspace_status`
- `find_tasks`
- `get_task`
- `get_task_events`
- `get_task_diff`
- `preview_task`

Write after Safety Preview:

- `start_task(plan_token)`
- `continue_task(task_id, instruction)`
- `abort_task(task_id)`
- `approve_escalation(task_id, escalation_id)`
- `reject_escalation(task_id, escalation_id)`
- `rollback_task(task_id, checkpoint_id)`

Do not expose `shell`, generic `read_file(path)`, generic `write_file(path)`, raw `session.attach`, raw Hub commands, Hub credentials, or raw daemon control to ChatGPT.

## 16. Migration sequence

Implement in these bounded units; do not jump directly to a live shared-runtime test.

### Unit 1 — Registry + Safety Preview

- machine-local project/workspace registry;
- canonical path validation;
- safety profile/config versioning;
- read-only workspace discovery;
- immutable Safety Plan store;
- opaque single-use TTL plan tokens;
- stale workspace/Git/policy fingerprint rejection;
- durable task linkage to project/workspace/safety plan.

Cloud tests only.

### Unit 2 — Policy engine + safe executors

- normalized action descriptors;
- secret/protected/allowed path evaluation;
- symlink/reparse-point containment rules;
- patch multi-file preview/policy;
- owner-targeted `beforeTool` hook handler;
- client-owned read/search/editor/apply-patch executors;
- disabled shell/network/MCP/plugin/subagent/team surfaces;
- fail-closed behavior when policy/capability handling fails.

Cloud unit/integration tests with filesystem fixtures; no Hub/Ollama mutation.

### Unit 3 — Hub-backed Cline runtime adapter

- internal runtime factory/seam;
- `ClineCore` Hub backend with Cline-managed discovery/auth;
- required workspace context from registry;
- orchestrator-owned session creation;
- safe hook/executor contribution registration;
- current normalized event/watchdog/context-rotation/recovery behavior preserved;
- workspace/session identity revalidation on resume.

Use mocks/fakes in cloud CI first.

### Unit 4 — Machine MCP gateway

- task-level MCP tool surface;
- read-only annotations and write/destructive annotations;
- no raw path write parameters;
- no Hub credential exposure;
- local authentication/tunnel configuration;
- plugin skill/UX integration around Safety Preview and durable status.

Cloud tests plus local read-only smoke testing.

### Unit 5 — Isolated shared-runtime proof

Only after explicit authorization for an isolated local test window:

1. use a disposable/test workspace registered by the user;
2. connect to the pinned compatible Hub without restarting/stopping shared Ollama;
3. create one orchestrator-owned session;
4. verify VS Code can observe/attach;
5. perform an allowed in-scope edit;
6. prove an out-of-scope edit is stopped before execution;
7. prove a secret path is denied;
8. prove `run_commands` is unavailable;
9. prove owner/policy capability failure fails closed;
10. run validation and final diff safety;
11. rollback the test workspace from the orchestrator checkpoint.

No production repository, push, deploy, database mutation, or destructive shared-runtime operation is permitted in this proof.

## 17. Required test matrix

Before write-capable plugin release, automated tests must cover at least:

### Registry / plan

- canonical registration and stable opaque IDs;
- root/system path rejection;
- duplicate/alias root handling;
- registry revision changes invalidate old plans;
- branch/HEAD/dirty changes invalidate old plans;
- expired/replayed plan tokens fail;
- `start_task` cannot replace workspace/path/policy fields.

### Policy / filesystem

- allowed read;
- secret read denied;
- in-scope edit allowed;
- protected/out-of-scope edit stopped;
- new-file parent containment;
- traversal rejection;
- symlink/reparse-point write rejection;
- multi-file patch all-or-nothing policy check;
- unknown tool fails closed;
- disabled shell/network/MCP/plugin surfaces remain unavailable.

### Hub ownership

- Hub write session is created by orchestrator identity;
- client contributions target that owner identity;
- wrong-client capability response is rejected;
- owner disconnect/error cannot cause tool execution;
- generic approval response is not required for safety-critical file tools;
- resume refuses a persisted session whose workspace no longer matches the registered root.

### Existing guarantees

- watchdog/retry;
- context rotation + handoff;
- session-not-found recovery;
- validation repair;
- checkpoint preservation;
- final diff-safety completion gate;
- abort and rollback.

## 18. Migration decision

For the first safe ChatGPT write-capable release:

- keep `ClineRunner` and the `ClineCore` API;
- switch plugin tasks to `backendMode: "hub"` through a runtime factory;
- create a new orchestrator-owned Hub session after every approved new task/recovery generation;
- use the machine-local user registry as workspace authority;
- use opaque immutable Safety Plans for task approval;
- install an owner-targeted `beforeTool` hook as an early fail-closed gate;
- route read/search/editor/apply-patch through owner-targeted client executors that re-enforce policy at execution;
- disable arbitrary model shell, ungoverned network/MCP/plugins, subagents/teams, and provider-owned tools in the pilot;
- keep validation and final diff safety outside the model;
- use orchestrator `waiting_for_human`/escalation state rather than native Hub approval as the human authorization channel;
- add the MCP/plugin surface only above these local guarantees.

This design gives VS Code shared visibility into the authoritative Hub session without allowing either ChatGPT or another attached Hub client to bypass the user's locally approved workspace/task safety envelope.
