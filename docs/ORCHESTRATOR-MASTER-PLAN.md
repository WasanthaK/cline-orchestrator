# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-29
Branch: `phase-1/bootstrap`

## Canonical rules

1. Finish milestones in order; implement only the first unfinished item unless a prerequisite defect is found, the user explicitly defers a separately gated physical proof, or the user explicitly prioritizes a bounded end-to-end product proof needed to validate the core workflow before deeper infrastructure work.
2. Use GitHub-hosted CI for normal proof. Do not mutate/restart the shared local Cline/Hub/VS Code runtime without explicit user authorization immediately before that proof.
3. ChatGPT receives task authority, never unrestricted machine authority.
4. Registry + approved Safety Plan/task envelope are authoritative. Scope expansion fails closed to durable human escalation or a fresh Safety Preview.
5. Planner/Reviewer output is advisory unless admitted by trusted orchestration code.
6. Workflow, dashboard, handoff, lock, scheduler, Hub participation, remote transport, distributed routing, placement, delivery and renewal evidence never grant task authority.
7. Lease possession is coordination only; current durable authority plus a current fenced local writer lease are required before coordinated writes.
8. Native teams/subagents, generic shell/network/plugin execution, raw Hub/process/lease/credential controls and release authority remain separately gated.
9. Edit authority is separate from commit, push, PR, merge and deployment authority.
10. User-visible controls invoke the same trusted service boundaries as non-UI callers.
11. Remote authentication is transport identity only; it never becomes human confirmation, Safety Plan approval, credential authority, or release authority.
12. Distributed machine registration, workspace placement, candidate assignment, dispatch, delivery and renewal are identity/routing/coordination evidence only. They never replace target-local task/Safety/workspace authority or the local writer lease.
13. Cline completion text is untrusted worker testimony. Preserve it for supervisor context, but never let it override independently captured validation, diff-safety, Git, checkpoint or runtime evidence.
14. No listener, tunnel, DNS/firewall/port-forwarding change, credential provisioning, external network mutation, merge, deploy or destructive Git operation may be performed without the separately required explicit authorization.
15. Distributed restart/recovery must fail closed. A prior dispatch, candidate, fence, handoff context or runtime history must never become takeover authority after process/machine restart.

## End goal

ChatGPT → Planner / Architect / Reviewer → Orchestrator → bounded Cline workers → registered workspaces → validation / Git safety / evidence, with durable memory, context rotation, safe concurrency, human control, multi-machine coordination and explicit release authority.

---

# Milestone status

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
| 10 | Interactive operator control plane | Complete — capability contract + CI `#733` |
| 11 | Secure remote ChatGPT control | Software complete through 11H; external/physical proof deferred and still gated |
| 12 | Distributed / multi-machine orchestration | In progress — 12A–12O complete; latest code CI `#967`; target-pull delivery, target-local execution, candidate/fence renewal, fail-safe abort and restart no-resurrection are proven in-process; real cross-machine network transport/listener and any distributed takeover/recovery remain separately gated |
| 13 | Safe multi-agent delegation | Planned |
| 14 | Autonomous engineering loops | Planned |
| 15 | GitHub delivery / release authority | Planned |
| 16 | Production security / reliability / observability | Planned |
| 17 | Productization / installer / first-run UX | Planned |
| 18 | Production release | Planned |

---

# Milestones 1–10 — COMPLETE

Foundation, reversible Git safety, context durability, durable project memory, task-oriented MCP/Cline Hub runtime, GPT Supervisor, unattended workflows, UI/concurrency safety, controlled parallel writers and the bounded operator plane are complete.

Milestone 10 mutations remain exactly: `reject_escalation`, `approve_escalation`, `abort_task`, `rollback_task`, `continue_task`, `resume_workflow`, and `recover_scheduled_writer`. Each uses short-lived single-use confirmation and an independently authority-enforcing trusted service. Generic machine/runtime/release controls remain unavailable.

