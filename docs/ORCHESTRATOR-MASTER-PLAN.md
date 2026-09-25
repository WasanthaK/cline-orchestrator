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

The system should support long-running and unattended coding work while preserving human control, reversible workspace changes, durable project memory, bounded model context, fail-closed authority, reactive incident visibility, and evidence-based completion.

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
9. **Sentinel is observational.** Incident detection/resolution evidence never grants execution authority or process-control privileges.
10. **Workflow ordering is not workflow authority.** A DAG may coordinate independently approved tasks, but cannot grant paths, commands, worker identity, model capabilities, or Safety Plan scope. Automatic progression may pass only an opaque task ID to a starter that independently revalidates the task's existing authority.
11. **Unattended budgets fail closed.** Missing historical usage evidence, exhausted limits, missing checkpoint evidence, or an untrusted starter checkpoint mechanism prevents another automatic node start; limits are never silently increased.
12. **Workflow restart never replays stale position.** Resume reloads the immutable workflow plus current durable task/budget evidence, then selects only still-`created` nodes; active, terminal, escalated or unsafe nodes are never replayed from workflow state alone.
13. **Specialist handoff is provenance, not authority.** A handoff can identify the next bounded role and durable evidence, but it grants no machine/write authority and cannot keep stale task/Safety Plan authority alive.
14. **Concurrency admission is coordination, not authority.** A writer slot, lock claim, lease renewal or scheduler decision never grants task/Safety Plan/filesystem authority; every admitted writer must independently revalidate current durable authority before acquisition and again immediately before execution.

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
- Restart reconciliation `8b6bc285e7a79a88576babcd62716cf09d2bff97`; CI `#385/#386`.
- Explicit-endpoint Hub auth handoff `99ff5d0ffccda2f531aadd0c95abf19314f89138`; smoke test `182705ab6540fa4e339b304679cd150d7aacc8e8`; CI `#426` / `36071434059`.
- Dual pinned Core launcher shims `318919d42c2085207e228574bda272bd4d2b152a` + tests `e73e02e3fb7808f37df07241e5ab1309892f6b9a`; CI `#430`.
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

## Acceptance

- [x] Supervisor task schema and bounded instructions.
- [x] Planner bounded criteria/proposed validation.
- [x] Reviewer sanitized evidence + bounded repairs.
- [x] Reviewer cannot bypass safety/completion gates.
- [x] Durable decisions + human escalation.

Evidence:
- Supervisor task contract through `d8a064aa0ec6328c69c390e577fb4637af7509f9`; CI `#359/#360`.
- Planner through `5f83903b61494c458474d2ab3f2402101170a0c4`; CI `#448` / `36098312588`.
- Reviewer through `19024c79c178b9c9e58854065fa98d2d4a029cd1`; CI `#454` / `36098699621`.
- Durable decisions/human escalation through `ce0620427e821a66ffd64942720f2bc0b942b055`; CI `#462` / `36099296457`.

## Status

**COMPLETE**

---

# Milestone 7 — Unattended Execution + Reactive Operations

## Objective

Progress from supervised single-task execution to bounded unattended workflows, with reactive incident visibility before autonomy increases.

## Slice 0 — Orchestrator Sentinel

Tracked as GitHub issue **#2 — Add Orchestrator Sentinel reactive incident tracking**.

- [x] Durable append-only incident observations and deterministic deduplication.
- [x] Bounded/redacted incident evidence and fail-closed/human-action state.
- [x] Evidence-based resolution only from later durable task events.
- [x] Read-only registered-workspace incident query and `list_incidents` MCP exposure.
- [x] No process/runtime/code/policy mutation authority.

Evidence:
- Core through `c4756161ee558cbfe05817f0f9901081fcdf2455`; CI `#470` / `36099791355`.
- Read-only query/MCP through `9b34d88effae9317eb6f5504c58d64654abbd063`; CI `#480` / `36100230922`.

## Slice 1 — Durable Bounded Task Queue / DAG

