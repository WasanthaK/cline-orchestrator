# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-21
Branch: `phase-1/bootstrap`

## Purpose

This file is the canonical execution plan for `cline-orchestrator`.

Before starting new implementation work, read this file first. After completing a meaningful step, update this file with:

1. what changed;
2. the evidence that it works;
3. the current milestone status;
4. the single next planned step.

Do not skip ahead to later milestones merely because an interesting API or implementation path is discovered. Research may be recorded, but implementation should follow the milestone order below unless the plan itself is deliberately revised.

## End Goal

```text
ChatGPT
Planner / Architect / Reviewer
          |
          v
Orchestrator
Durable state + safety + supervision
          |
          v
Cline
Implementation agent
          |
          v
VS Code workspace
          |
          v
Tests / validation / Git safety
```

The desired system should eventually support long-running and unattended coding work while preserving human control, reversible workspace changes, durable project memory, bounded context, and evidence-based completion.

---

# Execution Rules

## Rule 1 — Finish milestones in order

Current order:

```text
1. Foundation
   ->
2. Safety
   ->
3. Context Durability
   ->
4. Durable Project Memory
   ->
5. Cline Hub / VS Code Integration
   ->
6. GPT Supervisor
   ->
7. Unattended Execution
   ->
8. UI / MCP / Multi-worker
```

A milestone is complete only when:

- its acceptance criteria are implemented;
- relevant automated tests exist;
- normal cloud CI is green;
- important runtime behavior has evidence where runtime testing is actually required;
- this document has been updated to mark it complete.

## Rule 2 — Shared local Ollama runtime is protected

The user's Windows/Ollama environment is a shared development runtime.

Automated development must **not**:

- stop Ollama models;
- unload models;
- kill `llama-server.exe`;
- restart Ollama;
- pre-warm or switch models automatically;
- run destructive local E2E tests without explicit authorization.

The self-hosted runner must remain manual/read-only unless the user explicitly authorizes an isolated runtime test window.

Normal development should use repository inspection, mocked/unit tests, and GitHub-hosted CI.

## Rule 3 — Do not confuse model context with project lifetime

Project continuity must eventually live in durable orchestrator state, not in one model conversation.

Cumulative token usage is **not** the context-rotation trigger. Context supervision should use the size of the current/per-turn model request.

## Rule 4 — Model completion is not proof of task completion

For coding tasks, `completed` should eventually mean:

```text
model reports done
      ->
validation passes
      ->
diff/safety policy passes
      ->
completion is recorded
```

---

# Milestone 1 — Foundation: Task Execution and Durability

## Objective

Reliably control Cline across task start, continuation, recovery, cancellation, and daemon lifecycle while preserving durable orchestration state.

## Acceptance Criteria

- [x] Start a task with workspace + goal.
- [x] Run Cline through `ClineCore`.
- [x] Persist task state under `.orchestrator/tasks/`.
- [x] Persist Cline session ID.
- [x] Stream worker output.
- [x] Resume the same orchestration task.
- [x] Keep the Cline runtime alive inside a persistent daemon.
- [x] Preserve same-daemon Cline conversation continuity.
- [x] Recover semantically after daemon restart / lost Cline session.
- [x] Record run-local token/tool/iteration metrics.
- [x] Watchdog stalled Cline turns.
- [x] Bounded retry after watchdog stalls.
- [x] Durable event timeline.
- [x] Explicit abort CLI/API.
- [x] Manual abort does not trigger retry.
- [x] Graceful daemon shutdown aborts active tasks durably.
- [x] Graceful daemon shutdown drains queued tasks without starting Cline.
- [x] CLI falls back to persisted terminal state during listener shutdown race.
- [x] Provider preflight rejects unavailable/missing configured model before task state changes.
- [x] Provider preflight is metadata-only and non-destructive.

## Status

**COMPLETE**

## Key Evidence

- Same-daemon session continuity proven with real local Cline session.
- Daemon-restart semantic recovery proven.
- Watchdog stall -> abort -> retry -> recovery proven.
- Active shutdown and queued-task shutdown behavior proven.
- Provider preflight covered by mocked unit tests and cloud CI.

