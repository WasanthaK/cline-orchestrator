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
15. **Delegation is not authority.** Native agent spawning, teams, plugins, runtime extensions and extra executors remain disabled unless a separately reviewed adapter proves that every side effect still traverses the current owner-targeted safe-executor boundary. A config/tool/executor drift toward a delegated execution surface must fail closed. Future concurrent write adapters must additionally validate the current fenced workspace lease before every write-capable side effect.

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

Evidence: key closure `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345`.

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

Evidence: through `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506`.

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

Evidence: key closure `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260` / `35604869492`.

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
- Gateway restart revalidates authority/diff/checkpoint evidence, discards stale owner identity, creates a durable handoff and replacement owner session; unsafe or unsupported states fail closed.
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

Evidence:
- Registry/plan boundary through `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; CI `#295`.
- Policy/executor boundary through `46da20d18cd703018c54207258d4fb2422e71eeb`; CI `#311/#312`.
- Hub runtime/safety wiring through `32c057d30bc70533233477e87f7e01ec09b2e04a`; CI `#329/#330`.
- Machine MCP through `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; CI `#351/#352`.
- Restart reconciliation `8b6bc285e7a79a88576babcd62716cf09d2bff97`; CI `#385/#386`.
- Explicit-endpoint Hub auth handoff `99ff5d0ffccda2f531aadd0c95abf19314f89138`; smoke test `182705ab6540fa4e339b304679cd150d7aacc8e8`; CI `#426` / `36071434059`.
- Dual pinned Core launcher shims `318919d42c2085207e228574bda272bd4d2b152a` + tests `e73e02e3fb7808f37df07241e5ab1309892f6b9a`; CI `#430`.
- Disposable Git `core.autocrlf=false` isolation `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d` + regression `c1c714457b9930b8a10d3321d2e0972cbdca78f3`; CI `#438`.

## Physical owner-loss closure

The first owner reached `running`, `runCount=1`, `sessionGeneration=1` with a usable checkpoint. Only the isolated owner process was terminated. Restart reconciliation created a durable handoff and replacement session generation 2; the recovered task completed, validation passed, diff safety passed, and rollback returned `rolled_back`.

A final LF/CRLF byte assertion differed after Windows checkout, but production rollback had already verified the restored Git fingerprint against the pre-run checkpoint. The disposable proof repository now pins `core.autocrlf=false`; no duplicate heavy 27B rerun is required.

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

- [x] Durable append-only incident observations and deterministic deduplication.
- [x] Bounded/redacted incident evidence and fail-closed/human-action state.
- [x] Evidence-based resolution only from later durable task events.
- [x] Read-only registered-workspace incident query and `list_incidents` MCP exposure.
- [x] No process/runtime/code/policy mutation authority.

Evidence: core through `c4756161ee558cbfe05817f0f9901081fcdf2455`, CI `#470` / `36099791355`; read-only query/MCP through `9b34d88effae9317eb6f5504c58d64654abbd063`, CI `#480` / `36100230922`.

## Slice 1 — Durable Bounded Task Queue / DAG

- [x] Versioned workflow built only from already-approved durable tasks.
- [x] Workflow stores opaque identity/dependencies only; no paths, scope, commands or executable capability.
- [x] Duplicate/unknown dependencies and cycles fail closed.
- [x] Deterministic runnable-node selection.
- [x] Dependency success requires durable completion + required validation + diff safety + no human escalation.
- [x] Immutable atomic workflow store with graph revalidation on load.
- [x] Authority-free progression passes only opaque task IDs to an independently authority-enforcing starter.
- [x] Progression bounded; no hidden scope inheritance.

Evidence: DAG `9834e2f274227e4389498f5f2999ed9ac3ebffb7` + tests `aa3e5fe13f6d85cf7f6bd6b159c4aaccd7aa0e65`, CI `#486`; store `c564f83040a448bff669d100a5d4041464cc30d8` + tests `8be4ed2638489430bd088fe2273984c8152e4582`, CI `#490`; progression `0b136f8945be1e47218b00d47246a55de3acbef5` + tests `7e9282ee7e3e8e16363991339a42a28da555b918`, CI `#494` / `36104036934`.

## Slice 2 — Budgets + Checkpoint Policy

- [x] Explicit elapsed-time, model-request, token, tool, task-run, recovery and validation-repair ceilings.
- [x] Usage comes only from durable evidence; incomplete historical accounting blocks unattended starts rather than undercounting.
- [x] Preserved dependency checkpoint evidence is required.
- [x] Starter must use the existing task pre-run checkpoint mechanism.
- [x] Budget exhaustion/incomplete accounting prevents starter invocation.
- [x] Durable append-only budget decisions provide human/report evidence.
- [x] Budgeted progression starts at most one node per accounting pass.
- [x] Existing task checkpoint/rollback remains the only rollback authority.

