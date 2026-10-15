# M19 — Windows-first installable and configurable Cline Orchestrator

Status: **active product priority, initial contract implementation only**. Decision recorded 2026-10-15. Tracking: [issue #49](https://github.com/WasanthaK/cline-orchestrator/issues/49). Target branch: `milestone-13/delegation`.

## Product experience and scope

A developer should be able to obtain the Windows installer, install per-user without administrator privileges, launch Cline Orchestrator from the Start menu, connect a supported model, register a workspace and inspect work from the app. They should not need a source checkout, install Node separately, edit JSON manually or run PowerShell scripts.

M18 already proves that the installed npm CLI, authenticated read-only localhost viewer, and a real `llama.cpp`/Qwen supervised task can function. That is a **technical baseline**, not an end-user installer or safe browser setup wizard. M17's installer and setup plans describe authority but do not physically deliver a GUI installer.

**Initial release boundary:** foreground-only, localhost-only, no persistent Windows service/systemd or auto-start, no model download/installation, no GPU changes, no remote listener, no automatic command/edit approvals, and no automatic release, deployment or workflow start.

## Architecture decision

- **Windows host/launcher:** prefer a small **self-contained .NET** application using a local WebView2 view or launching the system browser. Evaluate UI/runtime availability, package size, sandbox/Origin protections and user-installed compatibility before selecting one; do not ship a WebView2 embedded privileged browser bridge just for convenience. Microsoft distribution guidance documents self-contained Windows options and recommends Evergreen WebView2 for most desktop hosts.
- **Runtime:** use a verified **bundled pinned Node executable**, exact npm-installed Orchestrator runtime dependencies and a versioned product manifest. Host controls launching/stopping a foreground child with no service registration; native packaging must run without a globally installed Node or npm. Candidate must prove launch/shutdown, ownership, port conflicts and rollback before claiming distribution readiness.
- **Local UI:** reuse the current loopback authenticated viewer and sanitized overview/task history; introduce configuration as a separate reviewed surface. Localhost authentication, session cookie, Origin and CSRF are mandatory for any mutation; no credential or one-shot token in URL, storage or rendered content.
- **Trusted configuration:** call the existing `first-run-guided-action`, `config-write-setup`, `registration-setup`, `SafetyPlanService`, `product-config` and preflight logic. The UI never validates or grants authority independently. Config writes/create-only registry actions require server-side freshness, exact scope and deliberate local confirmation. Existing files and symlinks fail closed; user-owned state remains outside the product install root.
- **Safety:** task submission and other mutations require a distinct capability, trusted Safety preview and explicit authorization; read-only pages never acquire authority by virtue of having a desktop window. No direct `ClineCore` shortcut in UI.

## Milestone slices

### M19A — Foreground installation ownership/layout contract (current)

Define a pure, nonexecuting Windows layout plan, backed by the existing M17 `installer-packaging` validation. Require separate install and operator-state directories, bounded safe file ownership, no bundled secrets/user files, no service registration, exact foreground mode, and explicit human execution/release gates. Automated negative cases include path overlap, unsafe/relative/system-root location, contradictory ownership, service-manager inclusion and non-Windows inputs.

M19A **does not** create a Windows binary, copy files, open a listener, install or remove anything. It is input validation for future M19B packaging; do not label M19A as an installable application.

### M19B — Windows foreground bundle and installer

Produce a **real** user-installable artifact that bundles exact Node and Orchestrator/dependencies, a launcher, version/provenance, UI entry, and only product-owned files. Ship a user-scoped Windows installer/upgrade/uninstaller with Start menu entry. Reject existing/conflicting installations without verified ownership; no service auto-registration. Runtime and installer binary signing/distribution require a later independent security/release review. Test clean Windows VM installation without Node, developer tools or source checkout, dual launch, interrupted launch, clean stop, port release, non-replacement, and idempotent repair.

### M19C — First-run wizard, one step at a time

Welcome/runtime readiness → choose provider, model and loopback URL → explicit preflight and discovered model identities → create config with a confirmed **create-only** write → choose/register project/workspace → define and confirm bounded allowed/protected paths and validation commands → readiness summary. Support `llama.cpp` without implying Ollama; no silent model download or runtime start. Separate approvals, cancel, stale/replay rejection, missing prerequisites and credential protection are acceptance requirements. Browser-facing mutation implementation needs a **distinct** authenticated Origin/CSRF/one-shot-authority security review.

### M19D — Operation, settings and evidence

Use design-thinking language: activity gauges for current system health, trend graphs only where time-series evidence is available, task lifecycle with independent validation and diff safety, source coverage notices showing **Unknown** vs verified zero, and deliberate drilldown for identifiers/technical details. Settings include provider/model endpoint, runtime limits, workspace registrations/Safety revisions, diagnostics, version and foreground lifecycle, with the same trusted backend services.

### M19D1 — Native integrated operations & settings (review candidate)

The Windows launcher offers an Operations & settings entry. Its read-only local
summary composes existing verified native setup states with the same trusted
sanitized task dashboard reader used by the passive browser viewer. It displays
bounded sample counts ONLY when the task source is verified, and explicitly
uses Unknown for unavailable, stale or truncated results. Other disconnected
workflow/incident/writer sources stay labeled unconnected.

The screen links to authenticated localhost task history and source quality
drilldowns, and reuses the existing confirmed setup dialog for settings and
registration. It adds no browser mutation, task, model, daemon or service
authority; create-only settings remain create-only. More complete revision-safe
settings editing, trend history and lifecycle management belong to later M19D
work and M19E review.

### M19D2 — Revision-checked native saved-model editor (review candidate)

From Operations & settings, Setup status or the launcher, the native editor
can inspect a saved local provider, model and literal /v1 endpoint with its
file revision. Credentials and private paths do not leave the native child.

Changes require fresh loopback model metadata, exact prior file revision,
the existing 60-second single-use setup review, and explicit UPDATE CONFIG.
A successful write atomically replaces verified user-owned config with a
create-only hash-named previous version retained for future rollback. Only
provider/model/endpoint fields change. Cancellation, stale state, symlinks,
unapproved runtimes, remote endpoints and unavailable models fail closed.
The original create-only first-run flow is unchanged.

Explicit restore/rollback UI and physical multi-process concurrency proof
remain pending. Preserving a previous version is not rollback acceptance.
No browser mutation or task/daemon/service/release authority is added.

### M19D3A — Verified recovery visibility (review candidate)

Saved previous settings are only *potential* recovery material. The native
settings editor now checks their filesystem type, immutable candidate name,
actual content SHA-256, bounded size, product configuration policy, disabled
automatic approvals, and literal-loopback provider endpoint. Missing or
corrupt current settings, untrusted backup names, aliases and partial reads
never report a verified zero or a restorable backup. The output is only a
bounded count and one of four explicit statuses; filenames, secrets, paths
and previous configuration content remain private.

**No restore action is implemented by M19D3A.** Real rollback requires a
separate exact prior-version selection/provenance, current revision lease,
human preview, crash-safe commit/retention, and fail-closed concurrent
writer/rollback acceptance. The current UI explicitly labels restore as
not enabled, even when backup bytes pass verification.

### M19D3B — Controlled restore of a verified local model (review candidate)

The native saved-model editor now offers a **Restore selected model** selector
populated only from verified bounded previous versions. The operator must
select an exact digest and approve a short-lived, single-use **RESTORE CONFIG**
review. Both the current file revision and backup hash/policy are rechecked
immediately before saving, and the restored loopback model must pass a fresh
metadata preflight. No remote model selection is allowed.

Restore changes *only* provider ID/model ID/local endpoint in the current
settings. Current runtime parameters, daemon and Safety permissions are
preserved and automatic approval remains disabled. The old current file is
retained as a create-only previous version. Stale revisions, corrupt backups,
concurrent modifications or failed verification refuse to restore; cancellation
leaves both files untouched. No browser action can reach this path.

No claim is made about adversarial OS-level compare-and-swap atomicity,
full historical rollback, or physical operator-machine acceptance. Those
remain release gates, along with signed release and M19E rollout.

### M19D4 — Installed Operations & Settings acceptance (review candidate)

The actual Windows-installed `operations-desktop` command must be exercised
in disposable **fresh**, **synthetic loopback connected**, **offline** and
**corrupt settings** scenarios. It may report a verified 0-task sample only
when the bounded task source is complete, never when missing, truncated or
saturated at the 100-record cap. No task IDs, raw paths, model identifiers,
credentials, execution authority or task-control routes may appear.

The native Operations screen labels disabled task-history and data-quality
drill-downs with the action the operator must take: open the separate
foreground dashboard. Browser viewer remains authenticated and read-only.
Source proof covers the full installed CLI; desktop interaction and
accessibility still require the M19E operator-machine walkthrough. Running
on disposable Windows CI does not install on an actual operator computer.

### M19E1 — Candidate provenance preflight (review candidate)

The disposable Windows CI must independently verify that its unsigned package
really corresponds to the checked-out exact Git SHA before installing it on
the disposable runner. The read-only verifier checks the embedded product
manifest against BUILD-EVIDENCE.json, pinned official Node 22.23.3 SHA-256,
the launcher and product CLI hash declarations, ZIP and unsigned installer
digests, and the packaged regular-file count. It rejects symlinked package
entries, any mismatch, an unsafe manifest claim, or an unknown/invalid
commit. The provenance check runs **before** CI installation.

The verification report is intentionally sanitized and says
`releaseAuthorized: false`, `signed: false`, and
`installationPerformed: false`. It does not publish artifacts, start
models/tasks, or install on the operator workstation.

This is **not** complete release provenance: a dependency SBOM, full
payload file-hash inventory, reproducible independent rebuild comparison,
clean-machine update/rollback and human Windows/Linux acceptance remain
open. M19E1 cannot be interpreted as signing or production approval.

### M19E2 — Runtime dependency SBOM and complete product file inventory (review candidate)

The disposable Windows artifact workflow now produces npm's **CycloneDX**
SBOM from the checked-out versioned source lockfile, explicitly omitting dev
dependencies. A separate verifier reads the actual installed consumer
`app/package-lock.json` and refuses the candidate when any installed
runtime dependency name/version is absent from the SBOM. It then hashes every
regular file in the installed Windows product bundle (not just the three
M19E1 core binaries) and records a deterministic, sorted manifest with SHA-256
and byte lengths.

The source Git SHA, bundle manifest, build evidence, runtime dependency
coverage, and SBOM digest must agree; symlinks, aliases, mismatched files,
unknown or malformed dependencies, and outdated manifests fail closed.
The SBOM and inventory are CI review artifacts only, not public releases or
authorization to install on an operator workstation. This proves **build
inventory consistency**, not cryptographic signing, reproducible independent
rebuilds or third-party package vulnerability-free status.

### M19E3A — Disposable Windows lifecycle and upgrade refusal (review candidate)

The hosted Windows acceptance suite now tests an occupied-target refusal
**before** the real fresh installation, validates a second-install refusal
without modifying installed binary hashes, and checks user-owned configuration,
registry, secret-reference and task-history placeholders against exact
SHA-256 evidence through uninstall. The script refuses to operate outside
a GitHub-hosted Windows runner, rejects existing user state, and does not
print paths or file contents. Full source/packaged candidate provenance,
browser checks and settings/Safety tests remain separate acceptance gates.

**Upgrade remains unsupported:** current NSIS intentionally rejects nonempty
targets. Binary rollback is not implemented or tested by this slice.
M19D3B model-connection recovery must never be mistaken for product
binary rollback. Independent transactional update/rollback design, clean VM
real-model work, human accessibility review, signing, Linux support and M18F
release authority remain pending.

### M19E3B — Binary upgrade/rollback design rehearsal (review candidate)

A pure in-memory candidate assessment and fault-transition simulation maps
the necessary Windows **upgrade** prerequisites without performing an upgrade.
The shipped unsigned installer still **refuses existing targets**. Candidate
source revision, installed product hash, version increase, exact signed
candidate and trusted signer, runtime SBOM/whole-bundle inventory, immutable
prior product snapshot, separate user-data integrity, no active viewer/writer,
explicit owner consent and independent M18F release approval are all required
before a real implementation may even be reviewed.

The model always returns `upgradeAvailable: false`,
`rollbackAvailable: false`, `releaseAuthorized: false` and
`grantsAuthority: false`. Even externally asserted perfect evidence only
advances to *independent implementation review*, never executable authority.
Fault rehearsal describes discard-before-switch vs restoring owned binaries
after an interrupted switch; it cannot do either action in the OS.
Any missing immutable prior snapshot requires manual recovery review.

Actual transactional update code, process lease barriers, locked-file behavior,
snapshot durability, crash recovery, Windows platform signing, independent
human review and Linux compatibility are still **pending**.

### M19E4A — Installed real-model pilot evidence gate (review candidate)

A non-executing and non-installing evidence assessor enumerates the real
Windows end-to-end pilot obligations: same exact candidate throughout the
installed manifest and runtime, independently checked provenance/SBOM/hashes,
**actually running** literal-loopback llama.cpp, advertised model alias and
harmless answer, a separately approved small Cline task in a disposable
workspace, independent validation/diff safety, reviewable task history,
foreground stop/port release, and user-owned data preservation after uninstall.

The code distinguishes actual operator observations from synthetic CI
fixtures. Missing, failed, contradictory, or synthetic-only claims block the
pilot. **Even all-positive unverified JSON never becomes a passing pilot or
release approval**: the most it can indicate is "ready for independent human
review." Raw paths, prompt text, task IDs, outputs and secrets are excluded
from public receipts. The operator still has to perform the real pilot using
the installed application and review actual local evidence.

Task execution requires *separate explicit approval* and existing trusted
Safety/workspace/lease boundaries. M19E4A adds no task-launch or browser
mutation API and never installs or starts a local model. Full live Cline
acceptance remains **not run** until actual machine evidence and human review.

### M19E — Candidate acceptance and wider OS coverage

Exact SHA/build provenance, hash and dependency SBOM → isolated VM installation → guided settings → real local Qwen task → browser/task evidence → foreground exit → update/rollback proof → uninstall preserving external config, registry, secrets and history. Windows first; plan Linux packaging against equivalent no-service/local-only boundaries. Follow targeted local checks with one reviewed exact-head CI candidate per cohesive slice, not continuous speculative full test runs.

## UI security and ownership gates

| Operation | Requirement |
|---|---|
| Install/package | Verify known product manifest/hashes, user install target, symlink/traversal/refusal policy; no task authority |
| Open viewer | 127.0.0.1 only, authenticated session, no-store and restrictive CSP; viewer is passive |
| Configure provider | Loopback preflight, named secret references, explicit create/replace policy, no raw secret rendering |
| Register workspace/Safety | Verified canonical root, exact policy and validation; confirmation with short expiry and one-time use |
| Start Cline task | Separate approved Safety preview + registered workspace + single writer; not allowed as a side effect of setup |
| Update/uninstall | Stop owned foreground process, inspect manifest and hashes, preserve all user-owned state, no mass delete |
| Enable persistent service or release | **Separate M18D/M18F gates**; M19 foreground success is not release approval |

## Acceptance status

- **Evidence already obtained:** older pinned Windows developer pilot passed real model task, independent validation/diff safety and read-only dashboard. Candidate `59eea2e8` completed another bounded task and exited with code 0; cause of earlier non-exit is still unconfirmed (issue #47).
- **Not yet demonstrated:** double-clickable installer, bundled runtime verification, Start menu launch, authorized browser configuration, install/uninstall ownership under Windows OS integration, customer-facing first-run accessibility and signed release. Keep all as **not passed** until tested.
