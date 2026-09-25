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
9. **Sentinel is observational.** Incident evidence never grants execution authority or process-control privileges.
10. **Workflow ordering is not workflow authority.** A DAG coordinates independently approved tasks; it cannot grant scope, commands, worker identity, model capabilities or Safety Plan authority.
11. **Unattended budgets fail closed.** Missing or exhausted durable usage/checkpoint evidence prevents automatic progression.
12. **Workflow restart never replays stale position.** Resume reloads current durable task/budget evidence and never replays active, terminal or escalated tasks from workflow position alone.
13. **Specialist handoff is provenance, not authority.** It cannot preserve stale task/Safety Plan authority.
14. **Concurrency admission is coordination, not authority.** Writer slots/locks/leases never grant filesystem/task authority; durable authority is independently revalidated.
15. **Delegation is not authority.** Native spawn/teams/plugins/extra executors remain disabled until separately reviewed adapters preserve the owner-targeted safe-executor boundary.
16. **Remote access is transport, not authority.** Connectivity cannot enlarge task/workspace/tool/release authority.
17. **Release authority is separate from edit authority.** Commit, push, PR, merge and deploy are distinct capabilities.
18. **Distributed coordination requires real fencing.** Multi-gateway/multi-machine operation must prevent split-brain writers.
19. **A user-visible control never bypasses service policy.** UI actions invoke the same trusted orchestration boundaries.
20. **Production readiness requires failure proof.** Increased autonomy/distribution/release power requires deterministic failure and recovery evidence.

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
- Read-only Safety Preview produces immutable server-side Safety Plans and opaque single-use tokens.
- Durable tasks bind project/workspace/Safety Plan/profile/worker identity and approved path envelope.
- Pre-execution policy plus owner-targeted Hub executors are authoritative.
- Model shell, ungoverned network/MCP/plugins, subagents and teams are disabled in the first pilot.
- Hub credentials remain ephemeral/local.
- Persisted Hub-session workspace identity is verified before resume.
- Owner-loss recovery uses durable revalidation/handoff/replacement ownership.
- Machine MCP exposes task-oriented operations only.

## Acceptance

- [x] Registry + Safety Preview/token boundary.
- [x] Durable approved-task safety binding.
- [x] Pre-execution policy + local safe executors.
- [x] Hub-backed runtime factory + owner safety wiring.
- [x] Task-oriented machine MCP gateway and loopback bearer boundary.
- [x] Sanitized task/event/diff views.
- [x] Allowed edit, secret denial, protected-path denial and shell-unavailability physically proven.
- [x] External validation + diff safety + rollback physically proven.
- [x] Gateway owner-loss/replacement-owner recovery physically proven.

Evidence: registry `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; policy/executor `46da20d18cd703018c54207258d4fb2422e71eeb`; Hub runtime `32c057d30bc70533233477e87f7e01ec09b2e04a`; MCP `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; restart `8b6bc285e7a79a88576babcd62716cf09d2bff97`; Hub auth `99ff5d0ffccda2f531aadd0c95abf19314f89138`; smoke `182705ab6540fa4e339b304679cd150d7aacc8e8`; launcher shims `318919d42c2085207e228574bda272bd4d2b152a`; isolation `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d`; through CI `#438`.

## Status

**COMPLETE**

---

# Milestone 6 — GPT Supervisor

## Acceptance

- [x] Supervisor task schema and bounded instructions.
- [x] Planner bounded criteria/proposed validation.
- [x] Reviewer sanitized evidence + bounded repairs.
- [x] Reviewer cannot bypass safety/completion gates.
- [x] Durable decisions + human escalation.

Evidence: supervisor `d8a064aa0ec6328c69c390e577fb4637af7509f9`; Planner `5f83903b61494c458474d2ab3f2402101170a0c4`; Reviewer `19024c79c178b9c9e58854065fa98d2d4a029cd1`; decisions `ce0620427e821a66ffd64942720f2bc0b942b055`; CI through `#462`.

## Status

**COMPLETE**

---

# Milestone 7 — Unattended Execution + Reactive Operations

## Acceptance