Evidence: M9 isolated physical proof + CI `#668`; M10 continuation CI `#715`; targeted writer recovery CI `#727`; capability manifest `45b1fd891b555c8759f78c75bf795fe07d9fa7a0`; tests `2a731781316de4a4db5681f07188c024c50be3a1`; CI `#733`.

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

Software implementation is complete through 11H:

- 11A threat model + remote-session authority contract — CI `#741`.
- 11B machine-local remote registration store — CI `#749`.
- 11C short-lived bearer/replay/rate/audit primitives — CI `#757`.
- 11D opt-in authenticated loopback read transport — CI `#767`.
- 11E remote mutation proposal + distinct local-human approval bridge — CI `#775`.
- 11F all seven M10 mutations adapted without authority widening — CI `#779`.
- 11G loopback mutation propose/execute transport; no remote approve/confirm route — CI `#783`.
- 11H distinct `propose_new_task` capability + local Safety Preview/confirmation + one-shot start permit — CI `#795`; loopback task-start transport — CI `#799`.

**External/physical M11 proof remains deliberately unperformed.** It requires explicit authorization immediately before any external listener/relay/tunnel/DNS/firewall/port-forward/credential/network mutation. The user explicitly directed work to M12 on 2026-09-28. No raw public bind is acceptable.

---

# Reliability and core supervisory prerequisites — COMPLETE

## Cline runtime recovery

Bounded recovery handles hard provider context overflow and malformed/schema-invalid model tool calls without broadening authority. Unknown execution failures still fail closed. Evidence: `34c1599fc10a62af529eb2db4a648fa187c9f5b7`, `834908b64f4677e4c5daba0b423a38e5068a745a`, `59a53beec78ef4e39512b50c2dba8a10e16e1196`; CI `#809`.

## CR1 — Completion review packet

Cline completion prose is preserved as `untrusted_worker_claims`; independent validation/diff/Git/checkpoint evidence remains authoritative. Read-only MCP `get_task_completion` exposes bounded sanitized evidence. CI `#822`.

## CR2 — Supervisor consumption + correction handoff

Trusted coordinator validates bounded reviewer output, journals decisions and delegates repairs only through the existing trusted `continueTask` boundary. CI `#829`.

## CR3 — Real Cline completion/review/correction proof

Guarded disposable proof demonstrated real Cline completion → review → one bounded correction → second completion → advisory pass. CI `#840`; authorized Windows physical proof passed twice. It does not claim external ChatGPT transport or release authority.

---

# Milestone 12 — Distributed / Multi-Machine Orchestration

Acceptance target: coordinate registered machines and workspace placements without turning routing, liveness, assignment, transport, delivery, renewal or restart evidence into execution authority; preserve task/Safety Plan/workspace-registry authority on the target; prevent split-brain writers; and survive stale registrations, reconnects and machine/process loss without resurrecting stale authority.

## 12A — Distributed identity / placement / candidate-assignment authority contract — COMPLETE

`src/distributed-control-contract.ts` defines identity-only machine registration, routing-only placement and short-lived coordination-only writer candidates. All grant flags are false; no path/credential/command material is accepted. Evidence `d68a665291b974706348d4bb9ed9de50774e2385`; tests `f7fd7d2979f861ff270c072e83ba36047d49f82b`; CI `#811`.

## 12B — Durable machine registration + workspace placement store — COMPLETE

Durable exact-revision registration and placement stores preserve identity/routing-only semantics and fail closed on malformed/ambiguous/stale state. Evidence registrations `8d48992d1a30fbc9f7cd108a54008729a26b9391`; placement `69ebe3ccd290c723bda0e2c5dcc4a12d22f075ad`; tests `364ca98e970a1c472a816ca7f695871cda7b00d6`; CI `#851` attempt 2.

## 12C — Authenticated machine transport + liveness contract — COMPLETE

