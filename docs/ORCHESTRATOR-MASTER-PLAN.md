# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-27
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
| 11 | Secure remote ChatGPT control | In progress — Slices 11A–11D complete; no external listener |
| 12 | Distributed / multi-machine orchestration | Planned |
| 13 | Safe multi-agent delegation | Planned |
| 14 | Autonomous engineering loops | Planned |
| 15 | GitHub delivery / release authority | Planned |
| 16 | Production security / reliability / observability | Planned |
| 17 | Productization / installer / first-run UX | Planned |
| 18 | Production release | Planned |

---

# Milestone 10 — Interactive Operator Control Plane — COMPLETE

Supported bounded mutations are exactly `reject_escalation`, `approve_escalation`, `abort_task`, `rollback_task`, `continue_task`, `resume_workflow`, and `recover_scheduled_writer`. Each uses short-lived single-use confirmation and delegates to an independently authority-enforcing trusted service.

Reviewer completion/repair execution, standalone validation execution, generic process/Hub/lease/credential/shared-runtime control, pause-state mutation and release authority remain intentionally unavailable.

Evidence: continuation CI `#715`; targeted writer recovery CI `#727`; capability manifest `45b1fd891b555c8759f78c75bf795fe07d9fa7a0`, tests `2a731781316de4a4db5681f07188c024c50be3a1`, CI `#733` / `36313371285`.

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

Planned: explicit machine-local registration; authenticated/revocable short-lived remote sessions; local-only Hub/provider credentials; opaque IDs and sanitized evidence; Safety Preview for new write tasks; replay protection; rate limiting; durable sanitized audit; revocation; and no stale-authority resurrection after reconnect.

## Slice 11A — Threat model + remote-session authority contract — COMPLETE

- Threat actors/assets/trust boundaries/non-goals documented in `docs/MILESTONE-11-REMOTE-THREAT-MODEL.md`.
- Remote session capability projection is limited to a locally registered M10 subset.
- Session TTL is 30 seconds–15 minutes; expiry/revocation/revision drift/capability reduction fail closed.
- Transport grants only `authenticated_session_only`; it grants no human confirmation, Safety Plan, credential or release authority.
- Current production listeners remain loopback-only.

Evidence: contract `4f1bf14d685512945aebfe995d6d4f12466532ab`; tests `4f14c8e656ce376c07ce4a2724809a5f39eba4e0`; threat model `10e34cb064f9f50712f4673e7476170464589ad5`; CI `#741` / `36313678449`.

## Slice 11B — Machine-local remote registration store — COMPLETE

- Durable local create/list/get/update/revoke with opaque IDs.
- Strict current-M10 capability admission and deterministic projection.
- Monotonic revisions; exact `expectedRevision`; concurrent same-revision writes are single-winner.
- Revocation terminal; corrupt/duplicate state fails closed.
- Atomic temp-file + rename snapshot with restrictive permissions.
- Public view excludes tokens, credentials, workspace paths and Safety Plans.
- Revision/revocation/capability changes invalidate prior session claims.

Evidence: normalization `3a8ccc933f72f3587c179f6b86cebc10de0a21b8`; store `992498981f0226e9e5b43d1f652dd866a64073e3`; tests `32691d4f567b08cb6fe05aed5f79006288632be1`; CI `#749` / `36322675458`.

## Slice 11C — Local session issuance + replay/rate/audit primitives — COMPLETE

- Short-lived random bearer tokens are process-memory only and never persisted.
- Every request revalidates current registration before authorization.
- Single-use request IDs, bounded replay cache, per-session and aggregate registration rate limits.
- Local session revocation and expired-session pruning.
- Durable sanitized audit contains only opaque IDs, capability name, outcome/reason; no bearer/credential/path/Safety Plan/command output.
- Mutation capability means transport reachability only; it never executes a mutation or supplies human confirmation.

Evidence: primitives `ba6f6cb0d472fc59bef70665d53403b9732d1e83`; tests `826d642785b5e4f835b2a423377e3c765ca68fa7`; hardening `d7de15868cbe384d43a9c28a1014e6a8f382080b`; CI `#757` / `36323073039`.

