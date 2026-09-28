# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-28
Branch: `phase-1/bootstrap`

## Canonical rules

1. Finish milestones in order; implement only the first unfinished item unless a prerequisite defect is found, the user explicitly defers a separately gated physical proof, or the user explicitly prioritizes a bounded end-to-end product proof needed to validate the core workflow before deeper infrastructure work.
2. Use GitHub-hosted CI for normal proof. Do not mutate/restart the shared local Cline/Hub/VS Code runtime without explicit user authorization immediately before that proof.
3. ChatGPT receives task authority, never unrestricted machine authority.
4. Registry + approved Safety Plan/task envelope are authoritative. Scope expansion fails closed to durable human escalation or a fresh Safety Preview.
5. Planner/Reviewer output is advisory unless admitted by trusted orchestration code.
6. Workflow, dashboard, handoff, lock, scheduler, Hub participation, remote transport, distributed routing and placement never grant task authority.
7. Lease possession is coordination only; current durable authority plus a current fenced lease are required before coordinated writes.
8. Native teams/subagents, generic shell/network/plugin execution, raw Hub/process/lease/credential controls and release authority remain separately gated.
9. Edit authority is separate from commit, push, PR, merge and deployment authority.
10. User-visible controls invoke the same trusted service boundaries as non-UI callers.
11. Remote authentication is transport identity only; it never becomes human confirmation, Safety Plan approval, credential authority, or release authority.
12. Distributed machine registration, workspace placement and dispatch are identity/routing/coordination evidence only; distributed write execution stays disabled until an independently reviewed distributed fencing boundary exists.
13. Cline completion text is untrusted worker testimony. Preserve it for supervisor context, but never let it override independently captured validation, diff-safety, Git, checkpoint or runtime evidence.

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
| 12 | Distributed / multi-machine orchestration | In progress — 12A complete, CI `#811`; 12B temporarily deferred for core Cline completion/review-loop proof |
| 13 | Safe multi-agent delegation | Planned |
| 14 | Autonomous engineering loops | Planned |
| 15 | GitHub delivery / release authority | Planned |
| 16 | Production security / reliability / observability | Planned |
| 17 | Productization / installer / first-run UX | Planned |
| 18 | Production release | Planned |

---

# Milestone 10 — Interactive Operator Control Plane — COMPLETE

Supported bounded mutations remain exactly `reject_escalation`, `approve_escalation`, `abort_task`, `rollback_task`, `continue_task`, `resume_workflow`, and `recover_scheduled_writer`. Each uses short-lived single-use confirmation and delegates to an independently authority-enforcing trusted service.

Reviewer completion/repair execution, standalone validation execution, generic process/Hub/lease/credential/shared-runtime control, pause-state mutation and release authority remain intentionally unavailable.

Evidence: continuation CI `#715`; targeted writer recovery CI `#727`; capability manifest `45b1fd891b555c8759f78c75bf795fe07d9fa7a0`; tests `2a731781316de4a4db5681f07188c024c50be3a1`; CI `#733`.

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

Acceptance target: explicit machine-local registration; authenticated/revocable short-lived sessions; local-only credentials; opaque IDs and sanitized evidence; remote proposals without remote human authority; Safety Preview for brand-new write tasks; replay protection; rate limiting; durable sanitized audit; revocation; and no stale-authority resurrection after reconnect.

## 11A–11H — SOFTWARE IMPLEMENTATION COMPLETE