- [x] Versioned workflow built only from already-approved durable tasks.
- [x] Workflow stores opaque identity/dependencies only; no paths, scope, commands or executable capability.
- [x] Duplicate/unknown dependencies and cycles fail closed.
- [x] Deterministic runnable-node selection.
- [x] Dependency success requires durable completion + required validation + diff safety + no human escalation.
- [x] Immutable atomic workflow store with graph revalidation on load.
- [x] Authority-free progression passes only opaque task IDs to an independently authority-enforcing starter.
- [x] Progression bounded; no hidden scope inheritance.

Evidence:
- DAG contract/selection `9834e2f274227e4389498f5f2999ed9ac3ebffb7` + tests `aa3e5fe13f6d85cf7f6bd6b159c4aaccd7aa0e65`; CI `#486` / `36103577443`.
- Durable store `c564f83040a448bff669d100a5d4041464cc30d8` + tests `8be4ed2638489430bd088fe2273984c8152e4582`; CI `#490` / `36103856012`.
- Progression coordinator `0b136f8945be1e47218b00d47246a55de3acbef5` + tests `7e9282ee7e3e8e16363991339a42a28da555b918`; CI `#494` / `36104036934`.

## Slice 2 — Budgets + Checkpoint Policy

- [x] Explicit elapsed-time, model-request, token, tool, task-run, recovery and validation-repair ceilings.
- [x] Usage comes only from durable evidence; incomplete historical accounting blocks unattended starts rather than undercounting.
- [x] Preserved dependency checkpoint evidence is required.
- [x] Starter must use the existing task pre-run checkpoint mechanism.
- [x] Budget exhaustion/incomplete accounting prevents starter invocation.
- [x] Durable append-only budget decisions provide human/report evidence.
- [x] Budgeted progression starts at most one node per accounting pass.
- [x] Existing task checkpoint/rollback remains the only rollback authority.

Evidence:
- Budget/checkpoint guard through `1d4acd984103bf3be6752edcc3aa1c88f4650780`; CI `#502` / `36104641333`.
- Durable decision journal `44989106bb022a157eab250b48c642457696b98d`.
- Budget-gated coordinator/tests through `5333385737810f935ead4092e1d29760a2cbac99`; CI `#508` / `36104849331`.

## Slice 3 — Human Attention + Report + Safe Resume

- [x] Workflow-level state is derived from current durable task evidence rather than stored workflow position.
- [x] Pending human escalation yields `waiting_for_human` and prevents unattended progression.
- [x] Failed/aborted/validation-failed/rolled-back or missing completion safety evidence yields blocked workflow state.
- [x] Budget/accounting/checkpoint denials become durable attention state and are never automatically relaxed.
- [x] Bounded final/intermediate report exposes only opaque task/node IDs, lifecycle/safety booleans/counts, budget reasons and incident counts; raw goals, paths, commands/stdout, model output, session IDs, credentials, diff paths/summaries and checkpoint storage refs are omitted.
- [x] A completed workflow requires every node to have durable successful completion evidence including required validation and diff safety.
- [x] Restart reconciliation reloads immutable workflow plus current durable task/budget evidence on every pass.
- [x] Already-active tasks are never replayed after restart.
- [x] Human-blocked or terminal-failed workflows do not start other stale candidates.
- [x] Budgets/checkpoints are re-evaluated after restart before any new start.
- [x] Completed workflows return a final report and start nothing.

Evidence:
- Sanitized report contract `9c5f74053a09ccafe9b548766d241c62b682614f`; tests `01de3fd211e86efe91708bf990acf75cf2ecd359`.
- Safe restart reconciliation `3815abb742efc92b8390a19e7e00f226efc06d8e`; tests `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI `#518` / `36105316586`, success.

## Unattended execution acceptance

- [x] Sentinel durable incident model, deduplication, evidence resolution and sanitized MCP exposure.
- [x] Durable task queue/DAG, dependency validation and bounded automatic progression.
- [x] Time/token/request/repair budgets and checkpoint policy.
- [x] `waiting_for_human` integration and escalation rules for unattended work.
- [x] Final unattended-run report.
- [x] Safe resume after interruption.

## Status

**COMPLETE — bounded unattended workflows, fail-closed budgets/checkpoints, reactive Sentinel visibility, human pause, sanitized reporting and restart-safe progression are cloud-tested. No additional local-runtime proof is required at this stage.**

