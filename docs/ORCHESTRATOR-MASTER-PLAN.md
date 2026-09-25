# Cline Orchestrator — Master Plan and Progress Tracker

Last updated: 2026-09-25
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

1. **Finish milestones in order unless an explicit user decision defers a non-destructive proof step.** Work only on the first unfinished implementation item unless a prerequisite defect is discovered. A deferred live proof remains pending and must be returned to before final project closure.
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

Let the user invoke the orchestrator from ChatGPT while machine authority stays local. Registered project/workspace IDs and Safety Plans bind each write task. The orchestrator creates/controls a safety-bounded Cline Hub session that VS Code may observe without weakening task policy.

## Confirmed Technical Spike

Pinned Cline generation: `@cline/sdk 0.0.83`.

Documented/proven design:

- managed Hub discovery owns the local auth token; the orchestrator consumes Cline discovery and does not persist a second Hub credential;
- when an explicit Hub endpoint/port is used, the resolved endpoint and auth token are passed ephemerally in memory to `ClineCore.create`; neither token nor endpoint credential material is persisted in task/project state;
- `@cline/sdk` is sufficient for the first Hub path;
- `ClineCore` preserves the start/send/abort/subscribe programming model over Hub;
- Hub client hooks and tool executors are creator/client-targeted; wrong-client capability responses are rejected by the pinned Hub implementation;
- native Hub `approval.requested` is broader/broadcast and therefore is not the authorization boundary;
- new ChatGPT write sessions are orchestrator-owned; existing VS Code-created sessions remain observational in the first pilot;
- owner/client loss uses durable handoff and a replacement owner session rather than assuming attach transfers ownership.

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
- [x] Cloud tests cover registry/plan replay/staleness, path safety, patch all-or-nothing behavior, disabled surfaces, Hub contribution wiring/failure boundaries, workspace identity, Hub `session_not_found` recovery, MCP authority boundaries/authentication, active-task polling, gateway-restart owner recovery, and existing lifecycle safety regressions.
- [x] Explicitly authorized isolated runtime proof on disposable registered workspaces demonstrates shared VS Code visibility, allowed edit, blocked out-of-scope edit, secret denial, unavailable model shell, owner loss/replacement ownership, validation/diff safety, and rollback without mutating shared Ollama. The final owner-loss run physically demonstrated first-owner interruption, durable replacement generation 2, recovered completion, validation, diff safety, and successful orchestrator rollback. A final raw byte-comparison assertion was a proof-harness false negative caused by Windows `core.autocrlf`; production rollback had already verified the checkpoint fingerprint and returned `rolled_back`. The disposable repository is now pinned to `core.autocrlf=false`, with cloud-green regression coverage, so no further heavy local 27B rerun is required for Milestone 5 closure.

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

**COMPLETE — fake-Hub/cloud proof plus live normal-path tool-enforcement proof.**

Implemented:

- `ClineRuntime` / `ClineRuntimeFactory` seam while preserving `ClineRunner` as lifecycle owner;
- SDK factory uses local mode for existing daemon behavior and Hub mode only when explicitly selected;
- Hub creation uses `backendMode: "hub"` + `strategy: "require-hub"` with registered workspace root/cwd;
- explicit Hub discovery passes the returned endpoint/auth token only in memory to the runtime factory, fixing pinned Core's explicit-endpoint token-recovery gap without persisting a second credential;
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

