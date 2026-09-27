# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-27
Branch: `phase-1/bootstrap`

## Purpose

This is the canonical execution plan for `cline-orchestrator`.

Before implementation work: read this file, confirm branch/HEAD and the current milestone, implement only the first unfinished item, prefer GitHub-hosted CI over destructive local-runtime testing, then update this file with evidence and one concrete next action.

Detailed implementation history remains in Git history and milestone-specific documents. This tracker intentionally keeps current architecture, acceptance state, key evidence, constraints and ordered next work authoritative.

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

The system should support long-running and unattended software-engineering work while preserving human control, reversible workspace changes, durable project memory, bounded model context, fail-closed authority, reactive incident visibility, evidence-based completion, safe parallelism, secure remote supervision and explicit release/deployment authority.

> **ChatGPT decides what should be attempted. The orchestrator decides what is permitted. Cline performs only permitted work.**

---

# Execution Rules

1. **Finish milestones in order.** Work only on the first unfinished implementation item unless a prerequisite defect is discovered.
2. **Protect the shared local runtime.** Do not stop/unload local models, kill unrelated runtime processes, restart shared Cline/Hub, or mutate shared VS Code/Cline state without explicit user authorization.
3. **Use cloud CI for normal development.** Unit/integration tests and GitHub-hosted CI are the default proof path.
4. **Model context is not project lifetime.** Durable task/project state owns continuity; context rotation uses request/turn size rather than cumulative history.
5. **Model completion is not task completion.** Completion requires configured external validation plus checkpoint-relative diff safety.
6. **ChatGPT receives task authority, not machine authority.** Only registered IDs and approved task envelopes grant authority.
7. **Scope expansion fails closed.** Broader work requires durable human escalation or a fresh Safety Preview.
8. **Supervisor output is advisory unless admitted by trusted orchestration code.** Planner/Reviewer text cannot grant filesystem, command, validation, worker, policy, Hub, network, MCP, plugin, subagent or completion authority.
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

Acceptance: durable task start/resume, persistent daemon/state, semantic recovery, run-local metrics, watchdog/retry, durable events/abort/shutdown and provider preflight.

**Status: COMPLETE**

---

# Milestone 2 — Safety: Reversible Autonomous Editing

Acceptance: Git before/after evidence, restorable checkpoint preserving dirty state, rollback service, external validation with bounded repair, checkpoint-relative diff summary, scope/protected-path/branch/HEAD/excessive-diff enforcement, and completion gated by validation + diff safety.

Evidence: key closure `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345`.

**Status: COMPLETE**

---

# Milestone 3 — Context Durability

Acceptance: per-turn usage, bounded context rotation, durable structured handoff, repeated-rotation bounds, `session_not_found` recovery and validation-repair recovery preserving the original checkpoint.

Evidence: through `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506`.

**Status: COMPLETE**

---

# Milestone 4 — Durable Project Memory

Acceptance: stable project identity, architecture/decisions/code-map/conventions/issues memory, bounded task summaries, selective retrieval, handoff integration, audit/verifier and cross-store closure.

Evidence: key closure `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260` / `35604869492`.

**Status: COMPLETE**

---

# Milestone 5 — ChatGPT Plugin / Cline Hub Shared Runtime

Pinned Cline generation: `@cline/sdk 0.0.83` / `@cline/core 0.0.83`.

Architecture:
- machine-local registry provides opaque project/workspace IDs and revisioned safety profiles;
- read-only Safety Preview creates immutable server-side Safety Plans and opaque single-use tokens;
- durable tasks bind project/workspace/Safety Plan/profile/worker identity and approved path envelope;
- pre-execution policy plus owner-targeted Hub executors are authoritative;
- model shell, ungoverned network/MCP/plugins, subagents and teams remain disabled;
- Hub credentials remain ephemeral/local;
- persisted Hub-session workspace identity is verified before resume;
- owner-loss recovery uses durable revalidation/handoff/replacement ownership;
- machine MCP exposes task-oriented operations only.

Physical proof includes allowed edit, secret/protected-path denial, shell unavailability, validation/diff safety/rollback and owner-loss replacement recovery.

