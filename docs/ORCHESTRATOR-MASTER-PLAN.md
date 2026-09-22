# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-22
Branch: `phase-1/bootstrap`

## Purpose

This file is the canonical execution plan for `cline-orchestrator`.

Before implementation work: read this file, confirm the branch/HEAD and current milestone, implement only the first unfinished item, use normal cloud CI rather than destructive shared-runtime testing, then update this file with evidence and the single next action.

Detailed historical implementation narrative remains available in Git history; this tracker keeps the current architecture, acceptance state, evidence, constraints, and ordered next work authoritative.

## End Goal

```text
ChatGPT
Planner / Architect / Reviewer
          |
          v
Cline Orchestrator Plugin / MCP
Task-level authority + safety preview
          |
          v
Orchestrator
Durable state + safety + supervision
          |
          v
Cline Hub
Authoritative shared runtime
       /       \
      v         v
VS Code Cline   Cline session
          |
          v
Workspace / Git / validation
```

The system should eventually support long-running and unattended coding work while preserving human control, reversible workspace changes, durable project memory, bounded model context, and evidence-based completion.

---

# Execution Rules

1. **Finish milestones in order.** Work only on the first unfinished item unless a prerequisite defect is discovered.
2. **Protect the shared local runtime.** Automated development must not stop/unload Ollama models, kill runtime processes, restart Ollama, mutate shared VS Code/Cline Hub state, or run destructive self-hosted E2E tests without explicit authorization.
3. **Use cloud CI for normal development.** Repository inspection, mocks/unit tests, and GitHub-hosted CI are the normal proof path. The self-hosted/shared runtime remains manual/read-only until an isolated proof window is explicitly authorized.
4. **Model context is not project lifetime.** Durable task/project state owns continuity; context rotation uses current/per-turn request size, not cumulative totals.
5. **Model completion is not task completion.** Coding completion requires configured validation plus checkpoint-relative diff safety before `completed` persists.
6. **ChatGPT receives task authority, not machine authority.** Registered opaque IDs and approved task envelopes grant authority; raw paths, repository text, fuzzy matches, Hub participation, or ChatGPT conversation identity do not.
7. **Scope expansion fails closed.** Out-of-scope/high-risk actions become durable human escalation or a new Safety Preview, never silent authority expansion.

---

# Milestone 1 — Foundation

## Objective

Reliable task start/resume, persistent daemon behavior, durable task state, bounded recovery, event evidence, explicit abort, and graceful shutdown.

## Acceptance Criteria

- [x] Durable start/resume and session IDs.
- [x] Persistent daemon and semantic recovery after runtime/session loss.
- [x] Run-local token/tool/iteration metrics.
- [x] Watchdog stall detection with bounded retry/recovery.
- [x] Durable event timeline, abort, graceful shutdown/drain.
- [x] CLI persistence fallback during listener shutdown race.
- [x] Metadata-only provider preflight before task-state mutation.

## Status

**COMPLETE**

---

# Milestone 2 — Safety: Reversible Autonomous Editing

## Acceptance Criteria

- [x] Git branch/HEAD/dirty state before/after each run.
- [x] Restorable checkpoint preserving pre-existing dirty tracked/untracked state.
- [x] Durable checkpoint metadata and explicit rollback service/CLI/tests.
- [x] External validation with bounded repair and durable evidence.
- [x] Checkpoint-relative final diff summary.
- [x] Expected-path/protected-path/branch-HEAD/excessive-diff enforcement.
- [x] `completed` requires validation success when configured plus diff-safety success.

## Key Evidence

- Diff-safety closure: `56cecab14bf5719601d6801b5635a5b2ef2d0336`; CI `#174` / `35574026345`, success.

## Status

**COMPLETE**

---

# Milestone 3 — Context Durability

## Acceptance Criteria

- [x] Per-turn input usage and configurable context-rotation threshold.
- [x] Planned rotation distinct from watchdog retry/stall behavior.
- [x] Versioned structured durable handoff written before session replacement.
- [x] Bounded repeated rotations.
- [x] `session_not_found` recovery interaction.
- [x] Validation-repair recovery preserves original checkpoint baseline.
- [x] Cross-generation metrics/events remain attributable and coherent.