- [x] Sentinel durable observations/read-only MCP, no mutation authority.
- [x] Durable bounded DAG built only from independently approved tasks.
- [x] Deterministic runnable-node selection and dependency evidence.
- [x] Explicit elapsed/model/token/tool/task/recovery/repair budgets.
- [x] Preserved checkpoint required before unattended progression.
- [x] Human escalation yields durable `waiting_for_human`.
- [x] Restart reloads durable task/budget evidence and never replays stale workflow position.
- [x] Final unattended report is sanitized and evidence-based.

Evidence: Sentinel through `9b34d88effae9317eb6f5504c58d64654abbd063`; DAG/progression through `7e9282ee7e3e8e16363991339a42a28da555b918`; budgets through `5333385737810f935ead4092e1d29760a2cbac99`; report/restart through `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI through `#518` / `36105316586`.

## Status

**COMPLETE**

---

# Milestone 8 — Advanced UI / Multi-worker Safety Contracts

## Acceptance

- [x] Sanitized read-only orchestration dashboard.
- [x] Explicit sequential specialist handoffs; provenance only, no machine authority.
- [x] Durable workspace writer locks and fencing; coordination only.
- [x] Bounded cross-workspace concurrency scheduler contract.
- [x] Heartbeat/renewal keeps lease/fence identity while advancing revision/expiry.
- [x] Rich passive VS Code/web operator visualization.
- [x] Hub safety invariant rejects native spawn/teams/plugins/extra tools/executors.

Evidence: dashboard through CI `#526`; specialist handoff through `#540`; locks `#551`; concurrency `#559/#569`; visualization `#583`; owner-targeted no-bypass invariant `744fc21566e3e2352bb4317f5ad88bd4c2788555` + tests `108b7c74ab220e2678ca522e12bf408bc266ba0a`, CI `#588` / `36114475941`.

## Status

**COMPLETE — live machine-runtime concurrency and native teams/subagents remain disabled.**

---

# Milestone 9 — Controlled Live Multi-Workspace Runtime

## Objective

Turn Milestone 8 concurrency/lease contracts into real orchestrator-managed parallel execution across independently registered workspaces without weakening task authority, Safety Plan enforcement, owner-targeted safe executors, checkpoint/rollback safety or human escalation.

Native Cline teams, native subagents and provider-owned execution remain disabled in this milestone.

## Slice 9A — Lease-aware owner-targeted executor boundary

- [x] Trusted adapter binds admitted worker to current durable task/Safety Plan/project/workspace/profile/owner authority plus a fenced workspace lease.
- [x] Current durable authority is revalidated immediately before each write-capable executor call.
- [x] `editor` and `applyPatch` require a current valid fenced lease before invoking the existing owner-targeted safe executor.
- [x] Lease possession remains coordination only; valid lease without matching durable authority fails closed.
- [x] Lease abort, lease validation failure, lease/fence replacement and authority/profile/Safety Plan drift fail closed before mutation.
- [x] Normal heartbeat renewal may advance lease state revision/expiry while preserving the bound lease/fence identity.
- [x] Reads/search remain governed by existing Safety Plan policy and do not depend on writer lease authority.
- [x] Existing M5/M8 owner-targeted Hub safety contributions remain the underlying executor/policy boundary rather than being replaced.
- [x] Cloud tests cover authority drift, invalid lease, abort, fence replacement, renewal compatibility and read-without-writer-lease behavior.

Evidence:
- Lease-aware Hub safety adapter `9af0e30dfa740e4b36b959257dc0b9352658623a`.
- Acceptance/regression tests `6937640e02a6c75bab8c6a9e2bb8ec5ca173e2da`.
- CI `#596` / `36119645637`: install, typecheck and full test suite passed.

## Slice 9B — Live scheduler/runtime integration

- [ ] Connect `writer-concurrency-scheduler` to orchestrator-owned Cline Hub sessions through the lease-aware trusted adapter.
- [ ] Enforce configurable total writer budget and one live writer per workspace.
- [ ] Permit concurrency only across distinct workspaces in the first live implementation.
- [ ] Every live writer uses a distinct orchestrator-owned owner session; never silently take over an existing VS Code-created write session.
- [ ] Scheduler admission starts only already-approved durable tasks and grants no new path/tool/command authority.
- [ ] Existing workflow budget/checkpoint accounting remains authoritative and cannot be bypassed by concurrency.
- [ ] Implementation/cloud tests must not connect to or mutate the shared local live Cline/Hub runtime.

