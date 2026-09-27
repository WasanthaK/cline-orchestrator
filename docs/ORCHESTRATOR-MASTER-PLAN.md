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
| 11 | Secure remote ChatGPT control | In progress — Slices 11A–11B complete; no remote listener |
| 12 | Distributed / multi-machine orchestration | Planned |
| 13 | Safe multi-agent delegation | Planned |
| 14 | Autonomous engineering loops | Planned |
| 15 | GitHub delivery / release authority | Planned |
| 16 | Production security / reliability / observability | Planned |
| 17 | Productization / installer / first-run UX | Planned |
| 18 | Production release | Planned |

## Key completed evidence

- M2 closure `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174`.
- M3 through `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194`.
- M4 closure `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260`.
- M5 registry/policy/Hub/MCP/restart through CI `#438`; Hub generation remains pinned to reviewed Core/SDK `0.0.83`.
- M6 Supervisor through CI `#462`.
- M7 Sentinel/DAG/budgets/report/restart through CI `#518`.
- M8 dashboard/handoff/locks/concurrency/visualization/no-bypass through CI `#588`.
- M9A lease-aware writer boundary CI `#596`; M9B scheduler/Hub CI `#614`; M9C failure/restart safety CI `#620/#622/#628/#630`; M9D isolated Windows physical proof closure `14e9991bd4312e51cbb02beb5403326d9d3fe522`, CI `#668`.

---

# Milestone 10 — Interactive Operator Control Plane — COMPLETE

Supported bounded mutations are exactly:

- `reject_escalation`
- `approve_escalation`
- `abort_task`
- `rollback_task`
- `continue_task`
- `resume_workflow`
- `recover_scheduled_writer`

All supported mutations use short-lived single-use confirmation and delegate to independently authority-enforcing trusted services. Only escalation rejection currently has reviewed local loopback browser exposure.

Intentionally unavailable operator powers are part of the acceptance boundary, not unfinished work:

- Reviewer completion authority and Reviewer repair execution remain advisory only.
- Standalone validation execution remains unavailable because raw validation executes trusted configured commands and no independent operator-safe authority service exists.
- Generic process control, raw Hub control, lease management, credential access and shared-runtime control remain prohibited.
- Pause-state mutation remains unavailable until a deliberate durable state/service contract exists.
- Release authority remains Milestone 15.

Evidence: task continuation through `245c218d3245af5cec164ba0db4a348b40c8e3c5`, CI `#715`; targeted scheduled-writer recovery through `9e491a03db6bc47e634c3b194a7049765aea56f1`, CI `#727`; capability manifest `45b1fd891b555c8759f78c75bf795fe07d9fa7a0`, tests `2a731781316de4a4db5681f07188c024c50be3a1`, CI `#733` / `36313371285`.

---

# Milestone 11 — Secure Remote ChatGPT Control Plane

Planned: explicit machine-local registration; authenticated/revocable short-lived remote sessions; local-only Hub/provider credentials; opaque IDs and sanitized evidence; Safety Preview for new write tasks; replay protection; rate limiting; durable sanitized audit; revocation; and no stale-authority resurrection after reconnect.

## Slice 11A — Threat model + remote-session authority contract — COMPLETE

Implemented/proven:

- remote threat actors, protected assets, trust boundaries, data minimization and non-goals documented in `docs/MILESTONE-11-REMOTE-THREAT-MODEL.md`;
- no remote listener was opened;
- local registration/session contract uses opaque registration/machine/principal/session IDs;
- remote session capability projection is limited to the locally registered subset of the M10 capability manifest;
- session TTL is bounded to 30 seconds–15 minutes;
- expiry fails closed;
- registration revocation fails closed;
- local registration revision change invalidates existing sessions;
- capability reduction invalidates stale sessions;
- remote transport claims explicitly grant only `authenticated_session_only` and grant no human-confirmation, Safety Plan, credential or release authority;
- replay protection, rate limiting and durable sanitized audit are mandatory prerequisites for any future remote listener;
- current MCP and operator listeners remain loopback-only.

