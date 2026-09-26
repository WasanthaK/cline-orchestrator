# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-26
Branch: `phase-1/bootstrap`

## Purpose

This is the canonical execution plan for `cline-orchestrator`.

Before implementation work: read this file, confirm branch/HEAD and the current milestone, implement only the first unfinished item, prefer GitHub-hosted CI over destructive local-runtime testing, then update this file with evidence and one concrete next action.

Detailed implementation history remains in Git history. This tracker intentionally stays concise and keeps only current architecture, acceptance state, key evidence, constraints and ordered next work authoritative.

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

## Objective

Turn the Milestone 8 scheduler/lease contracts into real orchestrator-managed parallel execution across independently registered workspaces without weakening task authority, Safety Plan enforcement, owner-targeted safe executors, checkpoint/rollback safety or human escalation.

Native Cline teams, native subagents and provider-owned execution remain disabled in this milestone.

## Slice 9A — Lease-aware owner-targeted executor boundary

- [x] Bind admitted worker to current durable task/Safety Plan/project/workspace/profile/owner authority plus a fenced workspace lease.
- [x] Revalidate durable authority immediately before each write-capable executor call.
- [x] Require a current valid fenced lease for `editor` and `applyPatch`.
- [x] Keep lease possession coordination-only; valid lease without matching durable authority fails closed.
- [x] Fail closed on abort, invalid lease/fence replacement and authority/profile/Safety Plan drift.
- [x] Permit heartbeat renewal to advance lease revision/expiry while preserving lease/fence identity.
- [x] Keep reads/search under existing Safety Plan policy without writer-lease authority.
- [x] Preserve the M5/M8 owner-targeted Hub executor/policy boundary.

Evidence: adapter `9af0e30dfa740e4b36b959257dc0b9352658623a`; tests `6937640e02a6c75bab8c6a9e2bb8ec5ca173e2da`; CI `#596` / `36119645637`.

## Slice 9B — Scheduler/runtime integration

- [x] Connect `writer-concurrency-scheduler` to orchestrator-owned Hub sessions through the lease-aware trusted adapter.
- [x] Enforce configurable total writer budget and one live writer per workspace.
- [x] Permit concurrency only across distinct workspaces.
- [x] Give every writer a distinct orchestrator-owned owner session; never silently take over an existing VS Code-created write session.
- [x] Start only already-approved durable tasks; scheduler admission grants no new path/tool/command authority.
- [x] Preserve existing task checkpoint/diff-safety accounting.
- [x] Keep implementation/cloud tests isolated from the shared local live Cline/Hub runtime.

Evidence:
- runtime wrapper `a4b9d34e9c7e68a8f1fb77374427ef79f6cf8137`; wrapper tests `442f2c4053bfb046b93940a2ea759a1a6b705c24`;
- scheduled writer runner through `bbf81b8710099eaa2690a439b90d2c1bfbee116a`;
- real scheduler/lock/registry/fake-Hub tests `2db5cb5ab09bb4fa3f1808ba133d722dbcaefd92`; Git-baseline correction `c9c05bacd104f91a46c3fd1b6eee4efdcad90bff`;
- deterministic concurrency barrier `e34ec64c9b40f936e64e5ab75a27e16d7f593e95`;
- CI `#610` / `36122080710` and stable branch-head CI `#614` / `36122721492` passed typecheck + full suite.

## Slice 9C — Failure, restart and stale-writer safety

- [x] Worker crash releases/expires coordination state without permitting stale writes after restart.
- [x] Hub disconnect/owner loss recover through durable handoff/revalidation rather than stale session replay.
- [x] Gateway restart uses explicit recovery admission and a new fenced lease before replacement ownership.
- [x] Heartbeat failure aborts the active Hub worker and transitions the task to a durable safe state.
- [x] Expired/stale worker cannot resurrect or silently reacquire prior lease/fence identity.
- [x] Duplicate writers for one workspace cannot both pass immediate pre-write fencing checks.
- [x] Restart reconciliation derives authority from current durable registry/task/Safety Plan/checkpoint/lease evidence.
- [x] Current authority/profile drift fails closed before recovery runtime creation.
- [x] A still-live old writer lease causes restart recovery to defer rather than take over.

