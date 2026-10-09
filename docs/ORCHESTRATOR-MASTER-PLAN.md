# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-10-08
Branch: `milestone-13/delegation`

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
| 12 | Distributed / multi-machine orchestration | Complete — software complete through M12Z-H; M12X physical HTTPS/auth/no-work proof complete; M12Y acknowledgement/restart reconciliation complete; first real distributed writer physical proof passed on Windows run `#8`; M12Z-I two-process fresh-authority recovery physical proof passed on Windows run `#9` against orchestrator commit `ff2c1f7a` |
| 13 | Safe multi-agent delegation | Complete — M13A–M13Y; acceptance harness `26305244`, CI `#1240` green |
| 14 | Autonomous engineering loops | Complete — M14A–M14P; phase-aware restart-safe bounded loop acceptance harness `4f276b95`, CI `#1283` green |
| 15 | GitHub delivery / release authority | Complete — M15A–M15H; full separated delivery-authority acceptance harness `fcc3f52d`, CI `#1305` green |
| 16 | Production security / reliability / observability | Complete — M16A–M16H; production hardening acceptance harness `59a11705`, CI `#1323` green |
| 17 | Productization / installer / first-run UX | Complete — M17A–M17H productization contracts and acceptance composition; harness `400ce861`, type correction `3aa7a573`, CI `#1346` green. Installer execution and physical service installation are not proven by the fake-driver harness. |
| 18 | Production release | In progress — M18A source/evidence readiness assessment complete; production release blocked pending M18B–M18F. Current reviewed head `b9c11722`, CI `#1347` green. |

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

## 12Z-B — Non-authoritative recovery proposal — COMPLETE

`src/distributed-recovery-proposal.ts` permits proposal creation only from M12Z-A `fresh_authority_review_required` decisions. ACK-only, ambiguity-review and terminal/no-takeover classifications are rejected. The proposal binds the exact delivery/task/workspace snapshot and records that any future recovery requires fresh controller selection, fresh candidate assignment, fresh distributed fence, fresh local writer lease, fresh dispatch, fresh M12G admission and fresh M12H target-local authority re-entry.

The proposal is evidence only: it cannot start work, acquire candidate/fence/lease authority, create a dispatch, invoke M12G/M12H/M12I, retry/requeue work or grant task/filesystem/Safety/credential/release authority.

Evidence: implementation `2fa47a2161afb48c239b9b092250d85b330f74f9`; type-only narrowing correction `e632e4fd3efdb38f49d709622c556816bcf146a4`; push CI `#1139` green; PR CI `#1140` rerun green after the known unrelated M12N timing flake.

## 12Z-C — Trusted recovery pre-execution gate — COMPLETE

`src/distributed-recovery-preexecution.ts` reuses the existing target-local trusted task loader boundary and verifies the current task/workspace/Safety binding before any recovery can advance. It accepts only a still-fresh `created` task with no Cline session, no run history, no session generation and no pending escalation.

The output is evidence only. M12Z-C cannot acquire a candidate, distributed fence or local writer lease; create a dispatch; consume M12G admission; enter M12H/M12I; start Cline; retry/requeue work; or grant task/filesystem/Safety/credential/release authority.

Evidence: `76fe12fcc21d9745b977c8d94ebe91ee53f59f22`; CI `#1143` passed typecheck + full suite.

## 12Z-D — Fresh-authority reacquisition preparation — COMPLETE

`src/distributed-recovery-reacquisition-preparation.ts` validates an already-new candidate assignment, current distributed fence and current local writer lease against the exact M12Z-C task/workspace evidence. Candidate/fence bindings must match exactly, the candidate must still be current, the fence must still be current, and the local lease identity must remain stable across validation.

This slice does not create a candidate, fence or local writer lease and still does not create a recovery dispatch, invoke M12G/M12H/M12I, retry/requeue work, or start Cline. The result is preparation evidence only and grants no task/filesystem/Safety/lease/credential/release authority.

Evidence: `453c22c3d6451b94c6300bff4adaf770649b40fb`; CI `#1147` passed typecheck + full suite.

## 12Z-E — Fresh recovery dispatch creation gate — COMPLETE

`src/distributed-recovery-dispatch-creation.ts` wraps the existing authority-free M12G dispatch creator with recovery-specific exact-binding and immediate freshness checks. It accepts only the exact candidate, distributed fence and local writer lease identities recorded by M12Z-D, then revalidates all three immediately before creating a brand-new dispatch.

The created dispatch is still only `execution_request_only` evidence. M12Z-E does not consume M12G admission, enter M12H/M12I, start Cline, retry/requeue prior work, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: `3f7bb2f1c5df006373352cb63e1f8cf6c7418da2`; CI `#1151` passed typecheck + full suite.

## 12Z-F — Recovery admission bridge — COMPLETE

`src/distributed-recovery-admission-bridge.ts` binds the brand-new M12Z-E dispatch back to the exact M12Z-D preparation evidence, candidate and distributed fence, then delegates admission to the existing M12G gateway. Durable replay consumption remains owned exclusively by M12G; the recovery bridge does not implement or bypass its own replay path.

The result remains `admission_evidence_only`. M12Z-F does not enter M12H/M12I, start Cline, retry/requeue prior work, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `e413b0ecbf95305286666c8f8d30889055ccb2af`; test typing correction `403cca2c8db636cd33e53279a98b1c63fe03d764`; CI `#1157` attempt 2 passed typecheck + full suite after the known unrelated M12N timing flake.

## 12Z-G — Recovery target-local handoff gate — COMPLETE

M12H gained a dedicated post-admission entry point so recovery can reuse an already-consumed M12G receipt without replaying the one-shot dispatch. The normal M12H path is unchanged: it still owns M12G admission for ordinary execution.

`src/distributed-recovery-target-handoff.ts` binds the admitted recovery dispatch, receipt, candidate, distributed fence and current local writer lease back to the exact M12Z-D preparation evidence, then enters only the new M12H post-admission path. M12H still reloads the target-local durable task, requires a fresh `created` task with no prior runtime/escalation state, revalidates current task/Safety/registry authority, validates the local writer lease, and validates the distributed fence.

M12Z-G returns only the existing local runtime handoff context. It does not invoke M12I, start Cline, retry/requeue prior work, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: M12H refactor `91ad150d6775460b484c54d3031ef3cd8a37fd5e`; M12Z-G `1da1eae3511e9a296f2222f38b2e1664c4d64d66`; CI `#1163` attempt 2 passed typecheck + full suite after the known unrelated M12N timing flake.

## 12Z-H — Recovery runtime-start gate — COMPLETE

`src/distributed-recovery-runtime-start.ts` binds a valid M12Z-G process-local handoff context back to the exact M12Z-D local writer lease and distributed fence identities, revalidates both immediately before runtime start, and delegates exactly once to the existing M12I starter.

M12I remains the sole runtime-start path and retains its existing fresh-task, task/Safety authority, provider preflight, local lease, distributed fence, candidate/fence renewal and fail-safe abort behavior. M12Z-H adds no automatic retry, automatic requeue or stale-session resume semantics.

Evidence: implementation `36b86971c014c0d3e594ec47df8fb09cded95886`; test-only renewable-fence typing correction `d41f5f39d416fee5cf3b58147fed4ebcb2e72933`; CI `#1168` passed typecheck + full suite.

## 12Z-I — Two-process fresh-authority recovery physical proof — COMPLETE

A dedicated two-process Windows proof in `src/live-m12-recovery-proof.ts` exercised the recovery path across a real process boundary using the existing self-hosted runner and disposable workspace.

Stage 1 created a fresh approved task, current candidate/fence, brand-new dispatch, durable `admission_acknowledged` delivery state and durable M12G replay marker, then exited before M12H/M12I runtime history was created.

Stage 2 recreated controller/runtime objects in a new Node process, proved the old dispatch replay marker survived, classified the admitted/no-runtime-history state as `fresh_authority_review_required`, explicitly invalidated the old distributed fence, created a fresh recovery proposal, reacquired a new candidate, newer fence generation, fresh scheduler-owned local writer lease, fresh dispatch and fresh M12G admission, re-entered M12H through the post-admission boundary, and started the real Cline writer only through M12I.

The proof independently verified exactly one allowed file change, `git diff --check`, protected-file byte integrity, no stale-session resume, no automatic retry/requeue, no commit/push/merge/deploy, and no listener/public-network exposure.

Evidence: harness `ff2c1f7a2f8d8cbfe6080222fd6024eeae168938`; hosted CI `#1172` push and `#1173` PR green; temporary Windows proof workflow commit `df58b78791743403ce308a69ea19e487dd7ef7e0`; self-hosted Windows physical proof run `#9` passed.

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
22. **COMPLETE — M12Z-B non-authoritative recovery proposal.** Push CI `#1139`; PR CI `#1140` rerun green.
23. **COMPLETE — M12Z-C trusted recovery pre-execution gate.** CI `#1143` green.
24. **COMPLETE — M12Z-D fresh-authority reacquisition preparation.** CI `#1147` green.
25. **COMPLETE — M12Z-E fresh recovery dispatch creation gate.** CI `#1151` green.
26. **COMPLETE — M12Z-F recovery admission bridge.** CI `#1157` rerun green.
27. **COMPLETE — M12Z-G recovery target-local handoff gate.** CI `#1163` rerun green.
28. **COMPLETE — M12Z-H recovery runtime-start gate.** CI `#1168` green.
29. **COMPLETE — M12Z-I recovery physical proof + closure criteria.** Windows physical proof run `#9` passed.
30. **DO NOT production-wire cross-machine delivery/execution** until the takeover/recovery slice is reviewed and proven while preserving M12P server authentication, M12C/M12Q target authentication, M12R controller-owned selection, M12G replay, M12H local re-entry, M12I start guards, M12N lifecycle, M12O no-resurrection and M12F immediate write fencing.
31. **DO NOT perform public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning or external-network changes** without explicit user authorization immediately before the action.

---

# Recent progress

