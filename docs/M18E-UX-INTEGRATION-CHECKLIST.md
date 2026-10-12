# M18E UX integration candidate — review and local-preview gates

Status: **integration candidate, not merged or released**  
Source: complete linear UX sequence PRs #6–#21 ending at `3eb4cbf2c926135eb775dcc22b2739197b08f3b2`  
Target: `milestone-13/delegation` (not `main`).

## What is included

- Read-only operator overview, task/workflow/incident/source-state views and passive task review.
- Guided first-run readiness and separately trusted **in-process** setup/review action adapters; the browser does **not** gain setup or approval authority from these adapters.
- Explicit foreground `cline-orchestrator viewer` with a separately provisioned local token and **127.0.0.1-only** HTTP transport.
- Source-confidence warnings: disconnected/stale task, workflow and incident metrics display **Unknown**; optional writer/handoff feeds remain unknown until connected.
- Create-only offline setup-view export; static renderer and npm-installed CLI acceptance.
- Hosted Chrome/ChromeDriver installed-viewer testing, keyboard skip navigation, mobile/desktop screenshot evidence and installed Windows/Linux package acceptance.
- Packaged `npm-shrinkwrap.json` for reproducible consumer installs.

## Required integration checks before merge

1. Confirm branch ancestry and that `milestone-13/delegation` is the intended base. Do not merge unrelated changes into `main`.
2. Verify the integration PR's **exact head** passes hosted typecheck/full tests and packaged-artifact checks on Windows and Linux, plus installed Chrome browser acceptance. If a check fails, fix on this branch and rerun.
3. Inspect the actual changed-file list for accidental credentials, runtime/host authority widening, workflow auto-dispatch, additional public binds or unauthorized service install/release behavior.
4. Confirm the CLI/viewer stays local-only, observation-only and opt-in. Confirmation services remain trusted in-process mechanisms; no browser action endpoint is authorized here.
5. Review generated desktop/mobile screenshots. Automated Chrome smoke is **not** human visual signoff, WCAG 2.2 AA certification or cross-browser proof.
6. Do not describe M18D Windows SCM/Linux systemd physical lifecycle proof as complete; Linux physical systemd proof is still outstanding. M18F production release is separately authorized.
7. Do not install/replace the user's existing local checkout until its branch, status, uncommitted changes, worktrees and installed service/listener state have been inspected. Do not run `git reset --hard`, delete local data or overwrite their configuration to resolve integration.

## Local preview after successful integration

From `C:\Users\User\cline-orchestrator` on Windows, **first** inspect `git status --short --branch`, `git branch -vv`, `git remote -v` and the active listener/service configuration. Only when the working tree and intended branch are safe should the operator fetch and fast-forward from the chosen integration branch.

The read-only viewer is a foreground CLI process, **not** a Windows service; supply a freshly generated strong `ORCH_VIEWER_TOKEN` in the local terminal, run the built `cline-orchestrator viewer`, and manually open `http://127.0.0.1:4321/viewer`. The browser's token is entered through its login form, never through a URL. Stop the foreground command after use. A visual preview is not authority for task execution or production operations.

## Unresolved UX/product gaps

Live supervisor/workflow/incident/write-lock feeds, integrated graphical setup actions, full agent/task operation screens, WCAG audit, cross-browser human review, GUI install/uninstall experience, and final operator acceptance still need separate work. The integrated deliverable is a usable **read-only dashboard preview**, not a finished control console.
