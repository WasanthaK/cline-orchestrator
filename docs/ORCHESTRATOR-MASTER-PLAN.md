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

- [x] Start/resume tasks with durable task state and Cline session IDs.
- [x] Persistent daemon with same-daemon continuity and semantic recovery after session/runtime loss.
- [x] Run-local token/tool/iteration metrics.
- [x] Watchdog stall detection with bounded retry/recovery.
- [x] Durable event timeline, explicit abort, and graceful shutdown/drain semantics.
- [x] CLI persistence fallback during listener shutdown race.
- [x] Metadata-only provider preflight before task state changes.

## Status

**COMPLETE**

---

# Milestone 2 — Safety: Make Autonomous Editing Reversible

## Objective

Before unattended editing, every coding task must have auditable Git state, a reversible checkpoint, explicit validation support, and a final policy check on the resulting workspace diff.

## Acceptance Criteria

### Git state and rollback

- [x] Capture Git branch/HEAD/dirty state before and after run.
- [x] Exclude `.orchestrator/` bookkeeping from workspace comparisons.
- [x] Create restorable checkpoint before Cline changes the workspace.
- [x] Preserve already-dirty tracked/untracked state.
- [x] Persist checkpoint metadata/events.
- [x] Explicit rollback service, serialized daemon endpoint, CLI, and tests.

### Validation

- [x] Task stores `acceptanceCriteria[]` and `validationCommands[]`.
- [x] Model completion enters `validating` when commands exist.
- [x] Validation runs outside the model with persisted command evidence.
- [x] Stop on first failure; terminal `validation_failed` state.
- [x] Bounded automatic validation repair with lifecycle events/tests.

### Diff safety policy

- [x] Explicit final diff summary relative to the original pre-run checkpoint.
- [x] Expected-path scope detection when configured.
- [x] Protected-path hard failures and deployment-sensitive warnings.
- [x] Unexpected branch/HEAD movement detection.
- [x] Configurable excessive-diff threshold.
- [x] Persist warnings/failures/results and policy events.
- [x] `completed` requires validation success (when configured) and diff-safety success.

## Diff Safety Configuration

- `ORCH_DIFF_MAX_CHANGED_FILES` — hard threshold; default `100`; `0` disables it.
- `ORCH_DIFF_PROTECTED_PATTERNS` — comma-separated hard-failure glob patterns.
- `ORCH_DIFF_WARNING_PATTERNS` — comma-separated warning glob patterns.
- `ORCH_DIFF_EXPECTED_PATHS` — optional allowed task-scope patterns.
- Task `expectedChangedPaths[]` takes precedence over environment scope.

The comparison uses the original run checkpoint, so validation repair does not reset the baseline and pre-run dirty state is distinguishable from task-created changes.

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

## Acceptance Criteria

- [x] Track per-turn input usage separately from cumulative usage.
- [x] Configurable context-rotation threshold.
- [x] Rotation decision based on current/per-turn request size, not cumulative run totals.
- [x] Distinct planned context-rotation reason/event from watchdog failure.
- [x] Planned rotation does not increment watchdog stall/retry counters.
- [x] Rotation is requested after an iteration boundary rather than during an active tool call.
- [x] Cloud tests cover threshold calculations.
- [x] Replace primarily prose/previous-output recovery with a versioned structured durable handoff artifact.
- [x] Handoff includes original goal, current task state, relevant workspace evidence, and pending action.
- [x] Persist durable handoff evidence before session replacement and retain task/event provenance.
- [x] Bound and test multiple planned rotations in one long task.
- [x] Test interaction with `session_not_found` recovery.
- [x] Test interaction with validation repair while preserving the original checkpoint baseline.
- [x] Keep run metrics and lifecycle events attributable across multiple session generations.

## Structured Handoff Design

Durable handoffs are stored under:

```text
.orchestrator/handoffs/<task-id>/<target-generation>-<handoff-id>.json
```

Each version-1 handoff records recovery/rotation reason, source/target generation, original goal, pending action, task lifecycle/configuration state, current Git snapshot, checkpoint identity/fingerprints, validation/diff-safety summaries, run metrics, and bounded supporting prose.

The artifact is written **before** starting the replacement Cline session. The replacement prompt is rendered from structured durable data rather than reconstructed primarily from prior prose. Task state stores `lastContextHandoff` plus `contextHandoffCount`, and `context_handoff_created` events record provenance.

## Bounded Rotation Behavior