## Key Evidence

- Structured handoff: `15adf9f9dd87a45544d2a6fc3985dc278be9284d`; CI `#178` / `35576669466`.
- Repeated rotations: `84fc26df4d2dd6b7ad1c45e02c9846e264593d25`; CI `#182` / `35577093373`.
- Session-not-found recovery: `26dbf0db896e83d160c1cf3f43f2ae7b0e813e2c`; CI `#186` / `35577401081`.
- Validation-repair recovery: `af9db66835c5dfc7a657e1c0291cdaef24668a2d`; CI `#190` / `35577839253`.
- Cross-generation closure: `7fa6abebbc00b801349d321a98efd626795e2d1f`; CI `#194` / `35578149506`.

## Status

**COMPLETE**

---

# Milestone 4 — Durable Project Memory

## Target Structure

```text
.orchestrator/
  project.json
  tasks/
  task-summaries/
  events/
  checkpoints/
  handoffs/
  memory/
    architecture.md
    decisions.md
    code-map.md
    conventions.md
    known-issues.md
```

## Acceptance Criteria

- [x] Durable project metadata and stable project identity.
- [x] Architecture memory.
- [x] Decision log with rationale/date/task provenance.
- [x] Selective code map.
- [x] Conventions memory.
- [x] Known-issues lifecycle memory.
- [x] Versioned bounded per-task summary.
- [x] Structured handoff integration with bounded durable memory context.
- [x] Deterministic selective retrieval.
- [x] Explicit/auditable memory updates and verifier.
- [x] Cross-store serialization/update/audit/selection closure.

## Key Evidence

- Project skeleton: `32014431b54256d51f76626641350b08315afda9`; CI `#198` / `35579239935`.
- Architecture: `0344c16cc843428af4dbe4247b9156a222e2bdb9`; CI `#202` / `35585222049`.
- Decisions: `3a43401c80e6ebe3df6dc33c337d307cbeb38cee`; CI `#206` / `35586243241`.
- Code map: `3e064115c187783ec9fb86a3a732fca136e02140`; CI `#212` / `35590998279`.
- Conventions: `3efecb809b9679505f007d75bfd273d815fa2e55`; CI `#220` / `35593035452`.
- Known issues: `90a9adf9147b7bbf63486b99ac605ded5cdc844c`; CI `#226` / `35595083980`.
- Task summaries: `d74f63618898291f42363bdd846459814820b4cd` + `0e8c2e57cfe382b792a4178de40ccbb453c1c080`; CI `#232` / `35597817935`.
- Handoff-memory integration: `822125be3d7e0d81d44a20e503397b2b3a9014e1` + `7387489e360b851a726b42dcc6797ba48f29ed6a`; CI `#238` / `35599286479`.
- Selective retrieval closure: through `a8e34addbe3bacf56ce22cdf1d58e4ad166ca623`; CI `#250` / `35602317107`.
- Audit verification: `43ca077d91ecf137b34db4d68b8d6a694c58cfe5` + `f379272930f9fe9ffb71d70c6cc51f2eb4f1213e`; CI `#256` / `35604217740`.
- Final composition closure: `8cdb3b9da1b0de97d5d654636fab12992f4176e8`; CI `#260` / `35604869492`.

## Status

**COMPLETE**

---

# Milestone 5 — ChatGPT Plugin / Cline Hub Shared Runtime

## Objective

Let the user invoke the orchestrator from ChatGPT while machine authority stays local. Registered project/workspace IDs and Safety Plans bound each write task. The orchestrator creates/controls a safety-bounded Cline Hub session that VS Code may observe without weakening task policy.

## Confirmed Technical Spike

Pinned Cline generation: `@cline/sdk 0.0.83`.

Documented/proven design:

- managed Hub discovery owns the local auth token; the orchestrator consumes Cline discovery and does not persist a second Hub credential;
- `@cline/sdk` is sufficient for the first Hub path;
- `ClineCore` preserves the start/send/abort/subscribe programming model over Hub;
- Hub client hooks and tool executors are creator/client-targeted; wrong-client capability responses are rejected by the pinned Hub implementation;
- native Hub `approval.requested` is broader/broadcast and therefore is not the authorization boundary;
- new ChatGPT write sessions are orchestrator-owned; existing VS Code-created sessions remain observational in the first pilot;
- owner/client loss is recovered through durable handoff and replacement session rather than assuming attach transfers ownership.