Controller-local short-lived bearer sessions bind exact machine registration/revision, replay-protect request IDs and expose only `report_status` / `accept_writer_candidates`. Liveness is observation-only and process-local. No listener exists. Evidence `fa81ab281e7fc0f326f153f059ddd12f1e4d3245`; tests `3efc4b45f852cb7f116d8698009e59898cef777d`; CI `#857`.

## 12D — Placement-aware candidate routing — COMPLETE

Router requires current placement, current non-revoked registration, fresh liveness and explicit candidate acceptance, then returns only the existing short-lived coordination candidate and revalidates after creation. Evidence `87b502fb9dd30522dc7a0c6c8a54cac72af928d6`; tests `aa62aaa842b2ce01c5d639dc33cae48088d7744f`; CI `#863`.

## 12E — Distributed fencing / split-brain semantics — COMPLETE

Fencing uses monotonic per-workspace generations over a linearizable compare-exchange contract. Claims bind exact task/workspace/machine/registration/placement/candidate identity and remain authority-free. Renewal preserves generation while advancing exact backend state; stale copies fail. Reference backend is deterministic single-process proof only. Evidence `61ce376d626c24f54471c171486d2c31b067de7d`; tests `d017ca09156b3197adfd545b1ad4c288e45c3ee8`; CI `#869`.

## 12F — Production shared fencing backend + target write-boundary composition — COMPLETE

PostgreSQL provides durable linearizable fencing across independent processes. Every distributed `editor` / `applyPatch` path requires current durable task/Safety authority, exact current local writer lease and immediate current distributed-fence validation before mutation. Evidence through `f70037bac46d95bb66959a320aee94e86ac49cf0`; write composition `9cbc2647d029631cc7d00fa02ce7caa21052ca9f`; guard `205724c0c7942dbea966b32f4521660bdc92fbc9`; stale-generation proof `b3fa5200cd86ff4b5690ec3e99190e47774f003a`; CI `#892`.

## 12G — Target execution admission + durable replay — COMPLETE

`src/distributed-execution-admission.ts` creates a short-lived opaque dispatch bound to exact target/candidate/fence evidence. `FileDistributedDispatchReplayStore` provides machine-local durable single consumption across process restart. Dispatch/admission contains no prompt, command, path, Safety Plan, lease, credential or release material. Evidence `ca22b671aedfbb5ac0470d60486852510625d050`; tests `bd5ce0f0aa5a2f596d5ccbc06d809f983c6438f4`; CI `#899`.

## 12H — Admitted target-runtime handoff — COMPLETE

Target resolves workspace/task from local durable state, preserves narrowed Safety scope, requires a fresh `created` task with no runtime history/takeover, exact current local writer lease and current shared fence, consumes M12G once, reloads durable state after admission and returns process-local runtime context only. Evidence through `efeabe6a65100bae8e72bd1afc57e678cc7258bf`; CI `#914`.

## 12I — Target runtime start / lease-aware execution composition — COMPLETE

`src/distributed-target-runtime-start.ts` starts the existing target-local ClineRunner only from M12H process-local context. Prompt comes only from the target-local durable task goal. Immediate pre-session revalidation requires the expected first-start transition, current task/Safety authority, exact local lease and current distributed fence. Local lease loss actively aborts the in-flight run. Evidence `6736327ef61bc4c55448b22ea07d15c2329d5cf3`; tests `18cf71e0acddfed6c2b682610a7c585c83daf0ad`; CI `#921`.

## 12J — Authenticated target-pull execution delivery — COMPLETE

`src/distributed-execution-delivery.ts` composes existing M12C machine authentication with a target-pull delivery boundary. Pull requires `accept_writer_candidates`; returned bundle contains only M12C authorization evidence plus the existing authority-free M12G dispatch, M12D assignment and M12E fence. It contains no bearer token, prompt, command, workspace path, Safety Plan, local lease, credential or release instruction.

