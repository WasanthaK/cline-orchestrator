# M19R1 — Recovery Supervisor, observational first slice

Tracking: [#72](https://github.com/WasanthaK/cline-orchestrator/issues/72).

M19R1 adds pure, deterministic, bounded diagnostic classification. It does
not replace the existing ClineRunner context supervisor, durable handoff,
watchdog, bounded tool argument repair, supervisor review or HumanEscalationService.

Signals: context pressure/overflow, tool protocol failure, human question,
human approval, watchdog stall, repeated attempts, validation failure and
unknown. A repeated-attempt recommendation requires at least two attempts,
identical SHA-256 fingerprints AND trusted validated-no-progress evidence.
Changed or missing evidence cannot claim a loop; fingerprints are not returned.

The output is an advisory receipt only. Every result explicitly denies
execution skipping, retry authorization, task start, external advisor contact
and all authority. Question answers from verified evidence are advice, not
permission to submit a response. Approval requests always escalate.

Next M19R2: capture typed task events, track distinct tool/validation/git
progress, persist sanitized incident identity without raw model text, and
display incidents in the read-only task drilldown. M19R3: user-opt-in,
authenticated OpenAI advisor transport with cost/privacy budget and strict
response validation. M19R4: independently trusted, bounded action admission.
M19R5: human Recovery Center and physical acceptance. No remote endpoint,
model call, task, installer or release is introduced by M19R1. Real Windows
M19E5 acceptance remains a separate gate.

## M19R2A — optional inference-server observation candidate

Separate stacked source candidate after M19R1. Explicitly invoked probe is
GET-only, literal-loopback-only (127.0.0.1 or [::1]), redirect-denying,
credential-free, time-bounded and response-size-bounded. It does not discover,
start, stop, restart, configure or download a model.

- llama.cpp: GET /health; optional GET /metrics with processing/deferred,
  predicted-token counters and optional KV ratio.
- Ollama: GET /api/ps for loaded-model count only. Loaded is not busy.
- vLLM: GET /v1/models; optional GET /metrics with running/waiting
  gauges, generated-token counters and optional cache ratio.
- OpenAI-compatible: GET /v1/models only, for an explicit loopback
  endpoint. No request/generation telemetry is presumed.

Metrics may be disabled or unsupported. Missing metrics yield unavailable or
unsupported **telemetry**, not a Cline stall. Names, URL, raw metrics, labels,
model output, tokens and credentials never enter the compact public receipt.
The correlation function requires independently trusted Cline-runner evidence
for meaningful progress and independently verified watchdog evidence for a
stall classification. Engine tokens/queues alone cannot mark a task advancing,
nor authorize skipping, a retry, execution, model restart or ChatGPT contact.

This is a source-level observer/projection candidate only; no scheduling,
persistent incidents, live ClineRunner event connection, native UI binding,
network exposure, external advisors or physical proof are claimed. M19R2
trusted event integration and durable deduplicated incident history remain next.

## M19R2B — trusted durable-task-event incident projection candidate

Reuses TaskStore's existing on-disk append-only task event ledger through the
authenticated, workspace-binding-validating MachineOrchestratorService loader.
No second writable event/incident store, no parallel runner, no task mutation.
Read-only \`getTaskRecoveryEvidence(taskId)\` is a service method only; it does
**not** add a browser action or MCP route.

All events must match the exact task, be UUID-identified and timestamped,
monotonically ordered, uniquely identified, bounded to 1,000 events, and
carry a known type. Invalid/oversized/missing evidence returns unavailable,
never a healthy zero. The projection reads **only** event type, event ID and
timestamp. It cannot expose message/data or prompt, source path, command,
credential or raw model output, even if those exist in the historical JSONL.
Incident IDs are stable SHA-256 digests of task/event identifiers. Repeated
occurrences of an unresolved signal coalesce until matching independently
recorded resolution evidence; 40 most recent incidents are projected with
explicit truncation and full count. The original TaskStore remains the
durable audit source; this projection is reconstructible across restart.

Recognized incident signals: context rotation pressure, verified watchdog
stall, human escalation (always treated as approval-required), and failed
validation. Resolution is evidence-based, not inferred from backend activity.
Independent validation and diff-safety success events are counted separately:
they are **not** proof of code changes or completed tools. The existing
TaskStore does not record completed Cline tool calls and this slice must not
claim otherwise. No-progress/repeated-loop fingerprints remain unverified.

Next M19R2C: bounded typed runner tool lifecycle observation and real-time
join with M19R2A inference observations; after that, wire incident drilldown
and eventual M19R6 notifications (#75). No opt-in external transmission,
task retry, skip, model restart, notification delivery, or release authority.

## M19R2C — live SDK tool lifecycle and inference correlation (source candidate)

ClineRunner's existing trusted SDK subscription feeds a private in-process
observer. Only paired content_start/content_end tool events (same bounded
name, single tool in flight) count as verified tool activity. Model token
counters, text chunks, reasoning, status updates and watchdog heartbeats do
not count. Malformed, overlapping, unpaired or concurrent-tool events yield
ambiguous active-tool state and never add fabricated completions.
A completed tool is NOT proof that the resulting code/diff/validation passed.

Runs reset this observer, human-escalated/finished runs seal it, and existing
watchdog signals can be recorded without replacing the watchdog. An in-process
getRecoveryCorrelation(optionalSnapshot) joins M19R2A's independently sampled
backend evidence without starting any inference requests. Outputs are bounded
numeric timestamps and counts only: no worker output, tool names, paths,
prompts, credentials or raw logs.

M19R2B's durable task evidence remains independent and explicitly reports
tool completion history unknown. This slice does not persist SDK tool events;
crash/restart loses its process-local observations. Later milestone work must
review immutable bounded tool evidence, process/task binding and UI projection
before advertising continuous monitoring or operator notifications (#75).
No retries, restart, browser mutation, external advisor or new task authority.

## M19R2D — Durable tool milestones and Recovery Center candidate

The trusted Cline runner appends bounded numeric-only recovery_tool_progress
events at power-of-two milestones of paired SDK tool lifecycles. Events are
serialized and flushed on normal run exit. A failed append disables further
observer writes, not Cline execution. A crash can lose in-flight samples;
absence means unknown. Tool activity never proves edited code, validation
success, or task completion.

The existing TaskStore event projector now counts these milestones separately
from independent validation and diff checks. The workspace-bound read-only
getTaskRecoveryEvidence method is exposed only to the authenticated task detail
Recovery Center. It shows bounded incident history, deduplicated episodes,
open/resolved state and evidence limitations. The global incident source remains
disconnected, not healthy. No task mutation, ChatGPT transmission, notification,
automatic restart or expanded authority.

## M19R3A — Advisor trust contract (source candidate)

A pure zero-network validator admits only explicitly consented, bounded,
typed incident metadata. It rejects arbitrary prompt text, paths,
credentials, unknown fields and invalid event identities. Advisor suggestions
are limited to an enum of non-executing proposals, always marked
review_required with no retry, skip or task authority. This is **not** a
ChatGPT connection, an opt-in UI, cost metering or transport: M19R3B must
independently design authenticated transport, redaction, rate/cost budgets,
timeout, offline fallback and consent revocation before any transmission.

## M19R3C — Durable advisor admission ledger (source candidate)

The dormant admission ledger issues per-incident short-lived grants only after a trusted operator approval callback. It durably records one-shot consumption and conservative estimated spending reservations, with exclusive filesystem locking, monotonic clock enforcement, bounded history, explicit revocation and fail-closed state corruption. Concurrent or restarted processes cannot spend the same approval twice. Orphaned locks require manual review; no automatic unsafe lock removal. This module has no network operations and is not connected to advisor transport, runner, UI or scheduler. Its estimated budget is not proof of billed costs. Subsequent integration requires explicit consent UX, owned protected state directory, verified secret-provider binding and live end-to-end acceptance. The existing Cline execution authority remains unchanged.

## M19R3E — Human-centered standing consent, not per-incident prompts

Product decision (2026-10-16): the operator must NOT type an approval phrase
each time Cline stalls. Recovery Supervisor exists to support continuous work.
The preceding standalone M19R3E per-incident review draft was **not
committed** and is superseded by this standing-policy design.

First-run settings should offer: Off (default), Automatic advice for
preapproved bounded low-risk incidents, or Ask before consulting.
The operator sees the exact external destination, metadata-only disclosure,
project scope, allowed incident types, price/rate ceilings, expiry and a clear
Disable/Revoke control. Opt-in is project scoped and time-limited (at most
30 days before renewal). No raw prompts, file contents, paths, model output
or credentials are eligible for external transfer in this phase.

With Automatic advice selected, verified open incidents within approved
scope may become **eligible** for consultation without another confirmation
dialog. Human questions, safety approvals, expired consent, new project scope,
unexpected signals, exceeding per-incident budget or unknown evidence must
be surfaced as exceptions to the operator, not silently approved. An
eligible assessment alone is NOT a call: trusted current settings, a
task-bound event source, M19R3C's durable one-shot grant and budget admission,
and M19R3D's bounded transport must still be checked afresh on every call.
The existing authorization/lease/Safety Plan rules for executing changes
remain completely separate. Do not confuse permission to ask for advice
with permission to run it.

This slice implements a pure no-I/O policy evaluator and focused acceptance
tests only. Persisting protected preferences, atomic disable/revocation,
authenticating operator settings, secure credential setup, wiring live policy
to the existing durable grant, UI, push notifications (#75) and physical
Windows acceptance remain gated and are NOT claimed complete.

## M19R3F — Operator AI recovery Settings screen (candidate)

Adds an optional project-bound Settings capability to the **existing**
loopback-only authenticated operator control surface; the passive task
dashboard remains completely read-only. The trusted host must explicitly
inject an AdvisorSettingsStore + project display name. Existing installations
that do not supply this capability expose no additional route. No new
listener, port, service or external connection is opened.

Simple operator choices are **Off** (default), **Automatic advice**, and
**Ask me first**, with clear project scope, incident-metadata-only privacy
disclosure, time-limited permission (7 or 30 days), per-consultation estimated
cost cap and an ordinary Save settings button. It does not ask for technical
confirmation phrases on each incident. Non-off selection requires one
explicit checkbox acknowledging external metadata disclosure. The operator
may switch back to Off without a disclosure checkbox. Expired preferences
display Off until renewed.

The persisted policy is local-user-owned, protected, revision-checked and
atomic; symlink/state corruption, stale updates, invalid fields and
concurrent writers all fail closed. The authenticated operator route
requires its existing session cookie, same-origin POST and CSRF protection.
No project ID, state path or secret comes from the browser; it is bound by
the trusted host at startup. The rendered page never contains credentials,
workspace source, prompts or model responses.

**This is settings persistence and an authenticated UI, not runtime
enablement.** The future runtime integration must reload current policy
and revocation before every consultation, then consume a separate durable
one-use advisor grant/budget reservation, enforce a credential resolver and
confirm physical Windows installed behavior. Saving Automatic advice in
this slice does not make any network calls or permit task execution.
Operator notifications (#75) remain a separate later capability.

## M19R3G — Installed native host project binding

The existing optional authenticated loopback operator control server now
receives an explicit, native-host-injected project Settings capability from
MCP startup. Its source of truth is the registered WorkspaceRegistry,
not any path, project label, workspace ID or configured URL from a browser.

With one project the Settings link opens it directly. With multiple
projects an authenticated HTML selector lists their safe display names
and opens the chosen project's own Settings form. Selection is checked
against the trusted registry again before every save; unregistered,
duplicate, malformed and unknown project IDs are refused. Each project's
preferences live in its own protected local-user state directory beneath
the trusted registry's parent, with no per-project secret files or
application task permissions attached to the form.

This does not start a new listener, register a passive dashboard mutation
or consult the model. Existing local operator login, origin, CSRF,
authentication, short sessions and revision-checked writes still apply.
Settings can be saved and switched Off with a normal click. The main
app's live advisor path remains disconnected until independent policy,
durable one-use admission, credential-ref binding, provider smoke tests,
consent revocation/restart behavior and installed Windows acceptance are
verified. No task execution/safety/lease authority is changed.

## M19R3H — Trusted runtime advisor eligibility (source candidate)

TrustedAdvisorRuntimeGate accepts only a task UUID and a previously recorded
incident digest, **not** caller-supplied project, signal, payload, model,
filesystem path or price. It obtains the task through the canonical
MachineOrchestratorService (workspace verified), resolves its registered
project through the native project binding, reads the protected standing
advisor policy directly from disk, then checks the authoritative bounded
durable recovery event projection for an exact still-open, recent incident.
A matched event is not enough if the task completed, changed binding or is
awaiting a human approval. The receipt is a small allowlisted reason code.

M19R3B's exact request serializer supplies the estimated cost without
making any network call. M19R3E's pure standing-policy evaluator controls
Off, Ask first, automatic advice, expiry and allowlisted incident types.
M19R3C now exposes a **read-only** locked durable quota/duplicate capacity
preflight, scoped via the selected project: this is not a grant or
reservation. Quota/corruption/lock failure is fail-closed. Before labeling an
incident eligible, the gate rechecks the saved consent revision, task
identity/status, and that same incident remains open in newly read task
event history. Operator revocation or incident resolution during evaluation
therefore prevents a stale eligible result.

The gate still performs **zero** transport calls, credential lookups, task
execution or permission changes. Neither runtime scheduler nor HTTP/MCP
operator action is registered to invoke it yet; this is a trusted
application-layer admission candidate. A future opt-in runner integration
must atomically reserve a *project-bound*, single-use durable grant after
another fresh consent/evidence check and before any outbound network I/O;
no time-of-check authorization must be carried over from a view or
classification. Retest consent revocation at the send boundary. Installed
physical Windows validation and M19R6 operator notifications remain gated.

## M19R3I — Scoped one-shot consultation admission (source candidate)

The TrustedAdmittedAdvisorConsultation is a separately invoked trusted-host
library, NOT registered in a Cline task loop, scheduler, UI route or
operator MCP action. Its only caller inputs are the canonical task UUID
and trusted durable incident digest. It resolves project identity through
the authoritative machine/registry, holds an exclusive project policy
lease using the existing settings-save lock, rechecks the current M19R3H
gate, and rejects Off, Ask-first, unapproved human decisions, budget
exceptions, duplicate incidents and unavailable evidence.

When eligible, it derives a minimal typed request from current verified
task and TaskStore incident projections, verifies the shared cost quote,
then requests one short-lived M19R3C durable grant from a project-scoped
ledger. M19R3D consumes that grant before credential lookup. An optional
transport beforeSend() callback revalidates task/workspace identity, the
same still-open durable incident, exact saved consent revision, expiry
and per-incident limit AFTER credential resolution but BEFORE HTTP send.
Failed rechecks burn the grant without sending data. No retry or task
execution authority is created.

Saving policy Off during a consultation may return the existing busy
response, rather than silently altering a pending send. An Off action
cannot undo an already-sent consultation; later UI should clearly show
in-flight state and provide a cancellation strategy. Costs are operator
estimates, not provider billing proof. Production secret-provider
wiring and physical installed Windows acceptance remain gated.

This slice is source-level with mocked HTTP only, and does not enable
continuous consultations, task continuation, autonomous recovery or
operator push notifications.
