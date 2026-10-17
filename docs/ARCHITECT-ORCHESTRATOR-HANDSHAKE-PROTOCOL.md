# Architect ↔ Orchestrator: Engineering Handshake and Review Protocol

**Status:** Research-backed design proposal; NOT an implemented/wired transport, API or approval.
**Date:** 2026-10-17
**Parent requirements:** [Internal Engineering Operating Model](INTERNAL-AI-ENGINEERING-OPERATING-MODEL.md) · [Sprint 1 audit](SPRINT-1-CAPABILITY-GAP-AUDIT.md).
**Primary use case:** preserve the operator's existing ChatGPT Project → Git sprint plan → Orchestrator → Cline → independent review → corrections → authorized Git loop without manual copy-paste.
**Initial roles:** interactive ChatGPT Project architect (where officially supported), autonomous reasoning API reviewer, Orchestrator coordinator, existing Cline worker. Thinking/coding providers replaceable.

## 1. Research conclusions and standards

1. **MCP** is a client-to-tool interface suitable for interactive ChatGPT access (read project/plan/task/review, propose a work order, submit a review decision where supported). It does not by itself let an arbitrary local server wake or resume the operator's existing ChatGPT conversation. ChatGPT custom MCP availability, read/write rights and connection mechanisms depend on account/workspace/permissions; the initial connection must respect actual user entitlements and action confirmation.
2. **A2A** is the closest available *agent-to-agent interaction model*: Agent Cards and capability discovery, task IDs and status, Messages (conversation), Artifacts (results), polling, streaming and optional authenticated push notifications. **Do not automatically implement an entire A2A server.** Use its ideas for a small first-party contract and add a standards adapter if cross-vendor agents eventually need it. Verify and pin any adopted standard version (official A2A documentation describes 1.0.0 as latest released; some older pages still display 0.3.0).
3. **Agent Client Protocol (ACP)** describes editor/client ↔ coding-agent prompt, permission, event, cancellation, session-resume and turn completion. ACP v2 distinguishes prompt-accepted acknowledgment from later idle/stop-reason and tool update notifications. This is a reference for *future worker connectors*; the present Cline SDK is already integrated. Distinguish **agentclientprotocol/agent-client-protocol** from unrelated protocols also called ACP.
4. **MCP Tasks** provides longer-lived task handles and polling in supported versions; it is an evolving/experimental extension, **not a guaranteed feature of the ChatGPT application**. Do not make durability depend on the client preserving a stream or MCP session. Modern 2026 MCP versions also differ from 2025-11-25 in connection/session handshake semantics; negotiate capabilities, don't assume one wire shape.
5. **Cline SDK source** distinguishes task-completion telemetry from mere session teardown; our installed/pinned SDK version must be treated as the contract of record. Orchestrator already subscribes to SDK runtime events; process exit, transport disconnect, a stream's "done", or a model's natural-language "finished" must NOT be treated as validated task acceptance.

### Primary official references (checked 2026-10-17)

- A2A latest published specification: https://a2a-protocol.org/latest/specification/ and operations: https://a2a-protocol.org/latest/topics/streaming-and-async/
- A2A lifecycle and artifacts: https://a2a-protocol.org/latest/topics/key-concepts/
- Agent Client Protocol v2 overview: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx and migration: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/migration.mdx
- MCP tasks: https://tasks.extensions.modelcontextprotocol.io/ and evolving extension specification: https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks
- MCP 2026 update: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- ChatGPT custom MCP permissions: https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt
- Cline SDK architecture: https://github.com/cline/cline/blob/main/sdk/ARCHITECTURE.md

## 2. Four separate acknowledgments (the most important insight)

Never conflate these handshakes:

- **H1: Instruction received** — Orchestrator durably records an architect's proposed plan/task/review instruction, returns an immutable request ID and current status. Receipt is not approval and does not authorize a Cline start.
- **H2: Execution accepted** — trusted authority verifies the approved Git plan revision, task scope/Safety, workspace, budgets and start permissions; Orchestrator persists admitted work order and starts Cline by the *existing* trusted mechanism. A model cannot manufacture this acknowledgment.
- **H3: Evidence ready** — Cline declares an end or the runner terminates; *independent* validation, diff safety, Git and checkpoint evidence settle; Orchestrator atomically creates a review packet and durable review-request record. Cline's own status is testimony, not QC acceptance.
- **H4: Review decision admitted** — architect/QC returns a structured verdict referring to the exact review request, completion run and evidence digest. Trusted review admission validates actor/capability, freshness, schema, budget and approved boundaries. **Review accepted** is distinct from *code accepted*; only a valid pass with required independent evidence reaches Gate A. A repair starts a *new iteration* with new evidence; a blocked/escalated verdict creates a human decision request.