The target receiver accepts only its exact machine/registration revision, strictly validates fields, then enters only M12H → M12I. M12C request replay blocks duplicate pulls and M12G durable replay remains authoritative during M12H. No controller push, listener, external network transport or reciprocal server-auth claim was added. M12C target→controller bearer authentication must never be reinterpreted as controller/server authentication.

Evidence: boundary `d96cfcb56bcd3d75bea1db140eebe65bc7a957fa`; tests `3c787d118f6487f9750dfdba342281c1c36c72f1`; type-only correction `cf0b7401c5ec5e917c68b7ea2dd16a844e7ef43a`; CI `#928` / `36553603109`.

## 12K — Distributed fence renewal lifecycle — COMPLETE

The distributed write fence guard is renewal-aware and `DistributedFenceLifecycle` renews the exact current fence for long-running target execution without changing generation or granting authority. Renewal is serialized with validation so stale fence copies cannot become current again. Evidence guard `e2b8e30c7fc918cf4e6a3ba34a019fbd0821ce24`; lifecycle `1b746457bb43485308f773cda65fe50bcfbbe672`; proof `869ee41f0a84a58932ea15e514205ba1153e3e23`; CI `#935` / `36559281183`.

## 12L — Renewal-loss fail-safe abort — COMPLETE

Fence-renewal lifecycle loss is wired into the existing M12I target runtime. Renewal failure actively aborts the in-flight Cline run; per-write M12F validation remains authoritative and continues to reject stale writes. Evidence runtime wiring `5fd60864dc2e73ba4044d4f842e08ebefbaa19e8`; runtime proof `06260262c80e767b12cccf56f4b9e08582ff9a02`; CI `#939` / `36560882837`.

## 12M — Writer-candidate renewal lifecycle — COMPLETE

`src/distributed-candidate-lifecycle.ts` renews only the exact same assignment identity/bindings and extends time only after current routing/liveness validation. Registration/placement/liveness loss or binding drift fails closed. Candidate renewal remains coordination-only and cannot grant execution authority. Evidence implementation `f92da38e15b4503675a51dc68c3820c7a380b2e4`; proof `0be2fe14f09b3309dde2261a63e4d3a0c24c079e`; CI `#943` / `36567229962`.

## 12N — Candidate → fence renewal composition — COMPLETE

The M12F/M12K renewal-aware guard now carries the current exact candidate and exposes serialized same-binding candidate renewal. Every renewal cycle renews the exact candidate first, then renews the same fence generation under the same guard serialization. Candidate identity/task/workspace/machine/registration/placement/authority bindings cannot change.

If candidate renewal fails, fence renewal is not attempted. Candidate or fence renewal failure raises the same lifecycle abort signal consumed by the M12L fail-safe path, aborting the in-flight Cline run. The runtime contract explicitly records candidate renewal as included. No parallel lifecycle, network transport or new authority was introduced.

Evidence: candidate-aware guard `6e7b72fe019a8b9e871cfa8abeed3d49859d14c4`; composition `295316402f208edb03bdcf0adbef8f1852ef05e0`; lifecycle proof `bb617585409499d95eae93e2b7e257c6b7635180`; runtime abort proof `88ca5fd01431af5309d7b5490ca2fe81e168ff1d`; deterministic fixture correction `dc3f64dbf4e429ad42ebd437f47dd9cd06a2bf1a`; final runtime contract `242fecb2abce935bdbf1ca6c615e4adc8168bdb8`; final CI `#959` / `36574342286` passed typecheck + full suite.

## 12O — Restart / stale-coordination no-resurrection proof — COMPLETE

`src/distributed-restart-safety.ts` records an authority-free restart-safety contract: restart creates no authority, consumed dispatches are not reusable, stale candidates/fences are not reusable, process-local handoff context is not reusable, prior runtime history is not eligible for fresh admission, and distributed takeover remains disabled.