**COMPLETE — cloud/fake-runtime and physical disposable-runtime acceptance complete.**

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
- task-state JSON persistence is same-directory temp-file + atomic rename; Windows transient destination contention is retried in a bounded fail-closed loop without delete-before-rename fallback;
- gateway startup scans durable interrupted tasks: current safety binding and checkpoint-relative diff are revalidated before execution, a stale Hub owner session is deliberately discarded so existing ClineRunner missing-session recovery creates a durable handoff and replacement owner session, and unsupported/stale recovery states close fail-safe instead of remaining stranded.

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
- Windows atomic-write regression tests cover retry-to-success for transient `EPERM`/`EACCES`/`EBUSY` rename contention and exhaustion with temp cleanup;
- gateway-restart tests prove a persisted `running` task uses a replacement Hub owner through durable missing-session handoff while preserving its original rollback checkpoint;
- gateway-restart tests prove stale safety-profile authority is not re-executed and interrupted validation closes fail-safe rather than inventing model authority;
- all existing lifecycle, Git safety, validation, context/recovery, memory and Unit 1–3 tests remain green;
- direct-entry regression tests cover valid Windows `file:///C:/...` URLs, encoded Windows paths with spaces, mismatched modules, and POSIX entry paths;
- pinned Hub daemon compatibility tests cover both observed `0.0.83` bundled launcher paths, case-insensitive path equivalence, unreviewed-version denial, and unexpected-daemon-layout denial;
- explicit Hub auth-handoff tests verify endpoint/token delivery is in-memory only and missing auth fails closed;
- disposable live-proof repository tests now pin `core.autocrlf=false` so byte-exact rollback assertions are independent of the operator's global Windows Git checkout policy.

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
- Accepted Unit 4 implementation CI: push `#351` / `35726113138`, success; PR `#352` / `35726117694`, success. Typecheck and all 115 tests passed.
- 2026-09-22 authorized disposable Windows physical proof exposed a prerequisite production-entrypoint defect: `npm run mcp` launched `tsx src/mcp-main.ts` but emitted no listener banner and port `4318` had no listener. Root cause was manual `file://` construction producing Windows-incompatible entrypoint comparison semantics.
- Windows-safe direct-entry fix: `b56a34d0605ff29fe3a7a1b5fdeb4c6b64b8c663`; regression tests: `0f3741eb3c231696bb2cf909be3b948a71125005`; accepted CI push `#365` / `35739170423` and PR `#366` / `35739177913`, both success with typecheck + full tests.
- After pulling that fix, physical proof verified the listener on `127.0.0.1:4318`, unauthenticated `401`, authenticated MCP tool discovery, sanitized registered workspace discovery, and a clean read-only Safety Preview restricted to `src/demo.ts` with `.env*`, `outside.txt`, and `.git/**` protected.
- First approved physical task `bb99de9c-e3be-4b80-b62a-34a9fa26d2c5` persisted correctly but failed with `gateway_execution_failed` / `No compatible hub runtime is available.` at `runCount: 0`; validation never ran and no workspace mutation occurred.
- The Hub daemon log showed Node trying to execute `node_modules/@cline/core/dist/entry.js`, while installed `@cline/core 0.0.83` publishes the daemon at `dist/hub/daemon/entry.js`. Pinned upstream TypeScript source confirmed the bundling-relative `import.meta.url` defect.
- Version-gated compatibility implementation through `7fb9d3c2c394aab1f038208854cae7a3f2b77cc9` validates the exact package/export layout, creates only the missing compatibility entry, fails closed on version/layout drift, and leaves Cline's own Hub discovery/locking/retirement logic authoritative. Accepted implementation CI: push `#379` / `35744890378` and PR `#380` / `35744899199`, both success.
- The resumed physical proof exposed transient Windows task-state rename contention after a Cline run. Bounded Windows-only retry fix `670d27d077d6b45ce1dfe9204510405b530385cf` passed push CI `#383` / `35832372884` and PR CI `#384` / `35832377010`; no non-atomic delete-before-rename fallback was introduced.
- Live allowed-edit task `3c051272-dc49-4005-8fca-3f89e08cc9ab` was visible in Stable Cline, changed only `src/demo.ts` from `value = 1` to `value = 2`, passed `git diff --check` and final diff safety (1 changed path, 0 warnings/failures), and was restored to the clean tracked baseline via checkpoint rollback.
- Secret-read task `5a77a746-fef0-4361-93a2-81dd7a5be2d5` physically returned `Access to secret or credential paths is denied` from the read tool, completed with zero changed paths, and did not expose the secret.
- Shell-capability task `07ab9762-6de4-4ac8-a8c4-df63e64396a5` physically reported that no terminal/command execution tool was available; the model only inferred the expected echo text. Validation and diff safety passed with zero changed paths.
- Protected-path task `040c8abd-cdcf-4e8c-938c-a1c8c760100d` attempted both read and editor write on `outside.txt`; both tool calls returned `Access to protected paths is denied`. Validation and diff safety passed with zero changed paths.
- Reviewing the final owner-loss proof exposed a restart gap: persisted active tasks were not reconciled by a new `MachineOrchestratorService`, while `continue_task` correctly refused already-active statuses. Restart-reconciliation prerequisite fix `8b6bc285e7a79a88576babcd62716cf09d2bff97` revalidates safety/diff evidence, forces the existing durable missing-session path to create replacement Hub ownership for recoverable work, and fails closed on stale/unsupported recovery states. Push CI `#385` / `35840142043` and PR CI `#386` / `35840147771` both passed install, typecheck and the full test suite.
- Diagnostic owner-loss harness: `f3b39a1e5f485a770ca87574da6747ff72eadecc` + command `fb591f66bfa6b19255303c8bc9abbd69f6649997`; CI `#416` / `35993678361`, success.
- Live diagnostic evidence showed the isolated Hub daemon remained alive while a later runtime connection failed. Root cause was pinned Core's explicit-endpoint behavior: with `CLINE_HUB_PORT` set, the detached Hub resolver returned `{url, authToken}` but did not register that token in the managed in-process recovery cache, while the orchestrator created `ClineCore` without explicitly passing the token.
- Auth-preserving runtime fix uses the public `@cline/core/hub` namespace at runtime, resolves the exact detached endpoint/auth token, validates both values, and passes them only in memory to `ClineCore.create`; final implementation `99ff5d0ffccda2f531aadd0c95abf19314f89138`, runtime-export smoke test `182705ab6540fa4e339b304679cd150d7aacc8e8`; CI `#426` / `36071434059`, success.
- That public Hub subpath exposed the second pinned `0.0.83` bundled launcher defect (`dist/hub/entry.js`). Dual version/layout-gated shim implementation `318919d42c2085207e228574bda272bd4d2b152a` and tests `e73e02e3fb7808f37df07241e5ab1309892f6b9a` cover both `dist/entry.js` and `dist/hub/entry.js`; accepted CI `#430`, success.
- Owner-loss physical run after those fixes: first owner reached `running`, `runCount=1`, `sessionGeneration=1`, usable checkpoint; the proof terminated only that isolated owner child. Restart reconciliation then created durable handoff and replacement session generation 2, and the recovered owner completed the bounded edit. An initial 180-second harness timeout was a false negative because the local 27B recovered run took about 206 seconds; timeout alignment commit `3603b530153d8da2ed0d38dfefa4d4a225eac3af` passed CI `#434` / `36073454818`.
- Final physical owner-loss run at `3603b53` again reached generation 2 and then completed the recovered task in about 95 seconds with configured validation and checkpoint-relative diff safety passing. `rollbackTask` returned `rolled_back`; the only remaining proof assertion compared raw file text and saw Windows CRLF after `git reset --hard` versus the LF bytes written before the baseline commit. This was a harness artifact, not a production rollback failure: rollback had already self-verified that the restored Git fingerprint matched the checkpoint's pre-run fingerprint.
- Disposable proof isolation now sets local `core.autocrlf=false` before the baseline commit so future byte-exact assertions are independent of operator Git configuration: implementation `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d`, regression test `c1c714457b9930b8a10d3321d2e0972cbdca78f3`; CI `#438` / `36082887715`, success.
- Because the last physical run already exercised owner interruption, durable replacement ownership, recovered completion, validation, diff safety and rollback, and because the only final mismatch was proven to be proof-repository line-ending policy, no additional heavy local 27B rerun is required. The user also reported that the repeated proof was hanging the computer, so Milestone 5 closes on the accumulated physical + cloud evidence rather than creating avoidable local resource risk.

