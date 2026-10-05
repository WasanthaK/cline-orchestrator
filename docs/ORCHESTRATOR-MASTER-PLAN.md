# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-10-05
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
16. Distributed machine-authentication bootstrap must prove possession of an explicitly registered machine-local key; registration identifiers alone are never sufficient to mint an M12C session.
17. A target pull may present only transport authentication/request identity. Task, workspace, dispatch, candidate-assignment and fence selection remain controller-owned and must not be chosen by the target.

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
| 12 | Distributed / multi-machine orchestration | In progress — 12A–12W software complete; M12X P0–P5 physical HTTPS/auth/no-work proof complete; M12Y-A/B/C/D acknowledgement + restart reconciliation complete; first real distributed writer physical proof passed on Windows run `#8`; M12Z-A recovery classification complete at `305003cc`, CI `#1134`; takeover/recovery execution remains separately gated |
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

## 12P — Secure target-pull transport profile + controller server-identity prerequisite — COMPLETE

`src/distributed-secure-transport-profile.ts` defines a machine-local, authority-free profile that a future network adapter must satisfy before it can connect. The profile requires a canonical HTTPS controller origin, normal system-CA verification plus one to three canonical SHA-256 SPKI pins, bounded connection timeout and bounded response size. It rejects unknown fields and cannot contain bearer tokens, private keys, client certificates or executable/task authority material.

The M12P production module performs validation only: it imports no HTTP/HTTPS/TLS/net/DNS client or server primitive, performs no DNS lookup/TLS handshake/request, opens no listener/socket and leaves `networkIoEnabled` fixed to `false`. All task/filesystem/Safety/local-lease/credential/release grant flags remain false; controller push and distributed takeover remain disabled.

Tests prove accepted canonical configuration plus fail-closed rejection of HTTP/non-canonical origins, userinfo/path/query/fragment injection, empty/duplicate/oversized/malformed pin sets, timeout/response bounds, weakened server authentication, network enablement, authority widening and credential-like unknown fields.

Evidence: slice definition `a79151c047a7bf47bbeb3abadd3db1bc88530058`; production contract `3c5ca3ffac941d37b1c4c361e0472d3e2aea22eb`; proof `4cf5dd3faedea6afca7b925b267f09e18ff8aa9d`; CI `#975` / `36586351473` passed typecheck + full suite.

M12P does not authorize a network adapter. Any slice that actually performs DNS/TLS/HTTP I/O, opens a listener, provisions credentials, changes firewall/DNS/port forwarding or connects machines remains separately reviewed/gated.

## 12Q — Machine authentication bootstrap + bounded M12C session issuance — COMPLETE

`src/distributed-machine-auth-bootstrap.ts` adds a controller-local Ed25519 possession-proof boundary in front of the existing M12C session issuer. It does not create a second session/token authority path.

An explicit authentication binding ties the exact registration ID, machine ID and registration revision to a canonical Ed25519 public SPKI key and SHA-256 fingerprint. The binding is authentication metadata only; exact-schema validation rejects private-key fields and all task/filesystem/Safety/lease/credential/release grant flags remain false.

Bootstrap challenges are short-lived, process-local and one-shot. They bind exact machine/registration revision, public-key fingerprint, canonical requested capabilities and requested M12C session TTL into a domain-separated signed payload. A completion attempt consumes the challenge before current-registration/current-binding revalidation and signature verification, so wrong signatures and later replay fail closed. Controller restart does not resurrect outstanding challenge state.

Immediately before issuance, M12Q revalidates the durable registration revision and current authentication binding. A valid Ed25519 proof delegates only to the existing M12C `issue()` function, preserving M12C's short-lived capability-bounded `authenticated_machine_identity_only` claims. Registration identifiers alone cannot mint a session.

Tests prove valid possession reaches existing M12C issuance exactly once and that wrong keys/signatures, capability/TTL signature mutation, stale registration revision, authentication-key rotation, expired/replayed challenges, disallowed capabilities, authority widening, private-key fields and non-Ed25519 public keys fail closed. A fresh bootstrap instance cannot reuse an outstanding challenge from the prior process.

No DNS/TLS/HTTP/network I/O, listener/socket, private-key generation/provisioning, controller push, distributed takeover/recovery or release authority was introduced.

Evidence: slice definition `41ceaff443e2d4a07d79225b6ac03724d08aed15`; production implementation `a9c2837adc26c6aa96b1f448b0e65b58af0f102a`; initial proof `e9f6149c67d1da0a98a3064a347bb01fd76bb611`; strengthened binding-validation proof `ce3919ba81ffcd26f93ec88fee9a2929d44e0618`; CI `#985` / `36836397316` passed typecheck + full suite.

M12Q does not define public-key provisioning or a network challenge route. Those remain separately reviewed/gated.

## 12R — Controller-owned pending-work selection — COMPLETE

`src/distributed-controller-pending-work.ts` adds a controller-owned target-pull selector that accepts only the authenticated machine bearer plus an opaque request ID. The pull API contains no task ID, workspace ID, dispatch ID, candidate-assignment ID or fence ID, so the target cannot choose which work evidence it receives.

Selection begins with M12C authentication for `accept_writer_candidates`. The exact machine ID, registration ID and registration revision are derived from the resulting authority-free transport identity. The controller then atomically claims the next FIFO work item already prepared for that exact identity. Work for a different machine/revision remains unclaimable.

Every claimed item is exact-schema, authority-free controller-selection evidence containing only the existing M12G dispatch, M12D assignment and M12E fence. M12R revalidates current candidate state and current fence state after claim, then enters M12J through the new `DistributedExecutionPullDeliveryController.deliverAuthorized(...)` reuse point. M12J therefore remains the single delivery-bundle construction boundary; M12R does not create parallel delivery authority.