`maxContextRotations` is enforced per run. Integration coverage proves two allowed rotations produce generations 1 -> 2 -> 3, two distinct handoffs, and no third replacement when the configured budget is two.

## Session-Loss Behavior

A `session_not_found` result is distinct from planned rotation. Integration coverage proves one lost recorded session creates one handoff targeting the next generation, advances recovery/session-generation counters, resumes from the structured handoff, and does not increment planned-rotation counters.

## Validation-Repair Behavior

A validation-repair model turn reuses the original task checkpoint. If that repair turn loses its Cline session, the durable handoff captures the failed validation evidence, repair instruction, and original checkpoint identity/fingerprint. After the replacement model reports completion, the task returns to `validating`; it cannot persist `completed` until external validation actually passes.

## Cross-Generation Evidence

Repeated-rotation integration coverage proves run metrics remain coherent across replacement sessions: attempts and per-turn input/output/tool counts remain distinct and cumulative totals remain correct. Planned rotations do not increment watchdog retry/stall counters. `context_rotating`, `context_handoff_created`, and `session_recovered` events retain run-rotation count, reason, source generation, target generation, and distinct handoff IDs.

## Evidence

- Structured handoff: commit `15adf9f9dd87a45544d2a6fc3985dc278be9284d`; CI `#178`, workflow `35576669466`, success.
- Repeated rotations: commit `84fc26df4d2dd6b7ad1c45e02c9846e264593d25`; CI `#182`, workflow `35577093373`, success.
- Session-not-found recovery: commit `26dbf0db896e83d160c1cf3f43f2ae7b0e813e2c`; CI `#186`, workflow `35577401081`, success.
- Validation-repair recovery: commit `af9db66835c5dfc7a657e1c0291cdaef24668a2d`; CI `#190`, workflow `35577839253`, success.
- Cross-generation metrics/event assertions: commit `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194`, workflow `35578149506`, success.
- No self-hosted/Ollama runtime mutation was performed.

## Status

**COMPLETE**

---

# Milestone 4 — Durable Project Memory

## Objective

Make project continuity independent of any particular model context or Cline session.

## Target Structure