Evidence: budget/checkpoint guard through `1d4acd984103bf3be6752edcc3aa1c88f4650780`, CI `#502`; journal `44989106bb022a157eab250b48c642457696b98d`; coordinator/tests through `5333385737810f935ead4092e1d29760a2cbac99`, CI `#508` / `36104849331`.

## Slice 3 — Human Attention + Report + Safe Resume

- [x] Workflow-level state derives from current durable task evidence rather than stored workflow position.
- [x] Pending human escalation yields `waiting_for_human` and prevents unattended progression.
- [x] Failed/aborted/validation-failed/rolled-back or missing completion safety evidence blocks the workflow.
- [x] Budget/accounting/checkpoint denials become durable attention state and are never automatically relaxed.
- [x] Bounded report exposes only sanitized opaque evidence.
- [x] Completed workflow requires durable successful completion evidence including required validation and diff safety for every node.
- [x] Restart reconciliation reloads immutable workflow plus current durable task/budget evidence on every pass.
- [x] Active tasks are never replayed after restart; human-blocked/terminal-failed workflows do not start stale candidates.
- [x] Budgets/checkpoints are re-evaluated after restart before any new start.
- [x] Completed workflows return a final report and start nothing.

Evidence: report `9c5f74053a09ccafe9b548766d241c62b682614f`, tests `01de3fd211e86efe91708bf990acf75cf2ecd359`; safe restart `3815abb742efc92b8390a19e7e00f226efc06d8e`, tests `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI `#518` / `36105316586`.

## Status

**COMPLETE — bounded unattended workflows, fail-closed budgets/checkpoints, reactive Sentinel visibility, human pause, sanitized reporting and restart-safe progression are cloud-tested.**

---

# Milestone 8 — Advanced UI / Multi-worker

## Objective

Improve operator visibility and, only while the single-worker safety boundary remains authoritative, add optional specialist/multi-worker coordination without converting worker count into broader authority.

## Slice 1 — Read-only Orchestration Dashboard Contract

- [x] Sanitized dashboard snapshot from existing task/workflow/Sentinel/supervisor evidence.
- [x] Projects/workspaces/tasks/workflows, status, budgets, attention/incidents and bounded usage summaries without raw paths, credentials, model output or private checkpoint/session state.
- [x] Read-only only; no generic filesystem/shell/Hub/process controls.
- [x] Existing sanitized service/report views reused rather than bypassed.
- [x] Deterministic limits/truncation and explicit stale/unavailable metadata.
- [x] Cloud tests cover redaction, bounded sizes, ordering, stale/unavailable evidence, error sanitization and invalid counters.

Evidence: dashboard `12a384c7033517c3922f6514844d6bb08c45a95c`; metadata hardening `88d59d6f85edb52a1bd736c29865f159656c2687`, CI `#524` / `36107007328`; acceptance tests `349c8f0c9fc6147b6f3fed55ca17f9688d0f3324`, CI `#526` / `36107456324`.

## Slice 2 — Explicit Specialist Handoffs

- [x] Bounded planner/implementation/reviewer roles are instruction/evidence roles, not independent machine authorities.
- [x] Handoff binds to independently approved task/Safety Plan/project/workspace/profile/worker identity and revalidates current binding before append.
- [x] Sequential transitions only: planner -> implementation -> reviewer, with reviewer -> implementation for bounded repair; no concurrent writes.
- [x] Durable append-only provenance with chain validation, tamper rejection and opaque-ID traversal protection.
- [x] Handoffs grant no machine/write authority and carry no raw path, goal, command, model output, Hub/session identity or credentials.
- [x] Stale Safety Plan, worker, registry/profile/policy or path authority fails closed before persistence.

Evidence: contract `0ad537276734811aa76d25aef2abce19f3790f49`; tests through `d5563097594290b867da8102847707cd411b50d0`, CI `#534` / `36108097496`; current-authority service `18dd9dcd3d8d629eced5e37e44e20ce9c6330044`; service tests through `a160350ee51436fb8de03b6cfe61e9463c5218fc`, CI `#540` / `36108515738`.

## Slice 3 — Multi-worker Scheduling / UI

- [x] Explicit workspace locking and conflict policy.
- [x] Bounded concurrency budgets.
- [x] Rich VS Code/web operator visualization for task/event/usage/incident/handoff state.
- [x] No team/subagent feature may silently bypass existing owner-targeted safety executors.

### Slice 3A — Workspace locking/conflict policy

