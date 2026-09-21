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
- [x] Graceful queued-task shutdown without starting Cline.
- [x] CLI persistence fallback during listener shutdown race.
- [x] Metadata-only provider preflight rejects unavailable/missing configured model before task state changes.

## Status

**COMPLETE**

---

# Milestone 2 — Safety: Make Autonomous Editing Reversible

## Objective

Before unattended editing, every coding task must have auditable Git state, a reversible checkpoint, explicit validation support, and a final policy check on the resulting workspace diff.

## Acceptance Criteria

### Git state and rollback

- [x] Capture Git branch/HEAD/dirty state before and after run.
- [x] Exclude `.orchestrator/` bookkeeping from workspace-change comparisons.
- [x] Create restorable checkpoint before Cline changes the workspace.
- [x] Preserve already-dirty worktree state in checkpoint design.
- [x] Record checkpoint metadata/events.
- [x] Explicit rollback service, serialized daemon endpoint, CLI, and tests.

### Validation

- [x] Task stores `acceptanceCriteria[]` and `validationCommands[]`.
- [x] Model-reported completion transitions to `validating` when commands exist.
- [x] Run validation outside the model and persist command evidence.
- [x] Stop sequence on first failure; `validation_failed` terminal state.
- [x] Bounded automatic validation-repair loop and lifecycle events/tests.

### Diff safety policy

- [x] Explicit final diff summary relative to the original pre-run checkpoint.
- [x] Detect unexpected changed paths when expected scope patterns are configured.
- [x] Protected-path hard-failure policy and deployment-sensitive warning policy.
- [x] Detect unexpected branch/HEAD movement.
- [x] Configurable excessive-diff threshold.
- [x] Distinguish warnings from hard policy failures.
- [x] Persist policy result/events and automated decision tests.
- [x] `completed` requires validation success (when configured) and diff safety success.

## Diff Safety Configuration

- `ORCH_DIFF_MAX_CHANGED_FILES` — hard threshold; default `100`; `0` disables it.
- `ORCH_DIFF_PROTECTED_PATTERNS` — comma-separated hard-failure glob patterns.
- `ORCH_DIFF_WARNING_PATTERNS` — comma-separated warning glob patterns.
- `ORCH_DIFF_EXPECTED_PATHS` — optional comma-separated allowed task-scope patterns.
- Task `expectedChangedPaths[]` takes precedence over environment-level scope.

The comparison uses the original run checkpoint so validation-repair turns do not reset the baseline. Pre-run tracked/untracked dirty state is distinguished from task-created changes.

## Evidence

- Commit `56cecab14bf5719601d6801b5635a5b2ef2d0336` (`feat: add diff safety gate`).
- GitHub-hosted CI run `#174`, workflow `35574026345`, success.
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
- [x] Bound and test multiple planned rotations in one long task.
- [x] Test interaction with `session_not_found` recovery.

## Structured Handoff Design

Durable handoffs are stored under:

```text
.orchestrator/handoffs/<task-id>/<target-generation>-<handoff-id>.json
```

Each version-1 handoff records recovery/rotation reason, source/target generation, original goal, pending action, task lifecycle/configuration state, current Git snapshot, checkpoint identity, validation/diff-safety summaries, run metrics, and bounded supporting prose.

The artifact is written **before** starting the replacement Cline session. The replacement prompt is rendered from structured durable data rather than reconstructed primarily from prior prose. Task state stores `lastContextHandoff` plus `contextHandoffCount`, and `context_handoff_created` events record provenance.

## Bounded Rotation Behavior

`maxContextRotations` is enforced per run. Integration coverage proves two allowed rotations produce generations 1 -> 2 -> 3, two distinct handoffs, and no third replacement when the configured budget is two.

## Session-Loss Behavior

A `session_not_found` result is distinct from planned context rotation. Integration coverage proves one lost recorded session creates one handoff targeting the next generation, advances recovery/session-generation counters, resumes from the structured handoff, and does **not** increment planned-rotation counters.

