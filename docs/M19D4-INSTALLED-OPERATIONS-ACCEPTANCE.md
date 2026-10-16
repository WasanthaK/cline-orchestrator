# M19D4 — Installed Operations & Settings acceptance

**Status:** stacked review candidate after M19D3B / PR #60. No operator workstation installation or release.

## Goal and user-facing behavior

The first-run native Operations & settings overview must make setup states
understandable and task history discoverable without pretending a missing
source has zero tasks. When the authenticated foreground viewer is not running,
task and data-quality buttons indicate **open dashboard first** rather than
showing an unexplained disabled action. When the viewer runs, those links
retain existing passive Tasks and Data-quality drill-downs.

## Evidence and gates

A new Windows-hosted disposable installer smoke uses the actual bundled Node
and `operations-desktop`, against a fresh user-state directory, a synthetic
literal-loopback model endpoint, a stopped endpoint and corrupt local settings.
It checks no mutation of the saved config, sanitized output, explicit source
unknowns, bounded counts and no implicit task authorization.

A saturated 100-task page is not complete evidence: the projection now rejects
that size even if an upstream caller omits its completeness notice. A 99-row
verified bounded page may be reported as a sample, never an all-time total.
The existing passive browser UX and Windows compiled launcher are covered
by separate workflows.

**Still required:** dependency-chain merge #57 -> #58 -> #59 -> #60 -> M19D4;
exact-head CI green; real operator-machine accessibility/keyboard/visual
walkthrough; update/restart/rollback and uninstall-retention proofs; signing
and any Linux packaging decision in M19E. This slice deliberately adds no
task/model/daemon/service/release authority.