---

# Milestone 2 — Safety: Make Autonomous Editing Reversible

## Objective

Before allowing unattended edits, ensure every task has auditable Git state, reversible checkpoints, explicit validation, and policy checks on the resulting diff.

## Acceptance Criteria

### Git state and rollback

- [x] Capture Git branch/HEAD/dirty state before run.
- [x] Capture Git branch/HEAD/dirty state after run.
- [x] Exclude `.orchestrator/` bookkeeping from workspace-change comparisons.
- [x] Create restorable checkpoint before Cline changes the workspace.
- [x] Preserve already-dirty worktree state in checkpoint design.
- [x] Record checkpoint metadata/events.
- [x] Explicit rollback service.
- [x] Serialized rollback daemon endpoint.
- [x] `rollback` CLI command.
- [x] Automated rollback tests.

### Validation

- [x] Task can store `acceptanceCriteria[]`.
- [x] Task can store `validationCommands[]`.
- [x] Model-reported completion transitions to `validating` when commands exist.
- [x] Run validation commands outside the model.
- [x] Persist validation stdout/stderr/exit/timeout information.
- [x] Stop validation sequence on first failure.
- [x] `validation_failed` terminal state.
- [x] Bounded automatic validation-repair loop.
- [x] Validation lifecycle events.
- [x] Validation/unit tests in cloud CI.

### Diff safety policy

- [ ] Produce explicit final diff summary relative to pre-run checkpoint.
- [ ] Detect unexpected changed paths.
- [ ] Protected-path policy (for example `.env`, secrets, credentials, deployment-sensitive files).
- [ ] Detect unexpected branch/HEAD movement.
- [ ] Configurable excessive-diff threshold.
- [ ] Distinguish warning from hard policy failure.
- [ ] Persist diff-policy result/events.
- [ ] Add unit/integration tests for safety-policy decisions.

## Status

**IN PROGRESS — final diff safety gate remains**

## Current Next Step

Implement the **diff safety policy** and make successful coding-task completion pass through it after validation.

Do not start Hub/VS Code integration before this milestone is closed.

---

# Milestone 3 — Context Durability

## Objective

Allow long-running work without allowing a single Cline conversation to grow until quality degrades or the model hits its context ceiling.

## Acceptance Criteria

- [x] Track per-turn input usage separately from cumulative input usage.
- [x] Configurable context-rotation threshold.
- [x] Rotation decision is based on current/per-turn request size, not cumulative run totals.
- [x] Planned context rotation has a distinct recovery reason/event from watchdog failure.
- [x] Planned rotation does not increment watchdog stall/retry counters.
- [x] Cloud tests cover threshold calculations.
- [ ] Rotation occurs only at a safe Cline iteration boundary.
- [ ] Fresh session receives structured durable handoff.
- [ ] Handoff includes original goal, current task state, relevant workspace evidence, and pending action.
- [ ] Multiple rotations in one long task are bounded and tested.
- [ ] Context rotation interacts correctly with session-not-found recovery.
- [ ] Context rotation interacts correctly with validation repair.
- [ ] Context metrics/events survive rotations clearly.

## Current Implementation

A per-turn context supervisor has been introduced with a default policy derived from configured model limits. Cloud CI is green for the current implementation.

This milestone is **not yet complete** because the handoff still needs to become structured and durable rather than relying primarily on prior output text.

## Status

**IN PROGRESS, but paused until Milestone 2 is closed**

---

# Milestone 4 — Durable Project Memory

## Objective

Make project continuity independent of any particular model context or Cline session.

## Target Structure

```text
.orchestrator/
  project.json
  tasks/
  events/
  checkpoints/
  memory/
    architecture.md
    decisions.md
    code-map.md
    conventions.md
    known-issues.md
  handoffs/
```

## Acceptance Criteria