Claimed stale/invalid work fails closed and is not resurrected. A successful claim is one-shot; a later pull cannot receive the same pending item. "No work" returns `null` and grants nothing. Tests prove controller FIFO choice, cross-machine isolation, one-shot claim, authentication-before-selection, stale-candidate rejection before fence/delivery, stale-fence rejection before delivery, malformed/cross-bound evidence rejection and authority-widening rejection.

`ReferenceControllerPendingWorkQueue` is deterministic single-process proof only. A later production network/scheduler composition may inject a different controller-owned atomic source, but that source must preserve the same exact-identity, no-target-selector and one-shot claim contract.

No DNS/TLS/HTTP/network I/O, listener/socket, controller push, private-key provisioning, distributed takeover/recovery or release authority was introduced.

Evidence: M12J authorized-builder reuse `4927e2c906378dc6c13a925b3abbdca9ff8f65fc`; selector `71b55fa651a00b1919c11e5d8540bda93ad999a8`; proof `cf43622164499dcafff8aa21bc967835a7f8ad54`; CI `#993` / `36893284376` passed typecheck + full suite.

M12R does not authorize a real HTTPS adapter or public listener. Network I/O remains the next separately reviewed boundary.


## 12S — Secure HTTPS target-pull client adapter — COMPLETE

Security review and implementation are complete. The exact client-side contract remains recorded in `docs/M12S-SECURE-TARGET-PULL-CLIENT-CONTRACT.md`, with production code in `src/distributed-secure-target-pull-client.ts` and socket-free proof in `src/distributed-secure-target-pull-client.test.ts`.

The reviewed boundary is target→controller outbound HTTPS only. The client accepts only a validated M12P profile, an already-issued short-lived M12C bearer and a fresh request ID. It sends one fixed `POST /v1/distributed/execution/pull` request with no body and no task/workspace/dispatch/candidate/fence selector. M12R remains the sole controller-side work selector and M12J remains the sole delivery-bundle schema/validator.

Server authentication is fail-closed: explicit OS/system trust roots, normal CA/TLS validation, hostname verification and an exact leaf-SPKI SHA-256 pin from M12P are all required. Redirects, environment-proxy routing, caller-supplied CA/client-cert/TLS options, arbitrary URLs/headers, compression, connection reuse and automatic retries are forbidden. A valid 204 means no work; a valid 200 must be bounded UTF-8 JSON that passes the existing M12J delivery validator.

The review identified two deliberate later boundaries. First, M12Q bootstrap/session issuance still has no network route; M12S consumes an already-issued bearer only. Second, M12R claims work before delivery, so a lost response can create an ambiguous/lost-delivery condition. M12S therefore never retries automatically and reports `ambiguous_outcome`; durable claim/ack/reconciliation is a later separately reviewed reliability slice.

The review also found that the package-wide `node >=22` declaration is too broad to guarantee the explicit OS/system-CA APIs required by M12S. Implementation must tighten/enforce a Node runtime floor that supports the reviewed trust-store behavior rather than silently falling back to an unspecified/default CA set.

M12S implementation proof remained socket-free in hosted CI through an injected/fake request transport. No listener, real DNS/TLS/HTTP connection, credential provisioning, firewall/DNS/tunnel mutation or physical cross-machine proof was performed.

Implementation details: the client uses a fixed selector-free `POST /v1/distributed/execution/pull`, explicit Node system roots, `tls.checkServerIdentity` plus exact leaf-SPKI SHA-256 pinning, no redirects/proxy/connection reuse/automatic retry, bounded 200/204 response handling, strict UTF-8/M12J validation, sanitized errors and explicit ambiguous-outcome handling. The project runtime floor is now Node `>=22.15.0`, matching availability of `tls.getCACertificates("system")`. Final hardening rejects unsafe bearer characters before request construction.

Evidence: definition `493c35f91d0d4bc9bab7c0d2e8149c3361f6f1b2`; initial implementation `1e4c8b1953ef9ef6959677f9ea142cdd6d1cd07e`; exact input guard `9faeb81f7957ff50c890aa84e6fd6ce50825c26d`; proof `3981674f1830684ce68d7601b59f9e3a216993d9`; fixture-only corrections `2c1fd92ce3564ccb4c70eb9a7b130a173ae4c134` and `cba2301a7605f8374639697ce84168cfc57e862f`; bearer hardening `3ca06e4ffc6e2703a866f66994bda25ce00c36c4` + `484ea8cf547cbe768829b4dfaa9b13a95022bbfb`; final CI `#1015` / `36957941941` passed typecheck + full suite.


## 12T — Controller HTTPS target-pull route / unbound server — COMPLETE

Security review and implementation are complete. The exact controller-side contract remains recorded in `docs/M12T-CONTROLLER-HTTPS-PULL-SERVER-CONTRACT.md`, with production code in `src/distributed-controller-https-pull-server.ts` and socket-free proof in `src/distributed-controller-https-pull-server.test.ts`.

The route is exactly `POST /v1/distributed/execution/pull` over HTTPS/HTTP/1.1. It accepts only the exact M12S wire headers, no body and no work selectors. Duplicate-preserving header inspection is mandatory because Node may otherwise discard or combine duplicate header fields. The handler delegates exactly once to M12R `pullNext(token, requestId)`; it must not pre-authorize separately with M12C because M12R already performs M12C authorization and replay consumption.

