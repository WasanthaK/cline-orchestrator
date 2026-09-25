# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-25
Branch: `phase-1/bootstrap`

## Purpose

This is the canonical execution plan for `cline-orchestrator`.

Before implementation work: read this file, confirm branch/HEAD and the current milestone, implement only the first unfinished item, prefer GitHub-hosted CI over destructive local-runtime testing, then update this file with evidence and one concrete next action.

Detailed implementation history remains in Git history. This tracker keeps the current architecture, acceptance state, key evidence, constraints, and ordered next work authoritative.

## End Goal

```text
ChatGPT
Planner / Architect / Reviewer
          |
          v
Cline Orchestrator Plugin / MCP
Task-level authority + Safety Preview
          |
          v
Orchestrator
Durable state + safety + supervision
          |
          v
Cline Hub
Authoritative shared runtime
       /       \
      v         v
VS Code Cline   Cline session
          |
          v
Workspace / Git / validation
```

The system should support long-running and eventually unattended coding work while preserving human control, reversible workspace changes, durable project memory, bounded model context, fail-closed authority, and evidence-based completion.

---

# Execution Rules

1. **Finish milestones in order.** Work only on the first unfinished implementation item unless a prerequisite defect is discovered.
2. **Protect the shared local runtime.** Do not stop/unload Ollama or llama.cpp models, kill unrelated runtime processes, restart shared Cline/Hub, or mutate shared VS Code/Cline state without explicit user authorization.
3. **Use cloud CI for normal development.** Unit/integration tests and GitHub-hosted CI are the default proof path.
4. **Model context is not project lifetime.** Durable task/project state owns continuity; context rotation uses request/turn size rather than cumulative history.
5. **Model completion is not task completion.** Completion requires configured external validation plus checkpoint-relative diff safety.
6. **ChatGPT receives task authority, not machine authority.** Only registered IDs and approved task envelopes grant authority.
7. **Scope expansion fails closed.** Broader work requires durable human escalation or a fresh Safety Preview.
8. **Supervisor output is advisory unless explicitly admitted by trusted orchestration code.** Planner/Reviewer text cannot grant filesystem, command, validation, worker, policy, Hub, network, MCP, plugin, subagent, or completion authority.

---

# Milestone 1 — Foundation

## Acceptance

- [x] Durable start/resume and session IDs.
- [x] Persistent daemon and semantic recovery after runtime/session loss.
- [x] Run-local token/tool/iteration metrics.
- [x] Watchdog stall detection with bounded retry/recovery.
- [x] Durable events, abort, graceful shutdown/drain.
- [x] Provider metadata preflight before task-state mutation.

## Status

**COMPLETE**

---

# Milestone 2 — Safety: Reversible Autonomous Editing

## Acceptance

- [x] Git branch/HEAD/dirty evidence before/after runs.
- [x] Restorable checkpoint preserving pre-existing dirty tracked/untracked state.
- [x] Explicit rollback service and durable checkpoint metadata.
- [x] External validation with bounded repair.
- [x] Checkpoint-relative final diff summary.
- [x] Expected/protected path, branch/HEAD and excessive-diff enforcement.
- [x] `completed` requires validation success when configured plus diff-safety success.

Key closure: `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345`.

## Status

**COMPLETE**

---

# Milestone 3 — Context Durability

## Acceptance

- [x] Per-turn input usage and configurable rotation threshold.
- [x] Planned rotation separate from watchdog retry.
- [x] Versioned durable context handoff before session replacement.
- [x] Bounded repeated rotations.
- [x] `session_not_found` recovery.
- [x] Validation-repair recovery preserves original rollback baseline.
- [x] Cross-generation metrics/events remain coherent.

Key closure: through `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506`.

## Status

**COMPLETE**

---

# Milestone 4 — Durable Project Memory

## Durable structure

```text
.orchestrator/
  project.json
  tasks/
  task-summaries/
  events/
  checkpoints/
  handoffs/
  memory/
    architecture.md
    decisions.md
    code-map.md
    conventions.md
    known-issues.md
```

## Acceptance