Evidence: registry `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; policy/executor `46da20d18cd703018c54207258d4fb2422e71eeb`; Hub runtime `32c057d30bc70533233477e87f7e01ec09b2e04a`; MCP `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; restart `8b6bc285e7a79a88576babcd62716cf09d2bff97`; Hub auth `99ff5d0ffccda2f531aadd0c95abf19314f89138`; smoke `182705ab6540fa4e339b304679cd150d7aacc8e8`; launcher shims `318919d42c2085207e228574bda272bd4d2b152a`; isolation `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d`; through CI `#438`.

**Status: COMPLETE**

---

# Milestone 6 — GPT Supervisor

Acceptance: bounded supervisor schema, Planner criteria/validation proposal, sanitized Reviewer evidence, reviewer cannot bypass completion/safety gates, durable decisions and human escalation.

Evidence: supervisor `d8a064aa0ec6328c69c390e577fb4637af7509f9`; Planner `5f83903b61494c458474d2ab3f2402101170a0c4`; Reviewer `19024c79c178b9c9e58854065fa98d2d4a029cd1`; decisions `ce0620427e821a66ffd64942720f2bc0b942b055`; CI through `#462`.

**Status: COMPLETE**

---

# Milestone 7 — Unattended Execution + Reactive Operations

Acceptance: observational Sentinel, durable bounded DAG of independently approved tasks, deterministic runnable selection, explicit unattended budgets, preserved checkpoint requirement, durable `waiting_for_human`, safe restart/reconciliation and sanitized final report.

Evidence: Sentinel through `9b34d88effae9317eb6f5504c58d64654abbd063`; DAG/progression through `7e9282ee7e3e8e16363991339a42a28da555b918`; budgets through `5333385737810f935ead4092e1d29760a2cbac99`; report/restart through `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI `#518` / `36105316586`.

**Status: COMPLETE**

---

# Milestone 8 — Advanced UI / Multi-worker Safety Contracts

Acceptance: read-only dashboard, sequential specialist handoffs, durable workspace locks/fencing, bounded cross-workspace concurrency contract, heartbeat renewal, passive VS Code/web visualization and owner-targeted no-bypass invariant rejecting native spawn/teams/plugins/extra executors.

Evidence: dashboard through CI `#526`; specialist handoff through `#540`; locks `#551`; concurrency `#559/#569`; visualization `#583`; no-bypass invariant `744fc21566e3e2352bb4317f5ad88bd4c2788555` + tests `108b7c74ab220e2678ca522e12bf408bc266ba0a`, CI `#588` / `36114475941`.

**Status: COMPLETE — live machine-runtime concurrency and native teams/subagents remain disabled.**

---

# Milestone 9 — Controlled Live Multi-Workspace Runtime

Acceptance: lease-aware owner-targeted write execution, scheduler-to-orchestrator-owned Hub integration, crash/restart/stale-writer safety and disposable physical multi-workspace proof. Lease possession remains coordination only; current durable authority and a current fenced lease are both required immediately before writes.

Key evidence:
- M9A adapter `9af0e30dfa740e4b36b959257dc0b9352658623a`; tests `6937640e02a6c75bab8c6a9e2bb8ec5ca173e2da`; CI `#596` / `36119645637`.
- M9B runtime/scheduler integration through stable CI `#614` / `36122721492`.
- M9C lease-loss, crash and restart safety through CI `#620`, `#622`, `#628`, `#630`.
- M9D disposable physical proofs on Windows using local `llama.cpp` completed successfully; closure HEAD `14e9991bd4312e51cbb02beb5403326d9d3fe522`; branch-head CI `#668` / `36226493586`. See `docs/MILESTONE-9D-PHYSICAL-PROOF.md`.

**Status: COMPLETE — shared live-runtime concurrency remains disabled pending separate authorization/review.**

---

# Milestone 10 — Interactive Operator Control Plane

Planned: bounded service-backed task/escalation/rollback/workflow/worker controls and safe review/validation interaction, same policy boundary as non-UI callers, no generic shell/filesystem/Hub/process/credential surface, confirmation/audit for high-risk actions, replay/stale-action/authorization-drift tests.