```text
.orchestrator/
  project.json
  tasks/
  task-summaries/
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

- [x] Durable project metadata.
- [x] Architecture memory.
- [x] Decision log with rationale and date/task provenance.
- [x] Code map containing important modules/components only.
- [x] Conventions memory.
- [x] Known-issues memory.
- [x] Per-task structured summary.
- [x] Structured handoff artifact shared with context rotation/recovery.
- [ ] Selective retrieval so whole project memory is not dumped into every prompt.
- [ ] Memory updates are explicit/auditable.
- [ ] Tests for serialization, update, and selection logic.

## Project Metadata and Storage Skeleton

The orchestrator now bootstraps project memory automatically on the first task-state save.

`.orchestrator/project.json` is schema-versioned and persists a stable `projectId`, creation/update timestamps, current workspace root, memory-schema version, canonical relative paths for the five memory documents, and a latest-task pointer. Re-opening the project preserves project identity and creation time while task-state saves refresh the latest-task pointer.

The storage skeleton creates these files once and never overwrites existing content:

```text
.orchestrator/memory/architecture.md
.orchestrator/memory/decisions.md
.orchestrator/memory/code-map.md
.orchestrator/memory/conventions.md
.orchestrator/memory/known-issues.md
```

Unknown/future `project.json` schema versions are rejected instead of silently rewritten. Existing human-authored memory-file content is preserved when the skeleton is re-ensured.

## Architecture Memory

Architecture memory now has an explicit append-only update primitive. Each durable entry carries a unique update ID, timestamp, originating task ID, rationale, title, and architecture content. A machine-readable provenance marker is written beside the human-readable entry, while `.orchestrator/project.json` records `memoryUpdateCount` and `lastMemoryUpdate` for fast audit/reference.

Updates preserve existing architecture content rather than replacing the document. Required provenance/content fields are validated, timestamps must be valid, and multiple updates remain independently attributable and ordered.

## Decision Memory

Decision memory now uses the same append-only audit model. Each decision entry records a unique update ID, timestamp, originating task ID, title, explicit decision statement, and rationale. Machine-readable provenance is embedded beside the human-readable decision entry.

Existing decision history is preserved. Project-level `memoryUpdateCount` spans architecture and decision updates together, and `lastMemoryUpdate` identifies the latest update regardless of document, keeping audit provenance coherent across memory types.

## Code Map Memory

Code-map memory now records one important module/component per append-only entry. Each update includes the component name, a concise responsibility, task/date/rationale provenance, and a bounded set of representative paths rather than a repository-wide inventory.

The path list is deliberately constrained to 1–12 unique entries. Empty, duplicate, or over-broad path sets are rejected. Machine-readable provenance includes the component and representative paths, while project-level `memoryUpdateCount` and `lastMemoryUpdate` remain coherent across architecture, decisions, and code-map updates.

## Conventions Memory

Conventions memory now records durable implementation/project rules that future work should preserve. Each append-only entry carries a title, explicit scope, convention text, unique update ID, timestamp, originating task ID, and rationale, with machine-readable provenance beside the human-readable entry.

Existing convention content is preserved rather than replaced. Required title/scope/convention/provenance fields are validated, and project-level `memoryUpdateCount` plus `lastMemoryUpdate` remain coherent when convention updates follow other memory document types.

## Known Issues Memory

Known-issues memory now records durable risks/constraints as append-only lifecycle entries. Each update carries an explicit status (`open`, `mitigated`, `resolved`, or `accepted`), impact, description, unique update ID, timestamp, originating task ID, and rationale, with machine-readable provenance beside the human-readable entry.

Existing issue history is preserved instead of being rewritten when status changes. Invalid statuses and missing status/impact/description/provenance fields are rejected, while project-level `memoryUpdateCount` and `lastMemoryUpdate` remain coherent when issue updates follow other memory types.

## Per-task Structured Summary

Each task can now produce a versioned latest-summary artifact at `.orchestrator/task-summaries/<task-id>.json`. The summary records revision and source-task timestamp provenance, task goal/status, lifecycle/configuration counts, selected validation/diff-safety/Git/handoff/run-metric evidence, and terminal outcome fields.

Summary text is bounded to 2,000 characters per retained text field. Verbose/transient payloads such as worker prompts/output, validation stdout/stderr, Git status lines, full diff path lists, and per-turn metric arrays are deliberately excluded. Re-recording a task preserves the original summary creation timestamp while incrementing the revision and recording the latest source-task timestamp. Unsupported summary schemas and path-escaping task IDs are rejected.

## Handoff / Project-Memory Integration

New structured handoffs now carry an optional bounded `durableMemory` block while retaining schema version 1 for backward compatibility. That block contains the current bounded per-task summary plus a compact project-memory index: project ID/schema, canonical memory-file paths, project memory update count, and latest auditable memory-update reference.

The handoff prompt includes that bounded block for replacement Cline sessions, so planned context rotation and recovery can continue from durable task/project provenance rather than reconstructed prose alone. Full architecture/decision/code-map/conventions/known-issues document bodies are deliberately not embedded; focused tests prove a sentinel stored in an architecture document does not appear in either the handoff artifact or generated recovery prompt. Legacy version-1 handoffs without `durableMemory` continue to load and render normally.

## Evidence

- Project metadata/skeleton implementation: commit `32014431b54256d51f76626641350b08315afda9`; CI `#198`, workflow `35579239935`, success.
- Architecture memory implementation: commit `0344c16cc843428af4dbe4247b9156a222e2bdb9` (`feat: add auditable architecture memory updates`); CI `#202`, workflow `35585222049`, success.
- Decision memory implementation: commit `3a43401c80e6ebe3df6dc33c337d307cbeb38cee` (`feat: add auditable decision memory updates`); CI `#206`, workflow `35586243241`, success.
- Code-map memory implementation: commit `3e064115c187783ec9fb86a3a732fca136e02140` (`feat: add selective code map memory`); CI `#212`, workflow `35590998279`, success.
- Conventions memory implementation: commit `3efecb809b9679505f007d75bfd273d815fa2e55` (`feat: add auditable conventions memory`); CI `#220`, workflow `35593035452`, success.
- Known-issues memory implementation: commit `90a9adf9147b7bbf63486b99ac605ded5cdc844c` (`feat: add auditable known issues memory`); CI `#226`, workflow `35595083980`, success.
- Per-task summary implementation: commit `d74f63618898291f42363bdd846459814820b4cd` (`feat: add durable per-task structured summaries`) plus focused tests in commit `0e8c2e57cfe382b792a4178de40ccbb453c1c080` (`test: cover durable task summaries`); CI `#232`, workflow `35597817935`, success.
- Handoff/project-memory integration: commit `822125be3d7e0d81d44a20e503397b2b3a9014e1` (`feat: integrate durable memory into context handoffs`) plus compatibility tests in commit `7387489e360b851a726b42dcc6797ba48f29ed6a` (`test: cover durable memory handoff integration`); CI `#238`, workflow `35599286479`, success.
- Tests cover bootstrap/serialization/reload, stable project identity, latest-task metadata updates, `TaskStore` integration, non-overwrite behavior, architecture provenance/order, decision provenance/content, selective code-map entries, bounded/unique representative paths, conventions scope/provenance/content preservation, known-issue status/impact/lifecycle preservation, task-summary serialization/revision/bounding/schema/path safety, bounded handoff memory provenance, no full-memory dump into handoffs/prompts, legacy handoff compatibility, project-wide cross-document update counting, invalid-input rejection, and unsupported metadata schemas.
- No self-hosted/Ollama runtime mutation was performed.