- [x] Stable project identity and metadata.
- [x] Architecture, decisions, code map, conventions and known-issues memory.
- [x] Versioned bounded task summaries.
- [x] Handoff integration with bounded memory context.
- [x] Deterministic selective retrieval.
- [x] Auditable memory updates/verifier.
- [x] Cross-store closure.

Key closure: `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260` / `35604869492`.

## Status

**COMPLETE**

---

# Milestone 5 — ChatGPT Plugin / Cline Hub Shared Runtime

## Architecture

Pinned Cline generation: `@cline/sdk 0.0.83` / `@cline/core 0.0.83`.

- Machine-local registry provides opaque project/workspace IDs and revisioned safety profiles.
- Read-only Safety Preview produces an immutable server-side Safety Plan and opaque single-use token.
- Durable tasks bind project/workspace/Safety Plan/profile/worker identity and approved path envelope.
- Pre-execution policy and owner-targeted Hub tool executors are the authorization boundary.
- Model shell, ungoverned network/MCP/plugins, subagents and teams are disabled in the first pilot.
- Hub auth returned by Cline discovery is passed ephemerally in memory to `ClineCore.create`; it is not persisted.
- Persisted Hub-session workspace identity is verified before resume.
- Gateway restart reconciles recoverable active tasks by revalidating authority/diff/checkpoint evidence, discarding stale owner identity, creating a durable handoff and replacement owner session; unsafe/unsupported states fail closed.
- Machine MCP exposes task-oriented operations only; no raw filesystem/shell/Hub/process authority.

## Acceptance

- [x] Registry + Safety Preview/token boundary.
- [x] Durable approved-task safety binding.
- [x] Pre-execution policy + local safe executors.
- [x] Hub-backed runtime factory + owner safety wiring.
- [x] Task-oriented machine MCP gateway and loopback bearer boundary.
- [x] Sanitized task/event/diff views.
- [x] Shared VS Code visibility and allowed edit physically proven.
- [x] Secret read denial physically proven.
- [x] Protected-path read/write denial physically proven.
- [x] Model-shell unavailability physically proven.
- [x] External validation + diff safety + rollback physically proven.
- [x] Gateway owner-loss/replacement-owner recovery physically proven.

## Important evidence

- Registry/plan boundary through `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; CI `#295`.
- Policy/executor boundary through `46da20d18cd703018c54207258d4fb2422e71eeb`; CI `#311/#312`.
- Hub runtime/safety wiring through `32c057d30bc70533233477e87f7e01ec09b2e04a`; CI `#329/#330`.
- Machine MCP implementation through `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; CI `#351/#352`.
- Windows direct-entry fix through `0f3741eb3c231696bb2cf909be3b948a71125005`; CI `#365/#366`.
- Pinned Hub packaging compatibility through `7fb9d3c2c394aab1f038208854cae7a3f2b77cc9`.
- Windows atomic-state retry `670d27d077d6b45ce1dfe9204510405b530385cf`; CI `#383/#384`.
- Restart reconciliation `8b6bc285e7a79a88576babcd62716cf09d2bff97`; CI `#385/#386`.
- Diagnostic harness `f3b39a1e5f485a770ca87574da6747ff72eadecc` + `fb591f66bfa6b19255303c8bc9abbd69f6649997`; CI `#416` / `35993678361`.
- Explicit-endpoint Hub auth handoff `99ff5d0ffccda2f531aadd0c95abf19314f89138`; smoke test `182705ab6540fa4e339b304679cd150d7aacc8e8`; CI `#426` / `36071434059`.
- Dual pinned Core launcher shims `318919d42c2085207e228574bda272bd4d2b152a` + tests `e73e02e3fb7808f37df07241e5ab1309892f6b9a`; CI `#430`.
- Owner-loss proof timeout alignment `3603b530153d8da2ed0d38dfefa4d4a225eac3af`; CI `#434`.
- Disposable Git `core.autocrlf=false` isolation `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d` + regression `c1c714457b9930b8a10d3321d2e0972cbdca78f3`; CI `#438`.

### Physical owner-loss closure

The first owner reached `running`, `runCount=1`, `sessionGeneration=1` with a usable checkpoint. Only the isolated owner process was terminated. Restart reconciliation created a durable handoff and replacement session generation 2; the recovered task completed, validation passed, diff safety passed, and rollback returned `rolled_back`.

