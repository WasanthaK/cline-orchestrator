# M19C2B1 — Native Windows project registration

**State:** candidate implementation awaiting exact-head CI. Windows-first Milestone 19. M19C1 provider connection and M19C2A create-only provider configuration are already merged.

The foreground launcher now has **Register project**. A local native window asks for a project name and, when the operator selects **Review and register**, invokes a new installed `setup-project-desktop` command. This is a fixed local registry action (no selectable path or config override) using the established `runRegistrationSetup("register_project", ...)` trust boundary.

The command validates the project name, verifies existing registry structure and state snapshot, and emits only a bounded project review over redirected stdout. The native window checks the action, name, scope, one-time confirmation phrase and short expiry before showing an explicit **Yes/No** review with the local registry destination. Yes passes `REGISTER PROJECT` over the owned child-process stdin; No passes `CANCEL`. Existing setup service consumes confirmation once and revalidates the registry snapshot. The result displays the created project UUID for the next workspace step.

The browser/dashboard remains **read-only**. Project registration neither registers a workspace nor gives file editing access, a task lease, a model execution capability, a daemon or an OS service.

## Acceptance

- Unit tests: approved project exactly once, cancellation without registry creation, malformed/symlink registry fail-closed, name injection rejection and dedicated CLI-route isolation.
- Hosted disposable Windows: build installed launcher; invoke installed Node CLI to confirm, cancel and preserve a malformed existing registry; verify zero workspaces; then uninstall and preserve external data.
- No direct user-workstation install, auto-start, code signing or public release.

**Next:** M19C2B2 adds workspace registration with explicit root, Safety allow/protected patterns, max changed files and validation commands, using the same `runRegistrationSetup` confirmation service. The native UI must render the canonical workspace root, and tests must prove duplicate/system-root rejection, changes after preview and authority isolation. M18D/M18F remain separately gated.