`src/distributed-restart-safety.test.ts` proves existing trusted barriers still fail closed when process-local objects are recreated:

- M12G durable replay markers survive replay-store object/process recreation, so a consumed dispatch stays consumed;
- an expired candidate cannot be renewed by a freshly constructed candidate lifecycle/router;
- a superseded fence cannot be validated or renewed by a freshly constructed fence authority object;
- a task with prior runtime history (`runCount > 0`) is rejected by M12H before M12G admission is consumed;
- no restart path creates task/filesystem/Safety/lease/credential/release authority and no takeover/recovery/listener/network path is introduced.

Initial hosted CI `#965` failed only at TypeScript fixture typing, before tests ran: the restart test supplied lightweight objects where the handoff constructor requires concrete `DistributedExecutionAdmissionGateway` and `DistributedFenceAuthority` types. The fixture was corrected without weakening production validation. Evidence: restart safety contract/test commit through PR merge head before correction; fixture correction `17232804c98b024fda620c45d210dcb3cb55a75d`; final CI `#967` / `36580291353` passed typecheck + full suite.

Any future distributed takeover/recovery flow must be a later separately reviewed trusted path with fresh authority and fencing. M12O deliberately does not create one.

---

# Current capability snapshot

| Capability | Status |
|---|---|
| Registry + Safety Preview | Complete / physically proven |
| Hub runtime + owner safety | Complete / physically proven |
| Task-oriented MCP gateway | Complete / loopback-only |
| GPT Supervisor + completion/review/correction | Complete — CR1–CR3 |
| Bounded local operator mutations | Complete — M10 |
| Lease-aware parallel writer safety | Complete — M9 |
| Secure remote-control software boundary | Complete through M11H; external proof deferred |
| Distributed registration/placement/routing | Complete — M12A–M12D |
| Durable distributed fencing + target write guard | Complete — M12E–M12F |
| One-shot target admission + durable replay | Complete — M12G |
| Target-local authority handoff + Cline start | Complete — M12H–M12I |
| Authenticated target-pull delivery composition | Complete — M12J; process-local adapter/receiver only |
| Fence renewal + fail-safe abort | Complete — M12K–M12L |
| Candidate renewal + candidate→fence composition | Complete — M12M–M12N |
| Restart no-resurrection proof | Complete — M12O; CI `#967` |
| Distributed takeover/recovery | Disabled; requires a separately reviewed fresh-authority design |
| Distributed network listener/adapter | Disabled / separately gated |
| Controller-to-target network push | Disabled |
| Real cross-machine production writer execution | Disabled; no real network transport is production-wired |
| Shared live-runtime concurrency | Disabled pending separate authorization/review |
| Native teams/subagents | Disabled — M13 |
| Push/merge/deploy authority | Disabled — M15 |

---

# Known constraints and risks