A valid M12R `null` result maps to zero-byte 204. A delivery is revalidated through the existing M12J bundle validator, serialized once as bounded UTF-8 JSON and returned as 200. Errors are bodyless and sanitized; M12C replay maps to 409, capability denial to 403, stale/invalid sessions to 401, candidate/fence state loss to 409, saturation to 503 and invariant failures to 500. No remote error body contains machine/work/task/evidence details.

The reviewed server uses strict HTTP parsing, exact Host matching, `Content-Length: 0`, no Transfer-Encoding, one request per socket, HTTP/1.1-only ALPN, TLS >=1.2, bounded header/handshake/request/socket timeouts and bounded in-flight concurrency. Upgrade, CONNECT and Expect/100-continue paths fail closed.

M12T implementation may consume already-provisioned controller-local certificate/private-key material through trusted startup-only composition, but certificate generation/provisioning/rotation is out of scope. The implementation MUST return an unbound `https.Server`; it must not call `listen()`, choose a default bind, open a socket, mutate DNS/firewall/NAT/tunnels, expose networked M12Q bootstrap, add claim reconciliation, invoke M12H/M12I or grant release authority.

Hosted implementation proof remained socket/listener-free. The pure route validates the exact M12S wire contract, duplicate/unknown/body-framing headers fail before M12R, valid requests delegate exactly once to M12R with no separate M12C pre-authorization, responses are bodyless/sanitized except for validated bounded M12J 200 JSON, and concurrency is bounded. The unbound HTTPS factory configures strict HTTP/1.1/TLS parser/timeouts/events and returns `server.listening === false`; production contains zero `.listen(` calls, zero direct `.authorize(` calls, exactly one `.pullNext(` call, and no M12Q/M12H/M12I dependency. Actual bind/TLS physical proof remains a later separately authorized action.

Evidence: definition `68083d6b33274eda2efad0804878dede04f63c64`; implementation `9aac35df515178018e3bf9c6b5e11c6e8eee6b6e`; proof `cd0cd298849042bcfafb91fa9ac06b985908179c`; final CI `#1025` / `36961422096` passed typecheck + full suite.


## 12U — Networked M12Q machine authentication bootstrap — COMPLETE

Security review and implementation are complete. The exact protocol/client/server contract remains recorded in `docs/M12U-NETWORK-MACHINE-AUTH-BOOTSTRAP-CONTRACT.md`, with the controller route in `src/distributed-network-machine-auth-bootstrap.ts`, the target signer client in `src/distributed-network-machine-auth-client.ts`, and socket-free proof in their corresponding test files.

M12U wraps the existing M12Q Ed25519 possession proof with two fixed HTTPS/HTTP/1.1 routes on the same canonical controller origin as M12T: `POST /v1/distributed/auth/challenge` and `POST /v1/distributed/auth/session`. Registration ID remains a selector only; only successful possession proof with the exact current pre-enrolled Ed25519 binding may delegate to existing M12C session issuance. There is no direct network M12C `issue()` route.

The reviewed network envelope uses canonical bounded JSON, duplicate-preserving exact headers, no Authorization header, direct-peer-only rate limiting, one active challenge per registration, challenge-request idempotency keyed by request ID + exact canonical body, bounded concurrency, bodyless anti-enumeration errors and one-shot completion. Successful challenge responses contain only the validated existing M12Q challenge; successful session responses contain only the validated short-lived M12C token + claims and are never logged/cached/persisted by M12U.

The target client uses the same M12P TLS policy as M12S and an injected signer interface exposing only `publicKeyFingerprint` + `sign(payload)`; raw private-key bytes are not accepted. The returned challenge must match registration/capabilities/TTL and signer fingerprint before the signer is invoked. Completion is never automatically retried.

The prerequisite M12Q nonce correction is complete: challenge validation now requires canonical base64url decoding to exactly 32 bytes, matching the existing random 32-byte generator.

Deployment ordering is fixed: controller TLS identity must be provisioned and verified against M12P first; target Ed25519 private key and matching controller-side M12Q binding must already be provisioned second; only then may M12T + M12U be composed under one unbound server. An actual `listen()`/bind remains a later explicitly authorized physical action. M12U is not a machine-enrollment, TLS-provisioning or key-provisioning endpoint.

Hosted M12U proof remained socket/listener-free. The controller envelope now proves exact canonical JSON/header rules, challenge request idempotency, one active challenge per registration, peer + registration rate limits with stale-bucket pruning, bounded concurrency, anti-enumeration responses, one-shot completion and validated M12C issue results. The target client uses M12P system-CA/hostname/leaf-SPKI authentication, exact challenge matching before an exact signer-only boundary, the existing M12Q signed payload and no automatic completion retry. No TLS credential provisioning, Ed25519 key provisioning, DNS/firewall/tunnel mutation, listener binding or physical cross-machine proof was performed.

Evidence: definition `c736a0a310422fbff75cf702febf4b16e857a1ae`; nonce hardening `7225a168f396881afdd575eaf73f4b532031d9e4` + proof `06535f923a14880c519ac0e8fbccd51c468aa4a0`; controller route `eaf9ba30e09193d4a1cbafab3262d778cacb497f`; route proof `028e77d9cab0b8c1085d0c0627ddd2a49b426c30`; target client `aae35db2f9980f0f7ba0dcbd9acef76b6eba2af2`; client proof `6c1acb9e9f7abc2c6693ec399b590e294aa6845f`; signer/CA hardening `4e93d5d512011f722fb924093c8bd48079e61d68` + proof `24e2ca0d359a2d8922ec124399ccfead618f4edc`; proof correction `7163d31e8f9288a1e1f9b885ec190fec64a8156c`; peer/rate-state hardening `41b1d59e5f4b676a5cf0e398331ed881f68b24ed` + proof `25a80ffa437c114270a904b9806dedc005243c78`; final CI `#1055` / `36985140555` passed typecheck + full suite.