- [ ] Durable project metadata.
- [ ] Architecture memory.
- [ ] Decision log with rationale and date/task provenance.
- [ ] Code map containing important modules/components only.
- [ ] Conventions memory.
- [ ] Known-issues memory.
- [ ] Per-task structured summary.
- [ ] Structured handoff artifact used by context rotation/recovery.
- [ ] Selective retrieval so whole project memory is not dumped into every prompt.
- [ ] Memory updates are explicit/auditable.
- [ ] Tests for serialization, update, and selection logic.

## Status

**NOT STARTED**

---

# Milestone 5 — Cline Hub / VS Code Shared Runtime

## Objective

Allow the orchestrator and the user's VS Code Cline UI to observe/control the same authoritative Cline session instead of maintaining separate hidden runtime ownership.

## Confirmed Research

Current Cline architecture exposes Hub-backed runtime support for cross-process session management. The documented Hub client surface includes concepts such as:

- `NodeHubClient`
- `HubSessionClient`
- `HubUIClient`
- `connectToHub`

Hub sessions are designed so multiple clients can attach/detach without stopping the authoritative runtime.

The pinned Cline generation is `0.0.83`; `@cline/core` 0.0.83 exposes an `./hub` package surface, while `@cline/sdk` itself only exports its root alias. A controlled integration spike is required before changing our runtime architecture.

## Acceptance Criteria

### Technical spike first

- [ ] Document Hub discovery mechanism.
- [ ] Document local authentication/token mechanism.
- [ ] Confirm exact imports available from packages at `0.0.83`.
- [ ] Determine whether `@cline/core` must be added as a direct dependency.
- [ ] Identify list/attach/send/abort/session-event APIs.
- [ ] Determine how VS Code identifies workspace-owned sessions.
- [ ] Determine how approvals/tool executors work with multiple clients.
- [ ] Produce migration design from owned `ClineCore` to Hub-backed attachment.

### Implementation after spike approval

- [ ] Attach orchestrator to shared Hub runtime.
- [ ] Preserve task/session mapping.
- [ ] Preserve watchdog semantics.
- [ ] Preserve explicit abort semantics.
- [ ] Preserve usage/event metrics.
- [ ] Preserve validation and Git safety gates.
- [ ] Confirm VS Code and orchestrator can observe the same session.

## Status

**RESEARCH ONLY — implementation must wait for Milestones 2–4**

---

# Milestone 6 — GPT Supervisor

## Objective

Introduce a separate supervisory intelligence layer that plans, reviews, defines evidence, and sends bounded implementation tasks to local Cline.

## Target Flow

```text
GPT supervisor
      |
      +-- understand requirement
      +-- inspect durable project memory
      +-- define implementation task
      +-- define acceptance criteria
      +-- define validation commands
      v
Local Cline worker
      |
      +-- inspect
      +-- implement
      +-- test locally when permitted
      v
Orchestrator
      |
      +-- validation gate
      +-- diff safety gate
      +-- checkpoint evidence
      v
GPT reviewer
      |
      +-- review diff/evidence
      +-- request bounded repair when necessary
      v
complete / human escalation
```

## Acceptance Criteria

- [ ] Supervisor task schema.
- [ ] Planner produces bounded implementation instructions.
- [ ] Planner produces acceptance criteria.
- [ ] Planner produces validation commands.
- [ ] Reviewer consumes diff + validation + task evidence.
- [ ] Reviewer can request bounded repairs.
- [ ] Reviewer cannot bypass safety gates.
- [ ] Durable supervisor decisions recorded.
- [ ] Human escalation state for ambiguous/high-risk decisions.

## Status

**NOT STARTED**

---

# Milestone 7 — Unattended Execution

## Objective

Allow hours-long/overnight work with bounded autonomy, clear failure handling, and no silent uncontrolled continuation.

## Acceptance Criteria

- [ ] Task queue / DAG.
- [ ] Dependencies between tasks.
- [ ] Automatic progression to next eligible task.
- [ ] Time budget.
- [ ] Token/request budget.
- [ ] Repair/retry budget.
- [ ] Checkpoint policy.
- [ ] `waiting_for_human` state.
- [ ] Escalation rules.
- [ ] Final overnight summary/report.
- [ ] Resume safely after daemon/machine interruption.

## Status