1. Credentials must never enter durable/model-facing task/project/distributed state.
2. Validation commands are trusted local configuration; Planner text cannot self-admit them.
3. Reviewer `pass` cannot mark tasks complete or broaden authority.
4. Machine-local writer lease and distributed fence are distinct prerequisites; neither substitutes for task/Safety authority.
5. Shared live concurrent runtime remains disabled after isolated M9 proof pending separate authorization/review.
6. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
7. Remote authentication is transport identity only and cannot become human/Safety/task/credential/release authority.
8. Local revocation, registration revision and capability reduction must win over stale remote/distributed state.
9. M11 loopback transport is opt-in and not automatically production-wired.
10. External listener/relay/tunnel proof requires explicit authorization immediately before the action and reviewed secure transport; no raw public bind.
11. Runtime recovery remains narrowly classified and bounded; it cannot retry unknown side-effect failures or expand authority.
12. No M12 routing/placement/assignment/dispatch/delivery artifact may substitute for target-local task/Safety/workspace-registry revalidation.
13. `ReferenceLinearizableFenceBackend` is deterministic single-process proof only; PostgreSQL is the production shared fencing primitive.
14. A database-backed fence grants no task/filesystem/Safety/local-lease/credential/release/execution authority by itself.
15. M12G dispatch/admission receipt is evidence only and cannot carry executable instructions.
16. M12H handoff context is process-local only and must never be serialized as a distributed authority token.
17. M12C machine bearer identity proves target→controller authentication only; it is not reciprocal controller/server authentication. Any real network adapter must use separately reviewed secure server authentication.
18. M12J target-pull is software composition only; no real machine-to-machine network transport is proven or production-wired.
19. Candidate and fence renewal are continuation of coordination only. Either must fail closed on routing/liveness/fence loss and must never mint a new task authority envelope.
20. After restart, old dispatch/candidate/fence/handoff/runtime evidence must remain stale or consumed. Restart must never reconstruct an in-memory lifecycle and call it current.
21. Generic local scheduled-writer/workflow recovery cannot be silently reused as distributed takeover authority. Any future distributed recovery needs a separately reviewed fresh-admission/fresh-fence design.
22. Cline completion prose is reviewer context only; trusted captured evidence wins conflicts.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — M11A–M11H software/security implementation.** External physical proof remains deferred and separately gated.
3. **COMPLETE — Cline runtime recovery prerequisite.** CI `#809`.
4. **COMPLETE — CR1–CR3 supervisory completion/review/correction loop.** CI `#822`, `#829`, `#840` + authorized physical proof.
5. **COMPLETE — M12A–M12F distributed identity/routing/fencing/write-boundary prerequisites.**
6. **COMPLETE — M12G–M12J admission, target-local handoff/start and authenticated target-pull composition.**
7. **COMPLETE — M12K–M12N fence/candidate renewal and fail-safe abort lifecycle.** Final CI `#959`.
8. **COMPLETE — M12O restart / stale-coordination no-resurrection proof.** Final CI `#967`.
9. **STOP for review before defining the next Milestone 12 slice.** Any next step touching real network transport or distributed takeover/recovery must be explicitly bounded and reviewed first.
10. **DO NOT production-wire cross-machine delivery/execution** until a later explicitly reviewed secure transport slice preserves M12G replay, M12H local re-entry, M12I start guards, M12N lifecycle, M12O restart no-resurrection and M12F immediate write fencing.
11. **DO NOT perform public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning or external-network changes** without explicit user authorization immediately before the action.

---

# Recent progress

- 2026-09-28: M11 software complete through 11H; user directed work to M12; external M11 proof deferred.
- 2026-09-28: Cline context/tool-protocol recovery CI `#809`; CR1 CI `#822`; CR2 CI `#829`; CR3 CI `#840` + authorized Windows physical proof.
- 2026-09-29: M12A CI `#811`; M12B CI `#851`; M12C CI `#857`; M12D CI `#863`; M12E CI `#869`; M12F CI `#892`.
- 2026-09-29: M12G CI `#899`; M12H CI `#914`; M12I CI `#921`.
- 2026-09-29: M12J authenticated target-pull delivery boundary completed; CI `#928`.
- 2026-09-29: M12K distributed fence renewal completed; CI `#935`.
- 2026-09-29: M12L fence-renewal-loss runtime abort completed; CI `#939`.
- 2026-09-29: M12M writer candidate renewal completed; CI `#943`.
- 2026-09-29: M12N candidate→fence renewal composition and candidate-renewal-loss abort completed; final CI `#959`.
- 2026-09-29: M12O restart/stale-coordination no-resurrection proof completed; initial CI `#965` exposed test-fixture typing only; correction `17232804c98b024fda620c45d210dcb3cb55a75d`; final CI `#967` green.

---

# Current next step

**STOP for review.** M12O is complete. The next Milestone 12 slice is intentionally not yet defined. Do not add real network transport, listeners, controller push, distributed takeover/recovery, credential provisioning or release authority until the next bounded slice is explicitly reviewed.