- 2026-10-07: M13X deferred-sibling progression gate completed at `4b8844bb`; PR #3 CI `#1238` attempt 2 green. Attempt 1 failed only the known unrelated M12N timing assertion. A deferred sibling can now become the next M13U candidate only after the previously selected sibling is terminal and the shared workspace has no active writer lease.
- 2026-10-07: M13W selected-sibling runtime bridge completed at `24acda72` with test type correction `dd8f484c`; PR #3 CI `#1236` green. Only the current M13U/M13V-selected sibling can enter the existing M13G runtime starter; deferred siblings fail before runtime invocation and no second workspace writer is created.
- 2026-10-07: M13V selected-sibling activation bridge completed at `0d78917d`; PR #3 CI `#1233` green. Only the single M13U-selected sibling can enter the existing M13F activation coordinator under the exact fresh scheduler-owned lease; deferred siblings fail closed and runtime start remains disabled at this boundary.
- 2026-10-06: M13U sibling writer-lease compatibility gate completed at `6818a057`; PR #3 CI `#1231` green. The gate preserves the existing `maxActiveWritersPerWorkspace = 1` invariant: one M13T-prepared sibling is selected for the next lease-backed activation while any additional `parallel_disjoint` sibling is explicitly deferred; no lease or runtime is created.
- 2026-10-06: Before M13U implementation, scheduler review confirmed `maxActiveWritersPerWorkspace = 1` and exclusive workspace-writer locking. Since all M13B siblings share one workspace, true same-workspace concurrent Cline writers are not yet safe; `parallel_disjoint` therefore remains logical/scope-level eligibility only until a separately reviewed path-scoped locking design exists.
- 2026-10-06: M13T sibling durable-preparation batch completed at `4bc2f4f0`; PR #3 CI `#1228` green. The orchestrator now consumes only M13S-issued sibling tickets into M13D receipts and reuses the existing M13E durable preparation service for those exact children; blocked/terminal siblings cannot produce preparation state and no writer lease/runtime is acquired.
- 2026-10-06: M13S sibling execution admission batch completed at `1d8b5bb4`; PR #3 CI `#1226` green. Only M13R-prepared siblings can receive fresh short-lived one-shot M13D tickets; blocked/terminal siblings remain ineligible, and the batch still creates no durable preparation, writer lease, fence, or runtime.
- 2026-10-06: M13R sibling execution preparation set completed at `fd060594`; PR #3 CI `#1224` green. The orchestrator now maps only M13Q-admitted sibling identities back to their exact M13C descriptors and emits non-executable per-child preparation requests; blocked/terminal siblings fail closed and cannot advance.
- 2026-10-06: M13Q sibling execution-set admission completed at `210b671b`; PR #3 CI `#1222` green. The orchestrator can now determine which already-materialized siblings are eligible at a given point: all pending siblings only for an M13B-proven `parallel_disjoint` set, or exactly one next child for `serialized`; this remains non-executing and creates no workers or leases.
- 2026-10-06: M13P repair-child completion/review handoff completed at `de1afc0d`; PR #3 CI `#1220` green. Completed repair-child output is now bound to the exact repair attempt, fresh repair-child identity, prior child, original delegation/parent binding and narrowed scope while worker prose remains untrusted and independent validation/diff/checkpoint evidence remains authoritative.
- 2026-10-06: M13O repair-child runtime-start adapter completed at `10f3aea0`; PR #3 CI `#1218` green. A repair child now starts only as a fresh TaskStore identity with zeroed session/run/recovery counters, bounded repair instruction, exact narrowed write scope and lease-aware runtime safety; prior-child task/session/checkpoint/lease identity reuse remains prohibited.
- 2026-10-06: M13N repair-child activation gate completed at `a5db8d2d`; PR #3 CI `#1216` green. Activation now requires a fresh scheduler-owned lease for the new repair-child task ID, revalidates the exact inherited parent/Safety binding, emits only process-local runtime input with `runtimeStartAuthorized: false`, and rejects prior-child lease/runtime/session/checkpoint reuse.
- 2026-10-06: M13M repair-child durable preparation completed at `5e242a39`; PR #3 CI `#1214` green. A consumed M13L admission can now persist one new non-executable repair-child preparation after fresh parent/Safety revalidation and proof the prior child remains terminal, while carrying no prior-child runtime/checkpoint/session state.
- 2026-10-06: M13L repair-child execution admission completed at `9320d5ea` with test-import correction `4b22362b`; PR #3 CI `#1212` green. A fresh repair child can now receive only a short-lived single-use non-executing permit after full inherited parent/Safety revalidation and proof that the prior child remains terminal; prior child/session/lease reuse stays prohibited.
- 2026-10-06: M13K fresh repair-child rematerialization completed at `beabe271`; PR #3 CI `#1209` passed on attempt 2 after the known unrelated M12N renewal timing flake. Consumed M13J repair admission now yields only a brand-new non-executable repair-child identity while preserving the exact prior delegation/Safety/worker/scope binding; the prior child is never resumed or mutated.
- 2026-10-06: M13J bounded child repair admission completed at `b9b9eccc` with test-import correction `7ac59440`; PR #3 CI `#1207` green. Repair admission is short-lived, single-use, restart-safe through a durable per-child two-attempt budget, revalidates current parent/Safety scope, and still cannot schedule/resume/start the child or widen authority.
- 2026-10-06: M13I supervisor child-review decision completed at `44836b42`; PR #3 CI `#1204` green. The supervisor can now return advisory `pass`, bounded `repair`, or `escalate` guidance against one child review handoff, while repair wording that attempts scope/tool/validation/Safety/release widening fails closed and no child scheduling or execution authority is granted.
- 2026-10-06: M13H child completion/review handoff completed at `bffd4407`; PR #3 CI `#1202` green. Completed child output is now bound to its delegation/preparation identity and narrowed scope while worker prose remains explicitly untrusted; supervisor review sees independent validation/diff/Git/checkpoint/recovery evidence only and gains no scheduling/correction/release authority.
- 2026-10-06: M13G single-child runtime-start adapter completed through `80430db6`; PR #3 CI `#1200` green. One local child may now start only through the existing ClineRunner + lease-aware Hub safety path using a fresh scheduler-owned child lease and exact narrowed child Safety scope; native subagents/teams/shell/network/MCP/plugins remain disabled, existing child state cannot be resumed/replayed, and lease loss triggers fail-safe abort.
- 2026-10-06: M13F child execution activation gate completed at `1889fdf8`; PR #3 CI `#1196` green. Activation consumes only an already-fresh scheduler-owned local writer lease, revalidates the full current parent binding, proves exact child/workspace lease identity, and emits a narrowed process-local runtime input with runtime start still unauthorized.
- 2026-10-06: M13E durable child execution preparation completed at `6d8c4c17` with syntax-only correction `b4a176ce`; PR #3 CI `#1194` green. The consumed M13D admission receipt is revalidated against current full parent execution binding and persisted once as non-executable child preparation outside `TaskStore`, preserving narrowed scope and trusted validation commands without worker/runtime authority.
- 2026-10-06: M13D one-shot child execution admission merged via PR #1 at `43d43747`; push CI `#1190` and PR CI `#1191` green. The short-lived single-use permit revalidates current parent/Safety binding and delegation-set mode but remains non-executing and grants no worker/filesystem/release authority.
- 2026-10-06: M13C child-task materialization completed at `60d3e0b2`; push CI `#1186` and PR CI `#1187` green. Validated child delegation is materialized only as a non-executable descriptor outside `TaskStore`, preserving exact parent/Safety binding and narrowed child scope while granting no worker/runtime authority.
- 2026-10-06: M13B delegation-set validation / sibling isolation completed at `7c87296a`; push CI `#1182` and PR CI `#1183` green. Parallel sibling evidence is permitted only for conservatively disjoint write scopes; overlaps require explicit serialized coordination. The set remains evidence-only and creates no workers/runtime authority.
- 2026-10-06: M13A bounded delegation envelope completed at `df0421d2` with type-only correction `eeb878ed`; CI `#1178` green. Delegation is evidence-only, exact-parent-scope selection only, non-recursive, and grants no execution/tool/release authority.
- 2026-10-06: M12Z-I two-process fresh-authority recovery physical proof passed on Windows run `#9` using harness `ff2c1f7a` and temporary workflow `df58b787`. The old dispatch replay marker survived process restart, stale fence authority was invalidated, all recovery authority was reacquired fresh, and the final real Cline edit passed independent one-file Git/diff/protected-file checks. Milestone 12 acceptance is complete.
- 2026-10-05: M12Z-H recovery runtime-start gate completed at `36b86971` with test-only typing correction `d41f5f39`; CI `#1168` green. Recovery can now reach M12I only after exact prepared lease/fence identity revalidation, with no automatic retry/requeue/stale-session resume semantics.
- 2026-10-05: M12Z-G recovery target-local handoff completed at `1da1eae3` after M12H post-admission entry refactor `91ad150d`; CI `#1163` green on rerun after the known unrelated M12N timing flake. Recovery can now re-enter M12H without double-consuming M12G replay state and still stops before M12I.
- 2026-10-05: M12Z-F recovery admission bridge completed at `e413b0ec` with test typing correction `403cca2c`; CI `#1157` green on rerun after the known unrelated M12N timing flake. Recovery admission delegates to the existing durable M12G gateway and still stops before M12H/M12I.
- 2026-10-05: M12Z-E fresh recovery dispatch creation completed at `3f7bb2f1`; CI `#1151` green. It creates only a brand-new authority-free M12G dispatch from the exact still-current M12Z-D candidate/fence/local-lease set and still stops before admission/runtime.
- 2026-10-05: M12Z-D fresh-authority reacquisition preparation completed at `453c22c3`; CI `#1147` green. It validates a fresh candidate, current distributed fence, and stable current local writer lease against exact M12Z-C task/workspace evidence while remaining preparation-only.
- 2026-10-05: M12Z-C trusted recovery pre-execution gate completed at `76fe12fc`; CI `#1143` green. It reuses target-local task/workspace/Safety validation and requires a fresh `created` task with no runtime/session/escalation history before emitting evidence-only recovery readiness.
- 2026-10-05: M12Z-B non-authoritative recovery proposal completed through type-only correction `e632e4fd`; push CI `#1139` green and PR CI `#1140` green on rerun after the known unrelated M12N timing flake. Only `fresh_authority_review_required` can produce a proposal; proposals cannot start or reacquire work.
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

# Milestone 13 — Safe Multi-Agent Delegation

Acceptance target: allow the orchestrator/supervisor to decompose already-approved work into bounded child slices without allowing delegation itself to create execution authority, widen Safety scope, invent worker identity, grant tool/network/release capabilities, or permit unbounded recursive fan-out.

## 13A — Bounded delegation authority envelope — COMPLETE

`src/multi-agent-delegation-contract.ts` defines an authority-free child delegation envelope derived only from an already-approved `SupervisorTaskV1`. A child may select only exact path patterns already approved by the parent, retains the same project/workspace/Safety/worker binding, inherits protected paths, and remains `delegation_envelope_only`.

M13A creates no worker, starts no Cline/runtime, acquires no local lease or distributed fence, creates no dispatch/admission, allows no subdelegation or agent teams, and grants no shell/network/MCP/plugin/task/filesystem/Safety/credential/release authority.

Evidence: implementation `df0421d2328b8ac289d05ce2ef2d2c1ee88cad29`; type-only correction `eeb878ed4c6cfd1b4b2584ebc1f6da2e833bf7e7`; CI `#1178` passed typecheck + full suite.

## 13B — Delegation set validation / sibling isolation — COMPLETE

`src/multi-agent-delegation-set.ts` validates one to eight M13A child envelopes as one authority-free delegation set. Every child must share the exact same parent supervisor/task/project/workspace/Safety/worker-profile binding, delegation IDs and normalized child objectives must be unique, and scope overlap is evaluated conservatively from the child path patterns.