## 12V — Shared unbound HTTPS router + TLS identity preflight — COMPLETE

Security review and implementation are complete. The exact composition/deployment-readiness contract remains recorded in `docs/M12V-SHARED-UNBOUND-HTTPS-COMPOSITION-CONTRACT.md`, with production code in `src/distributed-shared-unbound-https.ts` and socket-free proof in `src/distributed-shared-unbound-https.test.ts`.

M12V will compose exactly the completed M12T pull route and completed M12U challenge/session routes under one canonical M12P controller origin and one unbound HTTPS/HTTP/1.1 server. The route table is fixed to `/v1/distributed/execution/pull`, `/v1/distributed/auth/challenge`, and `/v1/distributed/auth/session`; unknown paths reach neither route and there is no fallback route chaining.

The shared layer will not duplicate authorization. Pull requests go only to the existing M12T route, which remains the sole M12C/M12R pull authority. Bootstrap requests go only to the existing M12U route, which remains the sole network M12Q wrapper. M12V itself must contain zero direct M12C `authorize/issue` calls and zero direct M12Q challenge/completion calls.

For M12U POST bodies, M12V adds only a transport/resource framing preflight and bounded collector before delegating: exact Content-Length, no Transfer-Encoding, 1024-byte challenge / 512-byte session limits, bounded concurrent collectors, and fail-closed aborted/early/oversized bodies. M12U still revalidates the complete exact header/canonical-JSON contract. Direct socket peer address remains the only peer identity signal; forwarded headers remain untrusted.

Before constructing the unbound server, M12V requires a pure local TLS identity preflight against the same validated M12P profile. The trusted startup provider supplies only an already-loaded private KeyObject plus a leaf-first certificate chain. The preflight verifies certificate time bounds, DNS/IP match for the canonical origin, exact leaf-SPKI SHA-256 pin match, non-CA leaf status, and leaf/private-key consistency. It returns only non-secret deployment-readiness evidence. This local preflight does not claim full system-CA chain validation; that remains part of later client-observed physical TLS proof.

The shared server remains strict HTTP/1.1 only, bounded, one request per socket, fails closed on Expect/upgrade/CONNECT/parser/TLS errors, and MUST return with `server.listening === false`. M12V production must contain no `.listen(` call and no default bind address/port.

Hosted M12V implementation proof remained socket/listener-free. The shared router now isolates exactly the three reviewed paths; pull requests reuse M12T without body buffering or duplicated bearer authorization; bootstrap requests use bounded exact-length collection before M12U; unknown paths reach neither route. The shared unbound HTTPS server is strict HTTP/1.1 only, bounded, fail-closed on special protocol events, and returns with `server.listening === false`.

Local TLS deployment-readiness preflight now validates the same M12P profile that targets trust, parses the leaf-first chain, rejects CA/malformed/time-invalid leaves, verifies DNS or IP identity (including normalized IPv6 literals), requires the exact leaf-SPKI SHA-256 pin, and proves the private KeyObject matches the leaf. Because Node's supported HTTPS server key option is PEM/Buffer based, the exact verified KeyObject is exported only after successful preflight to an ephemeral PKCS#8 PEM Buffer for synchronous server construction and that temporary buffer is zeroed immediately after the builder returns. The receipt contains no credential material and full system-CA chain validation is deliberately not claimed until later client-observed physical proof.

Production audit: zero `.listen(` calls; zero direct M12C `.authorize(` or `.issue(` calls; zero direct M12Q `.issueChallenge(` / `.completeChallenge(` calls; zero M12H/M12I runtime dependencies. No TLS certificate/private-key provisioning, machine-key provisioning, DNS/firewall/tunnel mutation, listener binding or real network proof was performed.

Evidence: definition `bbece84ec9639a306fced77ccc92040d708f9754`; implementation `0e9505620a78d7c2e576dd2f990c88dd6d613e53`; initial proof `3eddc16a82531388cff4bf45756d58de0ba82bef`; fixture correction `e3b5e20fb3a72ae6e10bb880a5f8786b8881f567`; Node HTTPS key typing fixes `dfc504f2db8c26d66cf91697f6dc5608666fbfdf` + `99eb446fa2e18552a13d79c1a7d02a2e57c4dc92`; ephemeral key hardening `12d6806c498e16f8b98cd08370f5f1104fecaeb1` + proof `a55a2b7e15cc93c21095a4cb81ee972e5fa6d660`; contract clarification `924c93be2f5000c3a3c55a3cc77805fd6bd7e685`; IPv6/preflight edge hardening `cc14b84c773ab81e359dbf89f436d8a81b866e07` + proof `4578f8aa93ef80238136022d43162ce886a99268`; final CI `#1080` / `36990529928` passed typecheck + full suite.


## 12W — Deployment credentials, durable machine binding + listener activation — COMPLETE

Security review and software-only implementation are complete. The exact deployment contract remains recorded in `docs/M12W-DEPLOYMENT-CREDENTIALS-LISTENER-ACTIVATION-CONTRACT.md`, with durable binding storage in `src/distributed-machine-auth-binding-store.ts` and deployment/listener composition in `src/distributed-deployment-listener.ts`.

