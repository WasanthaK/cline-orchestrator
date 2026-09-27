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

> **ChatGPT decides what should be attempted. The orchestrator decides what is permitted. Cline performs only permitted work.**

---

# Execution Rules

1. Finish milestones in order; work only on the first unfinished implementation item unless a prerequisite defect is discovered.
2. Protect the shared local runtime. Do not stop/unload local models, kill unrelated runtime processes, restart shared Cline/Hub, or mutate shared VS Code/Cline state without explicit user authorization.
3. Use cloud CI for normal development.
4. Model context is not project lifetime; durable task/project state owns continuity.
5. Model completion is not task completion; configured external validation plus checkpoint-relative diff safety are authoritative.
6. ChatGPT receives task authority, not machine authority. Only registered IDs and approved task envelopes grant authority.
7. Scope expansion fails closed. Broader work requires durable human escalation or a fresh Safety Preview.
8. Planner/Reviewer output is advisory unless admitted by trusted orchestration code. Model text cannot grant filesystem, command, validation, worker, policy, Hub, network, MCP, plugin, subagent or completion authority.
9. Sentinel is observational.
10. Workflow membership/order never grants scope, commands, worker identity, model capabilities or Safety Plan authority.
11. Unattended budgets fail closed on missing/exhausted durable usage or checkpoint evidence.
12. Workflow restart reloads current durable task/budget evidence; stale workflow position never grants execution.
13. Specialist handoff is provenance, not authority.
14. Concurrency admission and lease possession are coordination only; current durable authority plus a current fenced lease are required immediately before coordinated writes.
15. Native spawn/teams/plugins/extra executors remain disabled until separately reviewed adapters preserve the owner-targeted safe-executor boundary.
16. Remote access is transport, not authority.
17. Edit authority is separate from commit, push, PR, merge and deployment authority.
18. Distributed coordination requires real fencing before multi-gateway/multi-machine operation.
19. User-visible controls must invoke the same trusted orchestration boundaries as non-UI callers.
20. Increased autonomy/distribution/release power requires deterministic failure and recovery evidence.

---

# Milestone Status

## Milestone 1 — Foundation

Acceptance: durable task start/resume, persistent daemon/state, semantic recovery, run-local metrics, watchdog/retry, durable events/abort/shutdown and provider preflight.

**Status: COMPLETE**

## Milestone 2 — Safety: Reversible Autonomous Editing

Acceptance: Git before/after evidence, restorable checkpoint preserving dirty state, rollback service, external validation with bounded repair, checkpoint-relative diff summary, scope/protected-path/branch/HEAD/excessive-diff enforcement and completion gated by validation + diff safety.

Evidence: closure `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345`.

**Status: COMPLETE**

## Milestone 3 — Context Durability

Acceptance: per-turn usage, bounded context rotation, durable structured handoff, repeated-rotation bounds, `session_not_found` recovery and validation-repair recovery preserving the original checkpoint.

Evidence: through `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506`.

**Status: COMPLETE**

## Milestone 4 — Durable Project Memory

Acceptance: stable project identity, architecture/decisions/code-map/conventions/issues memory, bounded task summaries, selective retrieval, handoff integration, audit/verifier and cross-store closure.

Evidence: closure `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260` / `35604869492`.

**Status: COMPLETE**

## Milestone 5 — ChatGPT / MCP / Cline Hub Shared Runtime

Architecture: machine-local registry with opaque IDs; read-only Safety Preview and immutable plans; durable task binding to project/workspace/profile/worker/path envelope; pre-execution policy plus owner-targeted Hub executors; local/ephemeral credentials; verified session workspace identity; owner-loss recovery; task-oriented MCP only; arbitrary shell/network/plugins/subagents/teams disabled.

Key evidence: registry `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; policy/executor `46da20d18cd703018c54207258d4fb2422e71eeb`; Hub runtime `32c057d30bc70533233477e87f7e01ec09b2e04a`; MCP `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; restart `8b6bc285e7a79a88576babcd62716cf09d2bff97`; through CI `#438`.

**Status: COMPLETE**

## Milestone 6 — GPT Supervisor

Acceptance: bounded supervisor schema, Planner criteria/validation proposal, sanitized Reviewer evidence, Reviewer cannot bypass completion/safety gates, durable decisions and human escalation.

