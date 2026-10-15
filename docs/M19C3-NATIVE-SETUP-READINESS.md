# M19C3 — Windows-first local setup readiness

Status: review candidate, not a signed release. Completes the first-run readiness view without changing task execution authority.

The native Windows launcher now includes **Setup status**. It shows four clear steps with next-action buttons: Local model, Provider settings, Project registration, and Workspace & Safety. Those buttons open the existing independently confirmed native dialogs; Refresh is observation-only.

An installed Node command, **readiness-desktop**, reads only the fixed local user-owned configuration and the default workspace registry. It validates explicit saved configuration (not inferred defaults), checks that automatic command/edit approvals are disabled, and performs only the previously reviewed **literal-loopback model metadata** preflight on refresh. Registered workspaces must resolve to current canonical directories with explicit Safety and validation rules.

The snapshot contains only step states (ready / needed / attention), bounded project/workspace counts and a setup status. Raw paths, model IDs, endpoint URLs, tokens, provider errors, registry IDs and credentials are not emitted. A malformed, stale, unsafe or unreachable provider/registry is never reported as ready.

**Setup complete is not authorization to execute tasks.** It does not establish a running daemon, a lease, a granted workspace action, release readiness or a public installer. The passive browser remains read-only.

Acceptance: unit tests exercise new-install, configured local model, valid registered project/workspace, corrupt registry and unsafe configuration. Hosted installed-Windows smoke checks missing settings, a synthetic local model, disconnect degradation and malformed-file preservation, without touching real operator state. Full CI, browser acceptance and installer acceptance must pass on exact PR head.

Next milestones: M19D integrated operations/settings UX; M19E human-reviewed Windows/Linux install/update/uninstall; M18D/M18F remain independently gated.