## Status

**IN PROGRESS**

## Current Next Step

Implement the next Milestone 4 unit: **selective project-memory retrieval so only relevant bounded memory is supplied to a task/handoff instead of dumping all durable memory documents**, with focused selection/bounding tests. Do not begin Hub/RPC work.

---

# Milestone 5 — Cline Hub / VS Code Shared Runtime

## Objective

Allow the orchestrator and the user's VS Code Cline UI to observe/control the same authoritative Cline session instead of maintaining separate hidden runtime ownership.

## Confirmed Research

The pinned Cline generation is `0.0.83`. Research shows Hub-related architecture through `@cline/core/hub`, including `NodeHubClient`, `HubSessionClient`, `HubUIClient`, and `connectToHub`. This remains research only.

## Technical Spike Acceptance Criteria

- [ ] Document Hub discovery and local authentication/token mechanism.
- [ ] Confirm exact imports at `0.0.83` and direct-dependency needs.
- [ ] Identify list/attach/send/abort/session-event APIs.
- [ ] Determine workspace session identity and multi-client approval/tool-executor behavior.
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
| Validation-repair + handoff interaction | Implemented + cloud tested |
| Cross-generation metrics/event evidence | Implemented + cloud tested |
| Durable project metadata + memory skeleton | Implemented + cloud tested |
| Architecture memory + provenance | Implemented + cloud tested |
| Decision log + provenance | Implemented + cloud tested |
| Selective code map + provenance | Implemented + cloud tested |
| Conventions memory + provenance | Implemented + cloud tested |
| Known issues memory + provenance | Implemented + cloud tested |
| Per-task structured summary | Implemented + cloud tested |
| Handoff + bounded durable memory context | **Implemented + cloud tested** |
| Durable project memory content/retrieval | In progress |
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
9. **Handoff retention** — per-generation JSON is intentionally durable; retention/compaction belongs with project-memory policy.
10. **Project memory remains partial** — core memory documents, task summaries, and handoff provenance are durable/auditable, but selective retrieval of relevant memory content remains unfinished.

---

# Immediate Work Queue

Only work on the first unfinished item unless a prerequisite defect is discovered.

1. **Implement selective project-memory retrieval**
   - choose relevant memory documents/entries for the current task rather than loading everything;
   - bound returned memory content and preserve source/provenance references;
   - add focused selection/bounding tests.

2. **Close the remaining explicit/auditable update and selection-test acceptance criteria** once retrieval behavior is proven.

3. **Perform Milestone 5 Hub/RPC technical spike** only after Milestone 4 is complete.

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
- Next action: bounded repeated rotations.

## 2026-09-21 — Milestone 3 bounded repeated rotations proven

- Tests: three threshold-crossing sends with `maxContextRotations=2` prove exactly two replacements, generations 1->2->3, two distinct handoffs, and budget exhaustion without a third replacement.
- Evidence: commit `84fc26df4d2dd6b7ad1c45e02c9846e264593d25`; CI `#182` / `35577093373` passed.
- Next action: `session_not_found` interaction.

## 2026-09-21 — Milestone 3 session-not-found recovery proven

- Tests: first send returns `session_not_found`; orchestrator creates one durable handoff, starts generation 2, resumes from it, and completes without consuming planned-rotation budget.
- Evidence: commit `26dbf0db896e83d160c1cf3f43f2ae7b0e813e2c`; CI `#186` / `35577401081` passed.
- Next action: validation-repair interaction.

## 2026-09-21 — Milestone 3 validation-repair recovery proven