Completed slices:
- [x] Escalation rejection preview/confirmation with short-lived single-use token, current task/safety snapshot binding and existing durable machine-service audit.
- [x] Separate opt-in loopback browser surface for escalation rejection with operator token, short-lived browser session, CSRF/origin checks, session-bound preview and explicit confirmation. Passive visualization remains unchanged. See `docs/MILESTONE-10-LOCAL-OPERATOR.md`.
- [x] Bounded task abort with 60-second single-use confirmation, task/safety fingerprint, replay/expiry/drift checks and delegation to `MachineOrchestratorService.abortTask` / existing `abort_requested` audit.
- [x] Bounded escalation approval. Approval closes the old immutable task envelope and returns `new_safety_preview_required`; it never enlarges existing authority.
- [x] Harden `MachineOrchestratorService.rollbackTask` to revalidate current durable task/workspace safety binding before checkpoint acceptance or mutation.
- [x] Bounded operator rollback tied to exact current task/safety/checkpoint fingerprint and opaque checkpoint ID, delegating only to hardened machine rollback.
- [x] Pin unattended workflow resume to the exact expected runnable task before budget logging/starter invocation.
- [x] Bounded workflow-resume confirmation binding immutable workflow, exact runnable task, durable task/authority evidence, budget configuration and budget decisions; durable operator provenance is recorded without persisting the token.
- [x] Bounded task continuation (`continue_task`) without inventing pause/unpause semantics. The 60-second single-use token binds the exact current task/safety fingerprint and exact normalized instruction; preview exposes only an instruction SHA-256 digest and character count, not instruction plaintext. It delegates only to `MachineOrchestratorService.continueTask`, which independently revalidates current authority and records `resume_queued`. Browser exposure remains unchanged. Evidence: implementation `f10b6063cc6b4eefad434522325a46ee831a88a8`, focused tests `79805167ef36e590b6128e05adc84b937ab82973`, synchronization correction `245c218d3245af5cec164ba0db4a348b40c8e3c5`; CI `#715` / `36303792935` passed typecheck + full suite.
- [x] Bounded recovery of one interrupted orchestrator-owned scheduled writer. A read-only targeted recovery preview accepts only an opaque task ID, verifies current task/registry/Safety Plan/checkpoint evidence, refuses a live writer lease and fingerprints the exact recovery state. Confirmation is 60-second, single-use and consumed before awaiting; it records durable operator provenance, then delegates only to the targeted reconciler, existing recovery-permit boundary and fenced scheduler. The scheduler/runner still independently revalidate current authority and acquire a fresh fenced lease before replacement ownership or writes. No generic Hub/process/lease/credential control is exposed; browser exposure remains unchanged. Evidence: targeted boundary `7065a6a0125a48121249bb519174e1509092bb3b`, operator wrapper `7bf571f83c517348124af6a241f6c92aca8c575f`, operator tests through `3ca2d4703af662350d62952bb0e1cd9f0afc07ab`, targeted service tests/fixes through `9e491a03db6bc47e634c3b194a7049765aea56f1`; CI `#727` / `36311314469` passed typecheck + full suite.
- [ ] Review the remaining review/validation and worker-control requirements. Do not expose reviewer output as mutating authority, standalone validation execution, generic process control, raw Hub control, lease manipulation or credential access unless a deliberate trusted service boundary first exists.

**Status: IN PROGRESS — escalation decisions, local rejection browser boundary, task abort, rollback, workflow resume, task continuation and targeted scheduled-writer recovery are complete; remaining review/validation/worker-control boundary decisions are pending.**

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

Planned: remote threat model, explicit machine-local registration, authenticated/revocable short-lived remote sessions, local Hub credentials, opaque IDs/sanitized evidence, Safety Preview for new write tasks, replay protection/rate limiting/audit/revocation and no stale-authority resurrection after reconnect.

**Status: PLANNED**

---

# Milestone 12 — Distributed / Multi-Machine Orchestration

Planned: transactional distributed fencing backend, monotonic fencing, distributed worker registry/heartbeats/ownership transfer, independent Safety Plan authority, versioned protocol and deterministic partition/failure behavior.

**Status: PLANNED**

---

# Milestone 13 — Advanced Multi-Agent Delegation

Planned: bounded architect/implementer/test/reviewer roles, current task/Safety Plan binding, orchestrator-safe-executor side effects only, native teams/subagents disabled until separately reviewed adapter, child scope/tool/network/secret/release containment, delegation budgets and parent cancellation/authority-revision invalidation.

**Status: PLANNED**

---

