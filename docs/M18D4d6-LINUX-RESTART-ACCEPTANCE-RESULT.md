# M18D4d6 — Linux physical crash/restart acceptance result

**Status:** physical scenario proven for a specifically pinned disposable GitHub-hosted Linux VM run on 2026-10-14. This is **not** full M18D acceptance.

| Evidence | Observed value |
|---|---|
| Workflow run | [#38523549243](https://github.com/WasanthaK/cline-orchestrator/actions/runs/38523549243) |
| Workflow conclusion | Completed — success, attempt 1 |
| Runner | GitHub-hosted Ubuntu 24.04 disposable VM |
| Trigger / explicit opt-in | workflow_dispatch on main / `RUN_DISPOSABLE_LINUX_RESTART` |
| Dispatcher commit | `de004fc0631bff7716630a392deb4b3cf380dc5d` |
| Pinned source candidate | `3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a` |
| Built npm tarball | `cline-orchestrator-0.1.0.tgz` |
| Logged tarball SHA-256 | `561f11e8b60fadd1c2b09515d474b4bf5807aa5c1f5ac92f74d9d2062f6a6b4b` |
| Application listener | loopback-only, proof port 43719 |
| Service identity | `cline-orch-restart-38523549243.service` (temporary) |

## Verified execution log outcomes

1. GitHub-hosted VM identity, systemd PID1 and immutable source checkout preflights succeeded.
2. The product was built, packed, installed in a disposable npm consumer prefix, and the actual installed entrypoint was used.
3. The service initially reported healthy on loopback with no active task.
4. Controlled SIGKILL of **only the temporary owned service main process** caused systemd to report failed and the health endpoint to become unavailable.
5. The same service recovered only after an explicit `systemctl reset-failed` and `start`; application-level loopback health returned.
6. The service was stopped, its port released, its owned unit file removed, and an independent final residue check found no active temporary service or unit.
7. The four **temporary fixture** sentinels and package/entrypoint hashes were preserved.

The job log contains all five `PASS:` receipts plus the final `No active disposable restart service or unit file detected` inspection. This record reports observed outcomes and **does not** issue execution authorization or assert an independently signed artifact identity.

## Remaining release blockers

Windows SCM still requires installed-host provenance/signature, application-level health and crash/rollback acceptance on the same reviewed candidate. Both OSs still require independently proven conflict/duplicate-install/failed-start/partial-removal/complete-uninstall ownership and terminal cleanup, not merely self-reported evidence. User-owned state in real deployments was not inspected. M18D remains open; M18F release remains blocked.
