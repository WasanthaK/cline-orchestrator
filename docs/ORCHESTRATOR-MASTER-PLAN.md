# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-21
Branch: `phase-1/bootstrap`

## Purpose

This file is the canonical execution plan for `cline-orchestrator`.

Before implementation work: read this file, confirm the branch/HEAD and current milestone, implement only the first unfinished item, use normal cloud CI rather than destructive shared-runtime testing, then update this file with evidence and the single next action.

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

The system should eventually support long-running and unattended coding work while preserving human control, reversible workspace changes, durable project memory, bounded model context, and evidence-based completion.

---

# Execution Rules

## Rule 1 — Finish milestones in order

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

A milestone is complete only when its acceptance criteria are implemented, relevant automated tests exist, normal GitHub-hosted CI is green, required runtime behavior has evidence where appropriate, and this document records the result.

## Rule 2 — Shared local Ollama runtime is protected

The Windows/Ollama environment is a shared development runtime. Automated development must not stop/unload models, kill `llama-server.exe`, restart Ollama, pre-warm/switch models, or run destructive self-hosted E2E tests without explicit authorization.

Use repository inspection, mocks/unit tests, and GitHub-hosted CI for normal development. The self-hosted runner remains manual/read-only unless an isolated runtime test window is explicitly authorized.

## Rule 3 — Model context is not project lifetime

Project continuity must live in durable orchestrator state, not in one model conversation. Context rotation must use current/per-turn request size, not cumulative token totals.

## Rule 4 — Model completion is not task completion

For coding tasks:

```text
model reports done
      ->
validation passes (when configured)
      ->
diff safety policy passes
      ->
completed is persisted
```

A hard diff-policy failure prevents `completed`.

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

---

# Milestone 2 — Safety: Make Autonomous Editing Reversible

## Objective

Before unattended editing, every coding task must have auditable Git state, a reversible checkpoint, explicit validation support, and a final policy check on the resulting workspace diff.

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

- [x] Task stores `acceptanceCriteria[]`.
- [x] Task stores `validationCommands[]`.
- [x] Model-reported completion transitions to `validating` when commands exist.
- [x] Run validation outside the model.
- [x] Persist validation stdout/stderr/exit/timeout information.
- [x] Stop validation sequence on first failure.
- [x] `validation_failed` terminal state.
- [x] Bounded automatic validation-repair loop.
- [x] Validation lifecycle events.
- [x] Validation/unit tests in cloud CI.

### Diff safety policy

- [x] Explicit final diff summary relative to the original pre-run checkpoint.
- [x] Detect unexpected changed paths when expected scope patterns are configured.
- [x] Protected-path hard-failure policy for `.env`, secrets/credentials, private-key material, and configurable patterns.
- [x] Deployment-sensitive path warning policy with configurable patterns.
- [x] Detect unexpected branch movement.
- [x] Detect unexpected HEAD movement.
- [x] Configurable excessive-diff threshold.
- [x] Distinguish warnings from hard policy failures.
- [x] Persist policy result and lifecycle events.
- [x] Unit/integration tests cover safety-policy decisions and completion gating.
- [x] A coding task cannot persist `completed` until validation has passed (when configured) and the diff safety gate has passed.

## Diff Safety Configuration

Environment controls:

- `ORCH_DIFF_MAX_CHANGED_FILES` — hard threshold; default `100`; `0` disables this threshold.
- `ORCH_DIFF_PROTECTED_PATTERNS` — comma-separated hard-failure glob patterns; defaults include `.env`, secrets/credentials directories, and common private-key formats.
- `ORCH_DIFF_WARNING_PATTERNS` — comma-separated warning glob patterns; defaults include GitHub Actions, Docker/deployment/infra/Terraform-sensitive files.
- `ORCH_DIFF_EXPECTED_PATHS` — optional comma-separated allowed task-scope patterns. When omitted, scope enforcement is skipped and a durable warning is recorded.
- Task state also supports `expectedChangedPaths[]`, which takes precedence over the environment-level expected scope.