# Milestone 14 — Autonomous Software-Engineering Loops

Planned: issue/work-item ingestion as proposals only, bounded task decomposition, CI diagnosis without self-authorized scope expansion, isolated dependency maintenance, durable project memory/context rotation and evidence-based workflow completion.

**Status: PLANNED**

---

# Milestone 15 — GitHub Delivery and Release Authority

Authority model:

```text
edit authority
    != commit authority
    != push authority
    != pull-request authority
    != merge authority
    != deployment authority
```

Planned: separate grants/audit for commit/push/PR/merge/deploy, default denial of release actions, protected-branch/destructive-Git denial, validated diff evidence for PR creation and explicit merge/deploy gates.

**Status: PLANNED**

---

# Milestone 16 — Production Security, Reliability and Observability

Planned: threat model, credential rotation/revocation, audit integrity, durable-store backup/recovery/migration, crash/restart handling, sanitized logs/metrics/traces and chaos proof across workers/Hub/orchestrator/storage/model/network.

**Status: PLANNED**

---

# Milestone 17 — Productization and Installation

Planned: supported install/update/uninstall, compatible pinned Hub detection, first-run registration/Safety Preview flow, built-in safe profiles, credential-safe diagnostics/config export and durable-state migrations.

**Status: PLANNED**

---

# Milestone 18 — Production Release

End-to-end release invariants:
- machine access is never implied;
- workspace access is never inferred;
- worker count never increases authority;
- agent delegation never increases authority;
- a model cannot approve itself;
- a stale worker cannot write;
- a UI cannot bypass policy;
- a workflow cannot expand scope;
- edit authority never silently becomes push/merge/deploy authority.

Production acceptance requires all prior milestone safety, concurrency, remote-control, delivery, security/reliability and productization gates.

**Status: PLANNED**

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
| 9 | Controlled live multi-workspace workers | Complete — isolated physical proofs + CI `#668` |
| 10 | Interactive operator control plane | In progress — escalation decisions, task abort/continuation, rollback, workflow resume, targeted scheduled-writer recovery and local rejection browser boundary |
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
| Bounded local operator mutations | In progress / cloud tested — M10 |
| Workspace locks/fencing + scheduler contract | Complete / cloud tested |
| Owner-targeted delegation no-bypass invariant | Complete / cloud tested |
| Lease-aware owner write boundary | Complete / cloud tested — M9A |
| Scheduler → orchestrator-owned Hub integration | Complete / cloud tested — M9B |
| Failure/restart/stale-writer safety | Complete / cloud tested — M9C |
| Disposable physical concurrent-runtime proof | Proven on isolated Windows workspaces — M9D |
| Shared live machine-runtime concurrency | Disabled pending separate authorization/review |
| Native team/subagent execution | Disabled — M13 |
| Remote ChatGPT control | Disabled — M11 |
| Distributed/multi-machine scheduler | Disabled — M12 |
| Push/merge/deploy authority | Disabled — M15 |

---

# Known Constraints and Risks

