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