- Tests: a repair task with a real pre-repair checkpoint and failed validation loses its Cline session; recovery writes a durable handoff containing the repair instruction, failed-validation summary, and original checkpoint fingerprint.
- Tests: the repair run does not replace the original checkpoint; after replacement model completion, task state returns to `validating` and no `completed` event is emitted.
- Evidence: commit `af9db66835c5dfc7a657e1c0291cdaef24668a2d`; CI `#190` / `35577839253` passed.
- Next action: cross-generation metrics/event evidence.

## 2026-09-21 — Milestone 3 context durability completed

- Tests: expanded repeated-rotation coverage to assert attempts `1/2/3`, per-attempt token/tool metrics, cumulative token/tool totals, zero retry/stall inflation, rotation counts, generation-tagged handoff/recovery events, and distinct durable handoff IDs.
- Evidence: commit `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506` passed.
- Milestone impact: **Milestone 3 COMPLETE**.
- Known limitation: durable handoff retention/compaction is deliberately deferred to Milestone 4 project-memory policy.
- Next action: begin Milestone 4 with durable project metadata and the `.orchestrator/memory/` storage skeleton. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 project metadata and memory skeleton implemented

- Change: added schema-versioned `.orchestrator/project.json` with stable project identity, workspace root, memory-file map, timestamps, and latest-task pointer.
- Change: task-state saves now automatically bootstrap project memory and refresh the latest-task pointer.
- Change: added one-time creation of `architecture.md`, `decisions.md`, `code-map.md`, `conventions.md`, and `known-issues.md` without overwriting existing memory content.
- Tests: bootstrap/serialization/reload, stable identity, task-pointer updates, `TaskStore` integration, non-overwrite behavior, and unsupported-schema rejection.
- Evidence: commit `32014431b54256d51f76626641350b08315afda9`; CI `#198` / `35579239935` passed.
- Milestone impact: durable project metadata criterion complete; Milestone 4 remains in progress.
- Known limitation: the five documents are storage skeletons only; semantic update/retrieval/provenance behavior is not implemented yet.
- Next action: implement architecture memory with an explicit/auditable update primitive and provenance. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 architecture memory implemented

- Change: added append-only architecture-memory updates with unique update IDs, validated timestamp/task/rationale provenance, machine-readable provenance markers, and human-readable architecture entries.
- Change: project metadata now records memory-update count and the latest memory-update reference without replacing existing architecture content.
- Tests: existing content preservation, explicit provenance, metadata audit references, multiple-update ordering/uniqueness, and invalid provenance/content/timestamp rejection.
- Evidence: commit `0344c16cc843428af4dbe4247b9156a222e2bdb9`; CI `#202` / `35585222049` passed.
- Milestone impact: **Architecture memory criterion complete**; Milestone 4 remains in progress.
- Known limitation: the general memory update/retrieval system is not complete until the remaining memory types and selective retrieval are implemented.
- Next action: implement decision-log entries with rationale and date/task provenance. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 decision log implemented

- Change: added append-only decision entries with explicit decision text, unique update IDs, validated timestamp/task/rationale provenance, and machine-readable audit markers.
- Change: project-level memory update counting now remains coherent across architecture and decision documents, with `lastMemoryUpdate` identifying the latest cross-document update.
- Tests: existing decision-history preservation, explicit decision/rationale/date/task provenance, cross-document audit counting, and rejection of missing decision/provenance or invalid timestamps.
- Evidence: commit `3a43401c80e6ebe3df6dc33c337d307cbeb38cee`; CI `#206` / `35586243241` passed.
- Milestone impact: **Decision log criterion complete**; Milestone 4 remains in progress.
- Known limitation: code map, conventions, known issues, task summaries, and selective retrieval remain unfinished.
- Next action: implement selective code-map memory containing important modules/components only. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 selective code map implemented

- Change: added append-only code-map entries for important modules/components with explicit responsibility, bounded representative paths, and task/date/rationale provenance.
- Change: code-map path selection is constrained to 1–12 unique entries so durable memory does not become a repository-wide file inventory.
- Tests: preservation of existing code-map content, provenance markers, representative path rendering, empty/duplicate/over-limit path rejection, missing responsibility rejection, invalid timestamp rejection, and cross-document audit counting.
- Evidence: commit `3e064115c187783ec9fb86a3a732fca136e02140`; CI `#212` / `35590998279` passed.
- Milestone impact: **Code map criterion complete**; Milestone 4 remains in progress.
- Known limitation: conventions, known issues, task summaries, and selective retrieval remain unfinished.
- Next action: implement conventions memory with explicit/auditable provenance. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 conventions memory implemented

