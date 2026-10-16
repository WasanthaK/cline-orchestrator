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