Evidence: supervisor `d8a064aa0ec6328c69c390e577fb4637af7509f9`; Planner `5f83903b61494c458474d2ab3f2402101170a0c4`; Reviewer `19024c79c178b9c9e58854065fa98d2d4a029cd1`; decisions `ce0620427e821a66ffd64942720f2bc0b942b055`; CI through `#462`.

**Status: COMPLETE**

## Milestone 7 — Unattended Execution + Reactive Operations

Acceptance: observational Sentinel, durable bounded DAG of independently approved tasks, deterministic runnable selection, explicit unattended budgets, preserved checkpoint requirement, durable `waiting_for_human`, safe restart/reconciliation and sanitized final report.

Evidence: Sentinel through `9b34d88effae9317eb6f5504c58d64654abbd063`; DAG/progression through `7e9282ee7e3e8e16363991339a42a28da555b918`; budgets through `5333385737810f935ead4092e1d29760a2cbac99`; report/restart through `7787f2d494cd1f99fc51a019379e07c53c101ee1`; CI `#518` / `36105316586`.

**Status: COMPLETE**

## Milestone 8 — Advanced UI / Multi-worker Safety Contracts

Acceptance: read-only dashboard, sequential specialist handoffs, durable workspace locks/fencing, bounded cross-workspace concurrency contract, heartbeat renewal, passive visualization and owner-targeted no-bypass invariant rejecting native spawn/teams/plugins/extra executors.

Evidence: dashboard `#526`; specialist handoff `#540`; locks `#551`; concurrency `#559/#569`; visualization `#583`; no-bypass invariant `744fc21566e3e2352bb4317f5ad88bd4c2788555`; CI `#588` / `36114475941`.

**Status: COMPLETE**

## Milestone 9 — Controlled Live Multi-Workspace Runtime

Acceptance: lease-aware owner-targeted write execution, scheduler-to-orchestrator-owned Hub integration, crash/restart/stale-writer safety and disposable physical multi-workspace proof.

Key evidence:
- M9A adapter `9af0e30dfa740e4b36b959257dc0b9352658623a`; CI `#596` / `36119645637`.
- M9B runtime/scheduler integration through CI `#614` / `36122721492`.
- M9C lease-loss/crash/restart safety through CI `#620`, `#622`, `#628`, `#630`.
- M9D isolated Windows physical proofs using local `llama.cpp`; closure HEAD `14e9991bd4312e51cbb02beb5403326d9d3fe522`; CI `#668` / `36226493586`. See `docs/MILESTONE-9D-PHYSICAL-PROOF.md`.

**Status: COMPLETE — shared live-runtime concurrency remains disabled pending separate authorization/review.**

## Milestone 10 — Interactive Operator Control Plane

Acceptance: bounded service-backed operator controls, same authority boundaries as non-UI callers, short-lived/single-use confirmation for mutating actions, durable audit/provenance, replay/stale-state/authority-drift failure, sanitized read-only evidence, and explicit absence of generic machine power.

Completed bounded mutations:
- escalation rejection and approval;
- task abort;
- rollback after machine-service authority hardening;
- exact workflow resume with expected-task pinning;
- task continuation inside the existing envelope without inventing pause/unpause task-state semantics;
- targeted recovery of exactly one interrupted orchestrator-owned scheduled writer through the existing recovery-permit + fenced-scheduler path.

Operator capability contract:
- supported mutations are exactly `reject_escalation`, `approve_escalation`, `abort_task`, `rollback_task`, `continue_task`, `resume_workflow`, `recover_scheduled_writer`;
- every supported mutation is described as `short_lived_single_use` confirmation and `delegated_to_trusted_service` authority;
- only local escalation rejection currently has browser exposure;
- passive visualization, task validation status, supervisor decision summary and active-writer status are read-only capabilities;
- Reviewer completion authority and Reviewer repair execution remain advisory only;
- standalone validation execution is intentionally unavailable because raw validation directly executes trusted configured commands and no independent authority-revalidating operator service exists;
- generic process control, raw Hub control, lease management, credential access and shared-runtime control are intentionally prohibited;
- pause-state mutation remains unavailable until a deliberate durable state/service contract exists;
- release authority remains reserved for Milestone 15.