The review deliberately separates software deployment readiness from physical activation. M12W will add a durable controller-local store for M12Q **public** machine-authentication bindings, strict read-only loaders for already-provisioned controller TLS material, exact listener bind configuration, short-lived process-local one-shot listener activation permits, and a narrowly scoped activation adapter whose hosted proof uses an injected fake bind primitive and opens no real socket.

The durable binding store contains only existing `DistributedMachineAuthenticationBindingV1` metadata and never stores target private keys or M12C sessions. Replacement/deletion is optimistic and exact on fingerprint + registration revision. File-backed state must reject corrupt/oversized/symlink/non-regular paths and use same-directory atomic replacement. On POSIX newly created binding state uses owner-only `0600` mode; M12W does not claim unproven Windows ACL enforcement.

Machine-key rotation must bump the existing machine registration revision before replacing the M12Q public binding. That revision bump immediately makes existing M12C sessions stale through M12C's current-registration revalidation and also makes the old M12Q binding stale. If the new binding write then fails, the machine remains unable to authenticate — intentional fail-closed downtime rather than stale credential survival. No dual-key grace period is introduced.

The controller TLS loader is read-only and accepts only exact trusted-startup absolute key/certificate paths. It rejects symlinks/non-regular/oversized/invalid or encrypted key material, performs no ACME/renewal/self-signed fallback, and feeds loaded material through mandatory M12V preflight. TLS rotation is overlap-first: add the new M12P leaf-SPKI pin to targets before switching controller identity, prove the new leaf, then retire the old pin/key later.

Listener configuration is authority-free and exact: explicit IP literal + explicit port matching the M12P controller origin. Wildcard `0.0.0.0` / `::`, public/global, multicast and implicit host/port binds are rejected. M12W permits only loopback or private/local unicast exposure; globally routable/public listener exposure remains separately reviewed.

A bind configuration is not bind authority. Listener activation requires a fresh process-local one-shot permit bound to exact profile/origin/address/port + M12V preflight leaf pin, TTL 30–300 seconds (default 120), consumed before the bind attempt and burned even if bind fails. Hosted CI may use deterministic injected permit/bind fakes only. M12W physical actions remain unauthorized.

The later physical sequence is staged: P0 inspect-only prerequisites; P1 separately authorized credential provisioning/enrollment; P2 separately authorized exact-address listener activation; P3 client-observed TLS proof; P4 M12U bootstrap proof; P5 M12S/M12T **no-work 204** proof. Real writer delivery is not automatically included; delivery acknowledgement/reconciliation must be reviewed before a live writer proof if still unresolved.

Hosted M12W proof remained software-only. The binding store proves canonical create/get/replace/delete, duplicate/corrupt/oversized/private-field rejection, symlink/non-regular-path rejection, optimistic fingerprint/revision checks, same-directory atomic replacement and POSIX `0600` creation. Enrollment binds only to the exact current registration. Rotation bumps the registration revision before binding replacement; a replacement failure leaves the machine fail-closed, and a direct M12C proof confirms that the revision bump makes an already-issued session stale.

The TLS loader accepts only exact trusted absolute local paths, rejects symlinks/non-regular/oversized/encrypted-or-invalid key material, enforces restrictive POSIX private-key permissions, and returns only in-memory parsed identity for mandatory M12V preflight. Bind configuration accepts only explicit loopback/private/local IP literals with a port matching the M12P controller origin; wildcard/public/multicast/mismatched-port configurations fail closed.

Listener activation is guarded by a process-local short-lived one-shot permit bound to exact profile/origin/address/port + M12V leaf pin. Permits are consumed before bind, burned on bind failure, lost across a fresh issuer/process, and cannot be reused. Hosted tests inject a fake bind primitive; they create unbound `https.Server` objects but contain zero `.listen(` calls and open no real socket. Production contains exactly one narrowly scoped `server.listen({host, port, exclusive:true})` inside `NodeDistributedListenerBindPrimitive`, reachable only after the permit/controller checks; it was not invoked by hosted proof.

Static audit: the durable binding store contains zero listener/network calls; deployment production contains zero direct M12C `.authorize(` / `.issue(` calls, zero direct M12Q `.issueChallenge(` / `.completeChallenge(` calls, and no M12H/M12I runtime dependency. Firewall/DNS/tunnel references are immutable `false` contract flags only.

No TLS certificate/private-key issuance, target Ed25519 key generation/provisioning, OS trust-store change, DNS/firewall/NAT/tunnel mutation, real listener bind, physical cross-machine proof or runtime auto-start was performed.

Evidence: definition `198932fbc34b1eafd7f7150e502aaec167bf73f4`; binding store `5040739a70ea97db08acbb47e37647617c4f5252`; deployment substrate `6f8542d3d96835049933c7bf7d30f547b24335c1`; bind revalidation hardening `0dc2d48dd3a66d3507989e427c45e4a5b2174a65`; binding proof `33b47a77f32d5f4bf9b9f6dab29896986196e486`; deployment proof `52ca7a88d1ecf23ad4647da017417033db779669`; final corruption/credential/permit edge proofs `d5df8ffdfe922132f0688d2a08c87b553104967d` + `c859b34a2fdac8cab445d801d2b2a8777f8b4f00`; final CI `#1099` / `37002297374` passed typecheck + full suite.

## 12X — Physical deployment proof — COMPLETE

Authorized physical proof was completed on the Windows development host using canonical origin `https://localhost:8443` and exact loopback bind `127.0.0.1:8443`. P0 confirmed the deployment facts and absence of prior M12 registration/binding state. P1 provisioned a dedicated localhost TLS leaf identity/trust and a machine-local Ed25519 signer, then created identity-only machine registration and authentication-metadata-only public-key binding. Private key material remained outside repository/model-facing/durable distributed task state.

