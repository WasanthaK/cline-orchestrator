# M18D4d5 — Guarded disposable Linux restart recovery proof

**Prepared, not physically executed.** This slice introduces `scripts/prove-linux-restart-recovery-vm.sh` with negative guard tests and a syntax gate in ordinary PR CI. It extends the existing Linux physical **basic** lifecycle proof, but **does not replace or re-dispatch** the historical pinned workflow.

## Manual execution prerequisites

This is a service-mutating proof and must run **only** after a separately authorized, reviewed `workflow_dispatch` on a GitHub-hosted disposable Ubuntu systemd VM, from a narrowly registered workflow on `main`.

- Pin a **literal reviewed 40-character candidate commit SHA** in the workflow checkout. Do not accept a caller-editable arbitrary checkout commit with privileged service access. The script independently checks its `ORCH_PROOF_CANDIDATE_SHA` against `git rev-parse HEAD`.
- Before any service mutation, set `ORCH_LINUX_RESTART_CONFIRMATION=RUN_DISPOSABLE_LINUX_RESTART`, `ORCH_PROOF_RUNNER_KIND=github-hosted`, and keep the standard GitHub run/ref/repository identity environment. The workflow must require its own literal operator confirmation; passing the script's environment variable alone must not constitute that authorization.
- Build and install a **real candidate npm tarball** inside `RUNNER_TEMP`. Point `ORCH_PROOF_PACKAGE` at that tarball, `ORCH_PROOF_ENTRY` at the **installed** `dist/index.js`, and `ORCH_PROOF_PACKAGE_SHA256` at the independently measured tarball SHA-256. Set `ORCH_PROOF_PORT` to a reviewed isolated loopback TCP port and refuse an occupied port.
- Preserve `Restart=no` so failure is observed before an independently requested restart. Never switch to host-altering container privileges, self-hosted runners, generic user supplied unit names, unreviewed commands or auto-start registration.
- **Do not invoke from ordinary CI, a developer terminal or the user's shared workstation.** CI runs only `bash -n` and refusal-path tests with absent/forged opt-in.

## Physical observations targeted

1. Refuse incorrect manual authorization, runner identity, candidate checkout, package hash, outside-temp artifacts, occupied port, preexisting service unit, non-systemd host and unsafe paths before any unit mutation.
2. Create exactly one namespaced `/run/systemd/system/cline-orch-restart-<run-id>.service` with `Restart=no`, disabled auto-approval, temporary workspace/home and loopback-only daemon.
3. Observe actual installed daemon health and TCP listener; SIGKILL **only** the uniquely owned unit's main process; require `systemd` failed state and health endpoint disappearance.
4. Explicitly reset and restart that same unit; require renewed application health; stop and require released listener.
5. Always stop/remove only the owned temporary unit through an EXIT cleanup trap; preserve hashes of four newly created **disposable** user-data sentinels and the package/entrypoint. A cleanup failure makes the overall proof fail.

No workspace/task, real user-data, installer, system-wide installed binary, Windows SCM service or credentials are modified. These steps **cannot** prove the other M18D4d scenarios (foreign conflict, duplicate install, failed start, partial/complete uninstall), real user-data preservation, signed native-host identity, same-candidate cross-platform evidence or production readiness.

## Release gates

The manual proof workflow itself is **not added or registered** in this slice. First review its exact pinned candidate and isolation; separately register or amend the minimal workflow on `main`, obtain explicit manual authorization, run it on the GitHub-hosted VM, record run/asset hashes and logs, and independently verify cleanup. M18D remains open and M18F release blocked even if this focused crash/restart proof later passes.