## Slice 9C — Failure, restart and stale-writer safety

- [ ] Worker crash releases/expires coordination state without permitting stale writes after restart.
- [ ] Hub disconnect, owner loss and gateway restart recover via durable handoff/revalidation rather than stale session replay.
- [ ] Heartbeat failure aborts the live worker adapter and transitions the task to a durable safe state.
- [ ] Expired/stale worker cannot resurrect or silently reacquire its prior fence/lease identity.
- [ ] Duplicate workers for one workspace cannot both pass immediate pre-write fencing checks.
- [ ] Restart reconciliation derives authority from current durable registry/task/Safety Plan/lease evidence.

## Slice 9D — Disposable physical proof

- [ ] Use isolated disposable repositories/workspaces before shared development workspaces.
- [ ] Prove two independent workspaces can execute write tasks concurrently with separate leases/owner sessions.
- [ ] Prove same-workspace competing writer admission is denied.
- [ ] Prove forced lease loss prevents later writes.
- [ ] Prove one worker failure cannot corrupt/broaden another worker's authority.
- [ ] Prove validation, diff safety and rollback for both concurrent tasks.
- [ ] Prove gateway restart/stale-worker behavior in isolation.
- [ ] Obtain explicit user authorization immediately before any proof that mutates/restarts shared local Cline/Hub/VS Code runtime.

## Completion Gate

Milestone 9 is complete only when the orchestrator can safely run independent write-capable coding jobs concurrently on multiple registered workspaces and a stale/unfenced worker is physically unable to write through the trusted executor boundary.

## Status

**IN PROGRESS — Slice 9A COMPLETE; Slice 9B is next. Live shared-runtime concurrency is still disabled.**

---

# Milestone 10 — Interactive Operator Control Plane

## Acceptance

- [ ] Preserve sanitized project/workspace/task/workflow/incident/handoff/concurrency views.
- [ ] Add bounded service-backed pause/resume/abort/escalation/review/validation/rollback/workflow/worker actions.
- [ ] All UI actions use the same trusted service/policy boundary as non-UI callers.
- [ ] No generic filesystem, shell, Hub, process, raw-command or credential surface.
- [ ] Destructive/high-risk actions require explicit confirmation and durable audit evidence.
- [ ] Replay, stale-action, request-forgery and authorization-drift tests fail closed.

## Status

**PLANNED**

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

## Acceptance

- [ ] Remote transport threat model and trust boundaries documented.
- [ ] Explicit machine-local project/workspace registration remains authoritative.
- [ ] Authenticated, revocable, short-lived remote sessions/device identity.
- [ ] Hub/Cline credentials remain local.
- [ ] Remote callers see opaque IDs and sanitized evidence only.
- [ ] New write task still requires Safety Preview/approved task envelope.
- [ ] Replay protection, rate limits, audit and revocation.
- [ ] Reconnect cannot revive stale worker/task authority.

## Status

**PLANNED**

---

# Milestone 12 — Distributed / Multi-Machine Orchestration

## Acceptance

- [ ] Reviewed transactional distributed lease/fencing backend.
- [ ] Monotonic fencing replaces single-process locking assumptions.
- [ ] Distributed worker registry, heartbeats, ownership transfer and durable coordination.
- [ ] Task/Safety Plan authority remains independent of lease admission.
- [ ] Versioned worker/control-plane protocol.
- [ ] Network partition cannot produce two successful writers for one workspace.
- [ ] Machine/scheduler/control-plane failures recover or fail closed deterministically.

## Status

**PLANNED**

---

# Milestone 13 — Advanced Multi-Agent Delegation

## Acceptance

- [ ] Bounded architect/implementer/test/reviewer specialist roles.
- [ ] Delegated role binds to current durable task/Safety Plan; provenance is not authority.
- [ ] Machine work is proposed back through the orchestrator safe-executor path.
- [ ] Native Cline teams/subagents remain disabled until a reviewed adapter proves all side effects preserve owner-targeted executor and fenced-lease checks.
- [ ] Child work cannot expand scope/tools/network/secrets/release authority.
- [ ] Delegation depth/count/token/tool/time budgets fail closed.
- [ ] Parent cancellation/authority revision invalidates children safely.