`parallel_disjoint` is accepted only when no child scopes may overlap. Any detected overlap requires explicit `serialized` coordination evidence. This slice does not schedule or create workers, start Cline/runtime, acquire leases/fences, create dispatch/admission state, permit subdelegation, or grant task/filesystem/Safety/credential/release authority.

Evidence: `7c87296aa02496e099230df662da4910a6e3cf75`; push CI `#1182` and PR CI `#1183` passed typecheck + full suite.

## 13C — Child-task materialization contract — COMPLETE

`src/multi-agent-child-task.ts` converts one validated M13A delegation that is present in an accepted M13B set into a bounded `MultiAgentChildTaskDescriptorV1`. The descriptor copies only the exact parent task/project/workspace/Safety/worker-profile binding and the child’s narrowed objective, acceptance criteria, allowed paths and protected paths.

The descriptor is deliberately not an `OrchestratorTask` and is not persisted through `TaskStore`; existing schedulers therefore cannot accidentally treat materialization as executable work. It remains `child_task_materialization_only`, requires later independent execution admission and fresh writer/fence authority, forbids subdelegation, and grants no task/filesystem/Safety/lease/credential/release authority.

Evidence: `60d3e0b2ce57c14a653816a67143bed64a0c40ba`; push CI `#1186` and PR CI `#1187` passed typecheck + full suite.

## 13D — One-shot child execution admission — COMPLETE

`src/multi-agent-child-execution-admission.ts` issues a short-lived, single-use admission token for exactly one M13C child descriptor only after revalidating the current parent task/Safety binding and exact M13B delegation-set membership/coordination mode. Terminal parents or pending human escalation fail closed.

The permit remains `child_execution_admission_only`; issuing or consuming it does not create/start a worker, invoke Cline/runtime, acquire a local writer lease or distributed fence, create distributed dispatch/admission state, enable recursive delegation, or grant task/filesystem/Safety/credential/release authority.

Evidence: `43d4374706928a5b639511a957875c26ce7baa5f`; push CI `#1190` and PR CI `#1191` passed before merge into `main` at `e749117ff4d795e0de0dad74ac09190eb186a5f1`.

## 13E — Durable child execution preparation — COMPLETE

`src/multi-agent-child-execution-preparation.ts` persists exactly one durable preparation per child after a consumed M13D admission receipt is presented and the full current parent execution binding is revalidated. The durable record carries the exact parent project/workspace/registry/Safety/profile/worker binding, current policy version, trusted validation commands, and the child’s narrowed allowed/protected path scope.

The preparation remains outside `TaskStore`, is explicitly non-executable, and requires a later fresh parent-binding check plus fresh writer authority before any execution path can exist. It creates no worker, starts no Cline/runtime, acquires no local writer lease or distributed fence, creates no distributed dispatch/admission state, permits no subdelegation, and grants no task/filesystem/Safety/credential/release authority.

M13D also gained a distinct consumed-admission receipt so M13E never infers consumption from permit shape alone.

Evidence: consumed-receipt support `6d65edb28837d541c07c7f574b8a690b57738fb5`; M13E implementation `6d8c4c17ec25267d63f9620af61bb52b28732a0e`; syntax-only correction `b4a176ce48c94b0749064a311ad4781bbfa440d9`; PR #3 CI `#1194` passed typecheck + full suite.

## 13F — Child execution activation gate — COMPLETE

`src/multi-agent-child-execution-activation.ts` accepts one durable M13E preparation only inside an already-acquired scheduler-owned local writer lease. It revalidates the complete current parent project/workspace/registry/Safety policy/profile/worker/validation binding, then requires the live lease task ID to equal the child task ID and the lease workspace/owner/fence identity to remain unchanged across current-state validation.

The output is a process-local narrowed child runtime input plus activation evidence. `runtimeStartAuthorized` remains false; the slice does not acquire the lease itself, start Cline/runtime, acquire a distributed fence, create distributed dispatch/admission state, permit subdelegation, or grant task/filesystem/Safety/credential/release authority.

Evidence: `1889fdf89f2753decae4afa84ab99ce9709845f2`; PR #3 CI `#1196` passed typecheck + full suite.

## 13G — Single child runtime-start adapter — COMPLETE

`src/multi-agent-child-runtime-start.ts` starts exactly one local child only from a valid M13F process-local activation context. Immediately before start it revalidates the current parent execution binding, current child lease identity and registered workspace revision, resolves/preflights the configured worker profile, refuses any pre-existing child task state, then persists a fresh child `OrchestratorTask` whose approved write paths remain the narrowed child scope.

Execution reuses the existing `ClineRunner` and `LeaseAwareHubRuntimeFactory`, so owner-targeted safe executors, durable checkpoints, validation, diff safety and human escalation remain the existing trusted mechanisms. The child authority provider maps current parent binding to the child’s narrowed allowed-path envelope on every write-capable revalidation. Native Cline subagents and agent teams stay disabled; model shell/network/MCP/plugins remain disabled; distributed child execution and release authority are absent. Local writer-lease loss aborts the child fail-safe.

Evidence: implementation `84c257d5476ec989b607c0f0bb7dc68279e2fba2`; lease-loss abort correction `4157fe1c6f5cbb0781589b9082eb32dbcfa28ef5`; fail-safe coverage `80430db673a05c38564f1c75a31a544acdb8d581`; PR #3 CI `#1200` passed typecheck + full suite.

## 13H — Child completion/review handoff — COMPLETE

`src/multi-agent-child-review-handoff.ts` packages one review-ready M13G child completion packet together with the exact M13E preparation and M13B delegation-set identity. The handoff exposes the child objective, acceptance criteria, narrowed approved write scope, protected paths, status and sanitized worker report while preserving the worker report as `untrusted_worker_claims`.

Independent orchestrator evidence is required: a checkpoint must exist, diff safety must be available and passing, and any available validation result must pass. Cross-bound task/project/workspace/delegation evidence fails closed. Aborted, rolled-back or in-progress child states cannot be presented as review-ready completion.

M13H remains `child_review_evidence_only`: it schedules no sibling, starts no child/runtime, performs no automatic repair, permits no recursive delegation or distributed child execution, and grants no task/filesystem/Safety/credential/release authority.

Evidence: `bffd44072bf1dc3851bc3571bdb0e416fcb9c590`; PR #3 CI `#1202` passed typecheck + full suite.

## 13I — Supervisor child-review decision — COMPLETE

`src/multi-agent-child-review-decision.ts` lets a supervisor/reviewer consume one M13H child handoff and emit only `pass`, `repair`, or `escalate` guidance using the existing bounded supervisor reviewer result contract. The decision stays bound to the exact child/delegation/parent identity and remains `child_review_decision_advisory_only`.

Repair guidance is checked for attempts to widen scope or introduce forbidden shell/network/MCP/plugin/subagent/agent-team/validation/Safety/worker/release authority. The slice cannot schedule, resume or start a child, cannot create a new delegation, cannot mutate trusted validation/Safety identity, and grants no task/filesystem/Safety/credential/release authority.

Evidence: `44836b42396828a5688b24d89d50eb903609cce5`; PR #3 CI `#1204` passed typecheck + full suite.

## 13J — Bounded child repair admission — COMPLETE

`src/multi-agent-child-repair-admission.ts` converts only an advisory M13I `repair` decision for one terminal/reviewed M13H child into a short-lived, single-use repair permit. Issuance revalidates the current parent task/Safety coverage of the exact reviewed child scope and fails closed on parent terminal state or pending escalation.

A durable per-child repair-attempt ledger enforces a restart-safe maximum of two repair admissions. Runtime/watchdog retry counters are deliberately not reused. Consuming a repair permit returns evidence only; it does not schedule, resume or start the child, create a new delegation, alter validation/Safety/worker identity, enable distributed execution, or grant task/filesystem/Safety/credential/release authority.

Evidence: implementation `b9b9ecccdf7694e4b9070295f0005d51faa16f2b`; test-import correction `7ac59440e5242da6a8fcdcb408167e7821d1e54b`; PR #3 CI `#1207` passed typecheck + full suite.

## 13K — Fresh repair-child rematerialization — COMPLETE

`src/multi-agent-repair-child.ts` converts one consumed M13J repair admission into a brand-new non-executable repair-child descriptor with a fresh child task ID. The descriptor remains bound to the original M13E preparation, M13H review handoff, M13I repair decision and M13J consumed receipt.

The original delegation set/delegation/parent/project/workspace/registry/Safety policy/profile/worker binding, validation commands, protected paths and exact approved child write scope are preserved. Only the bounded repair instruction and repair-attempt number are added. Reusing the prior child task ID fails closed, and the descriptor explicitly forbids resuming or mutating the prior child.

M13K remains materialization-only: no TaskStore persistence, worker/Cline/runtime start, lease/fence acquisition, distributed execution, recursive delegation, or task/filesystem/Safety/credential/release authority.

Evidence: `beabe27133c1dfb69e87dcec51b48e2d6ea6a89a`; PR #3 CI `#1209` attempt 2 passed typecheck + full suite after an unchanged rerun of the known unrelated M12N timing flake.

## 13L — Repair-child execution admission — COMPLETE

`src/multi-agent-repair-child-execution-admission.ts` issues a fresh, short-lived, single-use execution admission for one M13K repair-child identity. Issuance requires the exact inherited current parent project/workspace/registry/Safety policy/profile/worker/validation/scope binding to remain current and independently proves that the prior child task still exists as the exact terminal task in the same project/workspace.

The permit remains non-executing and does not start Cline/runtime, acquire a writer lease or distributed fence, create distributed execution state, resume/mutate the prior child, permit recursive delegation, or grant task/filesystem/Safety/credential/release authority.

Evidence: implementation `9320d5ead8462eafca0370e2abf6bca6664314c4`; test-import correction `4b22362b3179a1962945426e58decebe84c5c1ff`; PR #3 CI `#1212` passed typecheck + full suite.

## 13M — Repair-child durable preparation — COMPLETE

`src/multi-agent-repair-child-preparation.ts` persists exactly one durable preparation per fresh M13K repair-child identity after a consumed M13L execution-admission receipt is presented. It revalidates the full current inherited parent project/workspace/registry/Safety policy/profile/worker/validation/scope binding and independently proves that the prior child remains the exact terminal task in the same project/workspace.

The durable record carries the bounded repair instruction and attempt number but deliberately carries no prior-child runtime state, checkpoint state or session state. It remains outside `TaskStore`, non-executable, and requires later fresh parent-binding and fresh writer-lease checks before any runtime path may exist.

Evidence: `5e242a390899d4cf519481ea2211b99b32681008`; PR #3 CI `#1214` passed typecheck + full suite.

## 13N — Repair-child activation gate — COMPLETE

