# M19D2 — Native saved-model settings revision

Status: stacked development candidate on M19D1 PR #57, **not merged, installed or released**.

The launcher, readiness wizard and operations overview expose **Edit saved model**.
A native-only `settings-desktop` reads provider/model/local endpoint metadata and
a SHA-256 file revision from fixed Windows user-owned state; an unsafe/missing
config is not editable. No raw private paths, full config or credential values
appear in the native review output.

`update-settings-desktop` accepts the exact previous SHA-256 revision,
provider/model/loopback URL; after fresh model metadata preflight, it delegates
to the existing 60-second, single-use `FirstRunSetupService` review and
requires a separate **UPDATE CONFIG** local-host reply. The backend rechecks
saved configuration and connectivity, writes a fsynced temporary file, retains
the exact old file as a create-only `config.previous-<SHA256>.json`, then
renames the replacement. Existing backups block rather than overwrite;
cancellation, stale revision and malformed/unsafe config fail closed.

Provider, model and endpoint only are editable in M19D2. Runtime policies,
workspace Safety and registry revision editors remain separate future slices.
Backups are retained for potential future rollback; automatic restoration,
crash-durability guarantees and robust adversarial cross-process CAS are
**not proven**. Concurrent hostile writers remain a boundary to address before
production or signed release.

Acceptance: focused source tests plus installed disposable Windows synthetic
model/config update, cancellation, stale-revision and previous-byte retention.
No browser POST mutations, worker/tool approval, daemon/model start, service,
operator-machine install or signing. M19E and M18F independently pending.