## Milestone 5 Status

**COMPLETE — Units 1–4, cloud/fake-runtime coverage, and disposable physical acceptance are complete. Physical proof demonstrated gateway/auth/discovery, shared VS Code/Hub visibility, allowed editing, external validation/diff safety, rollback, secret denial, unavailable model shell, protected-path read/write denial, owner loss, durable handoff, replacement owner/session recovery, and preserved safety/checkpoint authority without changing shared Ollama.**

---

# Milestone 6 — GPT Supervisor

## Acceptance Criteria

- [x] Supervisor task schema and bounded implementation instructions.
- [x] Planner produces acceptance criteria and validation commands.
- [ ] Reviewer consumes diff + validation + task evidence and can request bounded repairs.
- [ ] Reviewer cannot bypass safety gates.
- [ ] Durable supervisor decisions and human escalation state.

## Slice 1 — Supervisor Task Contract + Bounded Implementation Instructions

**COMPLETE — schema/instruction contract only; no planner/reviewer execution yet.**

Implemented:

- versioned `SupervisorTaskV1` contract bound to an already-approved durable orchestrator task;
- supervisor identity and task/project/workspace/Safety Plan/profile references are opaque IDs only;
- the caller cannot supply or override raw workspace paths, Hub/session identity, worker identity, policy, approved scope or trusted validation commands;
- objective, acceptance criteria, validation command evidence and path-pattern lists have explicit count/length bounds;
- approved path patterns must remain workspace-relative and reject absolute/traversal forms;
- missing or malformed durable Safety Plan authority fails closed as `task_not_approved`;
- the supervisor packet deliberately omits canonical workspace root, Cline/Hub session IDs, worker output and other runtime-private task fields;
- generated implementation instructions repeat the approved write/protected scope and explicitly state that repository/task/model/tool text cannot grant authority;
- model shell, arbitrary commands, network, MCP, plugins, subagents and agent teams are explicitly forbidden in the implementation packet;
- trusted validation commands are rendered as external-validator configuration/evidence, never as model shell permission;
- scope expansion requires stop + durable human escalation;
- model completion remains advisory; orchestrator validation and checkpoint-relative diff safety remain required;
- oversized rendered instruction packets fail closed instead of silently truncating safety context.