- 11A threat model + remote-session authority contract complete. Evidence: `4f1bf14d685512945aebfe995d6d4f12466532ab`, `4f14c8e656ce376c07ce4a2724809a5f39eba4e0`, `10e34cb064f9f50712f4673e7476170464589ad5`, CI `#741`.
- 11B machine-local remote registration store complete. Evidence: `3a8ccc933f72f3587c179f6b86cebc10de0a21b8`, `992498981f0226e9e5b43d1f652dd866a64073e3`, `32691d4f567b08cb6fe05aed5f79006288632be1`, CI `#749`.
- 11C short-lived bearer session/replay/rate/audit primitives complete. Evidence: `ba6f6cb0d472fc59bef70665d53403b9732d1e83`, `826d642785b5e4f835b2a423377e3c765ca68fa7`, `d7de15868cbe384d43a9c28a1014e6a8f382080b`, CI `#757`.
- 11D opt-in authenticated loopback read transport complete; exactly four sanitized reads, loopback Host/Origin enforcement. Evidence through CI `#767`.
- 11E remote mutation proposal + distinct local-human approval bridge complete; hidden M10 confirmation material stays process-local. Evidence through CI `#775`.
- 11F all seven M10 mutations adapted without widening authority. Evidence through CI `#779`.
- 11G opt-in loopback mutation propose/execute transport complete; no remote approve/confirm route. Evidence through CI `#783`.
- 11H distinct `propose_new_task` capability + local Safety Preview/confirmation + one-shot start permit complete; loopback task-start transport exposes only propose/execute. Evidence: capability `9a817b9cd34c5cd9d0e78e0073085317936d4983`; bridge `546dbcce504116d8c549c036499a36acba72e0db`; tests through `44d6c55a7ad473d34a6237f1066d4843e16d923d`, CI `#795`; transport `90717b84fa5f09f57025549dfcc3a5d9a29e69a0`; tests `37e332e274e7c827b0958e4b1ca6b128f9ef442e`, CI `#799`.

**M11 external/physical proof remains deliberately unperformed.** It requires explicit user authorization immediately before any external listener/relay/tunnel/DNS/firewall/port-forward/credential/network mutation. The user explicitly directed work to Milestone 12 on 2026-09-28, so the physical proof is deferred rather than silently treated as complete. No raw public bind is acceptable.

---

# Reliability prerequisite before Milestone 12 — COMPLETE

Observed Cline failures could terminate unattended work even though orchestrator authority and scheduling were still valid:

- provider hard context overflow: `request (197745 tokens) exceeds the available context size (196608 tokens)`;
- malformed tool call JSON: `Tool call editor emitted invalid JSON arguments ... could not be parsed as JSON`;
- tool-schema failure such as `expected string, received undefined` for a required editor field.

Implemented a bounded runtime recovery layer in `src/cline-runtime-recovery.ts` and wired it into both local and Hub runtimes:

- hard provider context overflow is converted into the runner's existing durable replacement-session/handoff path rather than leaving an oversized physical session alive;
- malformed JSON or schema-invalid tool calls may be repaired in the same authorized session, default maximum two attempts;
- repair prompt explicitly treats the rejected tool call as not executed, forbids replay of earlier successful side effects, forbids scope expansion and guessing missing required values;
- unknown runtime failures, command/edit execution failures and exhausted repair attempts still fail closed;
- no new filesystem, command, Safety Plan, credential, network or release authority is created by recovery.

Evidence: recovery layer `34c1599fc10a62af529eb2db4a648fa187c9f5b7`; factory integration `834908b64f4677e4c5daba0b423a38e5068a745a`; exact regression tests `59a53beec78ef4e39512b50c2dba8a10e16e1196`; CI `#809` / `36365447770` passed typecheck + full suite.

---

# Core workflow proof prerequisite — Cline completion → ChatGPT review loop — IN PROGRESS

User-confirmed product workflow: ChatGPT creates bounded work for Cline; Cline implements and returns its normal completion report; orchestrator captures that report plus independent evidence; ChatGPT reviews/challenges and may issue a correction or direction change; the loop repeats until the goal is achieved or a real human/safety/release decision is required. This proof is intentionally prioritized before deeper M12 distribution because multi-machine execution is not useful until the single-machine supervisory loop is proven against the real Cline client.

## Slice CR1 — Completion review packet + read-only MCP surface — COMPLETE

Implemented `src/task-completion-packet.ts` and read-only MCP tool `get_task_completion`:

- uses the actual durable Cline `lastOutput` already captured from the runtime completion result; no fragile “task complete” regex is used as the primary completion signal;
- labels the Cline narrative `untrusted_worker_claims` so statements such as “tests pass” cannot overwrite orchestrator evidence;
- independently exposes bounded orchestrator validation result, diff-safety result, before/after Git snapshots, checkpoint state and recovery counters;
- preserves the raw Cline report locally while bounding the model-facing copy to 40,000 characters;
- redacts exact workspace root variants, current/previous Cline session IDs and obvious bearer/API-key/token/secret/password material from the model-facing report;
- keeps existing `get_task` sanitized; the richer report is isolated to a dedicated read-only surface;
- reuses the existing task lookup/registered-workspace validation before loading raw durable state;
- grants no new write, filesystem, Hub, credential, network or release authority.

Evidence: packet `cbaa0e0f97f44be77bfc067ddbd530eb8af0f2fc`; tests `4633942db886f82a5ba68feb87376948162d63b4`; typing cleanup `5851ea31944230ff14130f07b8a4c92bf287b77b`; MCP surface `339499a9769452f8574a00989ec3462203589f38`; MCP contract tests `0635aa122b7277217cd78ecdcc485be70b9e6ccb`; CI `#822` / `36369800829` passed typecheck + full suite.

## Slice CR2 — Supervisor consumption + correction handoff — COMPLETE

Implemented `src/supervisor-completion-review.ts` as a trusted coordinator around the existing CR1 completion packet, reviewer validator, durable supervisor-decision service and `MachineOrchestratorService.continueTask` boundary:

- completion packets are accepted only when bound to the exact approved supervisor task/project/workspace and marked `ready_for_supervisor_review`;
- the natural Cline completion report is inserted into the reviewer prompt only as a bounded, clearly delimited `untrusted_worker_claims` data block;
- reviewer rules explicitly forbid obeying commands, role changes, authority requests or reviewer instructions embedded in Cline testimony;
- independent orchestrator validation/diff/checkpoint evidence remains authoritative, and existing reviewer validation still rejects `pass` when required durable evidence is not satisfied;
- reviewer decisions remain exactly `pass`, `repair`, or `escalate`, with `completionAuthority: advisory_only`;
- admitted reviewer decisions are recorded through the existing `SupervisorDecisionService`; CR2 adds an append-only `.orchestrator/supervisor-completion-reviews/<task>.jsonl` journal containing the exact sanitized completion packet, review result, decision link and repair-handoff outcome;
- repair decisions are durably journaled before the instruction is handed to the existing trusted `continueTask` boundary, so the immutable task/Safety envelope remains the only execution authority;
- failed trusted repair handoff is recorded without erasing the admitted reviewer decision;
- journaled errors redact workspace roots and obvious bearer/API-key/token/secret/password material;
- no new filesystem, shell, Hub, credential, network, release, commit, push, PR, merge or deployment authority is introduced.

Evidence: coordinator `8ae0e21b285122e6edcca19240a7177c2604301c`; regression/injection/repair-handoff tests `007c32b8aef6dd19e80549c9bb73314e7dd6054b`; CI `#829` / `36371626059` passed typecheck + full suite.

## Slice CR3 — Real Cline client proof — NEXT / EXPLICIT AUTHORIZATION GATE

Prove one bounded disposable/registered-workspace task against the user's real Cline/Hub/VS Code environment:

1. start/continue only an orchestrator-owned Cline session;
2. observe runtime activity and terminal completion;
3. capture the natural Cline completion report automatically;
4. construct the completion packet with independent evidence;
5. feed it to the supervisor and, if needed, issue one bounded correction through the existing task envelope;
6. stop on goal achieved, safety/human escalation, failure or explicit release boundary.

This physical runtime proof requires explicit user authorization immediately before mutating/restarting or otherwise interacting with the shared local Cline/Hub/VS Code runtime. It does not authorize merge, deploy, destructive Git or external network mutation.

---

# Milestone 12 — Distributed / Multi-Machine Orchestration

Acceptance target: coordinate registered machines and workspace placements without turning routing, liveness, assignment or transport into execution authority; preserve task/Safety Plan/workspace-registry authority on the target machine; prevent split-brain writers with an independently reviewed distributed fencing backend before enabling cross-machine writes; survive stale registrations, reconnects and machine loss without resurrecting stale authority.

## Slice 12A — Distributed identity / placement / candidate-assignment authority contract — COMPLETE