Additionally, Git push, PR, merge and deploy have their **own separate authorities**. H4 does NOT authorize push or release.

## 3. Role discovery and session registration

The Orchestrator exposes a read-only, authenticated **capability manifest** for the specific project, with supported protocol versions, current policies, available actions and server identity. The architect client or autonomous reviewer identifies itself and declares its requested role ("architect", "qc_reviewer", or both when separately authorized), supported transports and structured-output capability. Orchestrator returns allowed scoped operations, project/workspace IDs (opaque), approved canonical and sprint Git revisions, and current task/review cursors. This **registration is identity/transport only**, not engineering authority.

For first-party adapters, prefer a simple versioned manifest to full A2A agent-card publication. If an A2A adapter is later offered, map discovery and transport appropriately without exposing workspaces, secrets, credentials or unsafe outbound callback URLs.

- Wrong project, expired credential, unsupported version or revoked role: deny before emitting sensitive context.
- Reconnection: restore from durable cursor/IDs, not the assistant's chat history.
- User deliberately switching ChatGPT → Claude → DeepSeek: reuse project, plan and review artifacts; do not transfer implicit permissions or private conversation memory.
- A second concurrent reviewer may read; *only one* valid review decision can be admitted for a given request revision (compare-and-swap, duplicate replay returns original result).

## 4. Contract and status vocabulary

The following envelopes are **proposed logical messages, not current production JSON or public endpoints**. Use existing SupervisorTaskV1, TaskCompletionPacketV1, M14 state, SupervisorReviewerModel and trusted decision admission; map fields rather than rebuilding those schemas.

### Common correlation envelope

- protocolVersion; messageId; correlationId; projectId; workflowId; sprintId; workOrderId; taskId; iteration and runCount (when applicable).
- plan: canonicalPlanCommit, sprintPlanCommit and optional content digest. If no approved Git sprint revision, explicitly mark unbound and **block automatic scope-changing continuation**.
- actor: authenticated adapter identity plus authorized role/capabilities; never accept claimed role inside model text.
- eventSequence or durable state revision; sentAt; idempotencyKey; causalParentId; optional expectedRevision for optimistic concurrency.
- payloadType and type-validated bounded payload; separate internal project-local secure blob reference for large diffs.
- model metadata (name/provider) is observation, never a credential or authorization.

### Domain states

1. PLANNED (proposed; no execution permission)
2. AWAITING_PLAN_APPROVAL (human decision required if new scope/authority)
3. ADMITTED (approved task-bound plan/Safety)
4. RUNNING (Cline executing)
5. VERIFYING (Cline turn ended/terminal candidate, independent validation still active)
6. REVIEW_READY (immutable packet and review request stored)
7. REVIEW_IN_PROGRESS (one current review attempt, lease and timeout)
8. REPAIR_READY (typed bounded correction accepted; Cline continuation gate required)
9. ESCALATED (material concern, missing permission or exhausted budget)
10. GATE_A_ACCEPTED (review + independent evidence current; **not push authority**)
11. DELIVERY_AWAITING_AUTHORIZATION (separate Git push/PR permission)
12. GATE_B_REVIEW_READY (remote SHA/PR/CI/security packet)
13. RELEASE_ON_HOLD / FINISHED / FAILED / CANCELLED (distinct outcomes).

These are **logical protocol projections**, not a mandate to replace existing TaskStatus/M14 enums or force backward-incompatible migrations. Terminal Cline task states are different from terminal sprint states.

## 5. Exact workflow messages

### (A) Architect creates and submits an approved sprint

1. Architect GET_PROJECT_CONTEXT obtains Git canonical revision, last verified sprint/review status, risks and available budgets.
2. Architect may DRAFT_SPRINT with objective IDs, bounded scope, acceptance criteria, dependencies, preferred model and proposed Safety requirements.
3. Orchestrator responds RECEIVED (H1) including request ID, validation/scope assessment and whether approval is required.
4. Approved plan content is published through separately authorized Git document operations. Orchestrator then verifies and records **actual fetched plan SHA**, with no dirty-workspace overwrite.
5. SUBMIT_WORK_ORDER references that immutable plan revision and registered workspace. Only trusted admission issues ADMITTED (H2) and starts Cline. If plan has advanced or scope conflicts: STALE_PLAN or ESCALATION_REQUIRED, *not* silent rebase.