## Status

**PLANNED**

---

# Milestone 14 — Autonomous Software-Engineering Loops

## Acceptance

- [ ] GitHub issue/work-item ingestion creates proposals only; external text never grants authority.
- [ ] Planner decomposes approved objectives into independently bounded tasks/dependencies.
- [ ] CI failures may trigger diagnosis/proposal but cannot self-authorize broader repairs.
- [ ] Dependency maintenance uses isolated changes, validation, review and rollback.
- [ ] Long-running work uses durable project memory/context rotation.
- [ ] Workflow completion requires child validation/diff-safety/human evidence.
- [ ] Reactive automation respects budgets and cannot loop indefinitely.

## Status

**PLANNED**

---

# Milestone 15 — GitHub Delivery and Release Authority

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

- [ ] Separate policy grants/audit evidence for commit, push, PR, merge and deploy.
- [ ] Default coding tasks cannot push/merge/deploy.
- [ ] Protected branches/destructive Git remain denied unless separately authorized.
- [ ] PR creation uses validated checkpoint-relative diff evidence.
- [ ] Merge requires configured human/policy gate.
- [ ] Deployment requires environment-specific authorization and cannot inherit from merge/edit authority.

## Status

**PLANNED**

---

# Milestone 16 — Production Security, Reliability and Observability

## Acceptance

- [ ] Threat model covers injection, repository instructions, connectors, replay, credentials, tool/plugin drift, supply chain and privilege confusion.
- [ ] Credential rotation/revocation and audit integrity tested.
- [ ] Durable store backup/recovery/migration strategy.
- [ ] Crash/restart handling across gateway, worker, Hub, model endpoint and storage.
- [ ] Structured sanitized logs/metrics/traces for task/workflow/worker/lease/validation/recovery.
- [ ] Chaos tests kill workers/Hub/orchestrator/storage/model/network at critical points and prove recovery or fail-closed states.

## Status

**PLANNED**

---

# Milestone 17 — Productization and Installation

## Acceptance

- [ ] Supported install/update/uninstall path.
- [ ] Compatible Cline Hub detection without silent dependency upgrades.
- [ ] First-run flow: machine registration -> project -> workspace -> safety profile -> Safety Preview -> ChatGPT -> first task.
- [ ] Safe built-in observe/edit/development/maintainer/release profiles.
- [ ] Credential-safe configuration backup/export and diagnostics bundle.
- [ ] Safe durable-state upgrade/migration path.

## Status

**PLANNED**

---

# Milestone 18 — Production Release

## End-to-End Acceptance

- [ ] ChatGPT request resolves only to explicitly registered project/workspace.
- [ ] Safety Preview/human authorization creates bounded durable task/workflow.
- [ ] Workflow decomposition preserves authority.
- [ ] Parallel writers require current fencing + owner-targeted executor checks.
- [ ] Context rotation, owner loss and restart preserve durable continuity.
- [ ] Validation, Reviewer, bounded repair and human escalation work end-to-end.
- [ ] Completion requires validation + diff safety + required release evidence.
- [ ] PR/release operations use separately granted authority.
- [ ] Operator console/remote supervision cannot bypass policy.
- [ ] Security/reliability/chaos/productization acceptance is green.

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
| 9 | Controlled live multi-workspace workers | **In progress — 9A complete, 9B next** |
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
| Git checkpoint + rollback | Complete / physically proven |
| External validation + bounded repair | Complete |
| Context handoff + recovery | Complete |
| Durable project memory | Complete |
| Registry + Safety Preview | Complete / physically proven |
| Pre-execution policy + safe executors | Complete / physically proven |
| Hub runtime + owner safety | Complete / physically proven |
| Task-oriented MCP gateway | Complete / physically proven |
| GPT Supervisor | Complete |
| Sentinel + unattended DAG/budgets/resume | Complete / cloud tested |
| Passive operator UI | Complete / cloud tested |
| Workspace locks/fencing + scheduler contract | Complete / cloud tested |
| Owner-targeted delegation no-bypass invariant | Complete / cloud tested |
| Lease-aware owner write boundary | **Complete / cloud tested — M9A** |
| Live machine-runtime scheduler integration | Not enabled — M9B next |
| Native team/subagent execution | Not enabled — M13 |
| Remote ChatGPT control | Not enabled — M11 |
| Distributed/multi-machine scheduler | Not enabled — M12 |
| Push/merge/deploy authority | Not enabled — M15 |

