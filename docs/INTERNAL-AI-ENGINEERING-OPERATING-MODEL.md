# Cline Orchestrator — Internal AI Engineering Operating Model

**Status:** Product requirements baseline for review; not implementation acceptance  
**Date:** 2026-10-17  
**Owner:** Internal engineering operations  
**Canonical parent:** [ORCHESTRATOR-MASTER-PLAN.md](ORCHESTRATOR-MASTER-PLAN.md)  
**Tracking:** [Product issue #49](https://github.com/WasanthaK/cline-orchestrator/issues/49), [review-loop issue #72](https://github.com/WasanthaK/cline-orchestrator/issues/72)  
**First reference stack:** ChatGPT Project or supported OpenAI reasoning API (architect/reviewer), GitHub (versioned plans/code/evidence), Windows VS Code + Cline + local llama.cpp (developer), Cline Orchestrator (durability/governance).

## 1. Why this product exists

The operator currently plans sprints with a strong reasoning model in a ChatGPT Project; publishes canonical/sprint plans to GitHub; pulls them to a local VS Code/Cline checkout; delegates bounded coding assignments; copies Cline's reports into ChatGPT; reviews alignment, standards, security and actual evidence; sends corrections back; authorizes push; reviews remote GitHub/CI outcomes; and separately authorizes merge/release/deployment. This requires continuous copy/paste and operator attention.

**Primary goal:** eliminate routine human handoffs while retaining independent engineering governance. Enable sustained progress through multiple approved tasks with durable recovery, objective alignment, independent QC and exception-driven human intervention.

**Not a primary goal:** commercial SaaS, public sales, arbitrary workflow builder, replacement coding agent, second automated code writer, remote machine control, autonomous deployment, or reproducing ChatGPT's browser UI through unsupported automation.

## 2. Product responsibilities and authority

| Actor | Responsibility | Explicitly cannot do merely by role |
|---|---|---|
| Human engineering owner | Global objectives, material scope/architecture decisions, privileges, exceptional risks, gated merge/release/deploy approvals | Must not be asked to copy routine reports or approve every in-scope correction |
| Architect/planning adapter | Read approved context; propose sprint plan and bounded work orders; review strategic drift | Grant execution, alter canonical objectives, or write code as an assumed side effect |
| Cline developer adapter | Execute specifically authorized coding work, tests, and produce completion report | Accept its own work or expand scope; approve push/merge/deploy |
| QC/reviewer adapter | Independently assess code diff, tests, security, original plan, and report; issue structured verdict | Convert its assessment into execution or release authority without trusted admission |
| Orchestrator trusted core | Coordinate approved plan revisions, task execution, evidence, review loop, budgets, Safety, Git delivery, crash recovery, escalating exceptions | Invent approvals, widen workspace permissions, bypass required tests or push/merge/deploy from model prose |
| GitHub | Version approved plans, code, branches, PRs, CI, security and commits | Automatically make a plan or report correct simply by being stored in Git |

Thinking and coding engines are pluggable **roles**, not hardcoded brands. First implement and physically verify one reviewer/architect adapter and the existing Cline coding adapter. Other agents remain future compatible contracts, not release claims.

## 3. Sources of truth

1. **Git-backed canonical plan** — authoritative approved objectives, architecture, constraints, standards, acceptance criteria and explicitly approved revisions. No worker self-authorized changes.
2. **Git-backed sprint plan** — bounded approved work derived from a canonical-plan version; references target branch and acceptance.
3. **Durable orchestration ledger** — machine-validated active task state, approvals, locks, retries, incident decisions and exact review/commit bindings. It is not a competing roadmap.
4. **Developer report** — untrusted worker testimony; useful for reasoning, insufficient for acceptance.
5. **Independent evidence** — actual worktree diff, Git snapshots, test/validation output, security checks, provenance, CI and checkpoints.
6. **ChatGPT Project** — human-facing strategic context and conversation/artifacts; do not assume a ChatGPT Project is automatically writable/readable through an unattended program. Publish an approved, versioned planning packet to Git; provide review packets through supported client connector or model API.

Each work order binds `objectiveId`, `canonicalPlanCommit`, `sprintPlanCommit`, `workOrderId`, `revision`, `baseGitSha`, `workspaceId`, `branch`, `allowedScope`, `acceptanceCriteria`, `testRequirements`, `reviewPolicy` and `authorityRef`. Exact contract serialization is an implementation detail to be reconciled with existing types; do not replace working schemas without review.

## 4. Required end-to-end behavior

### A. Planning and work-order admission

- Planning agent or human drafts sprint scope from the current canonical plan and existing repository evidence.
- Human approves objective-changing decisions, allowed work scope and permissions; the **approved plan version** is published to GitHub, then synchronized by orchestrator to the local worktree with verified commit identity and no dirty-state overwrite.
- Orchestrator produces the smallest useful work order within approved scope, reusing existing planner and Safety services.
- Cline executes a bounded assignment. The orchestrator records start, tool progress, handoffs, completion, validation and fail-closed exceptions.

### B. Gate A — pre-push independent review

- Ingest actual Cline completion report **plus** independent worktree diff, validation/diff safety, tests, Git state, checkpoint provenance, and plan/sprint constraints. Never treat text-only completion as a pass.
- Review adapter returns a typed **APPROVE**, **CORRECT**, **NEED_EVIDENCE**, or **ESCALATE** decision, with rationale, cited evidence and exact revision identity.
- Trust boundary rechecks that revision, workspace, permissions and required checks are fresh. Invalid/unavailable evidence blocks advancement.
- For CORRECT, issue a narrowly scoped Cline follow-up under existing task continuation authority; retain history and bound retries/cost. On exhaustion or material drift, escalate.
- APPROVE authorizes **review completion only**, not automatic Git push.

### C. Version-bound Git delivery, then Gate B

- Separate trusted push permission admits *only* the previously reviewed code revision to the correct branch. A stale diff/commit or wrong destination revokes the proposal.
- Collect actual GitHub commit, PR diff, CI and security evidence using the authorized Git connector.
- Gate B reviewer compares actual remote head against Gate A identity and the approved plan; verdict again APPROVE/CORRECT/NEED_EVIDENCE/ESCALATE. CI green alone is not approval, and review verdict alone is not deployment authority.
- Merge, release and deployment are separately authorized gated actions; keep stop-before-deploy as pilot default.

### D. Continue the sprint

- Accepted work updates the **verified progress ledger**. Proposed canonical/sprint plan modifications require their own review/approval if they alter objectives, scope or security.
- Orchestrator advances automatically to the next already-authorized bounded assignment, or waits if more authority is necessary.
- Process crashes and worker context exhaustion must preserve durable history and resume *only* with fresh current authority and valid lease. No silent duplicate side effects.

## 5. Exception handling — any participant can raise a flag

Cline, architect, QC, deterministic monitors and CI may emit an exception. It is preserved even if another model disagrees.

**Routine, bounded and pre-authorized:** failed test that permits local correction, context handoff, transient connection retry, minor review fix. Continue only within explicit retry, token/cost and Safety budgets.

**Material / escalated to human:** unclear or conflicting requirement; architecture/security/privacy deviation; out-of-scope changes; suspected credential disclosure; repeated no-progress corrections; unverified source/evidence; stale approvals; new permission need; budget exhaustion; merge or deployment decision. Pause affected work, preserve evidence, notify via an *actually configured* channel, and allow unrelated independent approved work to continue.

Every escalation includes original objective and plan revision, blocked task/revision, reason, evidence links, suggested options, required decision, and audit status. No fabricated approvals or silent severity downgrades.

## 6. Interactive ChatGPT connector and unattended reviewer: two different interfaces

**Interactive client connector (MCP)**: lets a user in a supported ChatGPT or other thinking client read project context, inspect pending review packets, submit approved scoped work orders and structured review decisions, and request delivery proposals under the same trusted authority checks. A read-only pilot should be first; subsequent mutation capabilities need explicit authentication, project binding, CSRF/replay protections where applicable and per-action Safety/approval. Neither a tunnel nor transport authentication grants task authority.

**Unattended reviewer adapter:** configured reasoning-model API or compatible agent runtime, triggered by durable completion events, consumes minimized evidence and returns structured advisory verdicts within project opt-in, privacy and budget policies. An ordinary ChatGPT conversation cannot be presumed to receive unsolicited machine messages or be programmatically resumed. A high-effort model can be selected by the human for exceptional decisions.

Both interfaces share the **same** work-order, review-evidence, admission and release contracts. They must not fork business logic.

## 7. Non-negotiable reliability and security

- Source/diff/task report/CI text are untrusted inputs; resist prompt injection and protect secrets.
- Separate read, planning, execution, Git push, PR, merge, deploy and credential authorities.
- Evidence and model approvals bind exact SHA/diff/plan versions; any change invalidates affected approval.
- Use existing durable TaskStore, context handoffs, watchdogs, fences/leases, Git checkpoints, autonomous loops, CR1/CR2/CR3 correction chain, M15 delivery and M16 Safety. Avoid parallel implementations.
- Recovery and review retries must be bounded, idempotent where possible, restart-safe and observable. Timeout does not establish a hung inference backend.
- Capture no raw secrets, prompts, workspace files or personal data in public receipts. Cloud review requires explicit project-level consent and approved minimal disclosure.
- If review source, security evidence, user permission or runtime authority is unavailable, fail closed.
- Keep local coding on the chosen provider (reference: llama.cpp); reviewer and coding model may differ.

## 8. Current evidence / gap assessment (not a completion claim)

| Capability | Existing evidence | Integration still required |
|---|---|---|
| Cline completion intake and evidence | CR1 | Live review-adapter handoff |
| Structured review and corrected follow-up | CR2 and CR3; Windows proof documented | Full installed lifecycle with model API and human approvals |
| Bounded unattended execution | M14 | Bind each step to Git canonical/sprint revision and objective |
| Git delivery authority | M15 | Verified two-review-gate loop against actual pushed revisions/CI |
| Recovery/durable runtime | earlier milestones and M19R source candidate | Exercise crashes, context loss and stalls in the complete journey |
| Windows product | M19A/B merged; M19C/D review candidates | Actual PC and end-to-end installation |
| ChatGPT interactive connector | existing MCP/remote control contracts | Supported and safe current-client connection; no assumed conversation automation |
| Notifications | escalation history exists | Demonstrate real exception delivery, dedup and operator action |

Do not confuse passing tests on components with complete product acceptance.

## 9. First integrated acceptance scenario

Using a disposable Windows Git workspace and the installed/test-owned application:
1. In ChatGPT or an equivalent reasoning client, review the canonical plan and approve a small sprint committed to the repository.
2. Pull verified plan SHA locally; orchestrator creates a bounded Cline work order.
3. Cline modifies code and returns completion report; orchestrator independently checks diff/tests and produces review packet, with no human copy/paste.
4. Intentionally introduce a deviation from the plan. Reviewer detects it and returns a specific correction. Cline implements correction, tests, and receives a new evidence-bound review verdict.
5. Interrupt a task and restart; validate durable recovery without duplicate work or permission expansion.
6. Push only on an independently authorized Gate A-approved revision; retrieve real GitHub PR/CI/security results; reviewer performs Gate B.
7. Stop before deployment unless fresh specific release authority is granted.
8. Show one concise operator summary of accomplished objectives, evidence, exceptions, remaining work and human decisions.

**Pilot pass conditions:** zero routine copy/paste; at least three consecutive approved work packages; all deliberately injected material deviations caught; all required tests/evidence verified; zero cross-workspace changes or stale-approved pushes; every blocking exception escalated and recoverable; user not required to approve trivial corrections; no unattended merge/deploy.

## 10. Implementation planning principles

- **First documentation, then capability gap audit, then at most a small number of outcome-sized implementation sprints** with explicit objective and pass/fail tests. Do not revive a letter-suffixed PR treadmill.
- Initial sprint outcome: local Git plan handoff → Cline → automated review packet → reasoning verdict → correction → verified pre-push Gate A.
- Second sprint outcome: reviewed push → actual remote CI/security Gate B → explicit release hold, with human escalation notification.
- Third sprint outcome (only if necessary): user-friendly interactive MCP client connection and full pilot resilience across restarts.
- Implement focused fixes on reviewed existing branches, batch tests/CI and merge only on explicit approval.
- Commercial billing, multi-vendor adapters, public sign/release and expansive dashboards are out of scope for internal first operational acceptance.

**Change rule:** Changes to this specification or canonical objectives require explicit human review. A model or worker may propose changes but may not silently redefine project goals.