The safety comparison uses the original run checkpoint so validation-repair turns do not reset the baseline. Tracked dirty state present before the run is excluded by comparing against the checkpoint stash tree. Pre-existing untracked files are compared against checkpoint backups so task-created additions, modifications, and deletions can be distinguished from pre-run state.

## Evidence

- Implementation commit: `56cecab14bf5719601d6801b5635a5b2ef2d0336` (`feat: add diff safety gate`).
- GitHub-hosted CI: run `#174`, workflow run `35574026345`, conclusion `success`.
- Tests cover normal scoped edits, protected paths, unexpected paths, deployment warnings, branch movement, excessive diff, dirty pre-run tracked state, persisted policy evidence, and hard-policy prevention of `completed`.
- No self-hosted/Ollama runtime mutation was performed.

## Status

**COMPLETE**

---

# Milestone 3 — Context Durability

## Objective

Allow long-running work without allowing one Cline conversation to grow until quality degrades or the provider context ceiling is reached.

## Implemented

- [x] Track per-turn input usage separately from cumulative usage.
- [x] Configurable context-rotation threshold.
- [x] Rotation decision based on current/per-turn request size, not cumulative run totals.
- [x] Distinct planned context-rotation reason/event from watchdog failure.
- [x] Planned rotation does not increment watchdog stall/retry counters.
- [x] Rotation is requested after an iteration boundary rather than during an active tool call.
- [x] Cloud tests cover threshold calculations.
- [x] Replace primarily prose/previous-output recovery with a versioned structured durable handoff artifact.
- [x] Handoff includes original goal, current task state, relevant workspace evidence, and pending action.
- [x] Persist durable handoff evidence before session replacement and retain a task reference/event that survives replacement.

## Structured Handoff Design

Durable handoffs are stored under:

```text
.orchestrator/handoffs/<task-id>/<target-generation>-<handoff-id>.json
```

Each version-1 handoff records:

- recovery/rotation reason and source/target session generation;
- original task goal and pending action;
- task lifecycle state, validation configuration, repair/rotation counters, and expected change scope;
- current Git workspace snapshot excluding `.orchestrator/` bookkeeping;
- rollback-checkpoint identity/fingerprints when present;
- latest validation/diff-safety summary and run metrics when present;
- bounded previous-prompt and recent-worker-output excerpts as supporting evidence only.

The artifact is written **before** starting the replacement Cline session. The replacement prompt is rendered from the structured artifact rather than reconstructed primarily from prior prose. Task state stores `lastContextHandoff` plus `contextHandoffCount`, and a `context_handoff_created` event records durable provenance.

## Remaining Acceptance Criteria

- [ ] Bound and test multiple planned rotations in one long task.
- [ ] Test interaction with `session_not_found` recovery.
- [ ] Test interaction with validation repair.
- [ ] Ensure context metrics/events remain clear across multiple session generations.

## Evidence

- Implementation commit: `15adf9f9dd87a45544d2a6fc3985dc278be9284d` (`feat: add durable context handoff`).
- GitHub-hosted CI: run `#178`, workflow run `35576669466`, typecheck and full test suite passed.
- Tests cover durable serialization/loading, task/workspace/pending-action evidence, bounded supporting prose, structured replacement-prompt rendering, and handoff path containment.
- No self-hosted/Ollama runtime mutation was performed.

## Status

**IN PROGRESS — structured handoff implemented; interaction/bounded-rotation coverage remains**

## Current Next Step

Bound and test **multiple planned context rotations in one run**, preserving distinct durable handoff/session-generation evidence. Do not begin Hub/RPC work.

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
- [ ] Structured handoff artifact shared with context rotation/recovery.
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

The pinned Cline generation is `0.0.83`. Current research shows Hub-related architecture through `@cline/core/hub`, including concepts such as `NodeHubClient`, `HubSessionClient`, `HubUIClient`, and `connectToHub`. This remains research only.

## Technical Spike Acceptance Criteria