---

# Known Constraints and Risks

1. Shared local inference/runtime state is protected; automated development must not mutate it without authorization.
2. Semantic recovery cannot restore hidden model state; durable evidence remains authoritative.
3. Hub remains pinned to reviewed Core/SDK `0.0.83` until deliberate dependency review.
4. Dirty worktrees must preserve pre-run user state.
5. Validation commands are trusted local configuration; Planner text cannot self-admit them.
6. Credentials must never enter durable/model-facing state.
7. Authorization comes only from registry + approved Safety Plan/task envelope, never workflow, dashboard, handoff, lock, scheduler or Hub participation.
8. Native Hub approval is UX/defense-in-depth; owner hooks/executors are authoritative.
9. Arbitrary model shell, ungoverned network/MCP/plugins and native teams/subagents remain disabled.
10. MCP remains loopback-only until Milestone 11.
11. Reviewer `pass` cannot mark a task complete or grant broader authority.
12. Sentinel remains observational.
13. Workflow membership/orders never grant scope.
14. Current unattended accounting fails closed when historical usage cannot be reconstructed.
15. Locks/scheduler are single-gateway primitives until Milestone 12.
16. Lease heartbeat failure must abort live adapters; lease possession alone never authorizes writes.
17. Slice 9A proves the write guard contract but **does not wire it into live Cline execution**.
18. Live concurrent machine-runtime writes remain disabled until Slice 9B+9C implementation and Slice 9D proof.
19. Native Cline teams/subagents require Milestone 13 and cannot be enabled by configuration alone.
20. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
21. Any proof that mutates/restarts shared local Hub/Cline/VS Code runtime requires explicit user authorization immediately before that proof.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–8.**
2. **COMPLETE — Milestone 9 Slice 9A.** Lease-aware owner-targeted write boundary; CI `#596` / `36119645637`.
3. **NEXT — Milestone 9 Slice 9B.** Wire `writer-concurrency-scheduler` to orchestrator-owned Hub sessions through the new lease-aware adapter, using cloud/fake-runtime tests only first.
4. **THEN — Milestone 9 Slice 9C.** Worker/lease/restart/stale-owner failure behavior.
5. **GATED PHYSICAL PROOF — Milestone 9 Slice 9D.** Disposable isolation first; explicit authorization before touching shared live runtime.
6. **FUTURE IN ORDER — Milestones 10–18.**
7. **STILL GATED — native teams/subagents, distributed scheduling, UI write actions, push/merge/deploy/destructive Git, secrets, external-network mutation or system changes** until their milestone/policy gate is satisfied.

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 7 COMPLETE through CI `#518` / `36105316586`.
- 2026-09-25: Milestone 8 dashboard/handoffs/locks/scheduler/operator visualization/no-bypass boundary completed through CI `#588` / `36114475941`.
- 2026-09-25: Canonical roadmap extended through Milestone 18 in `228acad723add7cd4f6b81897700a2391625ab21`.
- 2026-09-25: **Milestone 9 Slice 9A COMPLETE.** Lease-aware Hub safety adapter `9af0e30dfa740e4b36b959257dc0b9352658623a` wraps the existing owner-targeted `editor`/`applyPatch` boundary with current durable-authority and fenced-lease validation. Regression tests `6937640e02a6c75bab8c6a9e2bb8ec5ca173e2da`; CI `#596` / `36119645637` passed full typecheck/tests. Live runtime integration remains disabled.

---

# Current Next Step

**Milestone 9 Slice 9B — live scheduler/runtime integration, cloud/fake-runtime first.** Connect the existing scheduler contract to orchestrator-owned Hub-session construction through the Slice 9A lease-aware safety adapter. Preserve one writer per workspace, existing task/Safety Plan authority, workflow budgets/checkpoints and distinct owner sessions. Do **not** connect to or mutate the shared local Cline/Hub/VS Code runtime during the cloud implementation/tests.

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
