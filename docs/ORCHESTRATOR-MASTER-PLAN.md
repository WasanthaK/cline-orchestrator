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
                Project / Workspace Registry
                           |
                           v
                     Safety Preview
                           |
                   Human authorization
                           |
                           v
                 ORCHESTRATOR CONTROL PLANE
             +-------------+--------------+
             |             |              |
          Planner       Reviewer       Sentinel
             |             |              |
             +-------------+--------------+
                           |
                     Workflow Engine
                    DAG + Budgets + Policy
                           |
                   Concurrency Scheduler
                           |
              +------------+------------+
              |            |            |
           Worker A      Worker B     Worker C
              |            |            |
              v            v            v
         Cline Hub     Cline Hub     Cline Hub
           owner         owner         owner
              |            |            |
              v            v            v
        Workspace A   Workspace B   Workspace C
              |            |            |
              +------------+------------+
                           |
                 validation / Git / evidence
                           |
                           v
                    Operator Console
```

The system should support long-running and unattended software-engineering work while preserving human control, reversible workspace changes, durable project memory, bounded model context, fail-closed authority, reactive incident visibility, evidence-based completion, safe parallelism, secure remote supervision, and explicit release/deployment authority.

The core invariant is:

> **ChatGPT decides what should be attempted. The orchestrator decides what is permitted. Cline performs only permitted work.**

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
16. **Remote access is transport, not authority.** Secure remote connectivity may carry requests and sanitized evidence but must not enlarge task, workspace, tool, command, release, secret or deployment authority.
17. **Release authority is separate from edit authority.** Code editing, commit, push, pull-request creation, merge and deployment are distinct capabilities and must be separately admitted.
18. **Distributed coordination requires real fencing.** A multi-gateway or multi-machine topology must not rely on single-process locking assumptions; split-brain writers must fail closed.
19. **A user-visible control never bypasses service policy.** Operator UI actions must invoke the same trusted orchestration services and authority checks as non-UI callers.
20. **Production readiness requires failure proof.** Features that increase autonomy, delegation, distribution or release power require deterministic failure/restart/chaos evidence before being considered complete.

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

# Milestone 9 — Controlled Live Multi-Workspace Runtime

## Objective

Turn the Milestone 8 concurrency/lease contracts into real orchestrator-managed parallel execution across independently registered workspaces without weakening task authority, Safety Plan enforcement, owner-targeted safe executors, checkpoint/rollback safety, or human escalation.

Native Cline teams, native subagents and provider-owned execution remain disabled in this milestone.

## Slice 9A — Lease-aware owner-targeted executor boundary

- [ ] Introduce a trusted runtime adapter that binds an admitted worker to the current durable task, Safety Plan, project/workspace/profile revision, owner identity and fenced workspace lease.
- [ ] Require current task/Safety Plan authority revalidation before worker acquisition and immediately before execution.
- [ ] Require current fenced-lease validation immediately before every write-capable `editor`/`applyPatch` side effect.
- [ ] Treat lease ownership as coordination only; a valid lease without valid task/Safety Plan authority must still fail closed.
- [ ] Lease loss, expiry, fence mismatch, authority revision or abort signal must prevent all subsequent writes by that worker.
- [ ] Reads remain bounded by existing registered workspace/Safety Plan policy and do not gain broader authority from lease possession.
- [ ] Cloud tests deliberately inject stale lease, stale fence, task revision drift, profile drift, Safety Plan drift and post-start lease loss.

## Slice 9B — Live scheduler/runtime integration

- [ ] Connect `writer-concurrency-scheduler` to orchestrator-owned Cline Hub sessions through the lease-aware trusted adapter.
- [ ] Enforce configurable total writer budget and one live writer per workspace.
- [ ] Permit concurrency only across distinct workspaces in the first live implementation.
- [ ] Every live writer uses a distinct orchestrator-owned owner session; no silent takeover of an existing VS Code-created write session.
- [ ] Scheduler admission continues to start only already-approved durable tasks and grants no new path/tool/command authority.
- [ ] Existing workflow budget/checkpoint accounting remains authoritative and may not be bypassed by concurrency.

## Slice 9C — Failure, restart and stale-writer safety

- [ ] Worker crash releases or expires coordination state without allowing stale writes after restart.
- [ ] Hub disconnect, owner loss and gateway restart recover through durable handoff/revalidation rather than stale session replay.
- [ ] Lease-heartbeat failure aborts the live worker adapter and transitions the task to a durable safe state.
- [ ] A stale/expired worker cannot resurrect or silently reacquire its prior fence/lease identity.
- [ ] Duplicate workers for one workspace cannot both pass immediate pre-write fencing checks.
- [ ] Restart reconciliation derives authority from current durable registry/task/Safety Plan/lease state, never cached scheduler position.

## Slice 9D — Disposable physical proof

- [ ] Use isolated disposable repositories/workspaces before shared development workspaces.
- [ ] Prove two independent workspaces can execute write tasks concurrently with separate leases and owner sessions.
- [ ] Prove same-workspace competing writer admission is denied.
- [ ] Prove forced lease loss during a task prevents later writes.
- [ ] Prove one worker failure does not corrupt or broaden authority of another worker.
- [ ] Prove validation, final diff safety and rollback independently for both concurrent tasks.
- [ ] Prove gateway restart/stale-worker behavior in the disposable environment.
- [ ] Any proof requiring mutation of the user's shared local Cline/Hub/VS Code runtime requires explicit user authorization immediately before that proof.

## Completion Gate

Milestone 9 is complete only when the orchestrator can safely run independent write-capable coding jobs concurrently on multiple registered workspaces, while a stale or unfenced worker is physically unable to perform a write through the trusted executor boundary.

## Status

**PLANNED — first future implementation milestone. Plan approved for inclusion on 2026-09-25; implementation has not started. Shared-runtime physical proof remains separately gated by explicit user authorization.**

---

# Milestone 10 — Interactive Operator Control Plane

## Objective

Evolve the passive operator visualization into a safe operational console without creating a privileged UI execution path.

## Acceptance

- [ ] Preserve read-only sanitized project/workspace/task/workflow/incident/handoff/concurrency views.
- [ ] Add bounded service-backed actions for pause, resume, abort, approve/reject human escalation, request review, retry admitted validation, rollback, workflow pause/resume and worker drain where supported.
- [ ] Every UI action calls the same trusted orchestration service/policy boundary used by non-UI callers.
- [ ] No generic filesystem, shell, Hub, process, raw command or credential surface is exposed.
- [ ] Destructive/high-risk actions require explicit confirmation and durable audit evidence.
- [ ] UI state cannot grant authority, widen Safety Plans, edit policy, mint leases, enable tools or convert read-only views into direct machine access.
- [ ] CSRF/request forgery, stale action, replay, authorization drift and race-condition tests fail closed.
- [ ] VS Code/web rendering keeps CSP/network restrictions appropriate to the new narrowly-scoped action transport.

## Completion Gate

A human can operate normal orchestrator lifecycle and escalation flows from the console without requiring CLI access and without any UI shortcut around task/service safety boundaries.

## Status

**PLANNED**

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

## Objective

Allow ChatGPT to supervise the local orchestrator from any conversation, with or without a ChatGPT Project, through authenticated secure transport while retaining the same registry, Safety Preview and task-level authority model.

## Acceptance

- [ ] Define remote transport threat model and trust boundaries before implementation.
- [ ] Preserve explicit machine-local project/workspace registration; raw paths or fuzzy names never self-authorize.
- [ ] Use authenticated, revocable, short-lived remote sessions/device identity.
- [ ] Keep Hub/Cline credentials local and never expose them through ChatGPT-facing transport.
- [ ] Remote callers receive opaque registered IDs and sanitized evidence only.
- [ ] A new write-capable task still requires Safety Preview/approved task envelope and cannot be authorized merely by transport authentication.
- [ ] Implement replay protection, rate limits, audit evidence and explicit connection revocation.
- [ ] Remote disconnect/reconnect cannot revive stale task/worker authority.
- [ ] Security tests cover stolen/replayed token, wrong device, wrong workspace ID, expired session and stale Safety Plan.

## Completion Gate

An authorized user can safely start/supervise registered local project work from ChatGPT away from the workstation without exposing machine-level credentials or widening task authority.

## Status

**PLANNED**

---

# Milestone 12 — Distributed / Multi-Machine Orchestration

## Objective

Scale from a single gateway process/machine to multiple orchestrator workers or machines while preserving one-writer-per-workspace safety through a separately reviewed distributed fencing backend.

## Acceptance

- [ ] Select and document a transactional lease/fencing backend suitable for multi-gateway ownership.
- [ ] Replace single-process lock assumptions with monotonic fencing semantics that stale processes cannot bypass.
- [ ] Add distributed worker registry, heartbeats, ownership transfer and durable task/event coordination.
- [ ] Preserve current task/Safety Plan authority checks independently of distributed lease admission.
- [ ] Version worker/control-plane protocol and reject incompatible peers safely.
- [ ] Prove network partition cannot produce two successful write-authorized owners for one workspace.
- [ ] Prove machine crash, scheduler crash, clock skew, duplicate worker and control-plane restart fail closed or recover deterministically.
- [ ] Multi-machine execution must not imply access to workspaces not explicitly registered on a worker/machine.

## Completion Gate

Multiple machines may safely contribute workers to one orchestration control plane without split-brain writes or authority leakage.

## Status

**PLANNED**

---

# Milestone 13 — Advanced Multi-Agent Delegation

## Objective

Add bounded specialist collaboration only after live parallel workers and distributed fencing boundaries are proven. Delegation remains a planning/evidence mechanism unless each machine side effect traverses the existing trusted executor boundary.

## Acceptance

- [ ] Define explicit specialist roles such as architect, implementer, test specialist and reviewer with bounded context/tool surfaces.
- [ ] Each delegated role binds to a current durable task/Safety Plan and carries provenance, not inherited machine authority.
- [ ] A specialist requiring machine work submits an action/task proposal through the orchestrator rather than directly gaining shell/filesystem authority.
- [ ] Native Cline team/subagent support remains disabled until a reviewed adapter proves all side effects route through current owner-targeted executors and, for writes, current fenced-lease checks.
- [ ] Child/delegated work cannot expand scope, validation commands, plugins, MCP/network tools, secret access or release authority.
- [ ] Delegation depth/count/token/tool/time budgets are explicit and fail closed.
- [ ] Parent cancellation/authority revision invalidates delegated work safely.
- [ ] Tests prove a delegated agent cannot mint authority, spawn an unreviewed executor, bypass tool default-deny or retain stale owner/lease authority.

## Completion Gate

Multiple AI specialists can collaborate on one approved engineering objective without creating a second machine-authorization path.

## Status

**PLANNED**

---

# Milestone 14 — Autonomous Software-Engineering Loops

## Objective

Use the proven task/workflow/supervision infrastructure to support repeatable engineering loops such as issue-to-change, CI-failure repair proposals, dependency maintenance and long-running milestone execution.

## Acceptance

- [ ] GitHub issue/work-item ingestion creates proposals only; external text never grants task authority.
- [ ] Planner may decompose an approved objective into independently authorized/bounded tasks and dependencies.
- [ ] CI failure observations may trigger diagnosis/proposal but cannot self-authorize repairs beyond existing scope.
- [ ] Dependency-update workflows use isolated changes, validation, review and rollback gates.
- [ ] Long-running project execution uses durable project memory/context rotation rather than unbounded conversation context.
- [ ] Workflow-level completion requires all child task validation/diff-safety evidence and required human decisions.
- [ ] Reactive automation respects global/task/workflow budgets and cannot loop indefinitely.
- [ ] Automatic follow-up never silently upgrades edit, network, release or deployment authority.

## Completion Gate

The orchestrator can carry an approved software-engineering objective through decomposition, execution, validation, review and bounded repair over long periods without requiring one model conversation to retain the whole project.

## Status

**PLANNED**

---

# Milestone 15 — GitHub Delivery and Release Authority

## Objective

Introduce commit, push, pull-request, merge and deployment capabilities as separately reviewed authority classes rather than consequences of write access.

## Authority Model

```text
edit authority
    != commit authority
    != push authority
    != pull-request authority
    != merge authority
    != deployment authority