- [ ] Document Hub discovery mechanism.
- [ ] Document local authentication/token mechanism.
- [ ] Confirm exact imports available at `0.0.83`.
- [ ] Determine whether `@cline/core` must be a direct dependency.
- [ ] Identify list/attach/send/abort/session-event APIs.
- [ ] Determine how VS Code identifies workspace-owned sessions.
- [ ] Determine approval/tool-executor behavior with multiple clients.
- [ ] Produce migration design from owned `ClineCore` to Hub-backed attachment.

## Implementation Acceptance Criteria

- [ ] Attach orchestrator to shared Hub runtime.
- [ ] Preserve task/session mapping, watchdog, abort, usage/events, validation, and Git safety semantics.
- [ ] Confirm VS Code and orchestrator can observe the same authoritative session.

## Status

**RESEARCH ONLY — implementation must wait for Milestones 3–4**

---

# Milestone 6 — GPT Supervisor

## Objective

Add a separate supervisory intelligence layer that plans, defines evidence, sends bounded implementation work to local Cline, and reviews resulting evidence.

## Acceptance Criteria

- [ ] Supervisor task schema.
- [ ] Planner produces bounded implementation instructions.
- [ ] Planner produces acceptance criteria and validation commands.
- [ ] Reviewer consumes diff + validation + task evidence.
- [ ] Reviewer can request bounded repairs.
- [ ] Reviewer cannot bypass safety gates.
- [ ] Durable supervisor decisions.
- [ ] Human escalation state for ambiguous/high-risk decisions.

## Status

**NOT STARTED**

---

# Milestone 7 — Unattended Execution

## Objective

Allow hours-long/overnight work with bounded autonomy, explicit failure handling, and no silent uncontrolled continuation.

## Acceptance Criteria

- [ ] Task queue / DAG and dependencies.
- [ ] Automatic progression to next eligible task.
- [ ] Time/token/request/repair budgets.
- [ ] Checkpoint policy.
- [ ] `waiting_for_human` state and escalation rules.
- [ ] Final unattended-run report.
- [ ] Safe resume after daemon/machine interruption.

## Status

**NOT STARTED**

---

# Milestone 8 — UI, MCP, and Multi-worker

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
| Foundation lifecycle | Complete / proven |
| Provider metadata preflight | Implemented + cloud tested |
| Git before/after snapshots | Implemented |
| Restorable checkpoint + rollback | Implemented + tested |
| Validation + bounded repair | Implemented + tested |
| Diff safety gate | **Implemented + cloud tested** |
| Completion requires validation + safety | **Implemented + tested** |
| Per-turn context supervisor | Implemented + cloud tested |
| Structured durable context handoff | **Implemented + cloud tested** |
| Multiple planned rotation coverage | Next unfinished item |
| Durable project memory | Not started |
| Shared VS Code/Hub session | Research only |
| GPT supervisor | Not started |
| Unattended task DAG | Not started |

---

# Known Constraints and Risks

1. **Shared Ollama runtime** — never mutate/kill it through automated tests without explicit authorization.
2. **Context rotation** — never use cumulative token totals as the trigger.
3. **Semantic recovery** — hidden model context cannot be restored after runtime loss; recovery must rely on durable workspace/project state.
4. **Cline API evolution** — Hub work must use the exact pinned package/API surface, not newer docs by assumption.
5. **Dirty worktrees** — safety/rollback must preserve pre-run changes and distinguish them from task changes.
6. **Validation commands are trusted configuration** — they execute outside the model and must remain explicit/bounded.
7. **Expected changed paths** — without task/environment scope patterns the safety gate records a warning but cannot classify unrelated ordinary source files as unexpected.
8. **Event/state persistence** — currently lightweight JSON/JSONL; transactional storage can be considered later if justified.
9. **Handoff retention** — per-generation handoff JSON is intentionally durable; retention/compaction belongs with later project-memory policy rather than this milestone.

---

# Immediate Work Queue

Only work on the first unfinished item unless a prerequisite defect is discovered.