### (B) Detect task completion from Cline

- Primary source: the actual trusted Cline runner/task lifecycle (SDK completion signals and final result), NOT stdout parsing, periodic LLM assertions, or process termination alone.
- On completion *candidate*: move to VERIFYING; reconcile Cline result/finishReason with durable TaskStore state and runCount; wait for existing validation and diff safety to settle; capture Git snapshots and rollback checkpoint.
- Create completion packet using existing create/getTaskCompletionPacket (already redacts and marks worker report "untrusted_worker_claims").
- Do not mark success when validation failed, task aborted, source evidence missing, permission request unresolved or workflow remains active.
- Durable event **review_packet_ready** should be emitted only once per exact task + runCount + evidenceDigest; dedupe after restart. The event only alerts consumers to re-fetch the authoritative packet.
- Persist a review request **before** notifying/invoking a reviewer. If the process crashes between persistence and delivery, durable retry scans outstanding requests.
- If SDK event is missing/duplicated/out of order, reconcile authoritative task state and *never* create two trusted approvals.

### (C) Ask architect/reviewer for review

1. Orchestrator produces a minimized immutable REVIEW_REQUEST: goal, acceptance criteria, canonical/sprint commits, task ID, run count, diff/checkpoint digest, independent validation and Safety findings, Cline's sanitized testimony, review policy, allowed correction paths and reviewer budget. The reviewer gets no Cline writer permissions.
2. REVIEW_REQUEST_PUBLISHED gets a reviewRequestId, evidenceDigest, expectedRevision, createdAt and expiry. Return delivery acknowledgment separately; do not assume model execution has begun.
3. Interactive ChatGPT connection: user opens/asks for PENDING_REVIEWS or GET_REVIEW_REQUEST; client fetches data through MCP. Orchestrator cannot silently write into a particular existing ChatGPT Project conversation.
4. Unattended architecture/QC: background Orchestrator dispatcher invokes an opted-in configured reviewer model API or harness, validates structured reply and stores result. This path needs consent, budget, secret management and privacy rules. The API model does not inherit ChatGPT Project conversation history; it receives approved Git context explicitly.
5. A model answer arriving after timeout, after a new completion packet or after plan drift is **STALE_DECISION** and not applied.

### (D) Architect returns a decision

A review response must contain:
- reviewRequestId, workOrderId, taskId, runCount, evidenceDigest, plan commits, expectedRevision;
- decision: PASS / REPAIR / NEED_EVIDENCE / ESCALATE (adapter-level). Map to current internal **pass / repair / escalate** schema; NEED_EVIDENCE is a pre-admission HOLD/REFETCH outcome, **not** a silent new stored SupervisorReviewerDecision value;
- rationale, acceptance criteria assessed, actual evidence references and unresolved issues;
- for REPAIR: bounded corrective instruction and allowed files/constraints; preserve current task/Safety authority;
- for ESCALATE: reason, severity and explicit human question; no vague "green" or "next" loop.
- decision ID and idempotency key.

Orchestrator independently validates and responds with **DECISION_RECORDED**, **REJECTED_STALE**, **REJECTED_UNAUTHORIZED**, **REJECTED_INSUFFICIENT_EVIDENCE**, or **ESCALATED_TO_HUMAN**. A recorded review is not necessarily an accepted implementation. A PASS with failing tests remains blocked.

If REPAIR: create repair attempt N under existing CR2/M14 correction and lease gates; return **REPAIR_ADMITTED** only after durable authorized transition; Cline receives a fresh bounded prompt with task objective, reviewer findings, current authoritative plan, safety envelope and context handoff. New runCount and evidence digest invalidate the old PASS.

If NEED_EVIDENCE: collect additional independent checks through trusted validators; reviewer never directly executes an arbitrary shell command.

If ESCALATE: pause only affected work, preserve dossier; human answers through authenticated dashboard or supported client tool, after which fresh authority and plan revision validation are required before continuation.

### (E) Architect receives results and progress

Provide lightweight GET_WORKFLOW_STATUS / GET_PENDING_REVIEWS / GET_REVIEW_REQUEST / GET_ESCALATIONS / GET_VERIFIED_PROGRESS; return current phase, outcome, evidence and concise next action. A durable **verified progress ledger** can update when the work is independently accepted; worker status cannot rewrite canonical plan.