P2 invoked the production one-shot activation path and proved a real listener bound only to `127.0.0.1:8443`; the activation receipt remained `listener_state_evidence_only` with all authority grant flags false. No wildcard, LAN, Tailscale, firewall, DNS, NAT, tunnel or public exposure was introduced.

P3 proved from a separate client process that Windows trust + hostname validation succeeded for `localhost`, the expected leaf SPKI pin succeeded, an intentionally wrong pin failed, and the endpoint remained loopback-only.

P4 exercised the real M12U network bootstrap end-to-end: challenge issuance, local Ed25519 possession proof, bounded M12C session issuance and exact current machine/registration revision binding. The bearer token was process-local, not printed and not persisted; session authority remained `authenticated_machine_identity_only`.

P5 used a fresh authenticated session with the production M12S client against the shared M12T route wired to the real M12R controller-owned selector and an empty controller pending-work queue. The client validated no-work `204`, sent no task/workspace/dispatch/candidate/fence selectors, received no delivery bundle and invoked no target runtime or writer execution. Repository state remained clean throughout.

M12X deliberately stops here. Real distributed work delivery is still gated. Delivery acknowledgement/reconciliation, ambiguous-outcome handling and restart reconciliation must be reviewed and proven before any live writer delivery. Distributed takeover/recovery remains separately gated.

## 12Y — Delivery acknowledgement / reconciliation — COMPLETE

M12Y-A established the durable authority-free controller delivery state and acknowledgement contract. Delivery state is monotonic: `pending → claimed → delivered_unconfirmed → admission_acknowledged`. Ambiguous work delivery remains `delivered_unconfirmed`; no automatic retry or requeue is permitted. An acknowledgement means only that the target has already durably admitted the exact dispatch through M12G.

M12Y-B wired acknowledgement creation to the target admission boundary. After successful M12H/M12G admission and before M12I runtime start, the target creates the exact admission acknowledgement and persists it to a target-local durable outbox. Runtime-start failure does not erase that acknowledgement, and acknowledgement persistence failure blocks runtime start. No network ACK transport or delivery retry was introduced in this slice.

M12Y-C added authenticated ACK upload and controller reconciliation over the existing shared M12P HTTPS origin. The ACK route requires an M12C bearer with `report_status`, exact authenticated machine/registration revision binding, a bounded exact-schema acknowledgement body, and only permits the monotonic `delivered_unconfirmed → admission_acknowledged` transition. Identical duplicate acknowledgements are idempotent. Conflicting, wrong-machine or stale-session acknowledgements fail closed. ACK upload may be retried explicitly with a fresh request id because the acknowledgement is immutable/idempotent; work delivery itself remains non-retryable and non-requeueable.

CI evidence: M12Y-A `#1105`; M12Y-B `#1106` / `#1107`; M12Y-C `#1108`.

M12Y-D completed the restart reconciliation proof. Fresh controller/target process objects reconstructed from durable files preserve `delivered_unconfirmed` and the immutable target ACK outbox, then converge through a fresh authenticated ACK request to `admission_acknowledged` without re-delivering work, requeueing a dispatch, re-entering M12H, starting M12I runtime, or invoking writer execution. The initial PR run exposed an unrelated flaky project-memory read in an existing runtime-start test; the identical commit's push CI passed and the failed PR job rerun passed without code change.

## First real distributed writer physical proof — COMPLETE

Authorized Windows physical proof run `#8` on `DESKTOP-0BLIH36` passed against orchestrator commit `50fa220af5c18af1582118cd1f865c845ecbdb6b`. The proof used the existing localhost M12X TLS/Ed25519 identity, exact `127.0.0.1:8443` listener, llama.cpp OpenAI-compatible provider on `127.0.0.1:8080`, a disposable PostgreSQL 16 fencing backend, a disposable Git workspace and a Safety Plan allowing only `src/demo.ts`.

The proof traversed the real chain: authenticated M12U bootstrap → M12C status/liveness heartbeat → controller-owned M12R selection → M12J delivery → PostgreSQL M12E/F fencing → scheduler-owned local writer lease → M12G admission → M12H target-local authority re-entry → target durable ACK before M12I → real Cline writer execution → completion evidence → authenticated ACK upload → controller reconciliation to `admission_acknowledged`.

Trusted result marker: `passed:true`; one approved file changed; diff safety passed; independent `git diff --check` passed; protected files untouched; worker prose remained untrusted; no work retry/requeue occurred; no commit/push/merge/deploy/public-network exposure occurred; exact current distributed fence was revoked and the local writer lease was released by the scheduler. The disposable proof workspace/resources were cleaned up by the workflow.

Hosted validation for the final harness fixes: push CI `#1130` and PR CI `#1131` green. Physical proof workflow: `M12 distributed writer physical proof` run `#8`, success.

## 12Z-A — Distributed takeover/recovery classification — COMPLETE

`src/distributed-takeover-recovery.ts` adds a classification-only recovery contract. It cannot start work, mutate delivery state, acquire a candidate/fence/lease, invoke M12G/M12H/M12I, retry work, requeue work or reuse stale dispatch/candidate/fence/handoff/runtime evidence.

The classifier consumes only durable delivery state plus a target-local task summary and returns authority-free dispositions: ACK reconciliation only, manual ambiguity review, fresh-authority review required, or terminal/no takeover. Any eventual recovery is explicitly required to use fresh controller selection, fresh candidate assignment, fresh distributed fence, fresh local writer lease, fresh dispatch, fresh M12G admission and fresh M12H target-local authority re-entry.