1. **Finish Milestone 3 bounded rotation behavior**
   - multiple planned rotations in one run remain bounded by `maxContextRotations`;
   - every actual replacement gets a distinct durable handoff and target generation;
   - metrics/events remain understandable across generations.

2. **Finish Milestone 3 recovery/validation interaction coverage**
   - `session_not_found` interaction;
   - validation-repair interaction;
   - confirm durable context evidence through both paths.

3. **Build Milestone 4: durable project memory**.

4. **Perform Milestone 5 Hub/RPC technical spike** only after Milestones 3–4 are complete.

---

# Progress Log

## 2026-09-21 — Plan baseline established

- Consolidated the project into eight ordered milestones.
- Marked Foundation complete.
- Marked Safety nearly complete with diff policy as the remaining item.
- Recorded validation, rollback, checkpoint, context-supervisor, and Hub research state.
- Established the shared Ollama non-destructive testing rule.
- Next action was the Milestone 2 diff safety gate.

## 2026-09-21 — Milestone 2 diff safety gate completed

- Change: added final diff evaluation relative to the original rollback checkpoint, including tracked dirty-state exclusion and pre-existing untracked-file comparison.
- Change: added protected hard-failure patterns, deployment-sensitive warning patterns, expected-path scope enforcement, branch/HEAD movement checks, and configurable changed-file threshold.
- Change: persisted `lastDiffSafety` evidence and diff-safety lifecycle events; hard failures transition to `failed` with `finishReason=diff_safety_failed` instead of `completed`.
- Change: completion is now centrally gated in `TaskStore.save`, so model completion and post-validation completion cannot bypass the safety policy.
- Tests: added unit/integration coverage for scoped edits, protected/unexpected paths, warnings, branch movement, excessive diffs, dirty pre-run state, event persistence, and completion blocking.
- Evidence: commit `56cecab14bf5719601d6801b5635a5b2ef2d0336`; GitHub Actions CI run `35574026345` / run `#174` passed.
- Milestone impact: **Milestone 2 is COMPLETE**.
- Known limitation: unexpected ordinary source-path detection requires `expectedChangedPaths[]` or `ORCH_DIFF_EXPECTED_PATHS`; otherwise a warning records that scope enforcement was not configured.
- Next action: implement the Milestone 3 structured durable context handoff. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 3 structured durable handoff implemented

- Change: added versioned JSON context handoffs under `.orchestrator/handoffs/<task-id>/` and task-level handoff references/counters.
- Change: each handoff records original goal, pending action, task lifecycle/configuration state, current Git evidence, checkpoint identity, latest validation/diff-safety summaries, run metrics, and bounded supporting prose.
- Change: recovery now writes the handoff before replacement-session creation and renders the replacement prompt from the structured handoff for planned rotation, missing-session, session-not-found, and watchdog recovery paths.
- Change: added durable `context_handoff_created` events with source/target generation and artifact path.
- Tests: durable artifact serialization/loading, workspace/task evidence, bounded prior-output excerpts, structured prompt rendering, and path containment.
- Evidence: commit `15adf9f9dd87a45544d2a6fc3985dc278be9284d`; GitHub Actions CI run `35576669466` / run `#178` passed typecheck and tests.
- Milestone impact: structured handoff acceptance criteria are complete; Milestone 3 remains **IN PROGRESS** for bounded repeated rotations and recovery/validation interaction coverage.
- Known limitation: repeated-rotation/session-not-found/validation-repair interactions have not yet been exercised together by automated tests.
- Next action: bound and test multiple planned rotations in one run with distinct durable handoff/session-generation evidence.

---

# Update Template

```markdown
## YYYY-MM-DD — <short step name>

- Change: <what was implemented>
- Tests: <what automated/runtime tests were run>
- Evidence: <commit SHA / CI run / relevant runtime task ID>
- Milestone impact: <what checkbox/status changed>
- Known limitation: <anything still unproven>
- Next action: <one concrete next step>
```