---

# Milestone 8 — Advanced UI / Multi-worker

## Objective

Improve operator visibility and, only after the single-worker safety boundary remains authoritative, add optional specialist/multi-worker orchestration without converting worker count into broader authority.

## Candidate slices

### Slice 1 — Read-only Orchestration Dashboard Contract

- [x] Define a sanitized dashboard snapshot from existing task/workflow/Sentinel/supervisor evidence.
- [x] Show projects/workspaces/tasks/workflows, status, budgets, attention/incidents and bounded usage summaries without raw paths, credentials, model output or private checkpoint/session state.
- [x] Keep dashboard read-only initially; no generic filesystem/shell/Hub/process controls.
- [x] Reuse existing sanitized service/report views rather than bypassing authority boundaries.
- [x] Deterministic collection limits/truncation metadata and explicit stale/unavailable source metadata.
- [x] Cloud tests cover redaction, bounded result sizes, deterministic ordering, stale/unavailable evidence, error-code sanitization and invalid counter handling.

Evidence:
- Dashboard contract `12a384c7033517c3922f6514844d6bb08c45a95c`.
- Source metadata hardening `88d59d6f85edb52a1bd736c29865f159656c2687`; CI `#524` / `36107007328`.
- Acceptance tests `349c8f0c9fc6147b6f3fed55ca17f9688d0f3324`; CI `#526` / `36107456324`, success.

### Slice 2 — Explicit Specialist Handoffs

- [x] Define bounded planner/implementation/reviewer specialist roles as instruction/evidence roles, not independent machine authorities.
- [x] Every durable handoff is bound to the independently approved task/Safety Plan/project/workspace/profile/worker identity, and the service revalidates the current task binding before append.
- [x] Sequential transitions only: planner -> implementation -> reviewer, with reviewer -> implementation for bounded repair; no concurrent writes.
- [x] Durable append-only handoff provenance/evidence journal with chain validation, tamper rejection and opaque-ID traversal protection.
- [x] Handoffs explicitly grant no machine/write authority and carry no raw workspace path, task goal, path scope, validation commands, model output, Hub/session identity or credentials.
- [x] Stale Safety Plan, worker, registry/profile/policy or allowed/protected path authority fails closed before handoff persistence.

Evidence:
- Core handoff contract `0ad537276734811aa76d25aef2abce19f3790f49`.
- Core tests corrected through `d5563097594290b867da8102847707cd411b50d0`; CI `#534` / `36108097496`, success.
- Current durable-task authority revalidation service `18dd9dcd3d8d629eced5e37e44e20ce9c6330044`.
- Service tests `493ff844bc957960d628ea9f8b1377e8c4646bed`, with test-wording correction `a160350ee51436fb8de03b6cfe61e9463c5218fc`; CI `#540` / `36108515738`, success.

### Slice 3 — Multi-worker Scheduling / UI

- [x] Explicit workspace locking and conflict policy.
- [x] Bounded concurrency budgets.
- [ ] Rich VS Code/web operator visualization for task/event/usage/incident/handoff state.
- [ ] No team/subagent feature may silently bypass existing owner-targeted safety executors.