**NOT STARTED**

---

# Milestone 8 — UI, MCP, and Multi-worker

## Objective

Add ergonomic control surfaces and more advanced orchestration only after the core system is dependable.

## Possible Scope

- [ ] VS Code orchestration panel.
- [ ] Web/dashboard view.
- [ ] MCP server surface.
- [ ] Sequential specialist roles.
- [ ] Multiple workers when provider/hardware capacity permits.
- [ ] Team-role handoffs.
- [ ] Rich task/event/usage visualization.

## Status

**NOT STARTED**

---

# Current Capability Snapshot

| Capability | Status |
|---|---|
| Normal Cline execution | Proven |
| Same-daemon Cline continuity | Proven |
| Daemon-restart semantic recovery | Proven |
| Watchdog abort/retry/recovery | Proven |
| Persistent event timeline | Proven |
| Explicit abort | Proven |
| Graceful active-task shutdown | Proven |
| Graceful queued-task drain | Proven |
| Shutdown client persistence fallback | Proven |
| Provider metadata preflight | Implemented + cloud tested |
| Git before/after snapshots | Implemented |
| Restorable checkpoint infrastructure | Implemented + tested |
| Explicit rollback | Implemented + tested |
| Validation gate | Implemented + tested |
| Validation repair loop | Implemented + tested |
| Diff safety gate | Not yet complete |
| Per-turn context supervisor | Implemented + cloud tested |
| Structured durable context handoff | Not yet complete |
| Durable project memory | Not started |
| Shared VS Code/Hub session | Research only |
| GPT supervisor | Not started |
| Unattended task DAG | Not started |

---

# Known Constraints and Risks

1. **Shared Ollama runtime** — never mutate/kill it through automated tests without explicit authorization.
2. **Context rotation** — must not use cumulative token totals as the trigger.
3. **Semantic recovery** — after daemon/runtime loss, hidden model context cannot be restored; recovery must rely on durable workspace/project state.
4. **Cline SDK/API evolution** — Hub/RPC integration must be designed against the exact pinned package/API surface, not assumed from newer documentation alone.
5. **Dirty worktrees** — rollback/safety mechanisms must preserve changes that existed before an orchestrated run.
6. **Validation commands are trusted configuration** — they execute outside the model and must be explicit/bounded.
7. **Event/state files are currently lightweight JSON/JSONL persistence** — transactional storage can come later if needed.

---

# Immediate Work Queue

Only work on the first unfinished item unless a prerequisite defect is discovered.

1. **Finish Milestone 2: diff safety gate**
   - final diff against pre-run checkpoint;
   - protected paths;
   - HEAD/branch movement detection;
   - excessive-diff threshold;
   - persisted policy result + tests.

2. **Close Milestone 2**
   - cloud CI green;
   - update this document to `COMPLETE`;
   - record relevant commit/CI evidence.

3. **Finish Milestone 3: context durability**
   - structured rotation handoff;
   - bounded repeated rotations;
   - recovery/validation interaction tests.

4. **Build Milestone 4: durable project memory**.

5. **Perform Milestone 5 Hub/RPC technical spike** only after durable memory exists.

---

# Progress Log

## 2026-09-21 — Plan baseline established

- Consolidated the project into eight ordered milestones.
- Marked Foundation complete.
- Marked Safety nearly complete; diff policy is the remaining major item.
- Recorded existing validation, rollback, and checkpoint capabilities.
- Recorded current per-turn context supervisor work; cloud CI passed after worker-config test update.
- Recorded Cline Hub/RPC research but explicitly deferred its implementation.
- Established the shared Ollama non-destructive testing rule.
- **Next action:** implement the Milestone 2 diff safety gate.

---

# Update Template

Append entries in this format after each meaningful step:

```markdown
## YYYY-MM-DD — <short step name>

- Change: <what was implemented>
- Tests: <what automated/runtime tests were run>
- Evidence: <commit SHA / CI run / relevant runtime task ID>
- Milestone impact: <what checkbox/status changed>
- Known limitation: <anything still unproven>
- Next action: <one concrete next step>
```