```

## Acceptance

- [ ] Define separate policy grants and audit evidence for commit, push, PR creation/update, merge and deployment.
- [ ] Default coding tasks remain unable to push/merge/deploy.
- [ ] Protected branches and destructive Git operations remain denied unless specifically authorized by policy/human action.
- [ ] PR creation uses checkpoint-relative validated diff evidence and sanitized task provenance.
- [ ] CI/status observation is read-only unless a separately authorized repair workflow is created.
- [ ] Merge requires configured human/policy gate; model review text alone cannot merge.
- [ ] Deployment requires explicit environment-specific authorization and cannot inherit from merge or edit authority.
- [ ] Rollback/recovery procedures are defined separately for source changes and deployed systems.

## Completion Gate

An approved task may progress through a controlled PR lifecycle, while each escalation from editing toward release remains separately visible, auditable and revocable.

## Status

**PLANNED**

---

# Milestone 16 — Production Security, Reliability and Observability

## Objective

Prove the system is resilient and operable under realistic failures and hostile inputs before product release.

## Security Acceptance

- [ ] Formal threat model covers prompt injection, repository instructions, connector abuse, replay, credential exposure, tool/plugin drift, dependency/supply-chain risk and privilege confusion.
- [ ] Credential storage/rotation/revocation is documented and tested.
- [ ] Audit evidence integrity and tamper detection are defined for security-relevant actions.
- [ ] Protocol inputs and persisted state have schema/version/migration validation.
- [ ] Dependency upgrade process preserves reviewed Cline/Core safety assumptions.

## Reliability Acceptance

- [ ] Durable store backup/recovery and migration strategy.
- [ ] Crash/restart recovery across gateway, worker, Hub, model endpoint and storage failures.
- [ ] Corrupt/incomplete state fails closed with actionable human evidence.
- [ ] Rolling-upgrade/version compatibility policy for workers/control plane.
- [ ] Bounded retry/backoff avoids recovery storms and duplicate side effects.

## Observability Acceptance

- [ ] Structured logs, metrics and traces for task/workflow/worker/lease/validation/recovery flows.
- [ ] Health, queue depth, latency, token/tool usage, failure class, lease contention and human-attention metrics.
- [ ] Sanitization prevents secrets/raw private state from leaking into telemetry.

## Chaos Acceptance

- [ ] Deterministically test worker kill, Hub loss, orchestrator restart, storage outage, model outage and network partition at critical execution points.
- [ ] Every chaos case either recovers from durable evidence or stops in a documented fail-closed/human state.

## Completion Gate

The orchestrator is operationally observable and survives representative failures without unsafe duplicate writes, lost rollback authority or silent authority expansion.

## Status

**PLANNED**

---

# Milestone 17 — Productization and Installation

## Objective

Turn the engineering system into an installable, supportable product with safe defaults and a clear first-run experience.

## Acceptance

- [ ] Supported installation/update/uninstall path for the target desktop/server environments.
- [ ] Detect/connect compatible Cline Hub generation without silently upgrading reviewed dependencies.
- [ ] First-run flow: register machine, add project, add workspace, select safety profile, run Safety Preview, connect ChatGPT, start first task.
- [ ] Provide safe built-in profiles such as observe-only, safe-editing, development, maintainer and separately gated release profiles.
- [ ] Configuration export/backup excludes credentials and machine secrets by default.
- [ ] Diagnostics bundle is sanitized and useful for support.
- [ ] Upgrade/migration path preserves durable tasks/projects/audit state or fails safely before mutation.
- [ ] Documentation clearly distinguishes task, edit, Git, remote and release authority.

## Completion Gate

A new user can install, configure and run a first safe task without hand-editing internal state or understanding the implementation architecture.

## Status

**PLANNED**

---

# Milestone 18 — Production Release

## Objective

Prove the complete end-to-end product lifecycle and declare the first production-ready release.

## End-to-End Acceptance

- [ ] ChatGPT request resolves only to an explicitly registered project/workspace.
- [ ] Safety Preview and human authorization create a bounded durable task/workflow.
- [ ] Planner/workflow decomposition preserves task authority boundaries.
- [ ] Multiple safe workers may execute concurrently only with current fencing and owner-targeted executor checks.
- [ ] Context rotation, owner loss, restart and model/runtime recovery preserve durable continuity.
- [ ] Validation, Reviewer, bounded repair and human escalation behave as designed.
- [ ] Completion requires validation + diff safety + required human/release evidence.
- [ ] PR/release operations use separately granted authority.
- [ ] Operator console and remote ChatGPT supervision cannot bypass service policy.
- [ ] Production security/reliability/chaos acceptance is green.
- [ ] Installation/upgrade/support documentation and recovery procedures are complete.

## Release Invariants

- Machine access is never implied.
- Workspace access is never inferred.
- Worker count never increases authority.
- Agent delegation never increases authority.
- A model cannot approve itself.
- A stale worker cannot write.
- A UI cannot bypass policy.
- A workflow cannot expand scope.
- Edit authority never silently becomes push/merge/deploy authority.

## Completion Gate

The product can carry an explicitly approved software-engineering objective from ChatGPT request through safe implementation, supervision, validation, human escalation and separately authorized delivery/release while retaining durable evidence and fail-closed recovery throughout.

## Status

**PLANNED**

---

# Roadmap Sequence

| Milestone | Deliverable | State |
|---|---|---|
| 1 | Foundation | Complete |
| 2 | Reversible editing / Git safety | Complete |
| 3 | Context durability | Complete |
| 4 | Durable project memory | Complete |
| 5 | ChatGPT / MCP / Cline Hub shared runtime | Complete |
| 6 | GPT Supervisor | Complete |
| 7 | Unattended workflows | Complete |
| 8 | UI + concurrency safety contracts | Complete |
| 9 | Controlled live multi-workspace workers | **Next / planned** |
| 10 | Interactive operator control plane | Planned |
| 11 | Secure remote ChatGPT control | Planned |
| 12 | Distributed / multi-machine orchestration | Planned |
| 13 | Safe multi-agent delegation | Planned |
| 14 | Autonomous engineering loops | Planned |
| 15 | GitHub delivery / release authority | Planned |
| 16 | Production security / reliability / observability | Planned |
| 17 | Productization / installer / first-run UX | Planned |
| 18 | Production release | Planned |

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
| Concurrent live machine-runtime orchestration | Planned — Milestone 9 |
| Interactive operator actions | Planned — Milestone 10 |
| Secure remote ChatGPT control | Planned — Milestone 11 |
| Distributed/multi-machine scheduler | Planned — Milestone 12 |
| Native/specialist multi-agent delegation | Planned — Milestone 13; native teams remain disabled now |
| Autonomous engineering loops | Planned — Milestone 14 |
| Push/PR/merge/deploy authority | Planned — Milestone 15; disabled by default now |
| Production hardening/chaos proof | Planned — Milestone 16 |
| Product installer/first-run UX | Planned — Milestone 17 |
| Production release | Planned — Milestone 18 |

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
23. Dashboard/operator UI remains a presentation/query layer until Milestone 10; UI convenience cannot become a shortcut around MCP/service safety boundaries.
24. Specialist handoffs carry provenance/evidence only and are revalidated against current task authority on every durable append; they cannot preserve stale scope or worker identity.
25. Live concurrent machine-runtime writes remain disabled until Milestone 9 implementation/proof. The live adapter must keep owner-targeted safe executors authoritative and validate the current fenced lease before every write-capable side effect.
26. Durable workspace locks and concurrency admission are single-gateway-process primitives. Multiple independent gateway processes require Milestone 12 distributed fencing and must fail closed until then.
27. A lease heartbeat failure aborts the scheduler lease session, but trusted worker adapters must honor the abort signal and validate current lease state before every coordinated side effect; lease possession alone never authorizes a write.
28. The owner-targeted Hub invariant protects the current surface from silent config/tool/executor drift. It is not permission to enable native teams/subagents; Milestone 13 requires a separately reviewed delegation adapter and new acceptance evidence.
29. Remote transport is not implemented; current MCP remains local. Milestone 11 must not turn connectivity into machine authority.
30. Push, merge, deploy, destructive Git, secret access and external-network mutation remain separately gated and are not implied by completion of Milestones 9–14.
31. Milestone 9 disposable physical proof may use isolated runtimes, but any mutation/restart of the user's shared local Hub/Cline/VS Code runtime still requires explicit user authorization immediately before the proof.
32. Production release cannot be inferred from feature completeness; Milestones 16–18 require security, reliability, chaos, installation and end-to-end release evidence.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–5.** Foundation, reversible editing, context durability, project memory, machine MCP/Hub shared runtime and physical safety acceptance.
2. **COMPLETE — Milestone 6.** Supervisor contract, Planner, Reviewer, durable decisions and human escalation.
3. **COMPLETE — Milestone 7.** Sentinel, durable DAG, bounded automatic progression, budgets/checkpoints, human pause, sanitized report and restart-safe unattended execution.
4. **COMPLETE — Milestone 8.** Dashboard, specialist handoff, workspace locking, bounded concurrency scheduler contract, passive operator visualization and owner-targeted no-bypass invariant.
5. **NEXT — Milestone 9 Slice 9A.** Implement and cloud-test the lease-aware owner-targeted executor adapter. This is code/contract work only; do not enable shared-runtime live concurrency yet.
6. **THEN — Milestone 9 Slice 9B.** Wire the scheduler to orchestrator-owned Hub sessions only after Slice 9A is green.
7. **THEN — Milestone 9 Slice 9C.** Prove worker/lease/restart/stale-owner failure behavior.
8. **GATED PHYSICAL PROOF — Milestone 9 Slice 9D.** Use disposable isolation first. Obtain explicit user authorization before any proof that mutates/restarts the shared local Cline/Hub/VS Code runtime.
9. **FUTURE IN ORDER — Milestones 10–18.** Do not jump ahead merely because later interfaces are convenient.
10. **STILL GATED — native team/subagent execution, multi-gateway distributed scheduling, push/merge/deploy/destructive Git, secret access, external-network mutation or system changes** until their corresponding milestone/policy gate and any required explicit user authorization are satisfied.

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
- 2026-09-25: **Canonical roadmap extended through Milestone 18.** Milestone 9 is now the first planned implementation milestone; native delegation remains later than proven live/distributed ownership boundaries, and release/deployment authority remains independently gated.

---

# Current Next Step

**Milestone 9 Slice 9A — lease-aware owner-targeted executor adapter.** Implement only the trusted contract and cloud tests that require current task/Safety Plan authority plus current fenced-lease validation immediately before every write-capable side effect. Do **not** enable shared-runtime live concurrency, native teams/subagents, distributed scheduling, UI write actions, push/merge/deploy, secret access, external-network mutation or system changes as part of Slice 9A.

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
