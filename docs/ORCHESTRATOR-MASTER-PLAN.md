# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-29
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
| 12 | Distributed / multi-machine orchestration | In progress — 12A–12H complete; latest code CI `#914`; network delivery and distributed writer execution remain disabled pending a separately reviewed next slice |
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

# Core workflow proof prerequisite — Cline completion → supervisor review loop — COMPLETE

User-confirmed product workflow: ChatGPT creates bounded work for Cline; Cline implements and returns its normal completion report; orchestrator captures that report plus independent evidence; ChatGPT reviews/challenges and may issue a correction or direction change; the loop repeats until the goal is achieved or a real human/safety/release decision is required. CR1–CR3 now prove the single-machine local supervisory loop against the real Cline runtime. The external ChatGPT transport remains a distinct M11 physical-proof boundary and is not implied by CR3.

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

## Slice CR3 — Real Cline client completion/review/correction proof — COMPLETE

Implemented guarded physical proof `src/live-cr3-completion-review-proof.ts` and npm command `cr3:proof`:

- requires explicit disposable-proof opt-in and re-runs the read-only CR3 preflight before execution;
- creates a disposable Git workspace and a separate isolated non-default loopback Cline Hub; it does not use the default/shared Cline Hub;
- starts a real orchestrator-owned Cline session and captures its natural completion report automatically;
- constructs the CR1 completion packet and requires independently passing validation, diff safety, one changed file and a usable checkpoint;
- feeds the packet through the real CR2 review/admission/journal path;
- uses a deterministic local proof reviewer to force exactly one bounded in-scope correction, proving the trusted `continueTask` handoff without introducing external model authority;
- Cline performs the second run in the same immutable approved task/Safety envelope; the second completion packet is captured and reviewed again;
- requires exactly two completion-review journal entries and one queued repair-handoff record;
- verifies `.env` and `outside.txt` protected files are unchanged;
- uses no model shell/network authority, release authority or external-network mutation;
- records `externalChatGPTTransportProven: false` explicitly, so this proof does not overclaim the separately gated M11 external ChatGPT transport.

Evidence: physical proof implementation `1eddec87a0ac784f4f096149988e856463654a34`; proof-command wiring `83bc209f911616d5b8cda860aae423a40c18f4d7`; CI `#840` / workflow `36407380806` passed typecheck + full suite. On 2026-09-28 the authorized Windows physical proof passed twice. The latest run showed initial Cline completion with `runCount=1`, passing validation/diff safety and one changed file; first supervisor decision `repair` / `repair_queued`; second Cline completion with `runCount=2`, passing validation/diff safety and one changed file; second supervisor decision `pass` / `pass_recorded`; two completion-review records; one queued repair handoff; protected files unchanged; isolated non-default loopback Hub; and no release/external-network authority.

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

## Slice 12B — Durable machine registration + workspace placement store — COMPLETE

Implemented controller-local durable distributed registry state without execution authority:

- `src/distributed-registration-store.ts` persists opaque machine registrations with `identity_only` authority, exact expected-revision updates, terminal revocation, atomic replacement and restrictive `0600` file creation;
- registration state fails closed on malformed records, duplicate registration IDs, multiple active registrations for one machine, unsupported capabilities, request-field widening and unsupported top-level persisted fields;
- `src/distributed-placement-store.ts` persists opaque workspace placements with `routing_only` authority and derives machine identity only from a current exact-revision machine registration;
- placement create/update rejects missing, revoked or revision-stale registrations; update can deliberately rebind a placement to a newer current registration revision or another current machine registration without granting execution authority;
- placement create/list/get/update/disable use exact opaque identities and monotonic revisions; disablement is terminal for that placement while permitting a later distinct active placement for the same opaque workspace;
- placement state fails closed on malformed records, duplicate placement IDs, multiple active placements for one workspace, request-field widening and unsupported top-level persisted fields;
- both stores use the shared atomic-write primitive with restrictive persistence and contain no network endpoint, credential, workspace filesystem path, Safety Plan, command payload, Hub token, writer lease or release authority;
- 12B remains registry/state only: no cross-machine network connection, no liveness authority, no placement-aware execution dispatch and no distributed writer execution.