Implemented `src/distributed-control-contract.ts`:

- machine registration uses opaque registration/machine IDs, monotonic revision semantics and an explicit capability allowlist containing only `report_status` and `accept_writer_candidates`;
- machine registration has `identity_only` authority and cannot contain workspace paths, endpoints, commands, credentials or execution material;
- workspace placement binds one opaque workspace ID to an exact machine registration ID/revision and has `routing_only` authority;
- placement contains no endpoint/path/credential material and becomes stale on machine registration revision change, revocation or placement disablement;
- writer candidate assignment is short-lived (1 second–2 minutes), exact-binding coordination evidence only;
- assignment binds task/workspace/machine/registration revision/placement revision and grants no task, filesystem, Safety Plan, writer-lease, credential or release authority;
- stale registration revision, revocation, placement revision change, disablement and assignment expiry fail closed;
- distributed write execution is explicitly `false` and the contract requires both a future distributed fencing boundary and the existing local fenced writer lease before any write execution can be enabled.

Evidence: contract `d68a665291b974706348d4bb9ed9de50774e2385`; tests `f7fd7d2979f861ff270c072e83ba36047d49f82b`; CI `#811` / `36365596173` passed typecheck + full suite.

## Slice 12B — Durable machine registration + workspace placement store — DEFERRED UNTIL CORE WORKFLOW PROOF

Planned bounded scope:

- machine-local/controller-side durable store for opaque machine registrations and workspace placements;
- atomic replacement, restrictive permissions, monotonic revision + exact expected-revision mutation;
- explicit create/list/get/update/revoke/disable boundaries only;
- fail closed on malformed, duplicate or ambiguous state;
- no network endpoints, credentials, workspace filesystem paths, Safety Plans, command payloads, Hub tokens or release authority in distributed registry state;
- 12B remains registry/state only: no cross-machine network connection and no distributed writer execution.

Later M12 slices must separately introduce authenticated machine transport, liveness, placement-aware scheduling, and a reviewed distributed fencing/consensus mechanism before any multi-machine writer execution is enabled.

---

# Current capability snapshot

| Capability | Status |
|---|---|
| Registry + Safety Preview | Complete / physically proven |
| Pre-execution policy + safe executors | Complete / physically proven |
| Hub runtime + owner safety | Complete / physically proven |
| Task-oriented MCP gateway | Complete / loopback-only |
| GPT Supervisor | Complete |
| Sentinel + unattended workflows | Complete |
| Bounded local operator mutations | Complete — M10 |
| Lease-aware parallel writer safety | Complete — M9 |
| Cline hard-context/protocol recovery | Complete — CI `#809` |
| Cline completion review packet | Complete — CR1 / CI `#822` |
| Supervisor consumption + bounded correction handoff | Complete — CR2 / CI `#829` |
| Real Cline client completion/review proof | Next — CR3 / explicit local-runtime authorization gate |
| Remote control software boundary | Complete through M11H |
| External remote listener/relay/tunnel proof | Deferred / disabled / explicit-authorization gate |
| Distributed identity/placement/assignment contract | Complete — M12A / CI `#811` |
| Durable distributed registration/placement store | Deferred until CR3 proof, then M12B |
| Distributed network transport | Disabled — later M12 slice |
| Distributed writer execution | Disabled pending distributed fencing |
| Shared live-runtime concurrency | Disabled pending separate authorization/review |
| Native teams/subagents | Disabled — M13 |
| Push/merge/deploy authority | Disabled — M15 |

---

# Known constraints and risks