Evidence:
- lease-loss lifecycle abort `859e5926ff4fb5d319bcd8013f0efbee83914f86`;
- deterministic mid-flight lease-loss proof `26bc387312af0c64381a8ca8cf69001c6920e6f8`, CI `#620` / `36123697383`;
- worker-crash/stale-executor proof `5bf842ce2531d43dd0f8709d140038f0c0ed8230`, CI `#622` / `36123899455`;
- explicit restart recovery permit `37a525528d29cfacaed298a1b3d54e78ee7a3933`;
- scheduled restart reconciler `ace360368bcb079c024567bd836281b73b2291a9`;
- expired-fence replacement/live-lease deferral/authority-drift tests `8532681548351985030cf7afaa72a8fd28358d23`, CI `#628` / `36124261939`;
- active fenced Hub owner-loss/handoff replacement test `d673fa603a281798beefe6c27f06982a5f191df8`, CI `#630` / `36124422542`.

## Slice 9D — Disposable physical proof

- [x] Prepare a gated disposable multi-workspace harness with isolated Hub/data,
  registry and Git roots; require actual overlapping Hub sends before reporting
  concurrent execution. Prepare a separate gated scheduled gateway restart
  harness. See `docs/MILESTONE-9D-PHYSICAL-PROOF.md`.
- [x] Use isolated disposable repositories/workspaces before shared development workspaces.
- [x] Prove two independent workspaces execute write tasks concurrently with separate leases/owner sessions.
- [x] Prove same-workspace competing writer admission is denied.
- [x] Prove forced lease loss prevents later writes.
- [x] Prove one worker failure cannot corrupt or broaden another worker's authority.
- [x] Prove validation, diff safety and rollback for both concurrent tasks.
- [x] Prove gateway restart/stale-worker behavior in isolation.
- [x] Keep the shared local Cline/Hub/VS Code runtime untouched during the disposable proofs; require explicit user authorization immediately before any future proof that mutates or restarts it.

Physical evidence (2026-09-26): Windows PC, local `llama.cpp` at
`127.0.0.1:8080`, alias `qwen38-27b-192k`, orchestrator worker
`ollama-openai`. Branch `phase-1/bootstrap` code HEAD
`3fd26d6c05df701e5adfaf5a1cdf14abc85ae48b`. The operator reported
`"passed": true` and exit code 0 for `proof:multi-workspace` and
`proof:scheduled-restart`; `proof:owner-loss` also exited 0 with the
replacement/validation/rollback fields shown. Full evidence summary and
operator TEMP log names: `docs/MILESTONE-9D-PHYSICAL-PROOF.md`.
CI `#666` / `36222404791` failed one rollback test because it raced the
transition to idle; a test-only wait for the public idle state passes local
typecheck and all 268 tests. Branch-head CI `#668` / `36226493586` on
`14e9991bd4312e51cbb02beb5403326d9d3fe522` completed successfully.

## Completion Gate

Milestone 9 is complete only when the orchestrator can physically run independent write-capable coding jobs concurrently on multiple isolated registered workspaces and a stale/unfenced worker is physically unable to write through the trusted executor boundary.

**Status: COMPLETE — Slice 9D disposable physical proofs and branch-head CI passed. Shared live-runtime concurrency remains disabled pending separate authorization/review.**

---

# Milestone 10 — Interactive Operator Control Plane

Planned: bounded service-backed pause/resume/abort/escalation/review/validation/rollback/workflow/worker actions, same policy boundary as non-UI callers, no generic shell/filesystem/Hub/process/credential surface, confirmation/audit for high-risk actions, replay/stale-action/authorization-drift tests.

- [x] Establish the first bounded, service-backed operator action: preview and confirm rejection of a pending safety escalation. The in-process token is short-lived, single-use and tied to the current task/safety snapshot; execution calls the existing machine service, which revalidates authority and records the decision. Concurrent opposite decisions are single-winner within one gateway process.
- [x] Connect the action to a separate opt-in loopback browser surface with an operator token, short-lived browser session, CSRF/origin checks, session-bound preview and explicit confirmation. Keep the passive visualization unchanged. See `docs/MILESTONE-10-LOCAL-OPERATOR.md`.
- [ ] Add the remaining bounded task, workflow and worker actions with their confirmation, audit, replay, stale-state and authority-drift checks.

**Status: IN PROGRESS — first action and local browser boundary implemented; remaining actions pending.**

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
| 10 | Interactive operator control plane | In progress — first action and local browser boundary |
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
17. M9A–9C are cloud/fake-runtime safety and lifecycle proofs; they do **not** constitute the disposable physical live-runtime proof required by M9D.
18. Shared live concurrent machine-runtime writes remain disabled after the isolated M9D proof pending separate authorization/review of shared-runtime use.
19. Native Cline teams/subagents require Milestone 13 and cannot be enabled by configuration alone.
20. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
21. Any proof that mutates/restarts shared local Hub/Cline/VS Code runtime requires explicit user authorization immediately before that proof.