### Spike evidence

- Hub discovery/authentication: `de6846cb1bbc3e847865b735a2a3b045bc7b72ea`; CI `#264` / `35607213364`.
- Import/dependency boundary: `40e9e1938e7b5005b82bdec3d717a576d766e225`; CI `#268` / `35609556979`.
- Session-control API map: `b8e3f7e742e34e21bbc6043b7aaa68f84457caa4`; CI `#272` / `35611491671`.
- ChatGPT UX/safety contract: `060eca0d39c5d2019b4705229963fc36c5bae40d`; CI `#276` / `35614305961`.
- Workspace/session identity: `d93fb57355ddb889ebf1388488be8904b301fe68`; CI `#278` / `35618180127`.
- Safe migration design: `d51a85585c831b24da9cd7129d34d74488ec2750`; CI `#282` / `35668708848`.

## Implementation Acceptance Criteria

- [x] Machine-local user-configured project/workspace registry with canonical-root validation, opaque IDs, and revisioned safety profiles.
- [x] Read-only Safety Preview + immutable server-side Safety Plan + opaque single-use/expiring plan token; start rejects stale registry/Git/policy fingerprints.
- [x] Durable tasks bind approved project/workspace/safety-plan identity so continuation cannot silently broaden authority.
- [x] Pre-execution policy engine with fail-closed normalization, secret/protected/allowed-path checks, traversal/symlink containment, and durable escalation.
- [x] Owner-targeted `beforeTool` contribution plus owner-targeted read/search/editor/apply-patch executors are supplied through the Hub start contract.
- [x] First-pilot worker/runtime profile disables arbitrary model shell, ungoverned network/MCP/plugin configuration, subagents/teams, and unreviewed provider execution surfaces.
- [x] Hub-backed runtime factory preserves the existing `ClineRunner` lifecycle contract and revalidates persisted Hub session workspace identity before resume.
- [x] Machine-level task-oriented MCP/plugin gateway exposes registered IDs and Safety Preview workflows, not raw path/shell/Hub authority.
- [x] Cloud tests cover registry/plan replay/staleness, path safety, patch all-or-nothing behavior, disabled surfaces, Hub contribution wiring/failure boundaries, workspace identity, Hub `session_not_found` recovery, MCP authority boundaries/authentication, active-task polling, and existing lifecycle safety regressions.
- [ ] Explicitly authorized isolated runtime proof on a disposable registered workspace demonstrates shared VS Code visibility, allowed edit, blocked out-of-scope edit, secret denial, unavailable model shell, fail-closed owner/policy loss, validation/diff safety, and rollback without mutating shared Ollama.

## Unit 1 — Registry + Safety Preview / Plan-token Boundary

**COMPLETE.**

Implemented:

- per-user machine-local registry outside repositories;
- opaque project/workspace IDs and canonical-root validation;
- revisioned safety profiles and safe discovery;
- immutable in-memory Safety Plans;
- 256-bit opaque tokens stored only by hash, short TTL, single use;
- stale workspace/profile/policy/worker/Git branch/HEAD/dirty fingerprint rejection;
- plan-token-only durable task start;
- durable approved task identity/path envelope with no raw token persistence.

Evidence: registry `7f02b471dcada322c2b7cb740e8a552486634b16`; Safety Plan `29910e4d3bfedf23707697332d62c99a9e0a1e5a`; durable fields `d8fe91a9779022aeab73e6bb2d0b03525de86a41`; tests through `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`; CI `#295` / `35679414455`, success.

## Unit 2 — Pre-execution Policy + Local Safe Executor Boundary

**COMPLETE.**

Implemented:

- bounded action descriptors and `ALLOW` / `DENY` / `ESCALATE_AND_STOP`;
- canonical containment, nearest-existing-ancestor handling, traversal denial, write-symlink/reparse denial;
- secret/protected path denial before allow-scope matching;
- durable `waiting_for_human` escalation records/events;
- fail-closed `beforeTool` gate primitive;
- immediate read/search/editor/apply-patch executor re-checks;
- all-or-nothing multi-file patch checks;
- shell/network/unknown tool denial.