1. Credentials must never enter durable/model-facing task/project/distributed state.
2. Validation commands are trusted local configuration; Planner text cannot self-admit them.
3. Reviewer `pass` cannot mark tasks complete or broaden authority.
4. Existing workspace lock store is machine-local and explicitly not a distributed lock service.
5. Existing writer scheduler is a single-gateway coordination primitive; M12 must not reinterpret it as cross-machine fencing.
6. Shared live concurrent runtime remains disabled after isolated M9D proof pending separate authorization/review.
7. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
8. Remote authentication is transport identity only; it cannot become human approval, Safety Plan approval, task authority, credential authority or release authority.
9. Local revocation, registration revision and capability reduction must win over stale remote/distributed state.
10. No remote endpoint may use bearer possession as a substitute for explicit M10 or Safety Preview human confirmation.
11. Loopback M11 transport modules are opt-in and are not automatically production-wired.
12. External exposure/physical remote proof requires explicit user authorization immediately before any listener/relay/tunnel/network mutation and must use a reviewed secure transport; no raw public bind is acceptable.
13. Runtime recovery must remain narrowly classified and bounded. It must not retry unknown side-effect failures or use recovery as authority expansion.
14. No M12 routing/placement/assignment artifact may become a substitute for target-machine task/Safety Plan/workspace-registry revalidation.
15. Cross-machine writes remain disabled until distributed fencing is designed, reviewed and CI/physical-failure proven.
16. Cline completion prose is useful reviewer context but is never independent proof; contradictions must resolve in favor of trusted captured evidence or human review.
17. A supervisor repair instruction may reuse only the existing immutable task authority. Any required scope expansion must stop for a fresh Safety Preview/human decision.
18. Completion-review journal records are evidence only. They do not grant execution or completion authority, and a failed repair handoff must remain visibly failed rather than being silently retried outside trusted task continuation.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — M11A–M11H software/security implementation and CI proof.** External physical proof remains deferred and separately gated.
3. **COMPLETE — prerequisite Cline context/tool-protocol recovery hardening.** CI `#809`.
4. **COMPLETE — M12A distributed identity/placement/candidate-assignment authority contract.** CI `#811`.
5. **COMPLETE — CR1 Cline completion review packet + read-only MCP surface.** CI `#822`.
6. **COMPLETE — CR2 supervisor consumption + bounded correction handoff.** CI `#829`.
7. **NEXT — CR3 real Cline client completion/review proof.** Obtain explicit local-runtime authorization immediately before the physical interaction.
8. **RESUME — M12B durable machine registration + workspace placement store** after the core single-machine workflow proof.
9. **DO NOT enable cross-machine writer execution** until an independently reviewed distributed fencing boundary exists in a later M12 slice.
10. **DO NOT perform raw public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning or external-network changes** without explicit user authorization immediately before the action.

---

# Recent progress

- 2026-09-27: M11D loopback read transport CI `#767`.
- 2026-09-27: M11E human-separate mutation approval bridge CI `#775`.
- 2026-09-27: M11F all-seven existing M10 adapter CI `#779`.
- 2026-09-27: M11G loopback mutation proposal/execute transport CI `#783`.
- 2026-09-28: M11H new-task Safety Preview bridge CI `#795`; loopback task-start transport CI `#799`.
- 2026-09-28: user directed work to Milestone 12; M11 external physical proof remains deferred, not closed.
- 2026-09-28: M12A distributed authority contract created in `d68a665291b974706348d4bb9ed9de50774e2385`.
- 2026-09-28: recoverable Cline hard-context/tool-protocol failures intercepted safely; regression suite CI `#809`.
- 2026-09-28: M12A authority-contract tests restored and full suite passed in CI `#811`.
- 2026-09-28: user clarified the core product workflow as ChatGPT → Cline → completion report/evidence → ChatGPT challenge/correction → repeat; deeper M12 work explicitly deferred until this single-machine loop is proven.
- 2026-09-28: CR1 completion review packet and `get_task_completion` read-only MCP surface completed; CI `#822` passed typecheck + full suite.
- 2026-09-28: CR2 completion packet → advisory supervisor review → durable decision/journal → trusted bounded repair handoff completed; prompt-injection and failed-handoff regression coverage passed in CI `#829`.

---

# Current next step

**CR3 — real Cline client completion/review proof.** Use one bounded disposable/registered-workspace task, orchestrator-owned Cline session, automatic completion capture, CR1 packet, CR2 supervisor review and at most one bounded correction through the existing immutable task/Safety envelope. Obtain explicit user authorization immediately before interacting with the shared local Cline/Hub/VS Code runtime. This proof does not authorize commit, push, PR, merge, deploy, destructive Git or external-network mutation.
