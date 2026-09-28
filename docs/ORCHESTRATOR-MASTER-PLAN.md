# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-28
Branch: `phase-1/bootstrap`

## Canonical rules

1. Finish milestones in order; implement only the first unfinished item unless a prerequisite defect is found.
2. Use GitHub-hosted CI for normal proof. Do not mutate/restart the shared local Cline/Hub/VS Code runtime without explicit user authorization immediately before that proof.
3. ChatGPT receives task authority, never unrestricted machine authority.
4. Registry + approved Safety Plan/task envelope are authoritative. Scope expansion fails closed to durable human escalation or a fresh Safety Preview.
5. Planner/Reviewer output is advisory unless admitted by trusted orchestration code.
6. Workflow, dashboard, handoff, lock, scheduler, Hub participation and remote transport never grant task authority.
7. Lease possession is coordination only; current durable authority plus a current fenced lease are required before coordinated writes.
8. Native teams/subagents, generic shell/network/plugin execution, raw Hub/process/lease/credential controls and release authority remain separately gated.
9. Edit authority is separate from commit, push, PR, merge and deployment authority.
10. User-visible controls invoke the same trusted service boundaries as non-UI callers.
11. Remote authentication is transport identity only; it never becomes human confirmation, Safety Plan approval, credential authority, or release authority.

## End goal

ChatGPT → Planner / Architect / Reviewer → Orchestrator → bounded Cline workers → registered workspaces → validation / Git safety / evidence, with durable memory, context rotation, safe concurrency, human control and explicit release authority.

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
| 11 | Secure remote ChatGPT control | Implementation complete through 11H; external/physical proof pending explicit authorization |
| 12 | Distributed / multi-machine orchestration | Planned |
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

## Slice 11A — Threat model + remote-session authority contract — COMPLETE

- Threat actors/assets/trust boundaries/non-goals documented in `docs/MILESTONE-11-REMOTE-THREAT-MODEL.md`.
- Remote session capability projection is locally registered only.
- Session TTL 30 seconds–15 minutes; expiry/revocation/revision drift/capability reduction fail closed.
- Transport grants only `authenticated_session_only`; no human confirmation, Safety Plan, credential or release authority.

Evidence: contract `4f1bf14d685512945aebfe995d6d4f12466532ab`; tests `4f14c8e656ce376c07ce4a2724809a5f39eba4e0`; threat model `10e34cb064f9f50712f4673e7476170464589ad5`; CI `#741`.

## Slice 11B — Machine-local remote registration store — COMPLETE

- Durable create/list/get/update/revoke with opaque IDs.
- Monotonic revisions, exact `expectedRevision`, serialized mutation, atomic replacement, restrictive permissions.
- Revocation terminal; corrupt/duplicate state fails closed.
- No bearer/session tokens, credentials, workspace paths or Safety Plans persisted.

Evidence: normalization `3a8ccc933f72f3587c179f6b86cebc10de0a21b8`; store `992498981f0226e9e5b43d1f652dd866a64073e3`; tests `32691d4f567b08cb6fe05aed5f79006288632be1`; CI `#749`.

## Slice 11C — Session issuance + replay/rate/audit primitives — COMPLETE

- Random bearer tokens process-memory only.
- Every request revalidates current registration.
- Single-use request IDs, bounded replay cache, per-session and aggregate per-registration rate limits.
- Local session revocation and expiry pruning.
- Durable audit is sanitized and token-free.

Evidence: primitives `ba6f6cb0d472fc59bef70665d53403b9732d1e83`; tests `826d642785b5e4f835b2a423377e3c765ca68fa7`; hardening `d7de15868cbe384d43a9c28a1014e6a8f382080b`; CI `#757`.

## Slice 11D — Loopback authenticated read transport — COMPLETE

- Separate opt-in adapter, not production-wired.
- Loopback bind + loopback Host guard + loopback browser Origin guard.
- POST/JSON only, 64 KiB request bound, no-store/nosniff responses.
- Exactly four sanitized reads: passive visualization, task validation status, supervisor decision summary, active writer status.
- No registration/session issuance/mutation/confirmation/shell/filesystem/Hub/process/lease/credential routes.