Evidence: task state `b2bf06b9f59fedfb588dd36c66d3dc3c33d8f29a`; policy `d6e0d93460bfcf4d382fec7a8a7b6be298d3c6c4`; escalation `300060db73f3f40a860543fcf4416372c63e6a9c`; executor boundary `89610fccef145d05504a90a797d35646cf0b3804`; tests `6f655537e24e6bcf732fb99670ade579ef666ff3`, `464268aea4fae40047853dfd5ac39b6ec2c74aca`, `46da20d18cd703018c54207258d4fb2422e71eeb`; CI push `#311` / `35699517817` and PR `#312` / `35699521432`, success.

## Unit 3 — Hub-backed Cline Runtime Adapter / Owner Safety Wiring

**COMPLETE — mocked/fake Hub proof only; no live shared runtime mutation.**

Implemented:

- `ClineRuntime` / `ClineRuntimeFactory` seam while preserving `ClineRunner` as lifecycle owner;
- SDK factory uses local mode for existing daemon behavior and Hub mode only when explicitly selected;
- Hub creation uses `backendMode: "hub"` + `strategy: "require-hub"` with registered workspace root/cwd and no orchestrator-persisted Hub auth token;
- persisted Hub session resume canonicalizes and verifies `workspaceRoot` before any send; missing lookup capability or mismatched workspace fails closed;
- approved durable task safety envelope is required before a Hub write session can start;
- pinned SDK `beforeTool` is wired through `localRuntime.hooks` as a creator/client-owned contribution;
- pinned SDK `RuntimeCapabilities.toolExecutors` supplies only readFile/search/editor/applyPatch owner executors;
- actual SDK read/patch payloads are adapted and every patch source/destination path is checked before execution;
- final executors re-evaluate Unit 2 policy immediately before filesystem delegation;
- shell, web fetch, skills, question, ungoverned MCP/plugin settings, spawn-agent, agent-teams and unreviewed provider surfaces remain disabled;
- durable human escalation remains `waiting_for_human` even if Cline later reports aborted/failed;
- local mode remains the default for the existing daemon/CLI.

Evidence: runtime seam `1152c58ba2422d755072b480128c8def4c37a324`; shared enforcement export `063a8276a855879c51f9679f3c3067888cae7483`; Hub safety builder `82a85be99915b92b279886c0f8ce297e87ec88c0`; runner integration `21f627d17f2b745ddcd6380ec6e938e2337c3bc7`; tests through `32c057d30bc70533233477e87f7e01ec09b2e04a`; accepted CI push `#329` / `35723407897` and PR `#330` / `35723411583`, success.

## Unit 4 — Machine-level ChatGPT MCP / Plugin Gateway

**COMPLETE — cloud/fake-runtime proof only; no live shared runtime mutation.**

Implemented:

- `MachineOrchestratorService` composes the existing registry, Safety Plan service, `TaskStore`, Hub-mode `ClineRunner`, provider preflight, validation/repair, diff safety and rollback rather than creating a parallel authority path;
- per-workspace controllers serialize execution and route approved writes through `runtimeMode: "hub"`;
- public discovery/status/task/event/diff views resolve registered opaque IDs and deliberately omit canonical workspace roots, Hub/Cline session IDs, raw prompts/output, provider/Hub credentials and checkpoint backup refs/paths;
- task-event output omits raw `data`; task-diff output exposes bounded changed-path metadata and safety findings only, never file contents;
- `preview_task` is read-only and accepts only registered `workspace_id`, goal and bounded requested scope;
- `start_task` accepts only the opaque single-use plan token; workspace/path/policy/model overrides are impossible at the MCP boundary;
- `continue_task` accepts only task ID + instruction, revalidates the durable registry/profile binding and cannot broaden the approved envelope;
- `approve_escalation` records explicit approval but never converts it into broader old-task authority: the original task is closed and a fresh Safety Preview is required;
- `reject_escalation` closes the paused task without granting authority;
- rollback requires the task ID plus a derived opaque checkpoint ID rather than exposing private checkpoint paths/refs;
- untrusted project/workspace/task/escalation identifiers are validated as opaque UUIDs before storage lookup;
- the MCP v2 surface contains only task-level discovery/status/preview/start/continue/abort/escalation/rollback operations; no generic filesystem, shell, raw Hub attach/commands, credentials or unrestricted daemon/process control is exposed;
- the production MCP HTTP entrypoint is loopback-only, bearer authenticated with timing-safe comparison, and applies localhost Host/Origin validation before protocol handling;
- optional public tunnel URL configuration is metadata only and must be HTTPS; the orchestrator neither launches nor controls tunnel credentials;
- `npm run mcp` / `start:mcp` entrypoints and explicit local worker-profile matching are present; model command/edit auto-approval environment flags are not honored by the gateway worker profile;
- task-state JSON persistence is now same-directory temp-file + atomic rename so active MCP polling cannot observe a half-written task document.

