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