## Remaining Acceptance Criteria

- [ ] Test interaction with validation repair.
- [ ] Ensure context metrics/events remain clear across multiple session generations.

## Evidence

- Structured handoff: commit `15adf9f9dd87a45544d2a6fc3985dc278be9284d`; CI `#178`, workflow `35576669466`, success.
- Repeated rotations: commit `84fc26df4d2dd6b7ad1c45e02c9846e264593d25`; CI `#182`, workflow `35577093373`, success.
- Session-not-found recovery: commit `26dbf0db896e83d160c1cf3f43f2ae7b0e813e2c`; CI `#186`, workflow `35577401081`, success.
- No self-hosted/Ollama runtime mutation was performed.

## Status

**IN PROGRESS — validation-repair interaction and final cross-generation metrics/event clarity remain**

## Current Next Step

Test the structured handoff interaction with **validation repair**, preserving the original task/checkpoint baseline through a repair run and any replacement session. Do not begin Hub/RPC work.

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

The pinned Cline generation is `0.0.83`. Current research shows Hub-related architecture through `@cline/core/hub`, including `NodeHubClient`, `HubSessionClient`, `HubUIClient`, and `connectToHub`. This remains research only.

## Technical Spike Acceptance Criteria

- [ ] Document Hub discovery and local authentication/token mechanism.
- [ ] Confirm exact imports available at `0.0.83` and direct-dependency needs.
- [ ] Identify list/attach/send/abort/session-event APIs.
- [ ] Determine workspace-owned session identity and multi-client approval/tool-executor behavior.
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

Add a supervisory intelligence layer that plans, defines evidence, sends bounded implementation work to local Cline, and reviews resulting evidence.

## Acceptance Criteria

- [ ] Supervisor task schema and bounded implementation instructions.
- [ ] Planner produces acceptance criteria and validation commands.
- [ ] Reviewer consumes diff + validation + task evidence and can request bounded repairs.
- [ ] Reviewer cannot bypass safety gates.
- [ ] Durable supervisor decisions and human escalation state.

## Status

**NOT STARTED**

---

# Milestone 7 — Unattended Execution

## Objective

Allow hours-long/overnight work with bounded autonomy, explicit failure handling, and no silent uncontrolled continuation.

## Acceptance Criteria

- [ ] Task queue/DAG, dependencies, and automatic progression.
- [ ] Time/token/request/repair budgets and checkpoint policy.
- [ ] `waiting_for_human` state and escalation rules.
- [ ] Final unattended-run report and safe resume after interruption.

## Status

**NOT STARTED**

---

# Milestone 8 — UI, MCP, and Multi-worker

## Possible Scope

- [ ] VS Code orchestration panel and web/dashboard view.
- [ ] MCP server surface.
- [ ] Sequential specialist roles and multiple workers when capacity permits.
- [ ] Team-role handoffs and rich task/event/usage visualization.

## Status

**NOT STARTED**

---

# Current Capability Snapshot

| Capability | Status |
|---|---|
| Foundation lifecycle | Complete / proven |
| Provider metadata preflight | Implemented + cloud tested |
| Git checkpoint + rollback | Implemented + tested |
| Validation + bounded repair | Implemented + tested |
| Diff safety gate | Implemented + cloud tested |
| Completion requires validation + safety | Implemented + tested |
| Per-turn context supervisor | Implemented + cloud tested |
| Structured durable context handoff | Implemented + cloud tested |
| Multiple planned rotation coverage | Implemented + cloud tested |
| Session-not-found + handoff interaction | Implemented + cloud tested |
| Validation-repair + handoff interaction | Next unfinished item |
| Durable project memory | Not started |
| Shared VS Code/Hub session | Research only |
| GPT supervisor | Not started |
| Unattended task DAG | Not started |

---