Evidence: machine registration store `8d48992d1a30fbc9f7cd108a54008729a26b9391`, CI `#847` / `36442499050` passed typecheck + full suite; placement store `69ebe3ccd290c723bda0e2c5dcc4a12d22f075ad`; placement regression tests `364ca98e970a1c472a816ca7f695871cda7b00d6`; CI `#851` / `36498752454` attempt 2 passed typecheck + full suite unchanged after the first attempt exposed one unrelated timing-sensitive existing completion-event assertion.

## Slice 12C — Authenticated machine transport + liveness contract — COMPLETE

Implemented `src/distributed-machine-transport.ts` as a controller-local authenticated machine identity/liveness boundary:

- short-lived opaque bearer sessions are process-local, controller-issued, and bind the exact machine registration ID, machine ID and registration revision; session capability projection is limited to the M12A allowlist (`report_status`, `accept_writer_candidates`);
- every authorized request revalidates the current durable registration and fails closed on revocation, registration revision drift, expiry, unsupported capability or replayed request ID;
- transport claims and authorized-request evidence explicitly grant no task, filesystem, Safety Plan, writer-lease, credential or release authority;
- status reports contain only bounded `ready` / `busy` / `draining` state plus whether the machine currently accepts writer candidates; candidate acceptance cannot be advertised unless that exact capability exists in the authenticated session;
- liveness timestamps are controller-generated observation evidence only, are bound to the exact registration revision, cannot outlive the authenticating session, become stale on timeout, and are cleared immediately on explicit session revocation;
- process restart does not resurrect liveness or bearer sessions, and registration revision drift makes prior liveness unusable rather than carrying it forward;
- unexpected transport/session/payload fields and forged authority fail closed; no workspace paths, commands, Safety Plans, credentials, Hub tokens, writer leases or release authority are accepted into the 12C surface;
- 12C intentionally includes no network listener and no remote session-issuance endpoint. It proves the authenticated controller-side contract/gateway only; external listener/relay exposure remains separately gated;
- cross-machine write dispatch and distributed writer execution remain explicitly disabled.

Evidence: transport contract/gateway `fa81ab281e7fc0f326f153f059ddd12f1e4d3245`; regression tests `3efc4b45f852cb7f116d8698009e59898cef777d`; CI `#857` / workflow `36500722073` passed typecheck + full suite.

## Slice 12D — Placement-aware candidate routing/scheduling — COMPLETE

Implemented `src/distributed-candidate-router.ts` as a controller-side routing coordinator only:

- resolves exactly one active placement for the requested opaque workspace and rejects missing or ambiguous active placement state;
- revalidates that placement against the exact current non-revoked machine registration revision and requires `accept_writer_candidates` capability;
- requires fresh 12C liveness bound to the same registration ID, machine ID and registration revision, with `observation_only` authority and all authority-grant flags false;
- requires the live machine to explicitly advertise `acceptingWriterCandidates: true` before a candidate can be selected;
- creates only the existing M12A short-lived `coordination_only` writer-candidate assignment and then re-reads placement, registration and liveness before returning it, closing route/revision changes that occur during selection;
- `assertCandidateCurrent` fails closed after placement disable/revision change, registration revision drift/revocation, liveness loss or assignment expiry;
- the route request accepts exactly `taskId`, `workspaceId` and `ttlMs`; workspace paths, Safety Plans, command payloads, credentials, Hub tokens, local writer leases and release authority cannot enter the routing surface;
- no network command delivery, task execution, distributed write dispatch or distributed write execution is enabled by 12D.

Evidence: router `87b502fb9dd30522dc7a0c6c8a54cac72af928d6`; integration/regression tests `aa62aaa842b2ce01c5d639dc33cae48088d7744f`; CI `#863` / workflow `36521552004` passed typecheck + full suite.

## Slice 12E — Distributed fencing / split-brain prevention boundary — COMPLETE

Implemented `src/distributed-fencing.ts` as an authority-free distributed fencing contract plus deterministic reference backend:

- production fencing is defined around an independently linearizable compare-exchange backend keyed by opaque workspace ID; backend state must persist monotonic workspace generations across restart/failover and must never reset, reuse or skip generations;
- a `fencing_only` claim binds the exact workspace, task, machine, machine-registration revision, placement revision and M12A candidate-assignment ID; it grants no task, filesystem, Safety Plan, local writer lease, credential, release or execution authority;
- acquisition requires a current M12D candidate assignment and issues generation 1 only for a new workspace fence state; every replacement after expiry/revocation advances to `N+1` through compare-exchange;
- one current live generation excludes another machine; after failover advances the generation, the stale machine cannot validate, renew or revoke its old claim even if it reconnects with the original evidence;
- fence lifetime is bounded to at most 60 seconds and can never outlive the candidate assignment that authorized its creation; candidate/placement/registration/liveness invalidation makes the fence unusable immediately through candidate revalidation;
- renewal preserves the generation but advances exact backend state so the prior claim copy becomes stale; revocation clears the current holder while retaining the monotonic generation history for the next acquisition;
- backend corruption, wrong workspace binding, generation rollback/reset, malformed authority flags and bounded compare-exchange contention fail closed;
- `ReferenceLinearizableFenceBackend` is deliberately single-process proof infrastructure only. The contract explicitly records that no production distributed backend is configured and distributed write dispatch/execution remain disabled;
- future write execution must independently compose current immutable task/Safety Plan/workspace-registry authority, a current local `WorkspaceWriterClaimV1`, and immediate revalidation of the current distributed fence at the target-machine write boundary. The distributed fence replaces none of those controls.

Evidence: fencing contract/reference backend `61ce376d626c24f54471c171486d2c31b067de7d`; split-brain/failover regression tests `d017ca09156b3197adfd545b1ad4c288e45c3ee8`; CI `#869` / workflow `36523436303` passed typecheck + full suite.

## Slice 12F — Production shared fencing backend + target write-boundary composition/proof — COMPLETE

Implemented a PostgreSQL-backed shared fencing backend and composed distributed-fence revalidation into the existing target-machine Hub write boundary without enabling distributed execution:

- `PostgresDistributedFenceBackend` implements the existing M12E `DistributedFenceBackend` contract using one durable row per opaque workspace ID; first-writer `INSERT ... ON CONFLICT DO NOTHING` and exact-revision `UPDATE` operations provide a database serialization point across independent processes;
- durable row state retains monotonic workspace generation and revision across orchestrator process restart; malformed state, workspace mismatch, revision misuse, generation rollback/reset/skip and generation advance without an active claim fail closed;
- PostgreSQL connection material is supplied only through machine-local `Pool` / `PoolConfig` input and is not copied into task, assignment, placement, claim or other model-facing distributed state;
- PostgreSQL `jsonb` legitimately reorders object keys, which exposed that the M12E opaque claim comparison depended on serialization order. The backend now reconstructs the already-validated fixed claim schema in canonical field order on read, preserving exact values and M12E stale-holder semantics without relaxing any check;
- CI exercises the backend with an ephemeral PostgreSQL service and independent Node processes: exactly one process wins an initial compare-exchange, committed generations survive process restart, stale expected revisions cannot overwrite newer state, and invalid generation transitions are rejected;
- `createLeaseAwareHubSafetySessionContributions()` now accepts an optional `DistributedWriterFenceGuard` for future distributed writer paths. When supplied, every `editor` / `applyPatch` mutation requires current durable task/Safety Plan/workspace-registry/profile/owner authority, the exact still-current local fenced writer lease, and then current shared distributed-fence validation immediately before the underlying path-governed mutation;
- `createDistributedWriterFenceGuard()` binds one exact M12E claim to its exact candidate assignment and delegates every check to `DistributedFenceAuthority.validateCurrent()`. The guard carries no credentials and grants no task/filesystem/Safety Plan/writer-lease/release authority;
- local/single-machine callers that do not supply a distributed guard retain the existing write-boundary behavior;
- the end-to-end failure-mode proof acquires a real generation-1 fence, advances the same workspace to generation 2 from an independent Node process through PostgreSQL, then invokes the stale holder's target-machine editor path and proves `distributed_fence_invalid` is raised before the file changes while the newer generation remains durable;
- the CI PostgreSQL service is ephemeral GitHub-hosted proof infrastructure only. No listener, tunnel, DNS/firewall/port-forwarding, credential provisioning or other network mutation was performed on user infrastructure;
- distributed command delivery, dispatch and write execution remain disabled. M12F proves the required backend and target write boundary; it does not itself authorize or production-wire cross-machine execution.