`src/multi-agent-repair-child-activation.ts` mirrors the proven M13F activation boundary for a fresh M13M repair child. It revalidates the full current inherited parent project/workspace/registry/Safety policy/profile/worker/validation binding and requires the live scheduler-owned local writer lease to be bound to the new repair-child task ID and exact workspace.

The prior child task ID is explicitly rejected as writer authority. Lease identity must remain unchanged across current-state validation. The resulting process-local repair runtime input carries the bounded repair instruction/attempt and exact narrowed scope, but `runtimeStartAuthorized` remains false. No Cline/runtime start, distributed execution, recursive delegation, or release authority occurs.

Evidence: `a5db8d2d36c311621f2e9cbd45fcc62cb810159a`; PR #3 CI `#1216` passed typecheck + full suite.

## 13O — Repair-child runtime-start adapter — COMPLETE

`src/multi-agent-repair-child-runtime-start.ts` starts exactly one local repair child only from a valid M13N activation context. It performs one final parent/Safety/workspace/lease revalidation, resolves and preflights the existing worker profile, refuses any pre-existing repair-child TaskStore state, then creates a fresh repair-child task whose session/run/recovery/retry counters all begin from zero.

The repair-child goal includes the bounded repair instruction and attempt number while preserving the original child objective, acceptance criteria, trusted validation commands and exact narrowed approved/protected path envelope. Execution reuses the existing `ClineRunner` + lease-aware Hub safety boundary. Prior-child task/session/checkpoint/runtime/lease identity is never reused; native subagents/teams, model shell/network/MCP/plugins, distributed repair execution and release authority remain disabled. Lease loss aborts fail-safe.

Evidence: `10f3aea0b54ee1c350ca6ebfda5baa55bedb9dc9`; PR #3 CI `#1218` passed typecheck + full suite.

## 13P — Repair-child completion/review handoff — COMPLETE

`src/multi-agent-repair-child-review-handoff.ts` packages one review-ready M13O repair-child completion packet together with the exact M13M durable repair preparation. The supervisor-facing evidence is bound to the fresh repair-child task ID, prior child task ID, repair-attempt number, original delegation set/delegation/parent identity, objective, bounded repair instruction, acceptance criteria and exact narrowed write/protected scope.

Independent orchestrator evidence is mandatory: checkpoint available, diff safety passing, and any available validation passing. Worker completion prose stays `untrusted_worker_claims`. Cross-bound task/project/workspace evidence fails closed, and aborted/rolled-back/in-progress repair children cannot be presented as review-ready completion.

M13P remains review-only: it does not issue another repair admission, schedule/start any child, recurse delegation, distribute execution, widen scope, or grant release authority.

Evidence: `de1afc0d95eafd1fe21ea03b26efc5246baa76b3`; PR #3 CI `#1220` passed typecheck + full suite.

## 13Q — Sibling execution-set admission — COMPLETE

`src/multi-agent-sibling-execution-set-admission.ts` consumes one already-validated M13B delegation set, the exact M13C materialized children for every delegation, and explicit current child-state evidence. It returns only which child identities are eligible now.

For `parallel_disjoint`, all pending siblings may be admitted only when the M13B set carries no overlap evidence. For `serialized`, at most one next pending child is admitted and no second child is admitted while one sibling is already running. Cross-bound/missing/duplicate child or state evidence fails closed.

M13Q remains `sibling_execution_set_admission_only`: no child execution admission token, worker start, local writer lease, distributed fence, runtime, recursive delegation, distributed child execution, or release authority is created.

Evidence: `210b671b6e2aa02a5ee2f0db598a88ff1e99f4d8`; PR #3 CI `#1222` passed typecheck + full suite.

## 13R — Sibling execution preparation set — COMPLETE

`src/multi-agent-sibling-execution-preparation-set.ts` binds one M13Q sibling-admission result back to the exact M13C materialized child descriptors for the validated delegation set. Only admitted child identities produce per-child preparation requests; blocked or terminal siblings remain explicitly unable to advance.

Each request preserves the original delegation set/mode, parent/project/workspace/registry/Safety profile/worker binding, objective, acceptance criteria, narrowed allowed paths and protected paths. The set does not create a child execution admission token, durable preparation, local writer lease, distributed fence, runtime, recursive delegation, distributed execution, or release authority.

Evidence: `fd06059459d367a537c96a24d6ea95b6a57410dc`; PR #3 CI `#1224` passed typecheck + full suite.

## 13S — Sibling execution admission batch — COMPLETE

`src/multi-agent-sibling-execution-admission-batch.ts` reuses the existing M13D `MultiAgentChildExecutionAdmissionService` for siblings admitted by M13R. Each prepared sibling receives an independent short-lived, single-use child execution ticket only after the existing M13D parent/Safety/delegation-set revalidation succeeds.

The batch refuses blocked or terminal siblings, rejects preparation requests that no longer exactly match their M13C materialized descriptor, and enforces serialized sets to at most one prepared child. It creates no durable M13E preparation, writer lease, distributed fence, runtime, recursive delegation, distributed child execution, or release authority.

Evidence: `1d8b5bb461abd9e80929eafc69c753e4b1448c70`; PR #3 CI `#1226` passed typecheck + full suite.

## 13T — Sibling durable-preparation batch — COMPLETE

`src/multi-agent-sibling-durable-preparation-batch.ts` consumes only M13S-issued child tickets through the existing M13D `consumeForPreparation` path and feeds the resulting receipts into the existing M13E `MultiAgentChildExecutionPreparationService`. No parallel execution mechanism is invented; each sibling remains an independently prepared child with the original delegation/parent/Safety/worker/scope binding.

For `parallel_disjoint`, multiple ticketed siblings may be prepared independently. For `serialized`, more than one ticket is rejected before consumption. Blocked or terminal siblings cannot produce durable preparation state. The batch creates no writer lease, distributed fence, runtime, recursive delegation, distributed execution, or release authority.

Evidence: `4bc2f4f02cdc31d7b8454459601d560e5e386bfd`; PR #3 CI `#1228` passed typecheck + full suite.

## 13U — Sibling writer-lease compatibility gate — COMPLETE

`src/multi-agent-sibling-writer-compatibility.ts` reconciles one M13T sibling durable-preparation batch with the already-established exclusive workspace writer invariant. Because every M13B sibling shares one workspace and `maxActiveWritersPerWorkspace` is fixed at `1`, the gate selects at most one prepared sibling as the next lease-backed activation candidate and marks any additional prepared sibling as deferred.

This does not weaken M13B `parallel_disjoint` scope isolation; it clarifies that disjoint logical eligibility does not override the current workspace-wide writer lock. True same-workspace parallel writers remain deferred to a separately reviewed path-scoped locking design. M13U acquires no lease, starts no worker/runtime, creates no distributed state, and grants no task/filesystem/Safety/credential/release authority.

Evidence: `6818a057e7a05a28f8ad22f3ddf887b4fd985b89`; PR #3 CI `#1231` passed typecheck + full suite.

## 13V — Selected-sibling activation bridge — COMPLETE

`src/multi-agent-selected-sibling-activation-bridge.ts` binds the single M13U-selected sibling back to its exact M13T durable preparation and delegates activation to the already-proven M13F `MultiAgentChildExecutionActivationCoordinator`. The bridge itself acquires no lease; it requires an already-present fresh scheduler-owned writer lease bound to the selected child/workspace.

Deferred, blocked or terminal siblings cannot enter the bridge. Candidate/preparation identity drift fails before M13F. The returned activation context remains `runtimeStartAuthorized: false`; no Cline/runtime start, second writer, distributed state, recursive delegation, or release authority is introduced.

Evidence: `0d78917da76111637786f98d6b86e9d541e05aa9`; PR #3 CI `#1233` passed typecheck + full suite.

## 13W — Selected-sibling runtime bridge — COMPLETE

`src/multi-agent-selected-sibling-runtime-bridge.ts` accepts only an M13V activation context that exactly matches the current M13U-selected sibling and delegates runtime start to the already-proven M13G `MultiAgentChildRuntimeStarter`.

Deferred, blocked or terminal sibling identities fail before M13G invocation. The bridge does not create or acquire a second writer lease, widen child scope, distribute execution, recurse delegation, or grant release authority.

Evidence: implementation `24acda72807b3ba6eabf059da755c4ffd95a0356`; test-type correction `dd8f484c43af197f777edaccb23f47dde58dd9c3`; PR #3 CI `#1236` passed typecheck + full suite.

## 13X — Deferred-sibling progression gate — COMPLETE

`src/multi-agent-deferred-sibling-progression.ts` permits a previously deferred prepared sibling to become the next activation candidate only after two independent conditions are proven: the previously selected sibling has a terminal completion packet, and the shared workspace lock shows no active writer.

The gate removes only the completed selected child from the prepared set, records it terminal, and reuses the existing M13U writer-compatibility selector over the remaining preparations. It acquires no lease, starts no worker/runtime, and introduces no new authority.

Evidence: `4b8844bbf596d35c9675ba893cef000a792cd5e8`; PR #3 CI `#1238` attempt 2 passed typecheck + full suite. Attempt 1 failed only the known unrelated M12N lease-renewal timing assertion.

## 13Y — Milestone 13 acceptance harness — COMPLETE

`src/multi-agent-m13-acceptance.test.ts` provides the deterministic in-process Milestone 13 acceptance proof. It composes the existing M13A–M13X contracts to prove bounded child decomposition, sibling isolation, one-at-a-time same-workspace writer progression under the existing exclusive workspace-writer invariant, independent completion/review evidence, and one bounded repair cycle.

The acceptance proof also verifies that repair cannot widen the original child authority envelope: the repair child retains the exact approved path scope, protected paths and trusted validation commands, receives a fresh child identity, cannot resume the prior child, cannot recurse delegation or agent teams, and receives no shell/network/MCP/plugin or release authority.

M13Y adds no new runtime, writer-lease, filesystem, distributed, credential or release authority. It is acceptance evidence only.

Evidence: `26305244eeeeeccc5c64eb1088c849f894a5be3a`; PR #3 CI `#1240` passed typecheck + full suite.

## M13 work queue