### Unit 4 tests

- fake Hub runtime + temporary Git workspace proves Safety Preview -> token start -> Hub-mode execution -> completed status without a live Hub/Ollama connection;
- public task/event/diff results exclude raw workspace path, fake Hub session ID and worker output;
- continuation executes within the existing approved envelope;
- escalation approval preserves the old scope and requires a new preview;
- rollback rejects a mismatched checkpoint ID and task-ID traversal is rejected before storage lookup;
- exact MCP tool list and read/write/destructive annotations are asserted;
- forbidden generic shell/filesystem/Hub/daemon tool names and raw-authority schema fields are absent;
- configuration rejects non-loopback binding, weak bearer secrets and non-HTTPS tunnel metadata;
- ephemeral loopback HTTP proof asserts unauthenticated `401`, wrong-path `404`, and authenticated modern MCP `tools/list` success;
- modern MCP test requests carry the required current protocol metadata/method header rather than weakening server validation;
- active status polling remains valid across concurrent task saves after atomic persistence correction;
- all existing lifecycle, Git safety, validation, context/recovery, memory and Unit 1–3 tests remain green.

### Unit 4 evidence

- Machine orchestration service: `425b1a58aba2571d09912d8fec27ad61d5bcc0cc`.
- MCP v2 task-level gateway: `8b87fc9357db891c575c4d684c0448a21067985b`.
- Production MCP entrypoint: `d5b96b999e19256f74c6fbd8a6c3dfaf1c77254d`.
- MCP v2 dependencies/scripts: `8eb7bb9cd5587e6706ddcab47bfa28df2700cc1b`.
- Machine-service tests and MCP surface/auth tests: implementation sequence through `dd02a30db403156d9949a718d4e0adef0c717d83`.
- Modern MCP test-client correction: `437d754b84ff2c1a689b4d67a5ed75bb64b0b452`.
- Atomic task-state persistence prerequisite fix: `ee47237d6ca7e1571f064923c909fdfe9bc07e65`.
- Initial Unit 4 CI exposed two test-client `400` responses because the hand-written client omitted required modern MCP request metadata; this was corrected without adding a production compatibility bypass.
- The next CI exposed a real active-polling race in direct task JSON overwrite (`Unexpected end of JSON input`); task saves were changed to atomic replacement rather than masking the defect with read retries.
- Accepted implementation CI: push `#351` / `35726113138`, success; PR `#352` / `35726117694`, success. Typecheck and all 115 tests passed.
- No live Cline Hub, VS Code, Ollama, shared workspace, public tunnel, deployment target, push, or external-system runtime mutation was performed.

## Milestone 5 Status

**IN PROGRESS — technical spike and implementation Units 1–4 complete; only the explicitly authorized isolated shared-runtime proof remains.**

---

# Milestone 6 — GPT Supervisor

## Acceptance Criteria

- [ ] Supervisor task schema and bounded implementation instructions.
- [ ] Planner produces acceptance criteria and validation commands.
- [ ] Reviewer consumes diff + validation + task evidence and can request bounded repairs.
- [ ] Reviewer cannot bypass safety gates.
- [ ] Durable supervisor decisions and human escalation state.

## Status

**NOT STARTED**

---