Evidence: PostgreSQL backend/dependency/CI path through `f70037bac46d95bb66959a320aee94e86ac49cf0`; target write-boundary composition `9cbc2647d029631cc7d00fa02ce7caa21052ca9f`; exact fence guard `205724c0c7942dbea966b32f4521660bdc92fbc9`; write-boundary unit tests `6f83e5e2d3c0bbc0078dd6a84cad1704fd77e532`; independent-process stale-generation/editor proof `b3fa5200cd86ff4b5690ec3e99190e47774f003a`; backend-only CI `#883`; final CI `#892` / workflow `36525707334` passed typecheck + full suite.

## Slice 12G — Target execution admission / replay boundary — COMPLETE

Implemented `src/distributed-execution-admission.ts` as an authority-free pre-execution admission boundary without network delivery or worker execution:

- controller-side `createDistributedExecutionDispatch()` creates a short-lived dispatch envelope bound to the exact task, workspace, machine, machine-registration revision, placement revision, candidate assignment, fence ID and fence generation;
- the dispatch contains only opaque IDs, revisions, generation and timestamps. It cannot contain a prompt, command, path, credential, Safety Plan, local writer lease, Hub token or release instruction;
- dispatch TTL is bounded to 1–30 seconds and is capped by the earlier expiry of the current candidate assignment and distributed fence;
- target admission requires an exact configured target machine identity and revalidates the current durable machine registration, exact current placement, current M12D candidate assignment and current M12E/M12F distributed fence before admission;
- revoked/revision-stale registrations, disabled/revision-stale placements, expired dispatches, stale candidate assignments, stale fence generations, wrong-machine delivery and any cross-bound assignment/fence/dispatch mismatch fail closed;
- `FileDistributedDispatchReplayStore` provides a machine-local durable single-consumption barrier using exclusive file creation with restrictive directory/file modes, so process restart cannot make an already admitted dispatch reusable;
- replay evidence contains only dispatch ID and expiry. The replay-store path is trusted machine-local configuration rather than model/distributed input;
- successful admission returns `admission_evidence_only`, which still grants no task, filesystem, Safety Plan, writer-lease, credential, release or execution authority;
- regression tests prove exact-bound success, wrong-target non-consumption, revoked registration rejection, disabled placement rejection, stale candidate/fence rejection, expiry rejection, cross-bound evidence rejection and durable replay rejection after gateway restart;
- M12G intentionally does not start Cline, invoke an executor, deliver a prompt/command, open a listener or enable distributed writer execution. A later slice must explicitly wire any execution path through the already-proven target-side task/Safety/workspace authority, local fenced writer lease and M12F distributed fence checks.

Evidence: admission boundary `ca22b671aedfbb5ac0470d60486852510625d050`; regression tests `bd5ce0f0aa5a2f596d5ccbc06d809f983c6438f4`; CI `#899` / workflow `36538216117` passed typecheck + full suite.

## Slice 12H — Admitted target-runtime handoff contract — COMPLETE

Implemented `src/distributed-target-runtime-handoff.ts` as an in-process, target-local handoff boundary that consumes M12G admission evidence without starting a worker or adding transport:

- the distributed dispatch still contributes only opaque identity/coordination evidence; it cannot provide a prompt, command, workspace path, Safety Plan, credential, writer lease, Hub token or release instruction;
- the target resolves the workspace root only from its own current `WorkspaceRegistry`, loads the task from that workspace's local `TaskStore`, and checks the durable task binding against the current registry/profile before any handoff can be prepared;
- deliberately narrowed Safety Plan `allowedPathPatterns` remain authoritative instead of being widened back to the workspace profile; current profile identity/revisions, protected paths, validation commands, worker profile and canonical workspace binding must still match;
- only a fresh `created` task with no prior Cline session, run history or pending escalation is eligible. Interrupted-task recovery/takeover remains the existing separate trusted recovery path and cannot be implied by distributed admission;
- before M12G admission is consumed, M12H requires current target-local durable task/Safety authority and the exact current local fenced writer lease for the same task/workspace/owner;
- after one-shot M12G admission, the target constructs the already-proven M12F distributed fence guard, revalidates the current shared distributed fence, reloads the task from local durable state, and revalidates task authority plus the local lease again to close admission-time TOCTOU;
- a concurrent local start/status/session transition after admission fails closed as `task_not_current` and no runtime context is returned;
- the successful result is a process-local `DistributedTargetRuntimeHandoffContext` containing the target-loaded task plus the existing live `LeaseAwareHubSafetyOptions` (`lease`, current authority provider and distributed fence guard). It is deliberately not a transport payload and grants no authority itself;
- M12H does not instantiate `LeaseAwareHubRuntimeFactory`, start `ClineRunner`, invoke an executor, open a listener, deliver a prompt/command or enable distributed writer execution. Any later runtime-start slice must consume this context through the existing lease-aware/M12F safety boundary rather than creating a parallel execution path;
- regression coverage proves stale local authority rejection, wrong/replaced local lease rejection, one-shot admission failure, shared-fence drift rejection, post-admission authority TOCTOU rejection, target-local narrowed-scope loading, prior-runtime takeover rejection before dispatch consumption, and post-admission concurrent-start rejection.