Evidence: adapter `277e6f3aeff7cde3b884e572a8b05eb2ab3dc3b2`; tests `b029991ca0c2e8db2680c1b9d60a3cc039d1e6bf`; Host hardening `f47ddfba89ac6bd06daea4433b220de202a210d6`; rebinding test `9f8c6dc5933f30895b03c0b5177b3628106d7397`; CI `#767`.

## Slice 11E — Remote mutation approval bridge — COMPLETE

- Remote sessions may create exact mutation proposals only after current capability authorization.
- Exact proposal payload is held process-local; durable state stores digest/length + opaque identity/evidence only.
- Local human approval is distinct from remote bearer authentication.
- Hidden M10 confirmation material never appears in durable state or remote output; only SHA-256 binding evidence is durable.
- Local approval creates one short-lived bridge permit bound to exact proposal/session/registration revision/action/payload digest.
- Permit is burned before mutation execution; expiry/session/payload/execution failure closes proposal as `execution_failed` and forces a fresh proposal/approval.

Evidence: bridge `bc86625e6899524e1914fb63482aab6bf798d2f7`; tests `1de2d2e6775f6adae48866cfcf90f7635dee4df3`; hardening `1fe4cf7e38e811f64a1066213094d4561899d9d4`; CI `#775` / `36324188060`.

## Slice 11F — Existing M10 mutation adapter — COMPLETE

- Composite adapter covers all seven existing M10 mutations.
- Local approval calls the existing action-specific M10 preview wrapper.
- Raw M10 confirmation token exists only inside a process-local execution closure.
- Remote client never receives M10 confirmation tokens and never bypasses action-specific stale/current-authority checks.

Evidence: adapter `283b9486caf3b4a5ff55ad7da0ad6c9d5de7c6e1`; tests `90671a9083e2fcee0f7516eb04f30db3cda05016`; CI `#779` / `36324400332`.

## Slice 11G — Loopback mutation proposal/execute transport — COMPLETE

- Separate loopback-only mutation server.
- Exactly two remote routes: `mutation/propose` and `mutation/execute`.
- No remote approve/reject/confirmation route; bearer possession cannot create human approval.
- Execution requires the one-shot permit produced by the distinct local approval bridge.
- Raw M10 service result is not widened into the remote response.
- Host/Origin/input/replay/rate/current-registration controls remain enforced.

Evidence: transport `87f851bc74a6b0fd9c3a7764a61a356010228891`; tests `3ef8110cd036cc3423fdb0a5ca6e8f799018979c`; CI `#783` / `36324599464`.

## Slice 11H — Brand-new write task Safety Preview bridge + transport — COMPLETE

- Added distinct M11-only `propose_new_task` capability instead of reusing any M10 mutation authority.
- Existing/legacy registrations normalize to no control-plane capability; local registration must explicitly opt in.
- Session issue/authorization projects this capability and capability removal/revision change invalidates stale sessions.
- Remote proposal stores only opaque identity + workspace ID + goal/scope digests/counts; plaintext goal/scope and Safety Plan token are process-local only.
- Local operator must request the trusted `MachineOrchestratorService.previewTask` Safety Preview and then explicitly confirm that exact preview.
- Safety Preview token is never persisted or returned remotely.
- Local confirmation creates a one-shot start permit bound to proposal/session/registration revision and Safety Preview expiry.
- Remote execution reauthorizes the same live session and redeems the permit into existing `MachineOrchestratorService.startTask`, which consumes/revalidates the Safety Plan token before durable task authority is created.
- Process restart loses proposal material/permits and forces a fresh proposal rather than resurrecting authority.
- Separate loopback server exposes exactly `task-start/propose` and `task-start/execute`; no remote preview/approve/confirm route exists.
- Remote start response is minimized to opaque task/project/workspace IDs, status and timestamps; goal/Safety Plan data are not returned.
- Host/Origin/input-size/schema controls are enforced before bridge invocation.