Key evidence:
- initial rejection/browser slices through CI `#674`;
- task abort through CI `#680`;
- escalation approval through CI `#684`;
- rollback hardening/operator rollback through CI `#690/#695`;
- workflow candidate pinning/resume through CI `#701/#707`;
- task continuation implementation `f10b6063cc6b4eefad434522325a46ee831a88a8`, tests `79805167ef36e590b6128e05adc84b937ab82973`, synchronization correction `245c218d3245af5cec164ba0db4a348b40c8e3c5`; CI `#715` / `36303792935`;
- targeted scheduled-writer recovery boundary `7065a6a0125a48121249bb519174e1509092bb3b`, operator wrapper `7bf571f83c517348124af6a241f6c92aca8c575f`, tests through `9e491a03db6bc47e634c3b194a7049765aea56f1`; CI `#727` / `36311314469`;
- explicit machine-readable capability contract `45b1fd891b555c8759f78c75bf795fe07d9fa7a0`, boundary tests `2a731781316de4a4db5681f07188c024c50be3a1`; CI `#733` / `36313371285` passed typecheck + full suite.

**Status: COMPLETE — intentionally unavailable Reviewer/validation/generic-worker powers are part of the safety boundary, not unfinished operator functionality.**

## Milestone 11 — Secure Remote ChatGPT Control Plane

Planned: remote threat model, explicit machine-local registration, authenticated/revocable short-lived remote sessions, local Hub credentials, opaque IDs/sanitized evidence, Safety Preview for new write tasks, replay protection/rate limiting/audit/revocation and no stale-authority resurrection after reconnect.

**Status: PLANNED — NEXT**

## Milestone 12 — Distributed / Multi-Machine Orchestration

Planned: transactional distributed fencing backend, monotonic fencing, distributed worker registry/heartbeats/ownership transfer, independent Safety Plan authority, versioned protocol and deterministic partition/failure behavior.

**Status: PLANNED**

## Milestone 13 — Advanced Multi-Agent Delegation

Planned: bounded architect/implementer/test/reviewer roles, current task/Safety Plan binding, orchestrator-safe-executor side effects only, native teams/subagents disabled until separately reviewed adapter, child scope/tool/network/secret/release containment, delegation budgets and parent cancellation/authority-revision invalidation.

**Status: PLANNED**

## Milestone 14 — Autonomous Software-Engineering Loops

Planned: issue/work-item ingestion as proposals only, bounded task decomposition, CI diagnosis without self-authorized scope expansion, isolated dependency maintenance, durable project memory/context rotation and evidence-based workflow completion.

**Status: PLANNED**

## Milestone 15 — GitHub Delivery and Release Authority

Authority model: edit != commit != push != PR != merge != deployment.

Planned: separate grants/audit for commit/push/PR/merge/deploy, default denial of release actions, protected-branch/destructive-Git denial, validated diff evidence for PR creation and explicit merge/deploy gates.

**Status: PLANNED**

## Milestone 16 — Production Security, Reliability and Observability

Planned: threat model, credential rotation/revocation, audit integrity, durable-store backup/recovery/migration, crash/restart handling, sanitized logs/metrics/traces and chaos proof across workers/Hub/orchestrator/storage/model/network.

**Status: PLANNED**

## Milestone 17 — Productization and Installation

Planned: supported install/update/uninstall, compatible pinned Hub detection, first-run registration/Safety Preview flow, built-in safe profiles, credential-safe diagnostics/config export and durable-state migrations.

**Status: PLANNED**

## Milestone 18 — Production Release