# Milestone 7 — Unattended Execution

## Acceptance Criteria

- [ ] Task queue/DAG, dependencies, and automatic progression.
- [ ] Time/token/request/repair budgets and checkpoint policy.
- [ ] `waiting_for_human` state and escalation rules.
- [ ] Final unattended-run report and safe resume after interruption.

## Status

**NOT STARTED**

---

# Milestone 8 — Advanced UI / Multi-worker

## Possible Scope

- [ ] Rich VS Code orchestration panel/web dashboard beyond Milestone 5 plugin UX.
- [ ] Advanced MCP surfaces beyond the bounded task-level gateway.
- [ ] Sequential specialist roles/multiple workers when capacity permits.
- [ ] Team-role handoffs and richer task/event/usage visualization.

## Status

**NOT STARTED**

---

# Current Capability Snapshot

| Capability | Status |
|---|---|
| Foundation lifecycle | Complete / proven |
| Provider metadata preflight | Implemented + cloud tested |
| Git checkpoint + rollback | Implemented + tested |
| Validation + bounded repair | Implemented + tested |
| Final diff safety + completion gate | Implemented + cloud tested |
| Context supervisor + durable handoff/recovery | Complete / proven |
| Durable project memory + selective retrieval/audit | Complete / proven |
| Hub discovery/auth/package/session research | Documented + cloud tested |
| ChatGPT plugin UX/safety contract | Documented + cloud tested |
| Machine-local workspace registry | Implemented + cloud tested |
| Safety Preview + single-use plan-token boundary | Implemented + cloud tested |
| Durable approved-task safety binding | Implemented + cloud tested |
| Pre-execution policy + durable escalation | Implemented + cloud tested |
| Local safe executor boundary | Implemented + cloud tested |
| Hub-backed `ClineCore` runtime factory seam | Implemented + cloud tested |
| Hub owner `beforeTool` contribution wiring | Implemented + fake-Hub/cloud tested |
| Hub owner read/search/editor/apply-patch executors | Implemented + fake-Hub/cloud tested |
| Restricted first-pilot Hub worker/runtime surfaces | Implemented + cloud tested |
| Hub resume workspace identity validation | Implemented + fake-Hub/cloud tested |
| Hub session-loss durable recovery | Implemented + fake-Hub/cloud tested |
| Machine-level task-oriented MCP/plugin gateway | **Implemented + cloud tested** |
| Loopback MCP bearer/Host/Origin boundary | **Implemented + cloud tested** |
| Sanitized MCP task/event/diff views | **Implemented + cloud tested** |
| Atomic task-state persistence for active polling | **Implemented + cloud tested** |
| Live shared VS Code/Hub write proof | **Not yet authorized / pending** |
| GPT supervisor | Not started |
| Unattended task DAG | Not started |

---

# Known Constraints and Risks

1. Shared Ollama/runtime state is protected; no automated mutation without explicit authorization.
2. Context rotation must never use cumulative token totals as its trigger.
3. Semantic recovery cannot restore hidden model state; durable workspace/project/handoff evidence is authoritative.
4. Hub work must stay pinned to the verified `0.0.83` public SDK surface unless a deliberate dependency decision is recorded.
5. Dirty worktrees must retain pre-run user state and distinguish it from task-created changes.
6. Validation commands are trusted local configuration and remain explicit/bounded outside model execution.
7. Event/state persistence remains lightweight JSON/JSONL. Task JSON replacement is atomic; event JSONL append remains the existing durability model.
8. Hub discovery/auth credentials are runtime secrets and must not enter tasks, project memory, handoffs, logs, Git, or ChatGPT/MCP output.
9. MCP bearer/tunnel credentials are also machine-local runtime secrets and must not enter repository/project memory, handoffs or MCP results.
10. Authorization comes only from the machine-local registry and approved task envelope, never from raw paths, fuzzy names, repository instructions, or Hub participation.
11. Attaching to a Hub session does not transfer client-local capability ownership.
12. Native Hub approval is UX/defense-in-depth only; the orchestrator hook/executor boundary is authoritative.
13. Owner disconnect cancels creator-targeted live capabilities; recovery must use durable handoff/replacement ownership.
14. Arbitrary model shell, ungoverned network/MCP/plugin execution, subagents/teams, and unreviewed provider-owned execution remain disabled in the first pilot.
15. Safety Preview matching is not the filesystem gate; Unit 2/3 executor enforcement remains authoritative immediately before side effects.
16. Unit 3/4 prove the local/Hub/MCP contract using pinned-source analysis, fake/mock Hub behavior and ephemeral loopback protocol tests. Actual shared Hub/VS Code visibility, real owner disconnect, and live enforcement remain intentionally unproven until the explicitly authorized disposable-workspace proof.
17. The MCP listener is intentionally loopback-only; remote ChatGPT connectivity requires a separately managed secure tunnel and must not weaken the local bearer/task authority boundary.