1. **COMPLETE — M13A bounded delegation authority envelope.**
2. **COMPLETE — M13B delegation set validation / sibling isolation contract.** CI `#1182` / `#1183` green.
3. **COMPLETE — M13C child-task materialization contract.** CI `#1186` / `#1187` green.
4. **COMPLETE — M13D child execution admission contract.** CI `#1190` / `#1191` green.
5. **COMPLETE — M13E durable child execution preparation.** CI `#1194` green.
6. **COMPLETE — M13F child execution activation gate.** CI `#1196` green.
7. **COMPLETE — M13G child runtime-start adapter.** CI `#1200` green.
8. **COMPLETE — M13H child completion/review handoff contract.** CI `#1202` green.
9. **COMPLETE — M13I supervisor child-review decision contract.** CI `#1204` green.
10. **COMPLETE — M13J bounded child repair admission.** CI `#1207` green.
11. **COMPLETE — M13K fresh repair-child rematerialization.** CI `#1209` attempt 2 green after the known unrelated M12N timing flake.
12. **COMPLETE — M13L repair-child execution admission.** CI `#1212` green.
13. **COMPLETE — M13M repair-child durable preparation.** CI `#1214` green.
14. **COMPLETE — M13N repair-child activation gate.** CI `#1216` green.
15. **COMPLETE — M13O repair-child runtime-start adapter.** CI `#1218` green.
16. **COMPLETE — M13P repair-child completion/review handoff.** CI `#1220` green.
17. **COMPLETE — M13Q sibling execution-set admission.** CI `#1222` green.
18. **COMPLETE — M13R sibling execution preparation set.** CI `#1224` green.
19. **COMPLETE — M13S sibling execution admission batch.** CI `#1226` green.
20. **COMPLETE — M13T sibling durable-preparation batch.** CI `#1228` green.
21. **COMPLETE — M13U sibling writer-lease compatibility gate.** CI `#1231` green.
22. **COMPLETE — M13V selected-sibling activation bridge.** CI `#1233` green.
23. **COMPLETE — M13W selected-sibling runtime bridge.** CI `#1236` green.
24. **COMPLETE — M13X deferred-sibling progression gate.** CI `#1238` attempt 2 green; attempt 1 failed only the known unrelated M12N timing flake.
25. **COMPLETE — M13Y milestone acceptance harness.** Commit `26305244`; PR #3 CI `#1240` green.
3. **DO NOT** add recursive delegation, dynamic agent-team formation, raw tool/shell/network authority, release authority, or unbounded fan-out.

---

# Milestone 14 — Autonomous Engineering Loops

Acceptance target: given one already-approved bounded engineering goal, the orchestrator can durably progress through implementation → independent completion evidence → supervisor review → bounded repair/continuation → repeat until the acceptance criteria are satisfied or a trusted stop condition requires human action. Autonomy must reuse the existing task/Safety, worker, validation, diff-safety, review, repair, lease/fence and escalation boundaries rather than creating a parallel authority path.

Milestone 14 must remain bounded and fail closed: every iteration stays inside the current approved authority envelope; loop budgets and stop conditions are deterministic; stale or restarted loop state cannot resurrect authority; reviewer/model output remains advisory until admitted by trusted code; and commit/push/PR/merge/deploy/release authority remains outside this milestone unless separately introduced by Milestone 15.

## 14A — Autonomous-loop contract + durable state model — COMPLETE

`src/autonomous-engineering-loop.ts` defines a finite authority-free loop state machine bound exactly to one approved `SupervisorTaskV1`. The durable loop record preserves project/workspace/registry/Safety/worker/path bindings, explicit implementation/repair budgets, monotonic revisions and terminal stop reasons.

The transition model permits only bounded implementation → evidence → review → bounded repair progression. Budget exhaustion fails closed to `waiting_for_human`; terminal state cannot resume. `FileAutonomousEngineeringLoopStore` persists loop state outside TaskStore and rejects stale revision replacement after reconstruction, so restart history cannot resurrect stale loop progression.

M14A is non-executing: it starts no worker/Cline/runtime, acquires no local lease or distributed fence, creates no distributed dispatch, performs no Git delivery, uses no credentials and grants no task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `f3ce2bb6fc7e74805fc9e21a6d6eb79f1a435915`; proofs `e6237eb6a87dc220e32314336a17ca86f4b47d18`; CI `#1242` passed typecheck + full suite.

## 14B — Trusted loop-transition admission gate — COMPLETE

`src/autonomous-engineering-loop-transition-admission.ts` admits only one authority-free M14 loop transition after revalidating the exact current task/project/workspace/registry/Safety/worker/path binding captured by M14A. The admission object is short-lived evidence only and records the expected loop revision plus current task status/run count; it mutates neither loop state nor TaskStore.

Implementation-start and repair-start admissions require an eligible current task state with no pending escalation. Completion transitions require a current exact completion packet with terminal state, matching run count, checkpoint evidence and passing diff safety; successful completion/review transitions additionally require passing independent validation. Reviewer transitions require an exact trusted `SupervisorDecisionV1` of the matching kind, so model/reviewer prose remains advisory until admitted through the existing trusted supervisor-decision boundary.

M14B starts no worker/Cline/runtime, acquires no lease/fence, creates no distributed dispatch, performs no Git delivery, uses no credentials and grants no task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `cb0cf01cf03ee0f5876ca75f0005041f148456b8`; proofs `2f99533581e4a65aa67293d3e667cf7e1edb90ed`; CI `#1244` passed typecheck + full suite.

## 14C — Durable admitted-transition application — COMPLETE

`src/autonomous-engineering-loop-transition-apply.ts` consumes one still-fresh M14B transition admission only against the exact expected M14A loop revision, applies the already-admitted deterministic transition and persists the next revision through the M14A store. Admission expiry, wrong revision and replay fail closed.

Admission consumption is persisted separately from loop state, so reconstructing the apply service cannot reuse an already-consumed admission. The applied receipt remains state evidence only and explicitly grants no task/filesystem/Safety/lease/credential/release authority.

M14C mutates only the durable autonomous-loop record. It does not mutate TaskStore, start workers/Cline/runtime, acquire writer leases or distributed fences, create distributed state, perform Git delivery, or use credentials.

Evidence: implementation `b8831841004c4c2f3de560dc8cb4f9e9711f23b5`; proofs `b123ee1d5a3002a37f9a4aeb7dde03825a3839aa`; CI `#1246` passed typecheck + full suite.

## 14D — Execution-intent bridge — COMPLETE

`src/autonomous-engineering-execution-intent.ts` derives a bounded non-executing execution-intent descriptor only from an `implementation_in_progress` M14A loop revision whose exact M14B transition admission has already been durably applied by M14C. The bridge revalidates the current task/project/workspace/registry/Safety/worker/path binding before emitting intent.

Initial implementation intent uses only the already-approved supervisor objective, acceptance criteria and trusted validation commands. Repair intent additionally requires the exact trusted `review_repair` decision referenced by the admitted repair transition; stale or mismatched reviewer provenance fails closed. Loop state or model prose alone cannot create a repair instruction.

M14D does not mutate TaskStore or loop state, start/continue Cline/runtime, acquire lease/fence authority, create distributed work, perform Git delivery, use credentials, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `8ed92fe9d88f901e1fd67f147312981df3925d22`; proofs `1f6275e518cd85d9960e6a9fe5244f6e764044a0`; CI `#1249` passed typecheck + full suite.

## 14E — Execution admission permit — COMPLETE

`src/autonomous-engineering-execution-admission.ts` issues a short-lived, single-use execution admission only for an exact M14D intent whose durable M14A loop remains at the same `implementation_in_progress` revision and whose current task/project/workspace/registry/Safety/worker/path binding still matches. Consumption repeats both checks and returns evidence only.

The permit/receipt remains non-executing and carries no task/filesystem/Safety/lease/credential/release authority. It does not mutate TaskStore or loop state, start/continue Cline/runtime, acquire local/distributed writer authority, create distributed work, perform Git delivery or use credentials.

Evidence: implementation `488723e44e12982b4b5e9f34a591ad0daab32b33`; proofs `000da7536a29fde598295e0c8d0b214861693b98`; CI `#1251` typechecked successfully and passed the full suite on rerun after the known unrelated M12N renewal timing flake.

## 14F — Durable execution preparation — COMPLETE

`src/autonomous-engineering-execution-preparation.ts` persists exactly one durable, non-executable preparation per M14D execution intent after a consumed M14E receipt is presented. Preparation revalidates the exact durable loop revision plus current task/project/workspace/registry/Safety/worker/path binding and preserves the approved objective, acceptance criteria, trusted validation commands and exact scope/protected-path envelope.

For bounded repairs, the durable preparation also preserves the exact trusted repair instruction and reviewer decision identity. Reusing the same intent fails closed, and advancing the loop or drifting current Safety state invalidates preparation.

M14F does not mutate TaskStore or loop state, start/continue Cline/runtime, acquire writer lease/fence authority, create distributed work, perform Git delivery, use credentials, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `edaadb25c485ad02cb1e0c40d2604d427e72abd9`; proofs `e2de6d628b6fbed527f533143c6278eddcc7d578`; CI `#1253` passed on rerun after an unrelated pre-existing M12I ProjectMemory read race.

## 14G — Execution activation gate — COMPLETE

`src/autonomous-engineering-execution-activation.ts` activates only an exact M14F durable preparation whose M14A loop remains on the same `implementation_in_progress` revision and whose current task/project/workspace/registry/Safety/worker/path binding still matches. Activation also requires a live scheduler-owned local writer lease bound to the exact task/workspace/owner; the lease is validated again and any identity change during validation fails closed.

The activation result contains only process-local runtime input and activation evidence with `runtimeStartAuthorized: false`. The gate does not acquire the writer lease, mutate TaskStore/loop state, start/continue Cline, create distributed work, perform Git delivery, use credentials, or grant task/filesystem/Safety/lease/credential/release authority.

Evidence: implementation `626eb660581df0dacbe49f5c564ec442023ddb18`; corrected identity-change proof `b5944221e4d76760ac422badbcc335ab6ee168a7`; CI `#1256` passed typecheck + full suite.

## 14H — Trusted initial local runtime start — COMPLETE

`src/autonomous-engineering-initial-runtime-start.ts` bridges only an exact M14G `initial_implementation` activation into the existing `ScheduledHubWriterAuthorityRunner` path. Before handoff it revalidates the runner's current approved task/workspace/owner binding, validates the same live scheduler-owned writer lease again, and rechecks that the M14G activation evidence still matches the current lease identity.

M14H deliberately rejects `bounded_repair`. It does not weaken or bypass the scheduled runner's fresh-created-task invariant and therefore cannot silently reinterpret continuation as initial start. Runtime execution continues to inherit the scheduled runner's existing lease-aware Hub runtime, durable authority revalidation, provider preflight, validation/diff-safety behavior and fail-safe abort on lease loss.

M14H adds no distributed execution, credentials, Git delivery or release authority.

Evidence: implementation `d59f2ee85e377ad84611971c201cac9cd62ef6bd`; proofs `fb423e471873ea82a6d0cd603503434594dfe9a3`; CI `#1259` passed typecheck + full suite.

## 14I — Trusted bounded-repair runtime continuation — COMPLETE

`ScheduledHubWriterAuthorityRunner` now exposes a separate repair-specific revalidation/runtime path without changing `runApprovedTask()` or its fresh-created-task invariant. Bounded repair is allowed only for a completed task with existing orchestrator-owned session/run history, a usable rollback checkpoint, no pending escalation, current registered workspace/Safety authority and a non-empty trusted repair instruction.