Evidence:
- Writer lock/fencing contract `2d27c655b59af05c345fd3d59f2cc484f67e34e6`; tests `d84253a8702e07d5bf2db7b622ac34d7e8a309f1`.
- Durable single-gateway store `1c3ed32b9ea2806308bf35f65ad1f7e3178f7303`; persistence/concurrency/restart/corruption tests `d7c6a757384aaeffb3b1847eae8f4595df9a3f6a`; CI `#551` / `36110515174`.

Lock records are coordination-only: opaque workspace/task/owner/lease/fence identity, no task/filesystem authority. Current serialization is one gateway Node process; distributed scheduling needs a separately reviewed fencing backend.

### Slice 3B — Bounded concurrency budgets/scheduler

Evidence:
- Concurrency budget `6c266ac80ba2beddeb78f060fb0f824326567b85`; corrected tests `fb3e2bebfae6dd00984f0cf4fe1317f5941e0784`; CI `#559` / `36111154835`.
- Lease renewal `e4eac8143ab21aebd0695c56055c6182e03d961d`; live-lock enumeration/store integration `c3aed67a26d7d378e83cc2f3a75e31d34e399f4f`; tests `480b91880c1a527b9cd3952c9f384666cd6f8995`.
- Scheduler `1fe7e0a9e972007a0a05762936f1ab93ded8ac14`; scheduler tests `75efcd4230a31a6c9670d467d0db289b828b14b9`; CI `#569` / `36111750951`.

Admission is single-gateway serialized, capacity comes from current durable live leases, one writer per workspace remains fixed, authority is revalidated before and after acquisition, lease heartbeat/fencing covers worker lifetime, and the trusted runner must validate current lease immediately before write-capable side effects. Existing unattended workflow accounting still starts at most one node per durable usage snapshot. The scheduler is not wired into the live machine runtime.

### Slice 3C — Rich operator visualization

Evidence:
- Sanitized read-only operator view model `8b1c96107b12616104384fbf87c25a36a6cfcd29`; corrected acceptance tests through `6bc5c7744675f9534ba383d8b2d56810673901e0`; CI `36112455733`, success.
- Passive static HTML renderer `8f75b891803ff4959b67d4ed6f2f92925c8cdb8a`; renderer tests/fix through `ed3c428860e0e34acaa63b861b627cffafb63bda`; CI `#583` / `36112658367`, success.

The view model is explicitly `readOnly: true` with no actions. It exposes bounded health, task/workflow/incident/handoff/concurrency summaries from sanitized evidence while omitting Safety Plan/profile/owner/lease/fence secrets, raw paths, validation commands, Hub/checkpoint/session internals and model output. The renderer escapes content, emits no controls/scripts/network surface, and uses a restrictive CSP suitable for a passive browser/VS Code webview.

### Slice 3D — Owner-targeted delegation boundary

Evidence:
- Fail-closed Hub safety invariant `744fc21566e3e2352bb4317f5ad88bd4c2788555`.
- Acceptance tests `108b7c74ab220e2678ca522e12bf408bc266ba0a`; CI `#588` / `36114475941`, success.

The invariant runs during every first-pilot Hub safety contribution construction and rejects any configuration that enables native spawn/agent teams, plugins, runtime config extensions, non-default-deny tools, or any executor beyond the reviewed owner-targeted `readFile`/`search`/`editor`/`applyPatch` set. Tests deliberately inject spawn, teams, plugin, extra-tool and extra-executor drift and require fail-closed rejection. Existing Hub integration tests also prove ClineRunner passes the disabled spawn/team/plugin configuration, owner `beforeTool` hook and exact safe executor set into the runtime session.

This does **not** enable subagents, teams, provider-owned execution or live concurrent writes. Any future delegated or concurrent write adapter requires a separate review and, for concurrent writes, current fenced-lease validation before every write-capable side effect.

## Status