- Change: added append-only convention entries with explicit scope, convention text, unique update IDs, and validated task/date/rationale provenance.
- Tests: existing convention-content preservation, human/machine-readable scope and provenance, required-field/timestamp rejection, and cross-document audit counting after code-map updates.
- Evidence: commit `3efecb809b9679505f007d75bfd273d815fa2e55`; CI `#220` / `35593035452` passed.
- Milestone impact: **Conventions memory criterion complete**; Milestone 4 remains in progress.
- Repository-history note: commits `adcf36c05bef7c24d3e3404ad84f6f8004769c30` and `7e14ea2c7c16cc8d3543d7cfcfc3e443e4e1c31a` are content-neutral documentation commits created by a connector branch-update mistake; they did not alter source or plan content.
- Known limitation: known issues, task summaries/handoff integration, and selective retrieval remain unfinished.
- Next action: implement known-issues memory with explicit status/impact and auditable provenance. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 known-issues memory implemented

- Change: added append-only known-issue lifecycle entries with explicit status, impact, description, unique update IDs, and validated task/date/rationale provenance.
- Change: issue status is constrained to `open`, `mitigated`, `resolved`, or `accepted`; status changes append new history instead of overwriting prior issue state.
- Tests: existing issue-content preservation, human/machine-readable status/impact provenance, lifecycle ordering, invalid-status/required-field/timestamp rejection, and cross-document audit counting after conventions updates.
- Evidence: commit `90a9adf9147b7bbf63486b99ac605ded5cdc844c`; CI `#226` / `35595083980` passed.
- Milestone impact: **Known-issues memory criterion complete**; Milestone 4 remains in progress.
- Repository-history note: commit `41ce7e3c0ece9a84da7c1d837c5012e32d368572` temporarily replaced the master-plan content with a connector placeholder; commit `90a9adf9147b7bbf63486b99ac605ded5cdc844c` immediately restored the exact prior plan while adding the implementation and tests.
- Known limitation: per-task summaries, handoff/project-memory integration, and selective retrieval remain unfinished.
- Next action: implement a per-task structured summary with durable provenance and focused tests. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 per-task structured summary implemented

- Change: added versioned `.orchestrator/task-summaries/<task-id>.json` artifacts containing bounded task goal/status, lifecycle/configuration counts, selected validation/diff/Git/handoff/metrics evidence, terminal outcome, revision, and source-task timestamp provenance.
- Change: summary text is bounded to 2,000 characters; verbose worker prompts/output, validation stdout/stderr, Git status lines, changed-path details, and per-turn metric arrays are deliberately excluded.
- Tests: summary serialization/evidence selection, bounded-text behavior, exclusion of transient/verbose payloads, revision/creation provenance, reload, unsafe task-ID rejection, and unsupported-schema rejection.
- Evidence: implementation commit `d74f63618898291f42363bdd846459814820b4cd`; focused-test commit `0e8c2e57cfe382b792a4178de40ccbb453c1c080`; CI `#232` / `35597817935` passed.
- Milestone impact: **Per-task structured summary criterion complete**; Milestone 4 remains in progress.
- Known limitation: the summary artifact is not yet consumed by context rotation/recovery, and selective project-memory retrieval remains unfinished.
- Next action: integrate bounded task-summary/project-memory context into the existing structured handoff artifact used by rotation/recovery. Hub/RPC remains deferred.

## 2026-09-21 — Milestone 4 handoff/project-memory integration implemented

- Change: context-handoff creation now records the bounded per-task summary plus a compact project-memory index (`projectId`, schemas, canonical memory-file paths, update count, latest auditable update reference) in an optional `durableMemory` block.
- Change: replacement-session prompts carry that bounded durable-memory block while full memory-document bodies remain out of the prompt; the existing version-1 handoff shape remains backward compatible.
- Tests: task-summary/project metadata presence, source/provenance references, architecture sentinel exclusion from artifact/prompt, and load/render compatibility for legacy schema-v1 artifacts without `durableMemory`.
- Evidence: implementation commit `822125be3d7e0d81d44a20e503397b2b3a9014e1`; compatibility-test commit `7387489e360b851a726b42dcc6797ba48f29ed6a`; CI `#238` / `35599286479` passed.
- Milestone impact: **Structured handoff/project-memory integration criterion complete**; Milestone 4 remains in progress.
- Known limitation: relevant project-memory document content is still not selectively retrieved into task/handoff context.
- Next action: implement selective project-memory retrieval with explicit selection, provenance, and bounded-content tests. Hub/RPC remains deferred.

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
