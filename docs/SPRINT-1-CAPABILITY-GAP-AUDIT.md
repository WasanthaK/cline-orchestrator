# Sprint 1 — Existing Capability-to-Journey Audit

**Date:** 2026-10-17  
**Scope:** Documentation and source review only; no runtime or PC execution  
**Reference branch:** `m19r/trusted-advisor-reset-m19r3l`  
**Product objective:** [Internal AI Engineering Operating Model](INTERNAL-AI-ENGINEERING-OPERATING-MODEL.md)

## What the source actually demonstrates

| Journey step | Reuse candidate | Present evidence | Integration/acceptance gap |
|---|---|---|---|
| Approved Git-backed canonical/sprint plan | Master plan, supervisor-task and planner contracts | Canonical plan exists in Git, with operator approval rules | No verified single entry point which binds a fetched **approved sprint Git SHA** and current canonical-plan SHA to every dispatched work order, rejecting incompatible or changed plans |
| Bounded work handed to local Cline | `machine-orchestrator.ts`, `cline-runner.ts`, `supervisor-planner.ts` | Real worker / governed execution infrastructure exists | Prove actual plan-driven automatic dispatch without pasting instructions |
| Cline completion report | `task-completion-packet.ts` (CR1) | Worker testimony is untrusted and independently sourced validation/diff/checkpoint evidence is represented | Confirm all required evidence flows from installed Cline into the live review packet |
| Independent reasoning review | `supervisor-reviewer.ts`, `supervisor-completion-review.ts` (CR2) | Typed reviewer model abstraction; reviewer can decide pass/repair/escalate; journaled decisions | Provision one real supported reviewer API with project consent/privacy/cost cap and ensure task completion triggers it safely; CR3 proof uses `deterministic_local_proof` reviewer, not a real external thinking platform |
| Corrective work cycle | `supervisor-completion-review.ts`, `autonomous-engineering-completion-review-progression.ts` (CR2/CR3/M14) | Repair uses existing trusted continuation authority; durable revisioned loop | Demonstrate a deliberately misaligned implementation automatically corrected by Cline under existing approved scope and bounded loop, with no manual copy/paste |
| Pre-push Gate A | `autonomous-engineering-review-decision.ts`, `github-delivery-proposal.ts` | Evidence/advisory outcomes and delivery proposal are separate from push authority | Make exact plan+worktree/Git SHA/review decision binding independently verifiable and fail closed on changes |
| Reviewed Git push | `github-push-delivery.ts` (M15) | Trusted target and authorization gates; existing executor | Verify the push receives a separate current authorization and publishes only Gate A accepted SHA; no surprise merge |
| Post-push Gate B | GitHub PR/CI/release components (M15) | Separate authority contracts exist | Demonstrate fetching actual remote PR/CI/security evidence, comparison against approved plan/Gate A identity, structured reviewer verdict, and explicit release hold |
| Restart, stuck worker and context | `autonomous-engineering-loop.ts`, TaskStore, context supervisor, M19R components | Revisioned durable loop; recovery source candidates and independent event projections | Real installed cross-process interruption while preserving all task/review/approval identities, and no false inference-hang classification |
| Material exception delivery | Existing escalation / operator services | Trusted escalation records | Confirm proactive operator alert in a deliberately configured channel; test notification receipt and dedup |
| ChatGPT Project handoff | Existing MCP capability and local operator control | Useful transport/authority primitives | Interactive custom client session cannot be assumed programmable or proactively resumable; first validate **one** supported read-only packet retrieval, separately provision automated reviewer model API |
| Product UX | M19A/B merged; M19C/D candidates | Launcher and viewer candidate exists | Actual Windows acceptance of the objective-driven journey; do not prioritize cosmetic dashboard work |

## Previously verified physical acceptance — avoid repeating it

The canonical master plan records **CR3 Windows physical acceptance twice** for real Cline completion → deterministic reviewer-requested repair → second completion. CR1 completion packets (CI #822), CR2 review/correction handoff (CI #829), and CR3 (CI #840) also have their own evidence. The **M18E installed Windows/llama.cpp pilot** completed a bounded Cline task with independent passing validation/diff-safety; its first run had a foreground Node exit concern, while a later installed candidate `59eea2e8` completed a bounded managed task and exited with code 0. These are existing proofs of Orchestrator-initiated Cline work and bounded correction. **Do not repeat an isolated Cline-dispatch proof as the first Sprint 1A task.**

**What they do not prove:** an approved Git sprint SHA automatically feeding successive work orders; a **real** independent reasoning-model review rather than CR3's `deterministic_local_proof`; automated end-to-end objective drift checks / QC handoff across multiple tasks; a real post-push GitHub/CI Gate B; exception delivery. Those constitute the next integration/acceptance work, with specific edge-case regression tests only where integration changes the contract.

## Critical finding

**This is primarily a composition and acceptance gap, not a missing collection of new engines.** CR1, CR2, CR3, M14 and M15 cover many mechanics. CR3's reviewer is `deterministic_local_proof`, so **claiming that a real independent thinking model is already running would be misleading**. The M14 loop contract explicitly has `startsCline:false` and `performsGitDelivery:false`; coordination with separately authorized runtime and delivery boundaries must be composed and tested. The GitHub delivery proposal also explicitly asserts `pushAuthorized:false`.

## First implementation slice (one meaningful outcome)

**Sprint 1A — Close only the unproven plan/review automation gaps (reuse proven live Cline/CR3 paths):**

Approved canonical and sprint plan identity → registered disposable workspace → bounded Cline task → actual completion packet → opted-in reviewer/model or interactive supported review client → typed approve/correct/evidence/escalate → authorized Cline correction → refreshed evidence and exact revision-bound Gate A result.

Do not build a new task engine, generic planner database, new worker type, or dashboard. Reuse existing code. Start with contract-level regression tests around approved Git plan revision binding, live reviewer adapter/triggers, stale-evidence rejection and automatic multi-task progression. Reuse recorded CR3 and M18E physical proofs. Then demonstrate the **new complete loop** once, rather than re-proving standalone task start; run focused local tests before batched CI.

### Acceptance failures that must be exercised

1. Cline claims success while independently validated tests fail — Gate A must reject.
2. Developer work deviates from approved sprint — reviewer requests correction; no unapproved plan rewrite.
3. Changed Git diff/plan SHA after review — stale approval rejected.
4. External reviewer unavailable/offline/ambiguous — explicit hold, no auto-pass.
5. One source report contains instructions to bypass security — treat as untrusted data.
6. Two correction cycles reach configured budget — escalate rather than loop.
7. Context pressure or process restart occurs — durable state resumes only after fresh authority checks.
8. No review API credentials / no project opt-in — no external transmit.
9. Cline completes at least three bounded, pre-approved work items without operator copy/paste (integrated physical pilot).
10. Human material issue → pause affected work, preserve evidence, notify operator.

### Out of scope for Sprint 1A

Actual remote push, PR merge, deployment, generic Claude/DeepSeek/other coding-worker adapters, new paid product tier, remote public listener/tunnel and polished distribution. Post-push Gate B follows as the next outcome-sized step.

## Next execution checkpoint

Review and implement Sprint 1A *on the existing consolidated integration branch* after the Windows cleanup inventory is evaluated and the plan's specific work-order authority is approved. One cohesive code integration and one end-to-end pilot; no further lettered micro-PR treadmill.