Evidence: capability contract `9a817b9cd34c5cd9d0e78e0073085317936d4983`; registration projection `fc75d52a867ac661a090b6cd495135856e954563`; session authorization `824af87931a6bcef81e5d19c75c46a29a0c0293b`; task-start bridge `546dbcce504116d8c549c036499a36acba72e0db`; bridge tests through `44d6c55a7ad473d34a6237f1066d4843e16d923d`, CI `#795` / `36363187865`; loopback transport `90717b84fa5f09f57025549dfcc3a5d9a29e69a0`; transport tests `37e332e274e7c827b0958e4b1ca6b128f9ef442e`; CI `#799` / `36363314881` passed typecheck + full suite.

**Status: IMPLEMENTATION COMPLETE — all Milestone 11 software/security boundaries are CI-proven. Final external/physical remote proof remains deliberately unperformed because it requires explicit user authorization immediately before external-network mutation/exposure.**

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
| Remote threat/session authority contract | Complete — M11A |
| Remote registration store | Complete — M11B |
| Remote session/replay/rate/audit | Complete — M11C |
| Authenticated loopback reads | Complete — M11D / opt-in |
| Remote mutation proposal + local-human approval bridge | Complete — M11E |
| All-seven M10 adapter | Complete — M11F |
| Loopback mutation proposal/execute transport | Complete — M11G / opt-in |
| New-task Safety Preview proposal/approval/start bridge | Complete — M11H |
| External listener/relay/tunnel exposure | Disabled — physical proof gate |
| Shared live-runtime concurrency | Disabled pending separate authorization/review |
| Native teams/subagents | Disabled — M13 |
| Distributed scheduler | Disabled — M12 |
| Push/merge/deploy authority | Disabled — M15 |

---

# Known constraints and risks

1. Credentials must never enter durable/model-facing task/project state.
2. Validation commands are trusted local configuration; Planner text cannot self-admit them.
3. Reviewer `pass` cannot mark tasks complete or broaden authority.
4. Locks/scheduler remain single-gateway primitives until M12.
5. Shared live concurrent runtime remains disabled after isolated M9D proof pending separate authorization/review.
6. Push, merge, deploy, destructive Git, secret access, external-network mutation and system changes remain separately gated.
7. Remote authentication is transport identity only; it cannot become human approval, Safety Plan approval, task authority, credential authority or release authority.
8. Local revocation, registration revision and capability reduction must win over stale remote state.
9. No remote endpoint may use bearer possession as a substitute for explicit M10 or Safety Preview human confirmation.
10. Loopback transport modules are opt-in and are not automatically production-wired.
11. External exposure/physical remote proof requires explicit user authorization immediately before any listener/relay/tunnel/network mutation and must use a reviewed secure transport; no raw public bind is acceptable.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — M11A–M11H software/security implementation and CI proof.** Latest branch-head CI `#799` / `36363314881`.
3. **GATED NEXT — M11 physical remote proof / closure.** With explicit user authorization immediately before the action, choose/review a secure external transport (for example an authenticated tunnel/relay that keeps the orchestrator listener loopback-only), perform a disposable end-to-end proof for sanitized read + remote proposal/local approval/permit execution, verify revocation/replay/rate/stale-authority behavior, then disable/remove the exposure and record evidence.
4. **DO NOT perform raw public bind, port-forwarding, tunnel creation, DNS/firewall mutation, credential provisioning, or external-network changes without that explicit authorization.**
5. After physical M11 proof/closure, proceed to **Milestone 12 — Distributed / multi-machine orchestration**.

---

# Recent progress

- 2026-09-27: M11D loopback read transport CI `#767`.
- 2026-09-27: M11E human-separate mutation approval bridge CI `#775`.
- 2026-09-27: M11F all-seven existing M10 adapter CI `#779`.
- 2026-09-27: M11G loopback mutation proposal/execute transport CI `#783`.
- 2026-09-28: M11H explicit new-task proposal capability + Safety Preview bridge CI `#795`; loopback task-start transport CI `#799`.

---

# Current next step

**Milestone 11 physical remote proof / closure — GATED ON EXPLICIT USER AUTHORIZATION.** No external exposure has been created. The implementation is ready for a disposable secure-tunnel/relay proof while retaining loopback-only orchestrator listeners and the existing human-confirmation/Safety Plan boundaries.