Evidence:

- Supervisor task contract: `76d737c6083830e62eac8171e797df9c96ac4291`.
- Contract tests: `b3aed68158c3f12cd11d67bab97c37e045842ac5`.
- Error-classification correction: `d8a064aa0ec6328c69c390e577fb4637af7509f9`.
- Initial CI passed typecheck and 119/120 tests; the only failing assertion showed missing `projectId` was correctly denied but classified `schema_invalid` rather than `task_not_approved`. Classification was corrected without changing the deny behavior.
- Accepted implementation CI: push `#359` / `35729389950`, success; PR `#360` / `35729394317`, success. Typecheck and all 120 tests passed.
- No live Hub, VS Code, Ollama, shared workspace, MCP deployment or external-system mutation was performed.

## Slice 2 — Bounded Planner Proposal + Execution Seam

**COMPLETE — planner proposals are bounded/untrusted data; validation command admission remains outside planner authority.**

Implemented:

- versioned `SupervisorPlannerProposalV1` returns only the bound supervisor/orchestrator task IDs, acceptance criteria, proposed validation commands, and `validationAuthority: "proposal_only"`;
- planner prompt contains bounded objective, existing acceptance/validation evidence, approved write scope and protected-path context but omits canonical workspace path, Hub/session identity, worker output, credentials and runtime-private state;
- planner is explicitly forbidden from widening scope, changing worker/policy/Safety Plan identity, granting shell/network/MCP/plugin/subagent/team authority, or declaring implementation complete;
- proposed validation commands are model output data only and do not enter trusted `task.validationCommands` automatically;
- output validation rejects extra fields rather than ignoring them, so scope, policy, shell, completion or worker overrides cannot be smuggled into the proposal;
- proposal IDs must match the immutable supervisor/orchestrator task binding;
- acceptance criteria and proposed validation commands have explicit item/count/length bounds;
- `runSupervisorPlanner()` executes exactly one planner turn through an injected model adapter, then validates the untrusted result locally before returning it;
- the planner adapter receives no workspace handle, tool executor, shell, filesystem mutation primitive or authority-changing API;
- provider/model failures and malformed/authority-bearing planner output fail closed;
- implementation and tests are cloud-only; no live Hub, Cline, Ollama or shared workspace mutation is required.

Evidence:

- Bounded planner contract: `04cb34ffb8a813e1a55338000b99d9a8dc173d50`.
- Planner contract/authority tests: `10a5770b000fe9c250a8c0689bc4f43de1ec5ab3`; CI `#444` / `36097961631`, success.
- Planner execution seam: `9f7829caeb6324d38613b92cb5a1d6293db27084`.
- Execution/fail-closed tests: `5f83903b61494c458474d2ab3f2402101170a0c4`; CI `#448` / `36098312588`, success.

## Status