End-to-end invariants: machine access is never implied; workspace access is never inferred; worker count/delegation never increases authority; a model cannot approve itself; stale workers cannot write; UI/workflow/transport cannot bypass or expand policy; edit authority never silently becomes release authority.

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
| 10 | Interactive operator control plane | Complete — bounded capability contract + CI `#733` |
| 11 | Secure remote ChatGPT control | Next |
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
| Bounded local operator mutations | Complete / cloud tested — M10 |
| Operator capability boundary manifest | Complete / cloud tested — M10 |
| Workspace locks/fencing + scheduler contract | Complete / cloud tested |
| Lease-aware owner write boundary | Complete / cloud tested — M9A |
| Scheduler → orchestrator-owned Hub integration | Complete / cloud tested — M9B |
| Failure/restart/stale-writer safety | Complete / cloud tested — M9C |
| Disposable physical concurrent-runtime proof | Proven on isolated Windows workspaces — M9D |
| Secure remote ChatGPT control | Not implemented — M11 next |
| Shared live machine-runtime concurrency | Disabled pending separate authorization/review |
| Native team/subagent execution | Disabled — M13 |
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
10. MCP remains loopback-only until Milestone 11 deliberately adds a remote transport boundary.
11. Reviewer `pass` cannot mark a task complete or grant broader authority.
12. Sentinel remains observational.
13. Locks/scheduler are single-gateway primitives until Milestone 12.
14. Shared live concurrent machine-runtime writes remain disabled after isolated M9D proof pending separate authorization/review.
15. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
16. Any proof that mutates/restarts shared local Hub/Cline/VS Code runtime requires explicit user authorization immediately before that proof.
17. Rollback remains a high-impact workspace mutation requiring current authority revalidation and bounded confirmation.
18. Workflow resume confirmation never grants authority; current workflow/task/budget state and independent starter authority remain mandatory.
19. Task continuation cannot enlarge the approved envelope and does not create pause/unpause semantics.
20. Targeted scheduled-writer recovery grants neither lease nor owner identity; the existing recovery permit, scheduler and lease-aware runner remain authoritative.
21. Reviewer/validation interaction is observational/advisory at the operator boundary; standalone validation execution remains unavailable until a separate trusted service exists.
22. Generic Hub/process/lease/credential/shared-runtime controls are intentionally absent from the operator plane.
23. Remote connectivity in Milestone 11 must never expose local Hub credentials or transform transport authentication into task/workspace authority.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–10.**
2. **NEXT — Milestone 11 Secure Remote ChatGPT Control Plane.** Begin with the threat model and remote-session authority contract before opening any listener or adding any external transport. Define explicit machine-local registration, remote principal/session identity, short-lived/revocable authentication, capability projection from the M10 manifest, replay/rate-limit/audit requirements, sanitized evidence rules and reconnect/authority-revision invalidation behavior. Remote sessions must not receive raw paths, credentials, Hub/process/lease controls or release authority.
3. **STILL GATED — network listener/external transport implementation** until the M11 threat model and authority contract are reviewed in code/tests.
4. **STILL GATED — shared-runtime changes, native teams/subagents, distributed scheduling, push/merge/deploy/destructive Git, secrets, external-network mutation or system changes** until their milestone/policy gate is satisfied.

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 7 complete through CI `#518` / `36105316586`.
- 2026-09-25: Milestone 8 complete through CI `#588` / `36114475941`.
- 2026-09-26: Milestone 9D closed on `14e9991bd4312e51cbb02beb5403326d9d3fe522`; branch-head CI `#668` / `36226493586` passed after isolated Windows physical proofs. Shared runtime concurrency remains disabled pending separate authorization/review.
- 2026-09-26: Milestone 10 escalation decisions, abort, rollback and workflow-resume slices completed through CI `#707` and related earlier green runs.
- 2026-09-27: Milestone 10 bounded task continuation completed through `245c218d3245af5cec164ba0db4a348b40c8e3c5`; CI `#715` / `36303792935` passed.
- 2026-09-27: Milestone 10 targeted scheduled-writer recovery completed through `9e491a03db6bc47e634c3b194a7049765aea56f1`; CI `#727` / `36311314469` passed.
- 2026-09-27: Milestone 10 final boundary review confirmed Reviewer output is advisory, raw validation is task-lifecycle-coupled and generic Hub/process/lease/credential controls must remain unavailable. Machine-readable capability contract `45b1fd891b555c8759f78c75bf795fe07d9fa7a0` plus tests `2a731781316de4a4db5681f07188c024c50be3a1`; CI `#733` / `36313371285` passed typecheck + full suite. Milestone 10 closed.

---

# Current Next Step

**Milestone 11 — Secure Remote ChatGPT Control Plane, Slice 11A: threat model + remote-session authority contract.** Do not open a network listener yet. First specify and test the remote trust boundary: explicit local registration; opaque machine/session IDs; authenticated short-lived revocable sessions; projected M10 capabilities only; local-only Hub credentials; sanitized evidence; replay/rate limiting/audit; session revocation; and stale-authority invalidation when registry/Safety Plan/capability revisions change. Keep release authority, generic machine/process/Hub/lease access and shared-runtime mutation outside this milestone slice.

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