Evidence: initial handoff boundary `f53b49c732c0dde6278d62df5a1bc447ff0f8556`; core regression tests `1117a09ccbce33754982b2f0b5d63b0ba013c3ae`; narrowed-scope/takeover hardening `facbb036463fd7cb0ae5e43fa89438cbeb044810`; target-local loader proof `df8cb83d8a5579095a2720ddcc86ec1d82e0f5ce`; prior-runtime takeover proof `7d63aa8e46fa08c267f2422ebf7a2faf7fdc3ce5`; post-admission durable reload `b2924f2629c2f64135567111db4e81dc65c96c3f`; final TOCTOU regression `efeabe6a65100bae8e72bd1afc57e678cc7258bf`; CI `#914` / workflow `36540755746` passed typecheck + full suite.

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
| Real Cline client completion/review/correction proof | Complete — CR3 / CI `#840` + authorized physical proof |
| External ChatGPT transport through the remote control plane | Not physically proven — remains M11 external authorization gate |
| Remote control software boundary | Complete through M11H |
| External remote listener/relay/tunnel proof | Deferred / disabled / explicit-authorization gate |
| Distributed identity/placement/assignment contract | Complete — M12A / CI `#811` |
| Durable distributed registration/placement store | Complete — M12B / CI `#851` attempt 2 |
| Authenticated distributed machine transport/liveness contract | Complete — M12C / CI `#857`; controller-side only, no network listener |
| Placement-aware distributed candidate routing | Complete — M12D / CI `#863`; coordination-only, no command delivery or task execution |
| Distributed fencing contract / split-brain semantics | Complete — M12E / CI `#869`; reference backend retained for deterministic single-process proof |
| Production shared fencing backend + target write-boundary composition | Complete — M12F / CI `#892`; PostgreSQL shared backend + independent-process stale-generation proof |
| Target execution admission / durable replay boundary | Complete — M12G / CI `#899`; no prompt/command delivery or worker execution |
| Admitted target-runtime handoff contract | Complete — M12H / CI `#914`; process-local context only, no Cline start or transport |
| Distributed network listener/adapter | Disabled — later M12 slice / external exposure remains separately gated |
| Distributed writer execution | Disabled — M12H prepares local runtime context only; no cross-machine execution path is production-wired |
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
15. M12F proves a production-grade shared linearizable fencing backend and its composition at the target write boundary, but cross-machine command delivery/write execution remain disabled until a separately reviewed execution/transport slice explicitly wires those prerequisites without widening authority.
16. Cline completion prose is useful reviewer context but is never independent proof; contradictions must resolve in favor of trusted captured evidence or human review.
17. A supervisor repair instruction may reuse only the existing immutable task authority. Any required scope expansion must stop for a fresh Safety Preview/human decision.
18. Completion-review journal records are evidence only. They do not grant execution or completion authority, and a failed repair handoff must remain visibly failed rather than being silently retried outside trusted task continuation.
19. CR3 proves the real local Cline completion/review/correction path with a deterministic local reviewer; it does not prove external ChatGPT transport or grant remote/local release authority.
20. M12D candidate selection is coordination evidence only; any future target machine must still satisfy the now-proven M12E/M12F fencing plus target-machine task/Safety Plan/workspace-registry and local writer-lease checks before a write side effect.
21. `ReferenceLinearizableFenceBackend` remains a deterministic single-process proof backend only; using it as cross-process or cross-machine fencing would violate the M12E contract.
22. `PostgresDistributedFenceBackend` is shared fencing infrastructure only. Database configuration/credentials remain machine-local and possession of a database-backed fence does not itself grant task, filesystem, Safety Plan, local writer-lease, credential, release or execution authority.
23. An M12G dispatch/admission receipt is not an executable task and cannot carry prompt/command/path/Safety/credential/lease/release material. Any later executor must independently re-enter trusted target-machine task authority and the M12F write boundary rather than treating admission as permission to mutate.
24. An M12H handoff context is process-local composition evidence only. It must never be serialized as a distributed authority token, and any later Cline start must use the target-loaded task plus the existing lease-aware runtime/M12F fence checks rather than trusting the dispatch or admission receipt as execution authority.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — M11A–M11H software/security implementation and CI proof.** External physical proof remains deferred and separately gated.
3. **COMPLETE — prerequisite Cline context/tool-protocol recovery hardening.** CI `#809`.
4. **COMPLETE — M12A distributed identity/placement/candidate-assignment authority contract.** CI `#811`.
5. **COMPLETE — CR1 Cline completion review packet + read-only MCP surface.** CI `#822`.
6. **COMPLETE — CR2 supervisor consumption + bounded correction handoff.** CI `#829`.
7. **COMPLETE — CR3 real Cline client completion/review/correction proof.** CI `#840` + authorized Windows physical proof; external ChatGPT transport intentionally not claimed.
8. **COMPLETE — M12B durable machine registration + workspace placement store.** CI `#847` for registrations; CI `#851` attempt 2 for placements. State/registry only; no distributed network or writer execution.
9. **COMPLETE — M12C authenticated machine transport + liveness contract.** CI `#857`; controller-local session/liveness gateway only, no network listener and no distributed write dispatch/execution.
10. **COMPLETE — M12D placement-aware candidate routing/scheduling.** CI `#863`; current placement + current registration + fresh liveness only, producing coordination-only candidate assignments with post-creation revalidation.
11. **COMPLETE — M12E distributed fencing / split-brain prevention contract.** CI `#869`; monotonic workspace generations and stale-owner failure modes proven with a deliberately single-process reference backend; write execution remains disabled.
12. **COMPLETE — M12F production shared fencing backend + target write-boundary composition/proof.** PostgreSQL shared backend, independent-process durability/CAS proof, and stale-generation-before-editor proof passed in CI `#892`; distributed execution remains disabled.
13. **COMPLETE — M12G target execution admission / durable replay boundary.** Exact target/evidence binding, stale-state rejection and restart-persistent single-use dispatch admission passed in CI `#899`; no prompt/command delivery, listener or worker execution was added.
14. **COMPLETE — M12H admitted target-runtime handoff contract.** Target-local durable task reload, narrowed Safety Plan preservation, fresh-task/no-takeover rule, current local lease/authority revalidation, post-admission durable reload and M12F fence composition passed in CI `#914`; no Cline start, listener or distributed writer execution was added.
15. **STOP POINT — define/review the next bounded Milestone 12 slice before changing code.** M12H completion does not authorize Cline start, network delivery or cross-machine writer execution by itself.
16. **DO NOT enable cross-machine writer execution** until a later explicitly reviewed slice consumes M12H through the existing target-machine lease-aware runtime + M12F distributed fence boundary without widening authority.
17. **DO NOT perform raw public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning or external-network changes** without explicit user authorization immediately before the action.

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
- 2026-09-28: CR3 guarded physical proof added and CI `#840` passed. The authorized Windows proof then passed twice against real Cline execution in an isolated disposable workspace/Hub, including automatic completion capture, one bounded supervisor repair handoff, second completion and advisory pass. External ChatGPT transport remains a separate unproven M11 physical boundary.
- 2026-09-29: M12B durable machine registration store completed in `8d48992d1a30fbc9f7cd108a54008729a26b9391`; CI `#847` passed typecheck + full suite.
- 2026-09-29: M12B durable routing-only workspace placement store completed in `69ebe3ccd290c723bda0e2c5dcc4a12d22f075ad` with regression tests in `364ca98e970a1c472a816ca7f695871cda7b00d6`; CI `#851` attempt 2 passed typecheck + full suite unchanged after an unrelated timing-sensitive existing completion-event assertion failed attempt 1. Distributed transport and writer execution remain disabled.
- 2026-09-29: M12C controller-local authenticated machine transport/liveness contract completed in `fa81ab281e7fc0f326f153f059ddd12f1e4d3245`, with regression tests in `3efc4b45f852cb7f116d8698009e59898cef777d`; CI `#857` / `36500722073` passed typecheck + full suite. No network listener or distributed write dispatch/execution was introduced.
- 2026-09-29: M12D placement-aware candidate router completed in `87b502fb9dd30522dc7a0c6c8a54cac72af928d6`, with integration/regression tests in `aa62aaa842b2ce01c5d639dc33cae48088d7744f`; CI `#863` / `36521552004` passed typecheck + full suite. Candidate assignments remain coordination-only and distributed write dispatch/execution remain disabled.
- 2026-09-29: M12E distributed fencing contract/reference backend completed in `61ce376d626c24f54471c171486d2c31b067de7d`, with split-brain/failover regression tests in `d017ca09156b3197adfd545b1ad4c288e45c3ee8`; CI `#869` / `36523436303` passed typecheck + full suite. The reference backend is intentionally single-process only; production distributed fencing and writer execution remain disabled pending M12F.
- 2026-09-29: M12F production shared fencing backend and target write-boundary composition completed. PostgreSQL independent-process CAS/restart proof and stale-generation-before-editor failure-mode proof passed; final correction for `jsonb` key-order canonicalization is `f70037bac46d95bb66959a320aee94e86ac49cf0`; final CI `#892` / `36525707334` passed typecheck + full suite. Cross-machine dispatch/execution and all external network exposure remain disabled.
- 2026-09-29: M12G target execution admission/replay boundary completed in `ca22b671aedfbb5ac0470d60486852510625d050`, with regression tests in `bd5ce0f0aa5a2f596d5ccbc06d809f983c6438f4`; CI `#899` / `36538216117` passed typecheck + full suite. The dispatch is opaque authority-free evidence only; no prompt/command delivery, listener, Cline start or distributed writer execution was introduced.
- 2026-09-29: M12H admitted target-runtime handoff contract completed through `efeabe6a65100bae8e72bd1afc57e678cc7258bf`; CI `#914` / `36540755746` passed typecheck + full suite. The target now re-enters its own durable task/registry/Safety authority, current local writer lease and M12F distributed fence before producing a process-local runtime context, with a post-admission durable task reload that rejects concurrent local starts. No Cline start, command delivery, listener or distributed writer execution was introduced.

---

# Current next step

**M12H is complete. Stop before further implementation.** The next bounded Milestone 12 slice must be explicitly defined/reviewed before code changes. The natural next concern is whether and how the process-local M12H handoff may start the existing target-side lease-aware Hub runtime while preserving the fresh-task/no-takeover rule, revalidation immediately before runtime start, and M12F validation before every mutation. That next slice must still avoid adding a network listener or treating dispatch/admission/handoff evidence as task authority. Any network listener/external exposure remains separately gated and requires explicit authorization immediately before that action; no raw public bind is acceptable.