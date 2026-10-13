# M18D4 — Physical service integration readiness and proof gates

Assessment date: 2026-10-09. Source-only review against `7328ef59729b58cd494f0ba9e284f6baef828984`, CI #1372 green.

## What is supported today

- The npm package ships `dist/product-cli.js` as `cline-orchestrator`. It is a CLI, not a proven Windows Service Control Manager service host.
- M17E exposes an injected `LocalServiceLifecycleDriver` with install/start/stop/status; it does not ship concrete Windows SCM or Linux systemd process adapters.
- M18D1 validates and renders **non-executing** installation previews. The Windows path requires a no-argument native service-host executable; arguments to the ordinary CLI are rejected.
- M18D2 produces **non-executing** platform command plans; Linux unit file placement/removal is explicitly not implemented, and no plan constitutes OS authorization.
- M18D3 tests lifecycle contracts with fake drivers. It does not prove an installed service can actually start, report readiness, stop, or uninstall.
- M18C validates installed CLI execution and npm uninstallation on Windows and Ubuntu. It does not validate SCM/systemd integration.

## Blocking implementation gaps

1. **Linux service host:** prove the packaged foreground process and signal-driven shutdown work under a disposable systemd manager; specify the exact unit ownership, location, permissions, working directory, stderr/stdout handling and stop timeout. Never assume the CLI `start` command is a daemon entrypoint merely because it exists.
2. **Windows SCM:** ship or integrate a real, signed/verified service-host implementation with proper SCM start/control/stop semantics before allowing `sc.exe create`. Existing Node CLI cannot be passed off as that host.
3. **Ownership and rollback:** verify create/start/status/stop/uninstall on each disposable platform, including idempotency, installation conflict, failed start, failed stop, partial uninstall and exact restoration of only files owned by installer. User-owned workspace/config/registry/task/secrets must remain unchanged.
4. **Authority boundaries:** no automatic install/enable/start, no arbitrary command execution via a preview, no credential leakage, no external listeners, and no escalation of task/FS/release capabilities. Status-only reads must stay non-mutating.
5. **Artifact acceptance:** invoke service workflows using the actual packaged candidate, not source-tree shortcuts. Capture logs and identity/checksums and run on isolated runners/VMs with explicit temporary service-manager authority, never the user's shared machine.

## Proposed bounded sequence

- **M18D4a:** service-host contract/readiness tests and strict fail-closed capability assessment (no OS mutation).
- **M18D4b:** Linux packaged foreground host plus disposable systemd lifecycle integration with dedicated runner/VM proof.
- **M18D4c:** dedicated Windows SCM service-host adapter and disposable Windows service lifecycle proof.
- **M18D4d:** recoverability/ownership/failure matrix, closeout documentation, and complete CI evidence.

M18D is **not complete** on the current evidence. In particular, GitHub-hosted CI green for the existing suite does not establish installed service-manager interoperability.