---

# Immediate Work Queue

1. **COMPLETE — Milestones 1–8.**
2. **COMPLETE — Milestone 9 Slice 9A.** Lease-aware owner-targeted write boundary; CI `#596` / `36119645637`.
3. **COMPLETE — Milestone 9 Slice 9B.** Scheduler/runtime integration; stable branch-head CI `#614` / `36122721492`.
4. **COMPLETE — Milestone 9 Slice 9C.** Lease loss, worker crash, owner loss and gateway restart/stale-writer behavior; CI `#620`, `#622`, `#628`, `#630`.
5. **COMPLETE — Milestone 9 Slice 9D.** Three isolated disposable physical commands passed with exit 0; branch-head CI `#668` / `36226493586` succeeded.
6. **NEXT — Milestone 10 Interactive Operator Control Plane.** Review the opt-in local confirmation surface in CI, then add the remaining bounded actions in small slices; keep shared runtime disabled pending separate authorization/review.
7. **STILL GATED — native teams/subagents, distributed scheduling, UI write actions, push/merge/deploy/destructive Git, secrets, external-network mutation or system changes** until their milestone/policy gate is satisfied.

---

# Progress Log — Recent Closures

- 2026-09-25: Milestone 7 complete through CI `#518` / `36105316586`.
- 2026-09-25: Milestone 8 complete through CI `#588` / `36114475941`.
- 2026-09-25: roadmap extended through Milestone 18 in `228acad723add7cd4f6b81897700a2391625ab21`.
- 2026-09-25: Milestone 9A complete; adapter `9af0e30dfa740e4b36b959257dc0b9352658623a`, tests `6937640e02a6c75bab8c6a9e2bb8ec5ca173e2da`, CI `#596` / `36119645637`.
- 2026-09-25: Milestone 9B complete; real scheduler/Hub integration cloud proof through stable branch-head CI `#614` / `36122721492`.
- 2026-09-25: Milestone 9C complete; mid-flight lease-loss fail-safe CI `#620`, worker-crash/stale-executor CI `#622`, explicit fenced restart recovery CI `#628`, active Hub owner-loss/handoff recovery CI `#630`.
- 2026-09-25: Milestone 9D harness review added a bounded overlap barrier and an isolated scheduled restart proof command. Local Node test runner: 262 passed; typecheck passed. No new physical proof has run. Next: run the three gated proofs on a suitable local provider and review their evidence before changing any 9D acceptance checkbox.
- 2026-09-26: Windows test feedback identified fixture-only failures: directory symlink permissions and Git `core.autocrlf` inheritance. Use junctions in the two directory-link tests and force LF in the two temporary Git repository fixtures. Local typecheck and 262 tests pass; Windows rerun and physical proofs remain pending. The proof guide now configures the user's `llama.cpp` OpenAI-compatible endpoint explicitly.
- 2026-09-26: Three disposable live proofs on the Windows PC exited 0 using the local `llama.cpp` model; cross-workspace overlap, same-workspace denial, stale-write fencing, fault isolation, validation, checkpoint recovery and rollback were observed. Code HEAD `3fd26d6`; CI `#666` failed one test that raced workspace idle. A test-only idle wait passes local typecheck and 268 tests; green follow-up CI remains pending.
- 2026-09-26: Milestone 9D closed: test idle wait and physical evidence on `14e9991bd4312e51cbb02beb5403326d9d3fe522`; branch-head CI `#668` / `36226493586` passed. Shared runtime concurrency remains disabled pending separate authorization/review.
- 2026-09-26: Milestone 10 first slice: a short-lived, single-use escalation rejection preview/confirmation calls the existing machine service; stale/replayed decisions and competing approval/rejection fail closed, with the service's durable decision audit. Branch-head CI `#672` passed. The passive visualization remains unchanged.
- 2026-09-26: Milestone 10 local browser slice: a separate opt-in loopback page authenticates a local operator and requires a session-bound review and explicit rejection confirmation. Typecheck and 275 tests pass locally; CI review pending. The passive visualization and shared live runtime settings are unchanged.

---

# Current Next Step

**Milestone 10 — Interactive Operator Control Plane.** Review the opt-in local browser confirmation surface in CI, then implement remaining bounded actions in small slices. Keep shared live runtime concurrency disabled; obtain explicit user authorization immediately before any proposed proof that mutates/restarts shared local Cline/Hub/VS Code runtime.

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