## Slice 11D — Loopback authenticated read transport — COMPLETE

- Separate opt-in adapter; not wired into the production entrypoint.
- Bind restricted to `127.0.0.1`, `localhost`, or `::1` and tested only on ephemeral loopback.
- Every route requires 11C bearer auth plus single-use request UUID and therefore inherits registration-current, replay, rate-limit and audit checks.
- Request body bounded to 64 KiB, POST + JSON only, `Cache-Control: no-store`, `nosniff`.
- Browser Origin, when present, must be loopback; Host must also identify loopback, preventing DNS-rebinding-style requests.
- Exactly four remote read capabilities are mapped: passive visualization, bounded task validation status, supervisor decision summary and active writer status.
- Task-validation view strips goal, Safety Plan/scope, checkpoint, error/stdout/stderr and diff-summary/path contents.
- No registration/session-issuance, mutation/confirmation, shell/filesystem, Hub/process/lease or credential routes exist.
- Remote mutations were deliberately not exposed because an authenticated M11 session has `humanConfirmationAuthority: none`; bearer possession cannot be converted into M10 confirmation authority.

Evidence: adapter `277e6f3aeff7cde3b884e572a8b05eb2ab3dc3b2`; route/minimization tests `b029991ca0c2e8db2680c1b9d60a3cc039d1e6bf`; Host hardening `f47ddfba89ac6bd06daea4433b220de202a210d6`; rebinding test `9f8c6dc5933f30895b03c0b5177b3628106d7397`; branch-head CI `#767` / `36323681568` passed typecheck + full suite.

**Status: IN PROGRESS — Slices 11A–11D complete; external exposure and remote mutation remain disabled.**

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
| Remote session/replay/rate/audit primitives | Complete — M11C |
| Authenticated loopback remote reads | Complete — M11D / not production-wired |
| Remote mutation approval bridge | Not implemented — M11E next |
| External listener/relay/tunnel exposure | Disabled |
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
9. No remote mutation endpoint may use M11 bearer possession as a substitute for the M10 explicit confirmation boundary.
10. External exposure/physical remote proof remains gated and requires explicit user authorization immediately before external-network mutation/proof.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — M11A:** threat/session authority contract; CI `#741`.
3. **COMPLETE — M11B:** local registration store; CI `#749`.
4. **COMPLETE — M11C:** local session/replay/rate/audit primitives; CI `#757`.
5. **COMPLETE — M11D:** authenticated loopback read transport + Host/Origin/replay/rate guards; CI `#767`.
6. **NEXT — Milestone 11 Slice 11E: remote mutation approval bridge contract.** Design a durable request/approval boundary where remote sessions may propose a specific M10 mutation but cannot approve it. Human approval must be a distinct locally trusted action bound to exact registration/session/request/action/task/current-authority evidence. Only after approval may a one-shot execution permit delegate to the existing M10/trusted service boundary. Do not expose M10 confirmation tokens to remote clients and do not let bearer auth create approval authority.
7. **STILL GATED — any external listener/relay/tunnel exposure and physical remote proof** until the mutation/approval semantics and final remote surface are complete/reviewed, with explicit user authorization immediately before external-network mutation/proof.
8. **STILL GATED — shared-runtime changes, native teams/subagents, distributed scheduling, release actions, secrets and external-network mutation** until later milestone gates.

---

# Recent progress

- 2026-09-27: M10 capability boundary CI `#733`; M10 closed.
- 2026-09-27: M11A contract/threat model CI `#741`.
- 2026-09-27: M11B registration store CI `#749`.
- 2026-09-27: M11C session/replay/rate/audit CI `#757`.
- 2026-09-27: M11D loopback read transport through `9f8c6dc5933f30895b03c0b5177b3628106d7397`; CI `#767`; no production/external listener change.

---

# Current next step

**Milestone 11 — Slice 11E: remote mutation approval bridge contract.** Remote sessions may request/propose, but human approval must remain a separate trusted local authority. Build the durable binding and one-shot permit before considering any mutation route or external exposure.