Evidence: contract `4f1bf14d685512945aebfe995d6d4f12466532ab`; tests `4f14c8e656ce376c07ce4a2724809a5f39eba4e0`; threat model `10e34cb064f9f50712f4673e7476170464589ad5`; CI `#741` / `36313678449` passed typecheck + full suite.

## Slice 11B — Machine-local remote registration store — COMPLETE

Implemented/proven:

- durable machine-local registration create/list/get/update/revoke;
- opaque registration/machine/principal IDs only;
- strict admission through the current M10 operator capability manifest;
- normalized deterministic capability projection;
- revision starts at 1 and increments monotonically for every update/revocation;
- updates/revocation require exact `expectedRevision` and concurrent same-revision mutations are single-winner;
- revoked registration is terminal;
- atomic snapshot replacement via temporary file + rename with restrictive file mode;
- corrupt or duplicate durable state fails closed;
- sanitized public views expose only registration metadata/capability names and no token, credential, workspace path or Safety Plan material;
- persisted registration can be fed to the 11A session-current assertion, so capability reduction/revision change/revocation invalidate stale session claims.

Evidence: shared registration normalization boundary `3a8ccc933f72f3587c179f6b86cebc10de0a21b8`; store `992498981f0226e9e5b43d1f652dd866a64073e3`; focused tests `32691d4f567b08cb6fe05aed5f79006288632be1`; CI `#749` / `36322675458` passed typecheck + full suite.

**Status: IN PROGRESS — Slices 11A–11B complete; remote authentication/session issuance and network transport remain disabled.**

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
| Operator capability manifest | Complete — M10 |
| Lease-aware parallel writer safety | Complete — M9 |
| Isolated physical concurrent-runtime proof | Complete — M9D |
| Remote threat/session authority contract | Complete — M11A |
| Remote registration store | Complete — M11B |
| Remote authentication/session issuance | Disabled — M11C next |
| Remote listener | Disabled |
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
9. No remote listener may be implemented until replay protection, rate limiting and durable sanitized audit are reviewed and tested.

---

# Immediate work queue

1. **COMPLETE — Milestones 1–10.**
2. **COMPLETE — Milestone 11 Slice 11A.** Threat model + remote-session authority contract; CI `#741` / `36313678449`.
3. **COMPLETE — Milestone 11 Slice 11B.** Machine-local registration store + stale-session invalidation; CI `#749` / `36322675458`.
4. **NEXT — Milestone 11 Slice 11C: local session issuance + replay/rate/audit primitives.** Build a local-only session issuer that loads the current durable registration, creates short-lived claims, and records sanitized provenance. Add replay protection and per-registration/session rate limiting as trusted primitives before any remote listener exists. No external bind/relay/tunnel and no credential/token persistence.
5. **STILL GATED — any external listener/relay/tunnel exposure** until 11C primitives are complete, reviewed and tested.
6. **STILL GATED — shared-runtime changes, native teams/subagents, distributed scheduling, release actions, secrets and external-network mutation** until their later milestone gates.

---

# Recent progress

- 2026-09-27: M10 task continuation completed through `245c218d3245af5cec164ba0db4a348b40c8e3c5`; CI `#715`.
- 2026-09-27: M10 targeted scheduled-writer recovery completed through `9e491a03db6bc47e634c3b194a7049765aea56f1`; CI `#727`.
- 2026-09-27: M10 capability boundary manifest `45b1fd891b555c8759f78c75bf795fe07d9fa7a0` + tests `2a731781316de4a4db5681f07188c024c50be3a1`; CI `#733`; M10 closed.
- 2026-09-27: M11A remote authority contract `4f1bf14d685512945aebfe995d6d4f12466532ab`, tests `4f14c8e656ce376c07ce4a2724809a5f39eba4e0`, threat model `10e34cb064f9f50712f4673e7476170464589ad5`; CI `#741`; no listener/runtime change.
- 2026-09-27: M11B registration normalization/store/tests through `32691d4f567b08cb6fe05aed5f79006288632be1`; CI `#749`; no listener/runtime change.

---

# Current next step

**Milestone 11 — Slice 11C: local session issuance + replay/rate/audit primitives.** Implement only local trusted primitives first. Keep external network transport disabled until these controls are proven.