Evidence:
- Workspace writer lock/fencing contract `2d27c655b59af05c345fd3d59f2cc484f67e34e6`; contract tests `d84253a8702e07d5bf2db7b622ac34d7e8a309f1`.
- Durable single-gateway lock store `1c3ed32b9ea2806308bf35f65ad1f7e3178f7303`; persistence/concurrency/restart/corruption acceptance tests `d7c6a757384aaeffb3b1847eae8f4595df9a3f6a`; CI `#551` / `36110515174`, success.
- Lock records are coordination-only: they persist opaque workspace/task/owner/lease/fence identity, grant neither task nor filesystem authority, and require independently revalidated task/Safety Plan authority before any future write-capable start.
- Concurrency budget contract `6c266ac80ba2beddeb78f060fb0f824326567b85`; corrected acceptance tests `fb3e2bebfae6dd00984f0cf4fe1317f5941e0784`; CI `#559` / `36111154835`, success.
- Lease renewal `e4eac8143ab21aebd0695c56055c6182e03d961d`, live-lock enumeration/store integration `c3aed67a26d7d378e83cc2f3a75e31d34e399f4f`, and renewal/enumeration tests `480b91880c1a527b9cd3952c9f384666cd6f8995` close the long-running writer expiry gap.
- Bounded writer scheduler `1fe7e0a9e972007a0a05762936f1ab93ded8ac14`; scheduler acceptance tests `75efcd4230a31a6c9670d467d0db289b828b14b9`; CI `#569` / `36111750951`, success.
- Scheduler admission is single-gateway serialized and derives global capacity from current durable live leases. It admits at most the configured total writers/starts, never more than one writer per workspace, revalidates task authority before acquisition and after acquisition, keeps fenced leases renewed for the full worker lifecycle, and requires the trusted runner to validate the current lease immediately before write-capable side effects.
- Existing unattended workflow accounting remains unchanged: each workflow still starts at most one node per durable usage snapshot. The concurrency scheduler is an isolated trusted integration contract for independently approved cross-workspace candidates; it is not wired into the live machine runtime yet.
- Current lock/scheduler serialization is scoped to one gateway Node process. Multi-process/distributed scheduler ownership remains unsupported until a separately reviewed fencing backend exists.

## Status

**IN PROGRESS — Slices 1 and 2, Slice 3A workspace locking, and Slice 3B bounded concurrency budgets/scheduler contract are complete and cloud-tested. Live machine-runtime concurrent execution remains disabled. The next implementation item is richer operator visualization over existing sanitized evidence.**

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
| Supervisor Planner/Reviewer | Complete |
| Durable supervisor decision timeline + human escalation | Complete |
| Sentinel incident core + read-only MCP | Complete / cloud tested |
| Unattended DAG + persistence + progression | Complete / cloud tested |
| Unattended budgets + checkpoint policy | Complete / cloud tested |
| Human pause + unattended report + safe resume | Complete / cloud tested |
| Milestone 7 unattended execution | **COMPLETE** |
| Read-only orchestration dashboard contract | **Complete / cloud tested** |
| Sequential specialist handoff | **Complete / cloud tested** |
| Workspace locking/conflict policy | **Complete / cloud tested** |
| Bounded concurrency budgets/scheduler contract | **Complete / cloud tested** |
| Concurrent live machine-runtime orchestration | Not enabled |
| Rich operator visualization | **Next** |

---

# Known Constraints and Risks