**IN PROGRESS — Slices 1–2 complete; Slice 3 Reviewer is the first unfinished implementation item.**

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
| Git checkpoint + rollback | Implemented + tested + physically proven |
| Validation + bounded repair | Implemented + tested |
| Final diff safety + completion gate | Implemented + cloud tested + physically proven |
| Context supervisor + durable handoff/recovery | Complete / proven |
| Durable project memory + selective retrieval/audit | Complete / proven |
| Hub discovery/auth/package/session research | Documented + cloud tested |
| ChatGPT plugin UX/safety contract | Documented + cloud tested |
| Machine-local workspace registry | Implemented + cloud tested + physically proven |
| Safety Preview + single-use plan-token boundary | Implemented + cloud tested + physically proven |
| Durable approved-task safety binding | Implemented + cloud tested + physically proven |
| Pre-execution policy + durable escalation | Implemented + cloud tested |
| Local safe executor boundary | Implemented + cloud tested + physically proven for secret/protected paths |
| Hub-backed `ClineCore` runtime factory seam | Implemented + cloud tested + physically proven |
| Hub owner `beforeTool` contribution wiring | Implemented + fake-Hub/cloud tested + physically proven |
| Hub owner read/search/editor/apply-patch executors | Implemented + fake-Hub/cloud tested + physically proven |
| Restricted first-pilot Hub worker/runtime surfaces | Implemented + cloud tested + shell unavailability physically proven |
| Hub resume workspace identity validation | Implemented + fake-Hub/cloud tested |
| Hub session-loss durable recovery | Implemented + fake-Hub/cloud tested |
| Gateway restart owner reconciliation | **Implemented + cloud tested + physically proven through replacement generation 2** |
| Machine-level task-oriented MCP/plugin gateway | Implemented + cloud tested + physically proven |
| Loopback MCP bearer/Host/Origin boundary | Implemented + cloud tested + physically proven |
| Sanitized MCP task/event/diff views | Implemented + cloud tested + physically observed |
| Atomic task-state persistence for active polling | Implemented + cloud tested; Windows contention retry fixed |
| Windows MCP direct-entry startup | **Fixed + physically verified + cloud regression tested** |
| Pinned Cline Hub daemon published-entry compatibility | **Fixed for both observed bundle paths + physically verified + cloud regression tested** |
| Live shared VS Code/Hub write proof | **Physically proven including owner-loss/replacement-owner recovery** |
| Supervisor task schema + bounded implementation instructions | **Implemented + cloud tested** |
| Supervisor planner | **Implemented + cloud tested; proposals remain non-authoritative** |
| Supervisor reviewer | Next |
| Orchestrator Sentinel reactive incident tracking | Planned; GitHub issue #2 |
| Unattended task DAG | Not started |

---

# Known Constraints and Risks