Evidence: `305003cc91685e6ef96d90e7910f3ef17266194f`; CI `#1134` passed typecheck + full suite.

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
| Secure distributed transport profile/server identity | Complete — M12P; CI `#975`; no network I/O |
| Machine authentication bootstrap | Complete — M12Q; CI `#985`; Ed25519 possession proof delegates to M12C only |
| Controller pending-work selection | Complete — M12R; CI `#993`; target cannot select task/workspace/dispatch/candidate/fence |
| Secure target-pull HTTPS client | Complete — M12S; CI `#1015`; M12P-authenticated outbound-only client |
| Controller HTTPS target-pull server | Complete — M12T; CI `#1025`; strict unbound server/route, no `listen()` path |
| Networked machine-auth bootstrap | Complete — M12U; CI `#1055`; canonical M12Q challenge/session envelope + signer-only target client, socket-free proof |
| Shared unbound HTTPS composition | Complete — M12V; CI `#1080`; exact M12T+M12U route isolation, bounded bootstrap body collection, local M12P TLS identity preflight, one unbound server |
| Deployment credential/binding/listener substrate | Complete — M12W; CI `#1099`; durable public M12Q binding store + revision-safe key rotation + read-only TLS loader + explicit private/loopback bind config + one-shot activation permit; hosted fake-bind proof only |
| Distributed takeover/recovery | Disabled; requires a separately reviewed fresh-authority design |
| Physical distributed HTTPS credential provisioning / listener activation | Complete — M12X P0–P5 authorized Windows proof: trusted localhost TLS identity, Ed25519 machine identity/registration/binding, exact `127.0.0.1:8443` listener, client TLS/hostname/SPKI verification, real M12U bootstrap and authenticated M12S/M12T no-work `204`; no delivery/runtime/writer execution occurred |
| Controller-to-target network push | Disabled |
| Real distributed writer physical execution | Proven once in a tightly bounded localhost physical proof; production cross-machine wiring remains disabled |
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
22. M12P transport profiles may contain public endpoint/pinning metadata only. Bearer tokens, private keys, client certificates and other credentials remain outside the profile and outside model-facing/durable task state.
23. M12Q private keys remain machine-local and outside the orchestrator bootstrap/controller/task/project/model-facing state. Public keys/fingerprints are authentication metadata only, not task authority.
24. M12Q challenge state is intentionally process-local; process restart invalidates outstanding challenges. Durable bootstrap challenge recovery, if ever needed, requires a separate review.
25. M12R requires controller-owned work selection derived only from authenticated machine identity. The target must never submit task/workspace/dispatch/candidate/fence selectors to a future network route.
26. `ReferenceControllerPendingWorkQueue` is deterministic single-process proof only. Any production pending-work source must preserve atomic exact-target claim semantics and revalidation before M12J delivery.
27. Cline completion prose is reviewer context only; trusted captured evidence wins conflicts.

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
9. **COMPLETE — M12P secure target-pull transport profile + controller server-identity prerequisite.** Final CI `#975`.
10. **COMPLETE — M12Q machine authentication bootstrap + bounded M12C session issuance.** Final CI `#985`.
11. **COMPLETE — M12R controller-owned pending-work selection.** Final CI `#993`.
12. **COMPLETE — M12S secure HTTPS target-pull client.** Final CI `#1015`; implementation is outbound-client-only and hosted proof opened no socket/listener.
13. **COMPLETE — M12T controller HTTPS target-pull route / unbound server.** Final CI `#1025`; hosted proof opened no listener/socket and production has no `listen()` call.
14. **COMPLETE — M12U networked M12Q bootstrap.** Final CI `#1055`; exact nonce hardening, controller challenge/session envelope and target signer client are proven socket-free.
15. **COMPLETE — M12V shared unbound HTTPS composition + TLS identity preflight.** Final CI `#1080`; hosted proof remained socket/listener-free and production contains no `listen()` path.
16. **COMPLETE — M12W deployment credential/binding/listener substrate.** Final CI `#1099`; hosted proof used fake bind primitives only and performed no real credential/network mutation.
17. **COMPLETE — M12X P0–P5 physical deployment proof.** Authorized Windows proof established trusted localhost TLS, Ed25519 machine authentication, exact loopback listener activation, client-observed TLS/SPKI enforcement, real M12U bootstrap and authenticated M12S/M12T no-work `204`; no real delivery/runtime/writer execution occurred.
18. **COMPLETE — M12Y-A/B/C delivery acknowledgement / reconciliation substrate.** Durable controller delivery state, target durable ACK outbox and authenticated ACK upload/reconciliation are implemented and green through CI `#1108`.
19. **COMPLETE — M12Y-D restart reconciliation proof.** Controller ambiguity state and target ACK evidence survive process reconstruction and reconcile idempotently after restart; push CI `#1112` and PR CI `#1113` rerun are green.
20. **COMPLETE — First real distributed writer physical proof.** Windows run `#8` passed against `50fa220a`: real Cline writer execution, one-file Safety scope, PostgreSQL fencing, local writer lease, authenticated delivery/ACK reconciliation, independent diff evidence and exact-current fence cleanup all passed with no retry/requeue/commit/push/merge/deploy/public exposure.
21. **COMPLETE — M12Z-A recovery classification.** Authority-free classification only; CI `#1134`.
22. **NEXT — M12Z-B non-authoritative recovery proposal contract.** Only `fresh_authority_review_required` may produce a bounded recovery proposal; ambiguity/ACK-only/terminal dispositions must remain blocked. Proposal creation must not start work, acquire candidate/fence/lease, create a dispatch, invoke M12G/M12H/M12I or grant authority.
23. **DO NOT production-wire cross-machine delivery/execution** until the takeover/recovery slice is reviewed and proven while preserving M12P server authentication, M12C/M12Q target authentication, M12R controller-owned selection, M12G replay, M12H local re-entry, M12I start guards, M12N lifecycle, M12O no-resurrection and M12F immediate write fencing.
24. **DO NOT perform public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning or external-network changes** without explicit user authorization immediately before the action.