`src/autonomous-engineering-repair-runtime-continuation.ts` accepts only an exact M14G `bounded_repair` activation, revalidates the scheduled repair runner's task/workspace/owner binding, validates the same live scheduler-owned writer lease immediately before handoff, and passes only the exact reviewer-derived repair instruction preserved through M14D–M14G. The repair runtime remains lease-aware, reuses provider preflight, validation and diff-safety, and aborts fail-safe on lease loss.

M14I adds no distributed execution, credentials, Git delivery or release authority.

Evidence: scheduled runner repair path `b83dc2f04147150f6c09b4405d89374b7126e5ff`; bridge `c8ad12d4949b1395eec888d270d58094ed7e42b0`; proofs `90347cbe10f3b6c366a914571c523ace73131cba`; CI `#1263` passed typecheck + full suite.

## M14 work queue

1. **COMPLETE — M14A autonomous-loop contract + durable state model.** CI `#1242` green.
2. **COMPLETE — M14B trusted loop-transition admission gate.** CI `#1244` green.
3. **COMPLETE — M14C durable admitted-transition application.** CI `#1246` green.
4. **COMPLETE — M14D execution-intent bridge.** CI `#1249` green.
5. **COMPLETE — M14E execution admission permit.** CI `#1251` rerun green.
6. **COMPLETE — M14F durable execution preparation.** CI `#1253` rerun green.
7. **COMPLETE — M14G execution activation gate.** CI `#1256` green.
8. **COMPLETE — M14H trusted initial local runtime start.** CI `#1259` green.
9. **COMPLETE — M14I trusted bounded-repair runtime continuation.** CI `#1263` green.
10. **COMPLETE — M14J post-runtime completion evidence bridge.** CI `#1265` green.
11. **COMPLETE — M14K autonomous reviewer decision bridge.** CI `#1267` green.
12. **COMPLETE — M14L completion/review progression composition.** CI `#1269` green.
13. **COMPLETE — M14M bounded repair-cycle launch composition.** CI `#1274` green.
14. **COMPLETE — M14N initial-cycle launch composition.** CI `#1276` green.
15. **COMPLETE — M14O phase-aware autonomous step controller.** CI `#1281` green.
16. **COMPLETE — M14P Milestone 14 acceptance harness.** CI `#1283` green.
17. **MILESTONE 14 COMPLETE.** The bounded restart-safe autonomous loop acceptance target is satisfied without Git delivery, credentials or release authority.

## 14P — Milestone 14 acceptance harness — COMPLETE

`src/autonomous-engineering-m14-acceptance.test.ts` proves the M14A–M14O contracts compose into a bounded restart-safe loop using the actual durable M14 loop store/state machine across reconstructed controller instances. The acceptance path covers initial execution, independent completion evidence, trusted review repair, one bounded repair continuation, fresh evidence and eventual `succeeded` state.

The harness also proves restart from `awaiting_review`, deterministic repair-budget exhaustion to `waiting_for_human`, stale supervisor/Safety binding rejection, terminal no-op behavior and continued absence of Git delivery, credential or release authority.

Evidence: acceptance harness `4f276b959c88334f76d8ed62d4f5fcf4461bdfad`; CI `#1283` passed typecheck + full suite.

---


# Milestone 15 — GitHub Delivery / Release Authority

Acceptance target: after a bounded engineering task has reached a trusted successful terminal state, the orchestrator may prepare and, only through separately admitted explicit authority, perform narrowly scoped Git/GitHub delivery actions without allowing edit authority, model output, CI status, credentials, prior confirmations or restart history to become release authority.

Milestone 15 must keep each delivery capability distinct. Commit, push, pull-request creation/update, merge and deployment are separate authorities with separate evidence and confirmation requirements. Delivery authority is short-lived, single-purpose, bound to exact repository/workspace/task/evidence identity, replay-protected, and invalidated by repository/task/Safety drift. Merge, deploy, destructive Git and any external mutation continue to require explicit user authorization immediately before the authorized action.

## M15 work queue

1. **COMPLETE — M15A delivery proposal contract.** CI `#1286` green.
2. **COMPLETE — M15B explicit delivery authority admission.** CI `#1288` green.
3. **COMPLETE — M15C local commit preparation/execution boundary.** CI `#1290` green.
4. **COMPLETE — M15D push + PR boundary.** M15D1 push-only (`b6d90dd9`, CI `#1292`) and M15D2 PR create/update (`df68b8fc`, CI `#1295`) complete.
5. **COMPLETE — M15E merge authority boundary.** CI `#1298` green after correcting the merge-evidence boolean test contract.
6. **COMPLETE — M15F deployment/release boundary.** CI `#1301` green.
7. **COMPLETE — M15G release recovery/replay safety.** CI `#1303` green.
8. **COMPLETE — M15H Milestone 15 acceptance harness.** CI `#1305` green.
9. **MILESTONE 15 COMPLETE.** Delivery capability separation, explicit per-action authority, replay prevention, stale-evidence rejection and restart recovery are proven across commit → push → PR → merge → deploy.
10. **DO NOT** allow model/planner/reviewer output, autonomous-loop success, CI success, possession of GitHub credentials, or a prior delivery permit to grant another delivery capability.

## 15H — Milestone 15 acceptance harness — COMPLETE

`src/github-delivery-m15-acceptance.test.ts` composes the real M15A–M15G proposal, authority-admission, commit, push, PR, merge, deployment and recovery boundaries while faking only the external Git/GitHub/deployment drivers. The acceptance path proves each mutation requires its own explicit single-use permit and that a successful earlier delivery result cannot authorize a later capability.

The harness also proves stale evidence blocks mutation before side effects, consumed permits remain non-replayable across executor reconstruction/restart, recovery is observation-only, ambiguous outcomes cannot reuse a permit or mint retry authority, and no stage grants broad/general release authority.

Evidence: acceptance harness `fcc3f52d1323d2c8363f8b3de86407e04ac11950`; CI `#1305` passed typecheck + full suite.

---


# Milestone 16 — Production Security / Reliability / Observability

Acceptance target: the orchestrator can determine, before production use, whether its critical security, durability/recovery and observability controls are healthy enough for operation, expose only sanitized operator-facing diagnostics, and fail closed when required controls are unavailable or stale. Production hardening must not widen task, filesystem, network, credential, writer, Git delivery or release authority.

Milestone 16 builds on existing controls already proven in earlier milestones: remote-session replay/rate/audit protection, restrictive local-operator transport/UI controls, durable task/recovery/checkpoint state, writer fencing, Sentinel incidents, operator visualization and run metrics.

## M16 work queue

1. **COMPLETE — M16A production readiness baseline/evaluator.** CI `#1308` green.
2. **COMPLETE — M16B secret-safe structured operational events.** CI `#1310` green.
3. **COMPLETE — M16C durable operational health history.** CI `#1312` green.
4. **COMPLETE — M16D alert classification + escalation.** CI `#1314` green.
5. **COMPLETE — M16E reliability fault injection.** CI `#1316` green.
6. **COMPLETE — M16F resource/backpressure hardening.** CI `#1318` green.
7. **COMPLETE — M16G observability/operator integration.** CI `#1321` green after readonly tuple type correction.
8. **COMPLETE — M16H Milestone 16 acceptance harness.** CI `#1323` green.
9. **MILESTONE 16 COMPLETE.** Security-control loss, reliability degradation, saturation, corruption and observability blindness are proven sanitized, bounded, operator-visible and fail closed without authority widening.
10. **DO NOT** make readiness status itself an authorization source or allow health/recovery code to mutate task, Git, deployment or credential state.

## 16H — Milestone 16 acceptance harness — COMPLETE

`src/production-hardening-m16-acceptance.test.ts` composes the real M16A–M16G readiness, secret-safe event, durable history, alert-classification, backpressure and passive operator-status layers. The acceptance path proves healthy operation remains read-only and authority-free, while required-control loss, resource saturation, lease/fence/audit/recovery failures and observability blindness remain visible through bounded sanitized evidence.

The harness also proves operational history survives reconstruction without authority, corrupt history fails closed, exception text/paths/tokens are not exposed, alert pressure is deterministically bounded, and no health/alert/status path can pause/abort/retry/repair tasks or grant authority.

Evidence: acceptance harness `59a1170536e6de213933bdad7ca5afc25bc99964`; CI `#1323` passed typecheck + full suite.

---


# Milestone 17 — Productization / Installer / First-run UX

Acceptance target: a new operator can install, inspect, configure and start the orchestrator through a coherent product surface without editing source code, guessing environment variables or bypassing the safety/authority boundaries established in Milestones 1–16.

Productization must preserve local-first defaults, explicit workspace registration/Safety authority, loopback-by-default transports, provider preflight, secret isolation and the production readiness model. Installer/first-run UX must never silently enable write authority, remote listeners, credentials, delivery actions or deployment authority.

## M17 work queue

1. **COMPLETE — M17A first-run assessment + setup plan.** CI `#1326` green.
2. **COMPLETE — M17B product configuration file.** CI `#1329` green after normalized URL expectation correction.
3. **COMPLETE — M17C interactive first-run setup.** CI `#1331` green.
4. **COMPLETE — M17D packaged CLI surface.** CI `#1334` green.
5. **COMPLETE — M17E service lifecycle packaging.** CI `#1338` rerun green after known unrelated M12N renewal timing flake.
6. **COMPLETE — M17F installer/uninstaller packaging.** CI `#1341` green after path-validator correction.
7. **COMPLETE — M17G first-run operator UX/docs.** README/help/operator guidance aligned with actual product boundaries; commit `158a00f58d182c19f1f92e8894828e1d3fa2e310`, CI `#1344` green.
8. **COMPLETE — M17H Milestone 17 acceptance harness.** Harness `400ce861c206df037e00e1a5ea8a649e2cac3ed3`, type correction `3aa7a573a556b2a4be7163bf56209ecaba46143f`; CI `#1346` passed typecheck + full suite.
9. **MILESTONE 17 COMPLETE — software contracts and acceptance composition.** Install/uninstall remain non-mutating ownership plans, service lifecycle uses fake external drivers in acceptance, and CLI start delegates to the existing dispatcher. Physical installation/service deployment is not acceptance evidence here.
10. **DO NOT** make installer convenience an authority source or silently turn on command/edit approval, remote listeners, delivery, merge or deploy capabilities.

---


## 17H — Milestone 17 acceptance harness — COMPLETE

`src/productization-m17-acceptance.test.ts` composes the real M17 assessment, configuration, explicit setup confirmation, native CLI, service lifecycle and installer ownership boundaries. Windows and Linux specifications cover clean-state diagnosis, read-only setup/config/status, independently confirmed configuration/project/workspace actions, explicit service install/start/stop/status calls and deterministic install/uninstall plans preserving user-owned configuration, registry, secrets and task state.

The harness also proves confirmation action/digest binding, replay rejection, expiry, reconstruction invalidation, consumption on execution failure, provider-preflight degradation, production-observability loss and rejection of remote listener/raw-secret/ownership widening before external effects. Only external drivers and observations are faked. No installer executor, service driver, new CLI command or setup authority path is added, and no shared local runtime or physical installation is exercised.

