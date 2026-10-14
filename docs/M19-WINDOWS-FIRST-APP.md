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