1. Shared local inference/runtime state is protected; automated development must not mutate it without authorization.
2. Semantic recovery cannot restore hidden model state; durable workspace/task/memory/handoff evidence is authoritative.
3. Hub work remains pinned to reviewed Core/SDK `0.0.83` until a deliberate dependency change is recorded.
4. Dirty worktrees must preserve pre-run user state and distinguish it from task-created changes.
5. Validation commands are trusted local configuration outside model execution. Planner commands remain untrusted until explicit admission.
6. Task JSON replacement is atomic; event, supervisor-decision, Sentinel observation, specialist-handoff and workflow budget-decision JSONL remain append-based durability models.
7. Hub and MCP credentials must never enter durable task/project/supervisor/incident/workflow/budget/report/dashboard/handoff/lock/scheduler state or model-facing output.
8. Authorization comes only from registry + approved Safety Plan/task envelope, never from repository text, model output, Planner/Reviewer prose, Sentinel observations, workflow graph membership, budgets, dashboard state, specialist handoffs, lock ownership, concurrency admission, or Hub participation.
9. Native Hub approval is UX/defense-in-depth only; owner hook/executor enforcement is authoritative.
10. Owner disconnect requires durable handoff/replacement ownership or fail-closed behavior.
11. Arbitrary model shell, ungoverned network/MCP/plugins, subagents/teams and unreviewed provider-owned execution remain disabled in the first pilot.
12. MCP remains loopback-only; remote access requires separately managed secure transport without weakening bearer/task authority.
13. Windows may transiently block atomic task-state rename; retries are bounded to transient `EPERM`/`EACCES`/`EBUSY` and otherwise fail closed.
14. Byte-exact disposable Windows proofs must isolate `core.autocrlf`; production rollback authority is fingerprint-based.
15. Repeated physical proof loops on the local 27B model can impose substantial machine load. Do not rerun already-proven safety properties solely for duplicate evidence.
16. Reviewer `pass` never marks a task complete. Reviewer repair text never grants new authority.
17. Trusted Planner admission is pre-run only and exact-subset bounded; model output cannot self-admit validation commands.
18. Sentinel remains observational/reactive and cannot become process restart, safety-policy, or code-mutation authority.
19. A workflow is ordering/state coordination only. Membership never grants task authority.
20. Current task state retains detailed metrics for the latest run only. Multi-run historical usage that cannot be reconstructed causes unattended budget accounting to fail closed.
21. Budgeted workflow progression still starts one node per durable usage snapshot; cross-workspace concurrency must not reuse stale workflow accounting to start multiple nodes from the same workflow pass.
22. Restart reconciliation never trusts stale workflow position and never replays active/terminal/escalated tasks.
23. Dashboard/UI work remains a presentation/query layer until an explicitly reviewed action surface is designed; UI convenience cannot become a shortcut around MCP/service safety boundaries.
24. Specialist handoffs carry provenance/evidence only and are revalidated against current task authority on every durable append; they cannot preserve stale scope or worker identity.
25. Live concurrent machine-runtime writes remain disabled. The scheduler contract is cloud-tested, but a future live adapter must keep existing owner-targeted safe executors authoritative and validate the current fenced lease before every write-capable side effect.
26. Durable workspace locks and concurrency admission are currently single-gateway-process primitives. Multiple independent gateway processes require a separately reviewed distributed fencing backend; unsupported multi-process scheduling must fail closed rather than infer shared capacity.
27. A lease heartbeat failure aborts the scheduler lease session, but trusted worker adapters must honor the abort signal and validate current lease state before every coordinated side effect; lease possession alone never authorizes a write.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–5.** Foundation, reversible editing, context durability, project memory, machine MCP/Hub shared runtime and physical safety acceptance.
2. **COMPLETE — Milestone 6.** Supervisor contract, Planner, Reviewer, durable decisions and human escalation.
3. **COMPLETE — Milestone 7.** Sentinel, durable DAG, bounded automatic progression, budgets/checkpoints, human pause, sanitized report and restart-safe unattended execution.
4. **COMPLETE — Milestone 8 Slice 1: read-only orchestration dashboard contract.**
5. **COMPLETE — Milestone 8 Slice 2: sequential specialist handoff.**
   - planner/implementation/reviewer handoffs are sequential and provenance-only;
   - current durable Safety Plan/task binding is revalidated before persistence;
   - no machine/write/concurrent authority is granted by a handoff;
   - tampered, stale, cross-task, reordered or traversal-based handoffs fail closed;
   - CI `#534` and `#540` green.
6. **COMPLETE — Milestone 8 Slice 3A: workspace locking/conflict contract.**
   - opaque workspace/task/owner/lease/fence identities only;
   - one exclusive writer lease per workspace; observation requires no writer lease;
   - stale, expired, released or restarted-owner claims fail closed;
   - durable state is atomically persisted and malformed state never silently resets;
   - lock ownership grants no filesystem or task/Safety Plan authority;
   - competing acquisitions inside one gateway process deterministically admit one writer;
   - CI `#551` / `36110515174` green.
7. **COMPLETE — Milestone 8 Slice 3B: bounded concurrency budgets and scheduler contract.**
   - explicit bounded total writers and starts-per-pass; one writer per workspace remains fixed;
   - capacity derives from current durable live lock evidence and malformed coordination state fails closed;
   - live leases are renewable without changing lease/fence identity; old renewal claims become stale and expired leases cannot be resurrected;
   - task authority is revalidated before and after lock acquisition;
   - trusted worker lifetime is fenced and heartbeat-managed; lease validation remains required immediately before write-capable effects;
   - existing per-workflow unattended accounting still contributes at most one node per durable usage snapshot;
   - CI `#559` and `#569` green; no live shared-runtime concurrency proof performed.