---

# Immediate Work Queue

Only work on the first unfinished item unless a prerequisite defect is discovered.

1. **COMPLETE — machine-local registry + Safety Preview / plan-token boundary.**
2. **COMPLETE — pre-execution policy + local safe executor boundary.**
3. **COMPLETE — Hub-backed Cline runtime adapter/factory + owner-targeted safety wiring (mock/fake Hub proof).**
4. **COMPLETE — machine-level ChatGPT MCP/plugin gateway.**
   - opaque registered-ID discovery/status/task/diff surface;
   - read-only Safety Preview + plan-token-only start;
   - immutable-envelope continuation, abort, escalation decisions and checkpoint-bound rollback;
   - no raw path/shell/Hub/credential/daemon authority;
   - loopback bearer/Host/Origin HTTP boundary;
   - fake-Hub + modern MCP + active-polling cloud tests.
5. **WAITING FOR EXPLICIT USER AUTHORIZATION — isolated shared-runtime proof.**
   - use a disposable registered workspace only;
   - prove VS Code/Hub visibility, allowed edit, out-of-scope escalation, secret denial, shell unavailable, owner/policy loss fail-closed, external validation/diff safety and rollback;
   - do not stop/restart/pre-warm/switch Ollama or mutate unrelated shared VS Code/Cline sessions;
   - do not begin this proof from an implicit “continue”; obtain explicit authorization for the live shared-runtime test window.

---

# Progress Log — Key Closures

- 2026-09-21: Milestone 2 diff-safety closure — `56cecab14bf5719601d6801b5635a5b2ef2d0336`, CI `#174` / `35574026345`.
- 2026-09-21: Milestone 3 context durability closed through `7fa6abebbc00b801349d321a98efd626795e2d1f`, CI `#194` / `35578149506`.
- 2026-09-21: Milestone 4 durable project memory closed — `8cdb3b9da1b0de97d5d654636fab12992f4176e8`, CI `#260` / `35604869492`.
- 2026-09-22: Milestone 5 technical spike/migration design closed — `d51a85585c831b24da9cd7129d34d74488ec2750`, CI `#282` / `35668708848`.
- 2026-09-22: Unit 1 registry/Safety Preview boundary closed through `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`, CI `#295` / `35679414455`.
- 2026-09-22: Unit 2 local pre-execution boundary closed through `46da20d18cd703018c54207258d4fb2422e71eeb`, CI push `#311` / `35699517817`, PR `#312` / `35699521432`.
- 2026-09-22: Unit 3 Hub runtime/safety wiring implemented through `32c057d30bc70533233477e87f7e01ec09b2e04a`; accepted CI push `#329` / `35723407897` and PR `#330` / `35723411583`, both success. No live shared runtime was touched.
- 2026-09-22: Unit 4 machine MCP/plugin gateway implemented through `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; accepted CI push `#351` / `35726113138` and PR `#352` / `35726117694`, both success with typecheck + 115 tests. The implementation added task-level MCP authority, loopback bearer/Host/Origin protection, sanitized result views, immutable-envelope continuation/escalation/rollback semantics, and atomic task-state persistence for concurrent polling. No live shared runtime was touched.

---

# Current Next Step

**Milestone 5 Unit 5 is blocked on explicit user authorization.** The next implementation action is the isolated live shared-runtime proof in a disposable registered workspace. Do not start live Cline Hub/VS Code/Ollama/shared-runtime writes until the user explicitly authorizes that test window.

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