An optional outbound notification (email/message/A2A webhooks) should contain only task IDs and a summary; the receiving client fetches authoritative state after checking authentication. **A push message or SSE delivery is a hint, not the evidence source and not an approval.**

## 6. Sequence diagram

\`\`\`mermaid
sequenceDiagram
    participant A as Architect / thinking platform
    participant O as Orchestrator trusted core
    participant G as Git source of truth
    participant C as Cline developer
    participant Q as QC reviewer
    participant H as Human
    A->>O: Discover roles + GET_PROJECT_CONTEXT
    O-->>A: Authenticated capabilities, plan SHA, cursors
    A->>O: SUBMIT_SPRINT proposal
    O-->>A: H1 RECEIVED (not authorized)
    H->>O: Approve scope / separate Git publication
    O->>G: Fetch approved canonical and sprint SHA
    G-->>O: Exact authoritative revisions
    O->>O: Trusted Safety/workspace/task admission
    O-->>A: H2 ADMITTED or BLOCKED
    O->>C: Start existing approved Cline task
    C-->>O: SDK events + completion candidate
    O->>O: Independently settle validation, diff, checkpoint
    O->>O: Persist immutable packet and review request
    O-->>A: H3 REVIEW_READY (fetch ID, not report pasted)
    O->>Q: Invoke approved reviewer adapter (if unattended enabled)
    Q-->>O: Structured decision + digest/revision
    O->>O: Trusted stale/authority/evidence admission
    O-->>A: H4 DECISION_RECORDED or ESCALATION
    alt REPAIR admitted
        O->>C: Bounded corrective continuation
        C-->>O: New completion candidate and evidence
        O->>O: Repeat review with new digest
    else Material exception
        O-->>H: Ask decision with evidence
        H->>O: Explicit scoped authorization or stop
    else PASS with independent evidence
        O-->>A: GATE_A_ACCEPTED; delivery permission still separate
    end
\`\`\`

## 7. Durable delivery and disconnection

- Maintain durable inbox/outbox records; **persist-before-send** and acknowledge-after-persist, with idempotency on request ID + task iteration. Cross-machine notifications normally provide at-least-once delivery, not exactly-once effects.
- On timeout, unknown transport outcome or restart: query by request ID / latest durable cursor before retrying. Avoid duplicate worker starts and duplicate corrective work.
- Use optimistic concurrency on exact review revision and plan/commit binding. A response to an older packet never advances a newer task.
- Architect absent: continue **previously approved** unrelated tasks if safe; pending review remains durable, and an unattended reviewer adapter may process it only when configured and authorized. Otherwise wait without inventing approval.
- Reviewer model failure: retry within bounded provider/error budget; on exhaustion HOLD and escalate, never default PASS.
- Cline session context rotation: carry durable work-order/context handoff; still revalidate task/lease/Safety before new session. A new session ID is not a new review approval.
- Cline task completion vs engineer sprint completion: one task may finish but the sprint remains active; multiple tasks must be evaluated against dependencies, approval budgets and changed plans.
- Cancellation: acknowledge *request to cancel* separately from confirmed stopped Cline and reconciled clean task state.
- Status polling backoff is normal. Event stream or webhook may improve responsiveness, but must have reconciliation after disconnect.
- Bind notification endpoints to a specific authenticated operator and allowlist to prevent SSRF, leak of source/diff or unwanted external access.
- Require per-project model disclosure policy, redaction and audit trail before sending code or requirements to a hosted reviewer.

## 8. Codebase mapping and missing seams (inspected on 2026-10-17)

| Concern | Existing source / proof | Needed (if not already integrated in production) |
|---|---|---|
| Cline start | machine-orchestrator.ts:startTask(planToken), enqueueStart; CR3 and M18E physical proofs | **Reuse, don't retest standalone** |
| SDK lifecycle and recovery | cline-runner.ts subscribes to chunk, status, agent_event and ended; Cline runner executes with watchdog/recovery | Ensure durable terminal event flows to review outbox, not merely console/log |
| Completion packet | task-completion-packet.ts, MCP get_task_completion | Persist exact run/digest packet and review-ready signal, with settled independent tests |
| Review and trusted correction | supervisor-reviewer.ts (pass/repair/escalate), supervisor-completion-review.ts, supervisor-decision.ts, autonomous-engineering-step-controller.ts; CR2/CR3/M14 | Live opt-in model adapter, auto-trigger, retry + replay, distinct review ACK |
| Planning | supervisor-task.ts objectives and acceptance; Git master plan | Approved Git sprint SHA/canonical SHA in work-order/review binding; reject staleness |
| Interact with ChatGPT | mcp-gateway.ts read-only get_task/get_task_events/get_task_completion/get_task_diff | Dedicated **read-only architect inbox/status tools first**, then scoped mutation where client entitlements allow |
| Human decisions | human-escalation.ts durable waiting_for_human | Exception channel and acknowledged decision, dedupe and operator audit |
| Git delivery | M15 authority contracts | Separately approved Gate A push plus post-push real CI/security Gate B, not in handshake-first slice |

**Important distinctions**: source code's Cline \`agent_event:done\`, SDK \`ended\`, a closed transport and final worker report are **not equivalent** to a trusted task terminal record with validation. The existing TaskCompletionPacket includes failed and validation_failed terminal statuses and flags the worker testimony as untrusted. An explicit review disposition must be computed from actual evidence, not merely \`terminal:true\`.

## 9. Proposed architect-facing interface (logical, not yet registered tools)

**Read-only MVP:**
- DISCOVER_ORCHESTRATOR
- GET_PROJECT_CONTEXT(projectId)
- GET_WORKFLOW_STATUS(workflowId)
- LIST_PENDING_REVIEWS(projectId, cursor)
- GET_REVIEW_REQUEST(reviewRequestId)
- LIST_ESCALATIONS(projectId)
- GET_VERIFIED_PROGRESS(projectId, sprintId)

**Scoped mutations, separately enabled/gated:**
- PROPOSE_SPRINT(draft, expectedCanonicalCommit)
- SUBMIT_APPROVED_WORK_ORDER(approvedPlanRef, SafetyPreviewRef, idempotencyKey)
- SUBMIT_REVIEW_DECISION(reviewRequestId, evidenceDigest, expectedRevision, verdict)
- ANSWER_ESCALATION(escalationId, explicit approved action)
- REQUEST_GIT_DELIVERY(reviewAcceptedRevision, requestedAction), never general "run arbitrary command."

Each registered tool should do one bounded job, provide predictable typed errors, and use existing trusted admission services. Do not expose raw filesystem, shell, credentials, Hub, model sessions or raw arbitrary workflow JSON through the architect connector.

## 10. First implementation and physical acceptance — before more harness features

**Slice A — Review inbox and completion handshake**
1. Map existing task state -> actual durable completion packet -> review request; no new code until gaps confirmed.
2. Implement or wire an idempotent local review outbox and read-only pending-review query if missing, using existing TaskStore/review journal, not a new independent task engine.
3. Test Cline completion result, SDK duplicate/missing event, validation_failed, reboot/replay, no manual report copying, exact plan binding and missing/changed Git plan SHA.
4. Demonstrate one **real previously authorized** Cline completion generates a retrievable review request *automatically*; reuse CR3 as baseline evidence, test only the new seam.

**Slice B — Architect/reviewer response handshake**
1. One real configured reviewer model adapter using existing SupervisorReviewerModel.
2. Receive and independently validate typed response against immutable review request/evidence digest/revision. No implicit model grant or unverified pass.
3. Reuse CR2/M14 for bounded correction and a fresh review iteration; escalation for material concerns or budget exhaustion.
4. Test lost response, duplicate response, stale response, malformed reply, offline model, fail-closed evidence, and crash after H3 before H4.

**Slice C — Interactive MCP and remaining lifecycle**
1. A safe, supported, permission-aware ChatGPT client can query context/reviews/status without needing to paste reports. Validate actual account capabilities; no assumption the client is available on every plan.
2. Only when supported and specifically approved, expose mutation tools that submit bounded proposals/decisions.
3. Reconcile pre-push Gate A with separate approved Git operation and post-push Gate B later.
4. Do not migrate runtime to A2A or ACP solely to claim protocol compliance.

**Definition of success:** A reviewed Git sprint objective advances from an already authorized Cline task to a durable evidence packet, review request, real QC decision and bounded correction, without the operator doing the transport work. A disconnected architect can reattach to the correct outstanding review. An out-of-scope or security issue interrupts only affected work and asks the human. Never accept a Cline "done" message or reviewer "pass" as sufficient evidence or authority.

## 11. Implementation change control

This document is a **design proposal and gap map**. Before implementing any new network endpoint, tunnel, credential, model API call, remote callback, executor action or mutation capability: perform separate security review and obtain the approvals the master plan requires. Pin protocol versions to prevent surprise task/status semantic changes. Preserve installed/runtime state; no assumption that clicking a ChatGPT app control authorizes Cline, Git push or deployment.