1. Shared Ollama/runtime state is protected; no automated mutation without explicit authorization.
2. Context rotation must never use cumulative token totals as its trigger.
3. Semantic recovery cannot restore hidden model state; durable workspace/project/handoff evidence is authoritative.
4. Hub work must stay pinned to the verified `0.0.83` public SDK surface unless a deliberate dependency decision is recorded.
5. Dirty worktrees must retain pre-run user state and distinguish it from task-created changes.
6. Validation commands are trusted local configuration and remain explicit/bounded outside model execution. Supervisor packets may expose them as evidence/configuration, but that never grants model shell authority.
7. Event/state persistence remains lightweight JSON/JSONL. Task JSON replacement is atomic; event JSONL append remains the existing durability model.
8. Hub discovery/auth credentials are runtime secrets and must not enter tasks, project memory, handoffs, logs, Git, or ChatGPT/MCP output.
9. MCP bearer/tunnel credentials are also machine-local runtime secrets and must not enter repository/project memory, handoffs or MCP results.
10. Authorization comes only from the machine-local registry and approved task envelope, never from raw paths, fuzzy names, repository instructions, supervisor prose, model output, or Hub participation.
11. Attaching to a Hub session does not transfer client-local capability ownership.
12. Native Hub approval is UX/defense-in-depth only; the orchestrator hook/executor boundary is authoritative.
13. Owner disconnect cancels creator-targeted live capabilities; gateway restart reconciliation must discard stale owner identity and use durable handoff/replacement ownership, or fail closed.
14. Arbitrary model shell, ungoverned network/MCP/plugin execution, subagents/teams, and unreviewed provider-owned execution remain disabled in the first pilot.
15. Safety Preview matching is not the filesystem gate; Unit 2/3 executor enforcement remains authoritative immediately before side effects.
16. Unit 3/4 contracts have cloud/fake-Hub coverage plus live disposable proof for the normal Hub path, owner tool enforcement, validation/diff safety, rollback, and owner-loss replacement-session recovery.
17. The MCP listener is intentionally loopback-only; remote ChatGPT connectivity requires a separately managed secure tunnel and must not weaken the local bearer/task authority boundary.
18. The Milestone 6 supervisor contract is an instruction/evidence envelope only. It cannot grant scope, execute validation commands, bypass Unit 2/3 policy, or convert repository/model prose into authority.
19. Pinned `@cline/core 0.0.83` has published Hub-daemon entry resolution defects in both the root and public Hub subpath bundles. The orchestrator compatibility shim is deliberately version- and layout-gated, writes only the missing installed-package entries, and must fail closed for any future Core version/layout until that dependency change is explicitly reviewed.
20. Windows can transiently deny atomic replacement when polling/indexing/AV holds a task-state destination. The state writer retries only transient Windows `EPERM`/`EACCES`/`EBUSY` within a strict bound and otherwise fails closed; it never deletes the destination to force replacement.
21. Restart reconciliation deliberately auto-recovers only states where the existing execution boundary can be reconstructed safely. Stale authority, unsafe current diff, unusable checkpoint, stalled execution, and interrupted validation close fail-safe rather than inventing authority or silently changing lifecycle semantics.
22. Disposable Windows physical proofs must isolate Git checkout policy (`core.autocrlf=false`) when byte-exact assertions are required; production rollback authority remains fingerprint-based.
23. The local 27B model can consume substantial CPU/GPU/context resources during repeated physical proof loops. Once a safety property has been physically demonstrated and the remaining discrepancy is isolated to the harness with cloud regression coverage, do not repeat expensive local inference solely to reproduce the same evidence.
24. Planner-generated validation commands remain untrusted proposals. They must never become executable validation configuration merely because the planner emitted them; a later trusted admission/decision step must remain explicit and bounded.
25. The future Orchestrator Sentinel is observational/reactive, not a second autonomous controller. It may capture/deduplicate incidents and fail closed, but it must not restart/kill Ollama or Cline, mutate shared VS Code/Hub state, widen Safety Plans, alter worker/policy identity, grant disabled capabilities, or modify user code automatically.

---

# Immediate Work Queue

Only work on the first unfinished implementation item unless a prerequisite defect is discovered.

1. **COMPLETE — machine-local registry + Safety Preview / plan-token boundary.**
2. **COMPLETE — pre-execution policy + local safe executor boundary.**
3. **COMPLETE — Hub-backed Cline runtime adapter/factory + owner-targeted safety wiring.**
4. **COMPLETE — machine-level ChatGPT MCP/plugin gateway.**
5. **COMPLETE — isolated shared-runtime physical acceptance.**
   - gateway/auth/discovery and Stable Cline visibility proven;
   - allowed write, external `git diff --check`, final diff safety and checkpoint rollback proven;
   - secret denial, model-shell unavailability and protected-path read/write denial proven;
   - Windows direct-entry, pinned Hub package compatibility, explicit-endpoint auth handoff and atomic-state persistence prerequisites fixed and cloud-regression tested;
   - owner-loss run physically proved first-owner interruption, durable handoff, replacement session generation 2, recovered completion, validation/diff safety and rollback;
   - final raw byte mismatch was traced to Windows `core.autocrlf`, while production rollback had already verified the pre-run checkpoint fingerprint and returned `rolled_back`; proof repository checkout policy is now isolated and CI-green;
   - no further heavy local 27B rerun is required; shared Ollama and unrelated Cline/VS Code sessions remain untouched.
6. **COMPLETE — Milestone 6 Slice 1: supervisor task schema + bounded implementation instructions.**
7. **COMPLETE — Milestone 6 Slice 2: bounded Planner proposal + execution seam.**
   - output contains only bound task IDs, bounded acceptance criteria and proposal-only validation commands;
   - extra authority-bearing fields are rejected rather than ignored;
   - planner cannot widen paths, change worker/policy identity, grant shell/network/MCP/plugin authority, or mark the task complete;
   - planner model receives no mutation/tool authority; cloud CI `#448` is green.