A final proof assertion saw LF/CRLF byte differences after Windows checkout. Production rollback had already verified the restored Git fingerprint against the pre-run checkpoint, so this was a proof-repository checkout-policy artifact rather than a rollback failure. The disposable repository now pins `core.autocrlf=false`. No further heavy 27B rerun is required.

## Status

**COMPLETE**

---

# Milestone 6 — GPT Supervisor

## Objective

Add Planner/Reviewer supervision without creating a second execution or authorization path.

## Slice 1 — Supervisor Task Contract

- [x] Versioned `SupervisorTaskV1` bound to approved durable task authority.
- [x] Bounded objective/criteria/validation/scope fields.
- [x] Raw workspace, Hub/session identity and worker output omitted.
- [x] Implementation instructions repeat approved/protected scope and disabled capabilities.
- [x] Scope expansion requires stop + escalation.
- [x] Model completion remains advisory.

Evidence: `76d737c6083830e62eac8171e797df9c96ac4291`, `b3aed68158c3f12cd11d67bab97c37e045842ac5`, `d8a064aa0ec6328c69c390e577fb4637af7509f9`; CI `#359/#360`.

## Slice 2 — Bounded Planner

- [x] Proposal contains only task IDs, bounded acceptance criteria, proposed validation commands and `validationAuthority: "proposal_only"`.
- [x] Extra authority-bearing fields are rejected rather than ignored.
- [x] Planner cannot widen paths, alter worker/policy/Safety Plan identity, grant disabled capabilities, or mark work complete.
- [x] Planner model adapter has no workspace/tool/shell mutation authority.
- [x] Provider/model failures and malformed output fail closed.

Evidence: `04cb34ffb8a813e1a55338000b99d9a8dc173d50`, `10a5770b000fe9c250a8c0689bc4f43de1ec5ab3`, `9f7829caeb6324d38613b92cb5a1d6293db27084`, `5f83903b61494c458474d2ab3f2402101170a0c4`; CI `#448` / `36098312588`.

## Slice 3 — Sanitized Reviewer

- [x] Reviewer receives bounded durable task/checkpoint/validation/diff evidence, not raw runtime/output/credential data.
- [x] Result is only `pass`, `repair`, or `escalate` with advisory completion authority.
- [x] `pass` is rejected unless required validation/diff/checkpoint/human-escalation evidence supports it.
- [x] Repair/escalation outputs are bounded and mutually exclusive.
- [x] Extra authority-bearing fields are rejected.
- [x] Reviewer model/provider failure fails closed.

Evidence: `72cb1620efdef8455d22f448318ddf907b5e7933`, `19024c79c178b9c9e58854065fa98d2d4a029cd1`; CI `#454` / `36098699621`.

## Slice 4 — Durable Decisions + Human Escalation

- [x] Append-only per-task supervisor decision log.
- [x] Decisions versioned/timestamped and bound to Safety Plan/profile/revision identity.
- [x] Planner proposal persistence does not automatically trust validation commands.
- [x] Trusted planner admission is explicit, pre-run only, exact-subset bounded.
- [x] Reviewer pass/repair persist without changing lifecycle/scope/worker/policy authority.
- [x] Reviewer escalation reuses `HumanEscalationService` and durable `waiting_for_human`.
- [x] Stale durable authority fails closed.
- [x] Decision logs omit runtime secrets/raw workspace/session/output data.

Evidence: `5b44d2baf79451f33afcd5563d54a3f42ffc5959`, `f2b67a6ff4d870fab04c36b9d2245613d3347d2b`, `ce0620427e821a66ffd64942720f2bc0b942b055`; CI `#462` / `36099296457`.

## Acceptance

- [x] Supervisor task schema and bounded implementation instructions.
- [x] Planner produces bounded criteria and proposed validation commands.
- [x] Reviewer consumes sanitized evidence and can request bounded repairs.
- [x] Reviewer cannot bypass safety/completion gates.
- [x] Durable supervisor decisions and human escalation state.

## Status

**COMPLETE**

---

# Milestone 7 — Unattended Execution + Reactive Operations

## Objective

Progress from supervised single-task execution to bounded unattended workflows, while adding reactive incident visibility before autonomy increases.

