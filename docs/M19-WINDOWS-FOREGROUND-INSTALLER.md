# M19B — Windows foreground preview installer (unsigned candidate)

**Status: implementation candidate, not a public release.** This does not close M18D service lifecycle or M18F release authorization.

The user-scoped installer includes a self-contained .NET 8 Windows Forms launcher, pinned official Node 22.23.3 x64 executable, the privately packaged Orchestrator runtime and dependency tree, an NSIS installation wizard/Start Menu shortcut and uninstaller, plus a portable ZIP for review.

The launcher is **foreground, observation-only**: on explicit user launch, it creates an in-memory cryptographic viewing token, starts the existing read-only viewer on 127.0.0.1:4321, presents a Copy access code button, and opens the system browser without including the secret in the URL. Closing the launcher stops only its owned viewer child. No service manager, model, task, workspace/registry write, automatic approval or remote listener is included.

The Windows-only packaging script is at scripts/build-windows-foreground-bundle.ps1. It requires Node/npm, a .NET 8 SDK and NSIS on the **build** machine, but not on the **installed** machine. For a disposable build:

    pwsh -NoProfile -File ./scripts/build-windows-foreground-bundle.ps1 -OutputDirectory "$env:TEMP\m19b-unique" -Installer

The script refuses an existing output directory. It checks the exact Node binary SHA-256 from the official Node 22.23.3 release, packages the private runtime, publishes a Windows single-file self-contained launcher, and generates literal uninstall entries for every packaged file. No recursive uninstall deletion of user data is allowed. It writes BUILD-EVIDENCE.json with exact Git SHA and output hashes.

The dedicated 'Windows foreground installer acceptance' workflow checks build on disposable Windows CI, actual user-only silent install, installed Node/CLI config invocation, uninstall and preservation of an external sentinel. Uploaded executables are **unsigned review artifacts**, not GitHub Releases or approved public downloads.

**Known acceptance gaps:** first-run provider/workspace/Safety wizard (M19C); integrated settings and operational dashboard (M19D); clean-VM end-user testing, code signing, upgrades/rollback, real user approvals, security and UX acceptance (M19E). A native browser view cannot bypass the existing Safety Plan and confirmation services. Existing installs are refused, not overwritten.

Tracking: issue #49. M19A foundation: PR #50. M18D/M18F remain separately gated.
