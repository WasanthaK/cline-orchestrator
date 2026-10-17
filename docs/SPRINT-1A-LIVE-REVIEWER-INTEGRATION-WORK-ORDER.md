# Sprint 1A — Live Reviewer Integration (one bounded Cline work order)

**Status:** Approved engineering scope for implementation; **not** proof of execution or acceptance  
**Date:** 2026-10-17  
**Parent objective:** [Internal AI Engineering Operating Model](INTERNAL-AI-ENGINEERING-OPERATING-MODEL.md)  
**Gap audit:** [Sprint 1 Capability Gap Audit](SPRINT-1-CAPABILITY-GAP-AUDIT.md)  
**Reference:** Existing CR3 real Cline review/correction proof and M18E installed Windows/llama.cpp task proof. **Do not rerun them as standalone product milestones.**  
**Coding worker:** Cline only, through the existing Orchestrator authorization path.

## Outcome

A completed, previously authorized Cline task automatically produces its existing independent completion packet and passes it to a **configured, approved real reasoning model** using `SupervisorReviewerModel`. Its typed `pass | repair | escalate` recommendation is validated through existing trusted review admission, revision checks and durable M14 step-controller workflow. Routine in-scope repairs return automatically to Cline. Material exceptions wait for a human. No operator copies a report or prompt between agents.

Keep current Git/Safety/lease and separate delivery authorization unchanged. **No push, PR merge or deploy** is part of this work order.

## Verified existing integration points

- `src/supervisor-reviewer.ts`: `SupervisorReviewerModel.review(request)` and strict validation of `schemaVersion`, `supervisorTaskId`, `taskId`, `decision`, `summary`, `repairInstruction` / `escalationReason`; output is advisory only.
- `src/supervisor-completion-review.ts`: `SupervisorCompletionReviewService.review()`, `getTaskCompletionPacket`, status and project/workspace binding, durable review journal, existing repair handoff.
- `src/autonomous-engineering-review-decision.ts`: trusted M14 reviewer decision with fresh completion/run binding.
- `src/autonomous-engineering-completion-review-progression.ts` and `src/autonomous-engineering-step-controller.ts`: bounded, phase-aware and restart-safe composition; don't introduce parallel state engine.
- `src/live-cr3-completion-review-proof.ts`: deterministic proof reviewer, **not** an external thinking-model integration.
- `src/machine-orchestrator.ts:startTask(planToken)`: already starts the existing Cline runner through approved authority; no new launcher needed.
- `src/supervisor-task.ts`: bounded objectives, acceptance criteria, validation commands and Safety bindings.
- `src/native-advisor-credential.ts` / `src/native-advisor-project-binding.ts`: M19R recovery advisor settings **are not proof** of a live software-QC reviewer. Reuse safe credential patterns as appropriate, but do not conflate recovery and QC authority.

## Cline assignment

1. **Trace** actual production activation of `AutonomousEngineeringStepController`, `SupervisorCompletionReviewService` and `SupervisorReviewerModel`. Produce exact call-site map, and identify missing automatic completion→review trigger versus already functioning code. Do not duplicate a service or create another queue.
2. **Implement one minimal review-only model adapter**, using an already supported local OpenAI-compatible endpoint *or* an explicitly opted-in remote model provider. Use strict bounded transport/timeouts, response/size validation, request/response redaction and explicit per-project enablement. Default to **disabled / no external calls**. Never infer that a ChatGPT Project conversation can be resumed by an API.
3. **Integrate through the existing typed interface**, preserving existing `pass | repair | escalate` schema and trusted admission. Reviewer model must receive only a bounded, sanitized, evidence-backed packet and approved objective/criteria, not raw credentials or unrestricted workspace data.
4. **Connect the durable completion trigger** so that a freshly completed authorized Cline task transitions to review, applies only trusted admission, requests bounded in-scope repair through the existing path, and resumes safely on restart. If active production service does not yet support unattended callbacks, implement the smallest dispatch hook within existing services, without relaxing task/lease/Safety gates.
5. **Bind plan context:** include/verifiably read an approved Git canonical/sprint revision in the supervisory review context, without permitting the reviewer or Cline to rewrite the objectives. If the current `SupervisorTaskV1` lacks room for this binding, propose the narrowest backward-compatible signed/validated metadata handoff or stop/escalate rather than treating unverified filenames as authority.
6. **Create tests before any provider calls:** valid pass, repair then new completion/review, escalation, malformed JSON/schema, wrong task/revision/workspace, timeout/offline model, duplicate completion callback, stale diff/plan evidence, exhausted repair attempts, injected worker testimony, no API key/no project opt-in, crash/restart. Verify no authority widening and no secret leakage.
7. **Contrast DeepSeek Harness only against this concrete adapter:** assess whether a pinned review-only harness version reduces implementation cost. Do not vendor, install, enable arbitrary tools, or replace the established orchestration core as part of this slice.

## Validation

Run `npm run typecheck` and targeted existing/new tests locally first. Run a coherent batch `npm test` only after targeted tests are green. CI is a later separately reviewed Git operation, not a substitute for local work.

The local fixture should exercise real trusted completion-packet and reviewer admission boundaries, not merely a mocked verdict. A real model smoke must be explicitly opted into, remain within a disposable approved workspace and never change the user's running llama.cpp flags, GPUs, models, Cline sessions or credentials without separate authorization.

## Definition of done / evidence required from Cline

Return a single completion packet containing changed files, exact before/after call paths, tested scenarios/results, strict scope/authority statement, provider chosen and why, observed local-model/reviewer interaction if genuinely exercised, limits, remaining blockers and diff summary.

**Acceptance:** one previously approved task automatically reaches independent reviewer (no human copy/paste); one deliberate in-scope defect triggers bounded repair and new evidence; one deliberate material issue pauses/escalates; stale or invalid identity/evidence never authorizes progression; existing CR3 and M14/M15 tests remain green.

## Stop conditions

Do not proceed past review if a real model would need unapproved secrets, unrestricted filesystem/network permissions, public listener/tunnel, remote code disclosure, Git push, merge, deploy or authority expansion. Preserve source and evidence and escalate the exact missing authorization.

**Next slice after acceptance:** Gate A exact Git revision binding → separately authorized push → real remote GitHub/CI Gate B. Not included in Sprint 1A.