---

# Recent progress

- 2026-10-05: M12Z-A recovery classification completed at `305003cc`; CI `#1134` green. The new classifier is authority-free and never retries/requeues or reuses stale distributed evidence; it only classifies durable delivery/task state into ACK-only, ambiguity review, fresh-authority review, or terminal/no-takeover dispositions.
- 2026-10-05: First real distributed writer physical proof passed on Windows workflow run `#8` against orchestrator commit `50fa220a`. Real Cline changed exactly one approved disposable file; diff safety and independent Git checks passed; target ACK was durable before runtime, controller reconciled to `admission_acknowledged`, no work retry/requeue occurred, and exact-current fence + local writer lease cleanup passed. No commit/push/merge/deploy/public exposure was used. Final hosted validation: CI `#1130` / `#1131` green.
- 2026-10-05: M12Y-D restart reconciliation completed at commit `e8046ed3`: durable controller `delivered_unconfirmed` state and target ACK outbox survive process reconstruction and reconcile to `admission_acknowledged` through fresh authenticated ACK evidence without work redelivery/requeue or runtime/writer execution. Push CI `#1112` passed; PR CI `#1113` initially hit an unrelated flaky project-memory JSON read, then passed on rerun without code changes.
- 2026-10-05: M12Y-A/B/C completed through CI `#1108`: durable controller delivery state, target-local durable admission-ACK outbox, authenticated `report_status` ACK upload on the shared HTTPS origin, exact machine/revision reconciliation, and idempotent ACK retry semantics; work delivery remains non-retryable/non-requeueable and no real writer execution occurred. Next gate is M12Y-D restart reconciliation.
- 2026-10-05: M12X P0–P5 authorized Windows physical proof completed: trusted localhost TLS identity, Ed25519 machine registration/binding, exact `127.0.0.1:8443` listener, client TLS/hostname/SPKI enforcement, real M12U authentication and authenticated M12S/M12T no-work `204`; no work delivery/runtime/writer execution occurred. Next gate is M12Y acknowledgement/reconciliation.
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
- 2026-09-29: M12P secure transport profile/server-identity prerequisite defined and implemented without network I/O; final CI `#975` green.
- 2026-10-01: Post-M12P security review identified machine-authentication bootstrap/session issuance and controller-owned pending-work selection as prerequisites before network I/O.
- 2026-10-01: M12Q Ed25519 possession-proof bootstrap completed; valid proof delegates only to existing M12C issuance, with replay/stale/key-rotation/authority-widening proofs; final CI `#985` green.
- 2026-10-01: M12R controller-owned pending-work selection completed; target pull inputs contain no work selectors; exact-machine FIFO claim, candidate/fence revalidation and M12J reuse proven; final CI `#993` green.
- 2026-10-02: M12S secure HTTPS target-pull client security review and implementation completed. Fixed outbound-only POST, explicit system-CA + hostname + leaf-SPKI pin validation, no redirects/proxy/retries/work selectors, strict bounded 200/204 responses, sanitized errors, explicit ambiguous outcome and socket-free hosted proof completed; final CI `#1015` green.
- 2026-10-02: M12T controller HTTPS target-pull route/unbound-server security review and implementation completed. Exact M12S headers/no body, duplicate-preserving validation, exactly one M12R call with no separate M12C pre-auth, bodyless/sanitized errors, bounded strict HTTP/1.1/TLS server settings, fail-closed special events and an unbound server factory were proven socket-free; final CI `#1025` green.
- 2026-10-02: M12U networked M12Q bootstrap security review and implementation completed. Exact 32-byte M12Q nonce validation, two fixed canonical JSON bootstrap routes, M12Q-only delegation, challenge idempotency/one-active challenge/rate + concurrency defenses, anti-enumeration, signer-only target private-key boundary, M12P TLS client validation and no completion retry were proven socket-free; final CI `#1055` green.
- 2026-10-02: M12V shared unbound HTTPS composition/deployment-readiness review and implementation completed. Exact three-route isolation, bounded bootstrap collection, strict unbound HTTP/1.1 server, local M12P leaf DNS/IP + SPKI pin + private-key-match preflight, ephemeral/zeroed server-key export and IPv6 handling were proven socket-free; final CI `#1080` green.
- 2026-10-02: M12W deployment credential/binding/listener activation software substrate completed. Durable public M12Q binding storage, revision-bumping Ed25519 rotation, strict read-only TLS loading, explicit private/loopback bind validation, short-lived one-shot activation permits and fake-bind activation were proven without opening a real listener; final CI `#1099` green.

---

# Current next step

**M12Z-B — non-authoritative recovery proposal contract.** Only an M12Z-A decision of `fresh_authority_review_required` may produce a bounded proposal for later human/trusted-coordinator review. `ack_reconciliation_only`, `manual_ambiguity_review`, and `terminal_no_takeover` must be rejected. The proposal must bind the exact task/workspace/delivery snapshot and explicitly require fresh controller selection, candidate, distributed fence, local writer lease, dispatch, M12G admission and M12H authority re-entry. It must not itself start work or grant any execution/release authority.