## Slice 0 — Orchestrator Sentinel

Tracked as GitHub issue **#2 — Add Orchestrator Sentinel reactive incident tracking**.

### Implemented core

- [x] Versioned append-only Sentinel observation journal under `.orchestrator/sentinel/`.
- [x] Deterministic incident fingerprinting/deduplication across equivalent failures in the same workspace.
- [x] Re-scanning the same durable event does not inflate occurrence counts.
- [x] Bounded/redacted summaries remove bearer/API-key/secret/password values, URLs, absolute paths and UUIDs from free-text evidence.
- [x] Incident model tracks severity, first/last seen, occurrence count, fail-closed state, human-action requirement, recovery attempts, and bounded task/event references.
- [x] Existing task events classify stalls, session recovery, validation failure, diff-safety failure, rollback failure, checkpoint unavailability, human escalation, provider failure, gateway failure and generic task failure.
- [x] Resolution requires a real later durable task event of an allowed recovery type; model assertion alone cannot resolve an incident.
- [x] Sentinel object exposes observation/query/resolution only; no process/runtime/code/policy mutation methods exist.

Evidence: initial incident journal `6b37e054a441cf54195870234caef764d31cdb0d`; tests `72f5f507312b532d4aa88bc32da73d1fce76a16a`; type-literal correction `c4756161ee558cbfe05817f0f9901081fcdf2455`; CI `#470` / `36099791355`, success.

### Remaining Sentinel work

- [ ] Expose sanitized incident views read-only through the task-oriented MCP/API.
- [ ] Refresh/ingest registered-workspace task events when incidents are queried or by a later bounded watcher.
- [ ] Keep GitHub issue creation/update optional and separately permissioned; it is not required for core incident tracking.

### Safety constraints

- Sentinel is observational/reactive, not a second controller.
- It must not automatically restart/kill Ollama, llama.cpp or Cline.
- It must not mutate shared VS Code/Hub state.
- It must not widen Safety Plans, change worker/policy identity, grant disabled capabilities, or modify user code.
- Uncertain recovery/authority must fail closed and require human action.

## Unattended execution acceptance

- [ ] Sentinel sanitized MCP/API exposure complete.
- [ ] Task queue/DAG, dependencies and automatic progression.
- [ ] Time/token/request/repair budgets and checkpoint policy.
- [ ] `waiting_for_human` integration and escalation rules for unattended work.
- [ ] Final unattended-run report.
- [ ] Safe resume after interruption.

## Status

**IN PROGRESS — Sentinel core is complete; sanitized read-only exposure is next.**

---

# Milestone 8 — Advanced UI / Multi-worker

Possible later scope:

- [ ] Rich VS Code orchestration panel/web dashboard.
- [ ] Advanced MCP surfaces beyond bounded task-level gateway.
- [ ] Sequential specialist roles / multiple workers when capacity permits.
- [ ] Team-role handoffs and richer task/event/usage visualization.

## Status

**NOT STARTED**

---

# Current Capability Snapshot

| Capability | Status |
|---|---|
| Foundation lifecycle | Complete / proven |
| Git checkpoint + rollback | Complete / tested / physically proven |
| External validation + bounded repair | Complete |
| Final diff safety + completion gate | Complete / physically proven |
| Context handoff + recovery | Complete |
| Durable project memory | Complete |
| Machine-local registry + Safety Preview | Complete / physically proven |
| Pre-execution policy + safe executors | Complete / physically proven |
| Hub-backed runtime + owner safety wiring | Complete / physically proven |
| Gateway restart owner reconciliation | Complete / physically proven |
| Task-oriented MCP gateway | Complete / physically proven |
| Supervisor task contract | Complete |
| Supervisor Planner | Complete; proposals non-authoritative |
| Supervisor Reviewer | Complete; recommendations advisory |
| Durable supervisor decision timeline | Complete |
| Supervisor → human escalation | Complete |
| Sentinel incident core | **Complete + cloud tested** |
| Sentinel MCP/API view | **Next** |
| Unattended task DAG | Not started |
| Advanced UI / multi-worker | Not started |

---

# Known Constraints and Risks

