# M19D3B — Controlled local model restoration

Status: stacked development candidate after PR #59. **Not installed or merged.**

A native-only restore-choices-desktop snapshot lists at most 32 SHA-256-verified,
policy-safe previous model selections (provider/model/loopback URL), never
full configuration, secret material, arbitrary file paths or task state.
Malformed/symlinked/hard-linked/changed previous-version files poison the
candidate set rather than being silently ignored.

A restore-model-desktop <current SHA-256> <backup SHA-256> request requires:
(1) a currently valid fixed user-state config, (2) exact current revision,
(3) exact verified backup hash and safe configuration policy, (4) successful
literal loopback model metadata preflight, (5) an explicit separate native
RESTORE CONFIG confirmation with the existing 60-second single-use token,
and (6) renewed current/backup/provider checks immediately before mutation.

Restoration changes **only** the provider ID, model ID and local endpoint,
preserves all current runtime/daemon settings including disabled auto-approvals,
and retains the previous current file via the M19D2 create-only sibling
backup protocol. Cancellation, tampering, stale/conflicting updates, expired
confirmations and offline models fail closed.

No viewer/browser mutation endpoint, daemon/model/task activation, service
installation, release or rollback of source/workspaces is introduced.
Physical release acceptance (M19E), adversarial process-race/atomic filesystem
signoff, broader config recovery, and signed installer decisions remain pending.

Acceptance: full source tests, Chrome passive-viewer suite and installed
disposable Windows synthetic-model restore smoke, including cancellation,
retention, unchanged runtime and stale-revision refusal.