# Known Constraints and Risks

1. **Shared Ollama runtime** — never mutate/kill it through automated tests without explicit authorization.
2. **Context rotation** — never use cumulative token totals as the trigger.
3. **Semantic recovery** — hidden model context cannot be restored after runtime loss; recovery must rely on durable workspace/project state.
4. **Cline API evolution** — Hub work must use the exact pinned package/API surface.
5. **Dirty worktrees** — safety/rollback must preserve pre-run changes and distinguish them from task changes.
6. **Validation commands are trusted configuration** — they execute outside the model and must remain explicit/bounded.
7. **Expected changed paths** — ordinary unrelated source paths require configured scope to be classified as unexpected.
8. **Event/state persistence** — currently lightweight JSON/JSONL.
9. **Handoff retention** — per-generation JSON is intentionally durable; retention/compaction belongs with later project-memory policy.

---

# Immediate Work Queue

Only work on the first unfinished item unless a prerequisite defect is discovered.

1. **Finish Milestone 3 validation-repair interaction coverage**
   - preserve original checkpoint through repair run;
   - prove recovery/rotation handoff contains repair-state validation evidence and pending repair action;
   - confirm resulting lifecycle remains in validation until validation actually passes.

2. **Finish Milestone 3 cross-generation metrics/event evidence** and close the milestone if CI is green.

3. **Build Milestone 4: durable project memory**.

4. **Perform Milestone 5 Hub/RPC technical spike** only after Milestones 3–4 are complete.

---

# Progress Log

## 2026-09-21 — Plan baseline established

- Consolidated eight ordered milestones and protected the shared Ollama runtime.
- Next action was the Milestone 2 diff safety gate.

## 2026-09-21 — Milestone 2 diff safety gate completed

- Change: implemented checkpoint-relative diff policy, protected/warning paths, scope enforcement, branch/HEAD checks, excessive-diff threshold, durable evidence, and central completion gating.
- Tests: safety decisions, dirty pre-run state, persistence, and completion blocking.
- Evidence: commit `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345` passed.
- Milestone impact: **Milestone 2 COMPLETE**.
- Next action: structured durable context handoff.

## 2026-09-21 — Milestone 3 structured durable handoff implemented

- Change: versioned `.orchestrator/handoffs/` artifacts, task references/counters, structured recovery prompts, and durable handoff events.
- Tests: serialization/loading, task/workspace/pending-action evidence, bounded supporting prose, prompt rendering, and path containment.
- Evidence: commit `15adf9f9dd87a45544d2a6fc3985dc278be9284d`; CI `#178` / `35576669466` passed.
- Milestone impact: structured handoff criteria complete; Milestone 3 remains in progress.
- Next action: bounded repeated rotations.

## 2026-09-21 — Milestone 3 bounded repeated rotations proven

- Tests: three threshold-crossing sends with `maxContextRotations=2` prove exactly two replacements, generations 1->2->3, two distinct handoffs, and budget exhaustion without a third replacement.
- Evidence: commit `84fc26df4d2dd6b7ad1c45e02c9846e264593d25`; CI `#182` / `35577093373` passed.
- Milestone impact: bounded repeated-rotation criterion complete.
- Next action: `session_not_found` interaction.

## 2026-09-21 — Milestone 3 session-not-found recovery proven

- Tests: mocked runtime rejects the first send with `session_not_found`; orchestrator creates one durable structured handoff, starts generation 2, resumes with that handoff, and completes without consuming planned-rotation budget.
- Evidence: commit `26dbf0db896e83d160c1cf3f43f2ae7b0e813e2c`; CI `#186` / `35577401081` passed.
- Milestone impact: session-not-found interaction criterion complete; validation-repair interaction remains.
- Known limitation: repair-path handoff evidence and final cross-generation metrics/event clarity are still unproven.
- Next action: test validation-repair interaction while preserving original checkpoint context.

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