**COMPLETE — dashboard, specialist handoffs, workspace locking, bounded cross-workspace scheduler contract, rich passive operator visualization, and the owner-targeted no-bypass invariant are cloud-tested. Live concurrent machine-runtime writes and native team/subagent execution remain intentionally disabled.**

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
| Rich passive operator visualization | **Complete / cloud tested** |
| Owner-targeted team/subagent no-bypass invariant | **Complete / cloud tested** |
| Milestone 8 advanced UI / multi-worker safety contract | **COMPLETE** |
| Concurrent live machine-runtime orchestration | Not enabled |
| Native team/subagent execution | Not enabled |

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
23. Dashboard/operator UI remains a presentation/query layer; UI convenience cannot become a shortcut around MCP/service safety boundaries.
24. Specialist handoffs carry provenance/evidence only and are revalidated against current task authority on every durable append; they cannot preserve stale scope or worker identity.
25. Live concurrent machine-runtime writes remain disabled. A future live adapter must keep owner-targeted safe executors authoritative and validate the current fenced lease before every write-capable side effect.
26. Durable workspace locks and concurrency admission are single-gateway-process primitives. Multiple independent gateway processes require a separately reviewed distributed fencing backend and must fail closed until then.
27. A lease heartbeat failure aborts the scheduler lease session, but trusted worker adapters must honor the abort signal and validate current lease state before every coordinated side effect; lease possession alone never authorizes a write.
28. The owner-targeted Hub invariant protects the current first-pilot surface from silent config/tool/executor drift. It is not permission to enable native teams/subagents; any such feature requires a separately reviewed adapter and new acceptance evidence.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–5.** Foundation, reversible editing, context durability, project memory, machine MCP/Hub shared runtime and physical safety acceptance.
2. **COMPLETE — Milestone 6.** Supervisor contract, Planner, Reviewer, durable decisions and human escalation.
3. **COMPLETE — Milestone 7.** Sentinel, durable DAG, bounded automatic progression, budgets/checkpoints, human pause, sanitized report and restart-safe unattended execution.
4. **COMPLETE — Milestone 8 Slice 1.** Read-only orchestration dashboard contract.
5. **COMPLETE — Milestone 8 Slice 2.** Sequential specialist handoff.
6. **COMPLETE — Milestone 8 Slice 3A.** Workspace locking/conflict contract; CI `#551`.
7. **COMPLETE — Milestone 8 Slice 3B.** Bounded concurrency budgets/scheduler contract; CI `#559` and `#569`; live shared-runtime concurrency not enabled.
8. **COMPLETE — Milestone 8 Slice 3C.** Read-only operator view model plus passive browser/VS Code HTML renderer; CI `36112455733` and `#583` / `36112658367`.
9. **COMPLETE — Milestone 8 Slice 3D.** Owner-targeted no-bypass invariant for native spawn/teams/plugins/extra tools/executors; CI `#588` / `36114475941`.
10. **GATED / NOT AUTHORIZED — any live concurrent machine-runtime adapter, native team/subagent execution, distributed scheduler, UI write action, push/deploy/destructive Git, secret access, external-network mutation, or system change.** Such work requires a new explicitly reviewed plan and any required user authorization before implementation/proof.

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 6 COMPLETE — Planner, Reviewer and durable supervisor decisions cloud-tested through CI `#462`.
- 2026-09-25: Sentinel incident/read-only MCP slices completed through CI `#480`.
- 2026-09-25: Unattended DAG/store/progression completed through CI `#494`.
- 2026-09-25: Unattended budgets/checkpoint gating completed through CI `#508`.
- 2026-09-25: Human attention/report/restart closure completed through CI `#518` / `36105316586`.
- 2026-09-25: **Milestone 7 COMPLETE.** Unattended progression remains task-authority bounded and restart-safe, with durable reactive incident visibility.
- 2026-09-25: Milestone 8 Slice 1 dashboard completed through CI `#526` / `36107456324`.
- 2026-09-25: Milestone 8 Slice 2 sequential specialist handoff completed through CI `#540` / `36108515738`.
- 2026-09-25: Milestone 8 Slice 3A workspace locking/fencing completed through CI `#551` / `36110515174`.
- 2026-09-25: Milestone 8 Slice 3B bounded concurrency/scheduler contract completed through CI `#569` / `36111750951`; live concurrency remains disabled.
- 2026-09-25: Milestone 8 Slice 3C operator view model and passive renderer completed through `8b1c96107b12616104384fbf87c25a36a6cfcd29`, `8f75b891803ff4959b67d4ed6f2f92925c8cdb8a`, tests/fixes through `ed3c428860e0e34acaa63b861b627cffafb63bda`; CI `36112455733` and `#583` / `36112658367` passed.
- 2026-09-25: Milestone 8 Slice 3D owner-targeted delegation boundary completed with invariant `744fc21566e3e2352bb4317f5ad88bd4c2788555`, tests `108b7c74ab220e2678ca522e12bf408bc266ba0a`; CI `#588` / `36114475941` passed.
- 2026-09-25: **Milestone 8 COMPLETE at the cloud-tested contract/UI level.** Live concurrent writes, native teams/subagents and distributed scheduling remain intentionally disabled and are not implied by milestone completion.

---

# Current Next Step

**No further implementation item is authorized by this master plan.** Preserve the current safe state: live concurrent machine-runtime writes and native team/subagent execution remain disabled. Before enabling either, create a new explicitly reviewed milestone/adapter plan that keeps owner-targeted safe executors authoritative, requires current fenced-lease validation before every concurrent write-capable side effect, defines disposable/isolation proof, and obtains explicit authorization for any shared-runtime mutation.

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