8. **NEXT — Milestone 8 Slice 3C: richer operator visualization.**
   - build a VS Code/web presentation surface over the existing sanitized dashboard snapshot plus bounded incident/handoff/workflow evidence;
   - remain read-only initially; no raw filesystem/shell/Hub/process controls and no new write authority;
   - expose concurrency/lock state only through sanitized opaque summaries, not paths, credentials, lease secrets, model output or checkpoint/session internals;
   - preserve deterministic limits/truncation/staleness metadata and explicit unavailable/error states;
   - cloud-test view-model redaction, boundedness and deterministic ordering before any UI action surface is considered.
9. **LATER — explicit proof that no team/subagent integration can bypass owner-targeted safe executors, before enabling any such feature or live concurrent machine-runtime adapter.**

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 6 COMPLETE — Planner, Reviewer and durable supervisor decisions cloud-tested through CI `#462`.
- 2026-09-25: Sentinel incident/read-only MCP slices completed through CI `#480`.
- 2026-09-25: Unattended DAG/store/progression completed through CI `#494`.
- 2026-09-25: Unattended budgets/checkpoint gating completed through CI `#508`.
- 2026-09-25: Human attention/report/restart closure completed with report `9c5f74053a09ccafe9b548766d241c62b682614f`, tests `01de3fd211e86efe91708bf990acf75cf2ecd359`, restart reconciliation `3815abb742efc92b8390a19e7e00f226efc06d8e`, tests `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI `#518` / `36105316586` passed.
- 2026-09-25: **Milestone 7 COMPLETE.** Unattended progression remains task-authority bounded and restart-safe, with durable reactive incident visibility.
- 2026-09-25: Milestone 8 Slice 1 dashboard contract implemented through `12a384c7033517c3922f6514844d6bb08c45a95c`, metadata hardened by `88d59d6f85edb52a1bd736c29865f159656c2687`, and acceptance-tested by `349c8f0c9fc6147b6f3fed55ca17f9688d0f3324`; CI `#526` / `36107456324` passed.
- 2026-09-25: Milestone 8 Slice 2 sequential specialist handoff implemented through `0ad537276734811aa76d25aef2abce19f3790f49`, current-authority service `18dd9dcd3d8d629eced5e37e44e20ce9c6330044`, tests through `a160350ee51436fb8de03b6cfe61e9463c5218fc`; CI `#534` / `36108097496` and `#540` / `36108515738` passed.
- 2026-09-25: Milestone 8 Slice 3A workspace lock/fencing contract completed through `2d27c655b59af05c345fd3d59f2cc484f67e34e6`, tests `d84253a8702e07d5bf2db7b622ac34d7e8a309f1`, durable store `1c3ed32b9ea2806308bf35f65ad1f7e3178f7303`, and acceptance tests `d7c6a757384aaeffb3b1847eae8f4595df9a3f6a`; CI `#551` / `36110515174` passed.
- 2026-09-25: Milestone 8 Slice 3B bounded concurrency contract completed through `6c266ac80ba2beddeb78f060fb0f824326567b85`, tests `fb3e2bebfae6dd00984f0cf4fe1317f5941e0784`, lease renewal/live accounting through `e4eac8143ab21aebd0695c56055c6182e03d961d`, `c3aed67a26d7d378e83cc2f3a75e31d34e399f4f`, `480b91880c1a527b9cd3952c9f384666cd6f8995`, and scheduler contract/tests `1fe7e0a9e972007a0a05762936f1ab93ded8ac14` / `75efcd4230a31a6c9670d467d0db289b828b14b9`; CI `#559` / `36111154835` and `#569` / `36111750951` passed. Live machine-runtime concurrency remains disabled.

---

# Current Next Step

Begin **Milestone 8 Slice 3C — richer operator visualization**. Build a read-only VS Code/web-facing view model on top of the already-sanitized dashboard, workflow, incident, handoff and bounded concurrency evidence. Keep all authority boundaries unchanged: no raw paths, credentials, model output, checkpoint/session internals, generic filesystem/shell/Hub/process controls, or write-capable UI actions. Cloud tests first.

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