8. **NEXT — Milestone 6 Slice 3: Reviewer consumes diff + validation + task evidence and can request bounded repairs.**
   - reviewer input must be sanitized evidence, not raw machine authority;
   - reviewer may return pass / bounded-repair-request / human-escalation recommendation only;
   - repair requests must remain inside the existing approved scope and cannot alter trusted validation/policy/worker identity;
   - reviewer cannot mark a task complete independently of orchestrator validation/diff-safety gates;
   - add cloud tests first; no live shared-runtime writes.
9. **TRACKED FUTURE — Orchestrator Sentinel reactive incident tracking (GitHub issue #2).**
   - add after core Planner/Reviewer supervision or at the start of Milestone 7;
   - persist bounded/redacted incident evidence, deduplicate repeats, expose sanitized status, and fail closed when authority/recovery is uncertain;
   - never become an automatic process/runtime restart or code-mutation authority.

---

# Progress Log — Key Closures

- 2026-09-21: Milestone 2 diff-safety closure — `56cecab14bf5719601d6801b5635a5b2ef2d0336`, CI `#174` / `35574026345`.
- 2026-09-21: Milestone 3 context durability closed through `7fa6abebbc00b801349d321a98efd626795e2d1f`, CI `#194` / `35578149506`.
- 2026-09-21: Milestone 4 durable project memory closed — `8cdb3b9da1b0de97d5d654636fab12992f4176e8`, CI `#260` / `35604869492`.
- 2026-09-22: Milestone 5 technical spike/migration design closed — `d51a85585c831b24da9cd7129d34d74488ec2750`, CI `#282` / `35668708848`.
- 2026-09-22: Unit 1 registry/Safety Preview boundary closed through `5406bc05b2d35f3f9b6f565fb4c93b13c839ca06`, CI `#295` / `35679414455`.
- 2026-09-22: Unit 2 local pre-execution boundary closed through `46da20d18cd703018c54207258d4fb2422e71eeb`, CI push `#311` / `35699517817`, PR `#312` / `35699521432`.
- 2026-09-22: Unit 3 Hub runtime/safety wiring implemented through `32c057d30bc70533233477e87f7e01ec09b2e04a`; accepted CI push `#329` / `35723407897` and PR `#330` / `35723411583`, both success. No live shared runtime was touched.
- 2026-09-22: Unit 4 machine MCP/plugin gateway implemented through `ee47237d6ca7e1571f064923c909fdfe9bc07e65`; accepted CI push `#351` / `35726113138` and PR `#352` / `35726117694`, both success with typecheck + 115 tests.
- 2026-09-22: Milestone 6 Slice 1 supervisor task contract implemented through `d8a064aa0ec6328c69c390e577fb4637af7509f9`; accepted CI push `#359` / `35729389950` and PR `#360` / `35729394317`, both success with typecheck + 120 tests.
- 2026-09-22: User explicitly resumed the Milestone 5 physical proof using disposable workspace `orchestrator-live-proof-01`. Windows direct-entry defect was fixed through `0f3741eb3c231696bb2cf909be3b948a71125005`; CI push `#365` / `35739170423`, PR `#366` / `35739177913`.
- 2026-09-22: Physical proof then exposed pinned Core `0.0.83` Hub daemon packaging. Version/layout-gated compatibility implementation through `7fb9d3c2c394aab1f038208854cae7a3f2b77cc9` passed push CI `#379` / `35744890378` and PR CI `#380` / `35744899199`.
- 2026-09-23: Live compatibility re-proof succeeded: task `3c051272-dc49-4005-8fca-3f89e08cc9ab` was visible in Stable Cline, edited only `src/demo.ts`, passed external validation and final diff safety, and checkpoint rollback restored the tracked baseline.
- 2026-09-23: A subsequent proof run exposed transient Windows `rename` contention while persisting task state. Fix `670d27d077d6b45ce1dfe9204510405b530385cf` added bounded retry for Windows `EPERM`/`EACCES`/`EBUSY` only and preserved atomic fail-closed replacement; push CI `#383` / `35832372884` and PR CI `#384` / `35832377010` passed.
- 2026-09-23: Secret denial was physically proven by task `5a77a746-fef0-4361-93a2-81dd7a5be2d5`: Cline attempted to read `.env` and the owner tool returned `Access to secret or credential paths is denied`; validation/diff safety passed with zero changes.
- 2026-09-23: Restricted worker shell behavior was physically proven by task `07ab9762-6de4-4ac8-a8c4-df63e64396a5`: the model reported no terminal/command tool was available and executed nothing; validation/diff safety passed with zero changes.
- 2026-09-23: Protected-path enforcement was physically proven by task `040c8abd-cdcf-4e8c-938c-a1c8c760100d`: Cline attempted both a read and an editor write on `outside.txt`, and both were denied by the owner tool layer; validation/diff safety passed with zero changes.
- 2026-09-23: Before forcing gateway owner loss, source review found that a restarted machine service did not reconcile persisted active tasks and public continuation correctly refused those active states. Restart-aware reconciliation fix `8b6bc285e7a79a88576babcd62716cf09d2bff97` now revalidates authority/diff state, preserves the original checkpoint, discards stale Hub owner identity, and routes recoverable work through the existing durable missing-session handoff/replacement-owner path; stale or unsupported states fail closed. Push CI `#385` / `35840142043` and PR CI `#386` / `35840147771` both passed.
- 2026-09-24: Owner-loss diagnostics exposed the explicit-endpoint Hub auth-token handoff gap. Final runtime fix `99ff5d0ffccda2f531aadd0c95abf19314f89138` plus runtime-export smoke test `182705ab6540fa4e339b304679cd150d7aacc8e8` passed CI `#426` / `36071434059`.
- 2026-09-24: The public Hub resolver exposed the second pinned Core launcher path. Dual-shim implementation `318919d42c2085207e228574bda272bd4d2b152a` plus `e73e02e3fb7808f37df07241e5ab1309892f6b9a` covered both published bundle locations; CI `#430` passed.
- 2026-09-24: Physical owner-loss recovery reached replacement session generation 2 and completed the recovered edit. The first acceptance harness falsely timed out at 180 seconds while the local 27B run completed in about 206 seconds. Timeout alignment `3603b530153d8da2ed0d38dfefa4d4a225eac3af` passed CI `#434` / `36073454818`.
- 2026-09-25: Final physical run again reached replacement generation 2, completed in about 95 seconds, passed configured validation and diff safety, and rollback returned `rolled_back`. The only failed assertion was raw LF-vs-CRLF content comparison after Windows checkout; production rollback's fingerprint verification had succeeded. Disposable proof Git isolation fix `4d5cfc5d9b5c5f628a8fe2730671f84c5a51805d` + regression `c1c714457b9930b8a10d3321d2e0972cbdca78f3` passed CI `#438` / `36082887715`.
- 2026-09-25: Milestone 5 closed on accumulated physical and cloud evidence. No further local owner-loss rerun is required because it would reproduce already-proven recovery behavior while imposing unnecessary load on the user's 27B local inference machine.
- 2026-09-25: Milestone 6 Slice 2 Planner implemented through `5f83903b61494c458474d2ab3f2402101170a0c4`. The planner receives bounded sanitized task context, returns only bound acceptance criteria plus proposal-only validation commands, rejects authority-bearing extra fields, and fails closed on model/provider errors. CI `#448` / `36098312588` passed typecheck and the full test suite.
- 2026-09-25: Future reactive operations requirement captured as GitHub issue #2, **Orchestrator Sentinel reactive incident tracking**. Sentinel is explicitly observational/reactive and cannot become a new runtime/process/code authority.

---

# Current Next Step

Begin **Milestone 6 Slice 3 — Reviewer** only. Define a bounded reviewer evidence packet from sanitized task/diff/validation/checkpoint evidence and a strict reviewer result contract (pass, bounded repair request, or human-escalation recommendation). A reviewer repair request must remain inside the existing approved Safety Plan scope, cannot change trusted validation commands, worker/policy identity, or disabled capabilities, and cannot mark the task complete independently of orchestrator validation and checkpoint-relative diff safety. Add cloud tests first; do not perform live shared-runtime writes.

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