1. Shared local inference/runtime state is protected; automated development must not mutate it without authorization.
2. Semantic recovery cannot restore hidden model state; durable workspace/task/memory/handoff evidence is authoritative.
3. Hub work remains pinned to reviewed Core/SDK `0.0.83` until a deliberate dependency change is recorded.
4. Dirty worktrees must preserve pre-run user state and distinguish it from task-created changes.
5. Validation commands are trusted local configuration outside model execution. Planner commands remain untrusted until explicit admission.
6. Task JSON replacement is atomic; event, supervisor-decision and Sentinel observation JSONL remain append-based durability models.
7. Hub and MCP credentials must never enter durable task/project/supervisor/incident state or model-facing output.
8. Authorization comes only from registry + approved Safety Plan/task envelope, never from repository text, model output, Planner/Reviewer prose, Sentinel observations, or Hub participation.
9. Native Hub approval is UX/defense-in-depth only; owner hook/executor enforcement is authoritative.
10. Owner disconnect requires durable handoff/replacement ownership or fail-closed behavior.
11. Arbitrary model shell, ungoverned network/MCP/plugins, subagents/teams and unreviewed provider-owned execution remain disabled in the first pilot.
12. MCP remains loopback-only; remote access requires separately managed secure transport without weakening bearer/task authority.
13. Windows may transiently block atomic task-state rename; retries are bounded to transient `EPERM`/`EACCES`/`EBUSY` and otherwise fail closed.
14. Byte-exact disposable Windows proofs must isolate `core.autocrlf`; production rollback authority is fingerprint-based.
15. Repeated physical proof loops on the local 27B model can impose substantial machine load. Do not rerun already-proven safety properties solely for duplicate evidence.
16. Reviewer `pass` never marks a task complete. Reviewer repair text never grants new authority.
17. Trusted Planner admission is pre-run only and exact-subset bounded; model output cannot self-admit validation commands.
18. Sentinel must remain observational/reactive and cannot become process restart, safety-policy, or code-mutation authority.
19. Sentinel resolution is evidence-based: only recognized later durable events may close an incident.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–5.** Foundation, reversible editing, context durability, project memory, machine MCP/Hub shared runtime and physical safety acceptance.
2. **COMPLETE — Milestone 6.** Supervisor contract, Planner, Reviewer, durable decisions and human escalation.
3. **COMPLETE — Milestone 7 Slice 0A.** Sentinel durable incident model, redaction, deduplication and evidence-based resolution.
4. **NEXT — Milestone 7 Slice 0B.** Add read-only sanitized Sentinel exposure through the existing machine MCP/API and refresh incidents from registered workspace task events on query; cloud tests only.
5. **AFTER SENTINEL — Milestone 7 bounded task DAG/budgets/unattended progression.**
6. **LATER — Milestone 8 advanced UI / multi-worker.**

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 5 closed on accumulated physical + cloud evidence; no additional heavy local owner-loss proof required.
- 2026-09-25: Planner completed through `5f83903b61494c458474d2ab3f2402101170a0c4`; CI `#448` / `36098312588`.
- 2026-09-25: Reviewer completed through `19024c79c178b9c9e58854065fa98d2d4a029cd1`; CI `#454` / `36098699621`.
- 2026-09-25: Durable supervisor decisions/human escalation completed through `ce0620427e821a66ffd64942720f2bc0b942b055`; CI `#462` / `36099296457`.
- 2026-09-25: **Milestone 6 COMPLETE.** Planner/Reviewer supervision remains subordinate to durable orchestrator authority.
- 2026-09-25: Sentinel durable incident core implemented through `c4756161ee558cbfe05817f0f9901081fcdf2455`; CI `#470` / `36099791355`. Incident tracking is append-only, redacted, deduplicated and evidence-resolved, with no runtime/code mutation authority.

---

# Current Next Step

Implement **Milestone 7 Slice 0B — sanitized Sentinel MCP/API exposure** only. Resolve a registered workspace by opaque ID, refresh Sentinel observations from its durable task/event history, and return bounded incident views through a read-only MCP tool. Do not expose canonical workspace paths, raw event payloads, credentials or runtime/session secrets. Do not add process control, automatic restarts, safety-policy mutation, or code mutation. Cloud tests first; no live shared-runtime writes.

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