Evidence: harness `400ce861c206df037e00e1a5ea8a649e2cac3ed3`; test type correction `3aa7a573a556b2a4be7163bf56209ecaba46143f`; GitHub-hosted CI [#1346](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37759190677) passed typecheck and the full suite for that exact branch head.

---

# Milestone 18 — Production release

Acceptance target: a pinned, tested release candidate can be built, installed, configured, started, inspected, stopped and removed through shipped product paths with user-owned data preserved and the existing workspace/Safety, secret, transport and per-action release boundaries intact. Software-contract completion is not a substitute for artifact or physical proof.

## M18A — Release-readiness source/evidence assessment — COMPLETE

Assessment dated 2026-10-08 against branch head `b9c11722f9a8017bfa3f98f51100b5d5ab14f25f`. GitHub-hosted CI `#1347` is green for that head. M17H implementation acceptance remains `3aa7a573`, CI `#1346`. PR #3 is still open against `main`; its title describes older M13E work and must be aligned with the final scope before release review. No GitHub release is listed at assessment time.

**Disposition: not ready for production release.** This is a read-only source/evidence assessment, not a runtime security certification or physical deployment result.

| Area | Verified source/evidence | Release gap / required proof |
|---|---|---|
| Existing software boundaries | M13–M17 acceptance evidence recorded; current branch typecheck/full suite green | Preserve these proofs while closing product wiring gaps; CI success grants no release authority |
| Product config loading | `resolveProductConfig` accepts a versioned input; native CLI calls it with only `{ schemaVersion: 1 }` plus environment | Ship explicit config-file loading/path/error handling; prove file → environment precedence through the actual CLI |
| Execution/config consistency | Native product commands validate product config; `runLegacy` spawns `index.js` with the unchanged process environment; `index.ts` independently parses worker/daemon settings and raw `ORCH_API_KEY` | Make product execution consume the same validated config as diagnosis; prove loopback restrictions, safe defaults and named-secret handling at the real dispatch boundary without weakening task/Safety checks |
| Confirmed setup | M17C provides per-action previews and single-use confirmation around injected driver calls; packaged `setup` remains plan-only | Ship narrowly scoped product adapters for config/project/workspace/loopback start through existing trusted boundaries, and expose a concrete operator confirmation flow; never treat a plan as confirmation |
| Service lifecycle | Windows/systemd specifications and explicit lifecycle service around an injected driver; M17H uses fake drivers | Ship bounded platform drivers and prove actual install/start/status/stop behavior in disposable environments; no shared-host mutation is implied |
| Installer ownership | Install/uninstall return non-mutating plans, preserving user-owned config/registry/secrets/tasks | Ship a bounded executor or explicitly choose a supported distribution method and prove its ownership/preservation behavior; plans alone cannot certify installation |
| Built artifact | Package declares `dist/product-cli.js` binary and build script; TypeScript includes all source/tests; package remains `private: true`; no tracked npm lockfile, package file allowlist or release artifact workflow appears in tree | Define artifact contents, reproducible dependency resolution and distribution method; build/pack/install and exercise the binary from the artifact, not source; private flag requires an explicit distribution decision |
| CI / supported platforms | Existing workflow runs `npm install`, typecheck and source tests on Ubuntu/Node 22 | Add build/artifact smoke proof and Windows/Linux matrix appropriate to the supported release; retain PostgreSQL safety proofs |
| Remote scope | M11 external physical proof remains explicitly deferred; prior M12 Windows proofs cover their recorded scenarios | Exclude unproven external remote-control claims from initial release or complete a separately authorized proof; do not reopen listeners/credentials through onboarding |
| Release/recovery | M15 proves separated commit/push/PR/merge/deploy authorities with fake external drivers | Prepare exact candidate evidence, rollback/support notes and staged release plan; publication/merge/deployment retain their existing explicit authorization |

The assessment adds no runtime code, installer executor, service driver, credential resolution, listener, release mutation or new authority path. Legacy settings described above are a product consistency gap; this assessment does not establish that existing underlying transport or Safety controls are bypassed.

## M18 work queue

1. **COMPLETE — M18A release-readiness source/evidence assessment.** Reviewed head `b9c11722`, CI `#1347` green; gaps and bounded release sequence recorded here.
2. **COMPLETE — M18B product config/execution integration.** B1 config-file loading, B2 shared execution settings, B3 daemon-local named credential and separately confirmed setup adapters, B4 composed acceptance; `303a111a`, exact-head CI `#1355` green. Completion is software integration evidence, not physical startup, artifact, service or release proof.
3. **IN PROGRESS — M18C reproducible release artifact and packaged CLI proof.** C1 defines private local tarball distribution, dependency lock and runtime build/package allowlist; C2 will build/pack/install in a disposable directory and run artifact-level diagnose/config/setup/status/error/removal smoke tests, followed by supported-platform CI. No publication or production listener activation.
4. **FOLLOW — M18D real installation/service integration.** Implement only narrowly scoped supported platform adapters through the existing explicit action boundaries. Prove install/start/status/stop/uninstall, failures and user-data preservation on disposable Windows/Linux environments; shared-host changes require separately authorized physical proof.
5. **FOLLOW — M18E release candidate acceptance and operator handoff.** Compose B–D through actual shipped paths, record supported/deferred features, exact artifact identity/checksums, provider/workspace/Safety prerequisites, operational readiness, backup/rollback and support instructions. Align PR metadata with the final change.
6. **FOLLOW — M18F staged production release.** Prepare the exact reviewable candidate and release actions. Merge, tag/publication and deployment are distinct actions; perform only actions authorized for that concrete candidate through their existing boundaries. Record actual outcome and rollback evidence before closing Milestone 18.

---

## M18B1 — Explicit product config-file loading — COMPLETE

Implementation `d16b8ff26b5764bccbb9b52e964a8f80e1fe60c4`; exact-head GitHub-hosted CI [#1349](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37783870570) passed typecheck and the full suite. Explicit file loading is bounded, read-only and sanitized; environment values override a valid selected file and an invalid requested file cannot silently fall back. M18B2 extends the same selected-file path to existing execution commands.

## M18B2 — Shared validated configuration at execution dispatch — COMPLETE

Implementation `a510f63c9b35cdde5149f017cc94846123ee9074`; exact-head GitHub-hosted CI [#1350](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37786452693) passed typecheck and the full suite. Product execution now uses the same selected-file/environment snapshot as native observation while preserving the existing dispatcher arguments, diff-safety restrictions and task/workspace/Safety controls. No shared local runtime was started for its validation.

## M18B3a — Named provider credential runtime boundary — COMPLETE

Implementation `ef75369e40aa4290956e4d19c0ac62f0d012346a`; exact-head GitHub-hosted CI [#1351](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37789892876) passed typecheck and the full suite. Named provider credential resolution is confined to the existing daemon-child WorkerConfig assembly. The product CLI forwards the validated reference only for daemon dispatch; it never sets raw ORCH_API_KEY from that reference. The runtime resolver looks up exactly the selected environment name once, rejects missing/empty/oversized/control-character-bearing values, and supplies the key only to the existing in-memory worker/provider/preflight consumers. Invalid/reserved references and lookup failures emit fixed sanitized errors without reference/value/cause exposure. No-reference behavior preserves existing low-level compatibility.

No key is added to argv, config files, public resolver receipts, setup previews or task authority. Existing preflight exception messages redact exact matches of the runtime key. This is a provider-specific runtime value boundary, not general credential access, and it adds no task/filesystem/release authority or setup mutation. Product observation and task clients do not select credential resolution.

Local validation: typecheck, whitespace check and 47 focused credential/preflight/product configuration/CLI/execution/M17 acceptance tests passed. Proofs use synthetic keys only: exact one-name lookup, unchanged settings, no lookup without a reference, invalid/unavailable-value rejection, existing metadata authorization header, redacted preflight exceptions and actual source CLI/daemon-child missing-key failure before binding or state writes. No successful daemon/listener activation or real credential provisioning occurred.

## M18B3b — Confirmed create-only config setup — COMPLETE

Implementation `250b3e30c4923f36be7727e088f0bba16e32e348`; exact-head GitHub-hosted CI [#1352](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37791474865) passed typecheck and the full suite. `setup-config <input.json> <new-output.json>` composes the existing FirstRunSetupService with a config-write-only filesystem adapter. A bounded input snapshot is strictly validated without environment overrides; the preview binds the canonical destination and exact document to the existing short-lived, single-use confirmation token. The CLI displays both and requires an interactive terminal and the exact phrase `WRITE CONFIG`. No token is exposed by the adapter review callback.

The destination must be a new JSON file in an existing directory. A private temporary file is flushed and atomically published with a create-only hard link; existing files/symlinks and targets appearing during confirmation are never overwritten. Parent directory identity is checked before writing and publication. Temporary files are cleaned up on success/failure. This protects normal local setup against accidental replacement; it is not a claim of protection against privileged operating-system races. No directories are created, and registration/start drivers remain unavailable in this adapter.

Config setup validation now uses the strict product schema, admitting named secret references and token-budget fields while rejecting raw keys, unknown fields, invalid types and non-loopback product settings. Other setup actions retain their existing payload checks. Confirmation does not confer task, workspace, service or delivery authority.

Local validation: typecheck, whitespace check and 35 focused config-write/setup/product CLI/config-source/M17 acceptance tests passed. Real filesystem proofs use disposable directories: confirmation-only creation, immutable reviewed snapshot, decline/expiry no-write behavior, existing file/symlink refusal, competing destination preservation, private permissions and temporary cleanup. Single-use/reconstruction/concurrent replay proofs cover the existing setup service. An actual non-TTY CLI subprocess rejects piped confirmation without creating a file. Successful physical TTY interaction and installer/service deployment are not claimed by these tests.

## M18B3c — Confirmed project/workspace registration — COMPLETE

Implementation `e6dfd943c7957002c88c9576d59b8c4f57ede141`; exact-head GitHub-hosted CI [#1353](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37793229815) passed typecheck and the full suite. `setup-project <display-name>` and `setup-workspace <input.json>` wire independently confirmed registration actions through the real WorkspaceRegistry. The CLI requires a TTY and the action-specific exact phrases `REGISTER PROJECT` / `REGISTER WORKSPACE`. The preview binds the selected registry location, registry snapshot and immutable registration document; workspace previews additionally bind the canonical root and directory identity. Successful receipts return generated project/workspace IDs for subsequent explicit actions, never a setup token.

Workspace input requires all existing Safety profile fields explicitly: allowed/protected paths, validation commands, worker profile, policy version and maximum changed files. Unknown fields, profile-ID/revision overrides, invalid types/control characters and omitted fields fail before confirmation. The existing secret-material checks remain in force. No permissive profile, project, workspace or command is inferred from product config/environment settings. Empty explicitly selected arrays retain the existing registry behavior and do not certify operational readiness.

A read-only WorkspaceRegistry preflight shares the same profile/project/canonical-root/duplicate-root guards as the mutation method. The adapter rejects malformed/unreadable/oversized or symlink registry files, rechecks the registry snapshot and workspace root after confirmation, and delegates mutation only to the matching existing registration method. In-process adapter mutations are serialized with conflict rejection; this is not a cross-process transaction/lock guarantee for independent existing registry writers, nor protection against privileged OS races. The existing registry persistence behavior is retained.

Local validation: typecheck, whitespace check and 45 focused registration/registry-Safety/setup/product CLI/config-write/M17 acceptance tests passed. Disposable real-registry proofs cover separately confirmed actions, exact immutable Safety fields, no workspace writes, decline/expiry, strict input/preflight guards, registry drift, root replacement/symlink retargeting, malformed/symlink registry refusal and concurrent in-process confirmations. Actual CLI dispatch with injected confirmation uses the real registry and never dispatches a task/daemon or contacts a listener; an actual non-TTY CLI subprocess rejects piped confirmation without registry creation. Existing Safety scope/drift/single-use tests pass. Successful physical TTY interaction, daemon startup and deployment are not claimed.

## M18B3d — Confirmed loopback foreground daemon dispatch — COMPLETE

Implementation `b7c7b1fccccec1980cecf10f9d7ec8b895d3e5e6`; exact-head GitHub-hosted CI [#1354](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37794773023) passed typecheck and the full suite. `setup-start <workspace-id>` supports the existing explicit config selector/environment precedence and composes FirstRunSetupService with the existing foreground daemon dispatch. It requires a registered opaque workspace ID, verifies the canonical root through WorkspaceRegistry, and previews the exact registered workspace/Safety profile and validated provider/runtime/loopback config. The interactive CLI requires the exact phrase `START DAEMON`; the existing short-lived, single-use setup confirmation binds workspace/config digests. Startup-only confirmation rejects automatic command/edit approval settings and reserved credential references.

The adapter captures the inherited environment and resolved config once, preserving existing diff-safety restrictions. It revalidates the registered workspace, complete Safety snapshot and directory identity after confirmation before dispatching only `daemon <verified-canonical-root>`. Credential values are not selected by setup; only the named reference reaches the existing daemon-child assembly. Other setup drivers remain unavailable. It adds no service installation, registry/config mutation, task approval, per-task Safety binding or alternate execution implementation; existing task-client/runtime behavior remains unchanged. The rechecks are not a privileged OS-race protection claim.

Foreground dispatch retains the existing child lifecycle. The setup call waits for child exit, and a receipt after successful dispatch completion is not an immediate listener-readiness or operational-readiness attestation. Actual successful binding/provider readiness/physical foreground interruption remains for disposable artifact/runtime proof.

Local validation: typecheck, whitespace check and 59 focused daemon-setup/registration/registry-Safety/setup/CLI/execution/credential/M17 acceptance tests passed. Proofs cover immutable config/root/environment review, preservation of diff restrictions, decline/expiry, invalid/unregistered paths and IDs, remote hosts/raw secret fields/reserved references, automatic approvals, Safety drift, root replacement/retargeting, foreground wait semantics and sanitized dispatch failure. Source CLI route/dispatch tests prove one selected file read with environment precedence. An actual non-TTY CLI subprocess refuses piped startup confirmation; a confirmed source CLI using the real daemon child rejects a synthetic absent credential before listener binding or workspace state writes. No successful daemon/listener or shared runtime activation occurred.

## M18B4 — Product integration acceptance — COMPLETE

Implementation `303a111a17360695302dea4098007871f352ae85`; exact-head GitHub-hosted CI [#1355](https://github.com/WasanthaK/cline-orchestrator/actions/runs/37797117885) passed typecheck and the full suite. `src/product-integration-m18b-acceptance.test.ts` composes the shipped product CLI, bounded config-file reader, real create-only config writer, real project/workspace registry and confirmed daemon adapter in disposable directories. Four acceptance scenarios cover initial diagnose/read-only plan, separately confirmed config/project/workspace/start actions, config-file/environment precedence through startup and task-client dispatch, status/diagnosis, decline at every action, invalid config rejection across observation/setup/execution, and reviewed Safety drift/degraded provider observation.

The harness verifies exact persisted Safety fields, one config read for selected startup, preservation of existing diff restrictions, startup automatic approvals remaining disabled, provider reference handoff only for daemon dispatch, no raw key in the reserved raw-key slot, sanitized outputs/false authority flags, and unchanged operator-owned workspace/config/registry data where mutation was not selected. A setup plan or observation never substitutes for confirmation. The task-client check exercises the existing dispatch handoff without executing a task or introducing a new Safety binding.

Only daemon dispatch and daemon/provider observations are simulated; confirmation callbacks are injected to exercise the same-session product adapters. Registry-backed workspace observations use the real registry. Actual listener readiness, successful provider/physical TTY interaction, packaged artifact execution, service installation and deployment are not claimed. The previously green B3d real daemon-child missing-credential negative proof remains independent evidence. This slice changes only acceptance tests and the canonical record: no product code, driver, installer, listener or authority path is added.

Local validation: typecheck, whitespace check and 35 focused M18B acceptance/config-write/registration/daemon-setup/M17 acceptance tests passed, including all four new composed scenarios. With hosted CI green, M18B software integration is complete. Physical/runtime/release gaps remain governed by the M18C–M18F queue.

# Current next step

**M18C1 — COMPLETE (commit `8db5077a`, exact-head hosted CI #1356 green).** The supported initial distribution is a private local npm tarball; `private: true` remains set and no registry publication occurs. The committed lockfile-v3 pins source build dependencies with integrity metadata. CI now installs with `npm ci --ignore-scripts`, preserving the existing full source typecheck/tests and PostgreSQL service before a separate runtime build/package-content verification.

`tsconfig.build.json` excludes source tests, live-proof programs and the developer CR3 preflight while retaining the full source configuration for typecheck/tests. The build script cleans the fixed repository dist directory and fails if excluded test/proof programs re-enter its compiled import graph. The package allowlist ships runtime JavaScript, README and distribution guide plus npm-required metadata; source/test/proof/build files, dependencies and operator config/registry/secret/task data are excluded. The prepack hook builds before a normal pack. The verification script checks required product/legacy/MCP entrypoints, prospective tarball contents and the product binary shebang.

This pins the source build graph; it does not embed a consumer dependency lock, guarantee offline installation or certify byte-identical builds across arbitrary toolchains. Runtime dependencies remain declared, unbundled npm dependencies. The distribution guide documents user-owned disposable prefixes, disabled install scripts and package removal with external operator data retained. Consumer install/run/remove and supported-platform proof remain for subsequent slices.

Local validation: clean locked dependency install, source typecheck, clean runtime build (including removal of a seeded stale test artifact), package-content allowlist verification and 9 focused Cline-runtime/M18B acceptance tests passed. A real `npm pack` produced `cline-orchestrator-0.1.0.tgz`: 182 allowed entries, 311394 bytes, SHA-256 `aeb0c4063b2ed68a4fe7c3e73cc01e5106865e8b46a143e7bf249dbf3d489eac`. Actual archive inspection verified the allowlist and shebang. The compiled CLI's default config and invalid raw-key config error passed in a disposable user-config environment without state creation or sentinel leakage. This is local build evidence, not an approved release artifact or consumer install proof. No service installation, listener, shared runtime, publication or release mutation is introduced.

Local build environment: Linux, Node `v24.19.0`, npm `11.9.0`. Hosted CI retains Node 22 and remains the exact-head completion gate. Next after green: M18C2 disposable tarball install/packaged CLI/error/removal acceptance, then M18C3 supported Windows/Linux artifact CI. M18C remains in progress until its packaged-binary and platform evidence is complete.

## M18C2 — Disposable installed-package acceptance — IMPLEMENTED; HOSTED CI PENDING

`npm run verify:installed-package` creates a real allowlisted npm tarball and installs it with lifecycle scripts disabled into a fresh disposable Linux consumer prefix. It runs the installed npm CLI shim, checks read-only safe defaults, proves raw-secret-bearing configuration fails without leaking a unique sentinel or creating operator state, uninstalls the product using npm, verifies the product/shim are removed and four separately stored user-owned files remain byte-identical. CI runs the acceptance after runtime build and package allowlist verification. No service driver, daemon/listener startup, registry publication, machine authority or destructive operator cleanup is added. M18C3 remains the supported Windows/Linux CI matrix after M18C2 exact-head green; M18D–M18F remain separately gated.

M18C2 CI #1357 initially failed at real consumer installation: unconstrained npm transitive resolution selected unavailable `@ai-sdk/openai@4.0.90` despite the source lock recording available `4.0.89` from `@cline/llms`. The repair pins `@ai-sdk/openai` to exact `4.0.89` as a runtime dependency and synchronizes the lockfile's root dependency declaration. This is a consumer dependency-resolution fix, not an acceptance bypass. Hosted exact-head verification remains required.

M18C2 retry #1358 attempt 2 reached installed package execution but exposed a genuine npm-shim entrypoint defect: CLI main detection compared the real module location to the symlink path and returned successfully without running `config`. Entry detection now compares resolved real filesystem locations so the installed npm binary executes, while retaining the disposable consumer-install regression gate. Exact-head CI is still required.

## M18C3 — Supported Windows/Linux artifact acceptance — IMPLEMENTED; EXACT-HEAD CI PENDING

Adds a GitHub-hosted Node 22 Windows/Linux build-and-artifact matrix. Both platforms must perform the locked install, clean runtime build, archive allowlist check, disposable npm consumer install, platform-specific installed npm shim execution, sanitized invalid-config rejection, npm package uninstall and byte-identical preservation of four user-owned sentinels. Windows uses the installed `.cmd` shim and Windows global npm prefix structure; Linux retains the existing POSIX executable. The existing Linux full-suite/PostgreSQL gate remains intact. No user-machine physical proof, service registration, listener, credential, task authorization, publication or release mutation is performed. CI #1360 established M18C2 complete; exact-head M18C3 green remains mandatory before advancing.

M18C3 initial CI #1361: Linux artifact and full test suite green; Windows consumer npm install exceeded the M18C2 harness's fixed 180-second subprocess timeout, before any installed CLI assertion. Corrective change permits a bounded 600-second timeout for npm pack/install/uninstall only, retaining a 180-second limit for CLI execution and every existing acceptance assertion. This does not claim Windows pass; exact-head CI must prove completion.

M18C3 CI #1362: full suite and Linux packaged-artifact job passed. Windows consumer install completed within extended bound, but the installed `.cmd` shim invocation failed due to nested quote formatting in the acceptance harness (`cmd /s /c` received a double-quoted command). The correction calls the same installed `.cmd` shim using `cmd /d /c call` with a single quoted path. All actual installed-package, invalid-config and uninstall assertions remain in force; exact-head Windows/Linux hosted CI is still required.