1. Shared local inference/runtime state is protected; automated development must not mutate it without authorization.
2. Semantic recovery cannot restore hidden model state; durable evidence remains authoritative.
3. Hub remains pinned to reviewed Core/SDK `0.0.83` until deliberate dependency review.
4. Dirty worktrees must preserve pre-run user state.
5. Validation commands are trusted local configuration; Planner text cannot self-admit them.
6. Credentials must never enter durable/model-facing state.
7. Authorization comes only from registry + approved Safety Plan/task envelope, never workflow/dashboard/handoff/lock/scheduler/Hub participation.
8. Native Hub approval is UX/defense-in-depth; owner hooks/executors are authoritative.
9. Arbitrary model shell, ungoverned network/MCP/plugins and native teams/subagents remain disabled.
10. MCP remains loopback-only until Milestone 11.
11. Reviewer `pass` cannot mark a task complete or grant broader authority.
12. Sentinel remains observational.
13. Workflow membership/order never grants scope.
14. Current unattended accounting fails closed when historical usage cannot be reconstructed.
15. Locks/scheduler are single-gateway primitives until Milestone 12.
16. Lease possession alone never authorizes writes; current durable authority + current fenced lease are both required immediately before a coordinated write.
17. Shared live concurrent machine-runtime writes remain disabled after the isolated M9D proof pending separate authorization/review of shared-runtime use.
18. Native Cline teams/subagents require Milestone 13 and cannot be enabled by configuration alone.
19. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
20. Any proof that mutates/restarts shared local Hub/Cline/VS Code runtime requires explicit user authorization immediately before that proof.
21. Rollback is a high-impact workspace mutation; current machine-service authority revalidation and bounded operator confirmation are mandatory. Browser exposure remains separate.
22. Workflow resume confirmation never grants authority: current workflow/task/budget state must match and the injected starter independently enforces task/registry/Safety Plan authority.
23. Task continuation does not create pause/resume state semantics and cannot enlarge the approved task envelope. The continuation instruction is bound to confirmation, while the machine service and safe executors remain authoritative.
24. Targeted scheduled-writer recovery is limited to one interrupted orchestrator-owned task with current checkpoint/authority evidence and no live writer. Operator confirmation does not grant a lease or owner identity; the recovery permit, scheduler and lease-aware runner remain authoritative.
25. Reviewer output remains advisory and current validation execution is coupled to task execution; neither should be exposed as a mutating operator action until a deliberate trusted service boundary exists.
26. Generic Hub/process/lease/credential controls remain intentionally absent from the operator plane.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–8.**
2. **COMPLETE — Milestone 9.** M9A–M9D closed; isolated physical proof and CI `#668` passed. Shared live-runtime concurrency remains separately gated.
3. **IN PROGRESS — Milestone 10.** Escalation decisions, abort, rollback, workflow resume, task continuation and one-task scheduled-writer recovery have bounded confirmation/audit/stale-authority controls.
4. **NEXT — Milestone 10.** Inspect the remaining Reviewer/validation and worker-facing service boundaries. Choose another operator action only if a narrow trusted service already owns authority revalidation. Do not manufacture standalone validation, reviewer mutation, generic process control, raw Hub control or lease-management authority just to satisfy the UI milestone.
5. **STILL GATED — browser expansion beyond the reviewed local rejection surface, shared-runtime changes, native teams/subagents, distributed scheduling, push/merge/deploy/destructive Git, secrets, external-network mutation or system changes** until their milestone/policy gate is satisfied.

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 7 complete through CI `#518` / `36105316586`.
- 2026-09-25: Milestone 8 complete through CI `#588` / `36114475941`.
- 2026-09-26: Milestone 9D closed on `14e9991bd4312e51cbb02beb5403326d9d3fe522`; branch-head CI `#668` / `36226493586` passed after isolated Windows physical proofs. Shared runtime concurrency remains disabled pending separate authorization/review.
- 2026-09-26: Milestone 10 escalation rejection/browser, abort, escalation approval, rollback authority/operator rollback, workflow candidate pinning and bounded workflow resume were completed through CI `#707` / `36248365798` and related earlier green runs.
- 2026-09-27: Milestone 10 bounded task continuation completed through `245c218d3245af5cec164ba0db4a348b40c8e3c5`. The confirmation binds the exact continuation instruction and task authority while delegating only to the existing machine continuation path. CI `#715` / `36303792935` passed typecheck + full suite. Browser surface unchanged.
- 2026-09-27: Milestone 10 targeted scheduled-writer recovery completed through `9e491a03db6bc47e634c3b194a7049765aea56f1`. Read-only target preview, exact recovery fingerprint, live-lease refusal, short-lived single-use confirmation, durable operator provenance, downstream recovery-permit/fenced-scheduler delegation and stale-state/authority tests were added. CI `#727` / `36311314469` passed typecheck + full suite. No shared local runtime or browser surface was changed.

---

# Current Next Step

**Milestone 10 — Interactive Operator Control Plane.** Inspect the remaining Reviewer/validation and worker-facing trusted service boundaries. Add another operator action only where an existing narrow service independently revalidates current durable authority; otherwise document the boundary as intentionally unavailable rather than adding generic machine/process power. Keep Reviewer output advisory. Do not add standalone validation execution until a deliberate trusted service boundary exists. Do not add pause/unpause task-state semantics without a deliberate durable state/service contract. Keep browser expansion separate. Keep shared live runtime concurrency disabled and obtain explicit user authorization immediately before any proposed proof that mutates/restarts shared local Cline/Hub/VS Code runtime.

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
