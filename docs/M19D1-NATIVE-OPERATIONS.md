# M19D1 — Integrated read-only operations and settings

Status: **review candidate**, not installed/released. Base: M19C3 merged #56.

## User journey

From the Windows Start-menu launcher, **Operations & settings** shows a status
summary rather than sending the operator through setup-only dialogs. It
explains model and Safety readiness, project/workspace counts, task activity
and the limits of evidence coverage. **Task history and evidence** opens the
existing authenticated localhost viewer at the Tasks section, which already
supports bounded task rows, independent validation/diff-safety indicators and
sanitized task timeline drilldowns. **Data quality details** opens its existing
source-provenance section. Both buttons are unavailable if the owned foreground
viewer is not running.

**Setup & settings** opens the existing native setup-status wizard. Model
settings remain **confirmed create-only**, and project/workspace registration
continues through the existing trusted one-time backend approvals. This slice
does not introduce replace/revise settings or new browser mutations.

## Evidence discipline

`operations-desktop` composes `readiness-desktop` with the existing machine
passive snapshot reader. Task counts are a **current bounded sample of at most
100 records**, never an all-time task count, success rate or invented trend.
Unknown/stale/truncated/unavailable sources return null counters, not zero.
Workflow, incident, writer and specialist feeds remain *not connected*.
Native output excludes workspace paths, task identifiers/goals, provider URLs,
model IDs, secrets, worker reports and source exceptions.

This command accepts no parameters or config overrides; only runs with Windows
local user-state context; uses observation APIs and rejects any task worker
profile resolution. It starts no daemon/model/Cline task, creates no browser
mutation route and grants no new approval/credential/release authority.

## Acceptance required

Source typecheck/tests, passive-browser acceptance, hosted Windows launcher
build and unsigned installer lifecycle. Tests cover available task samples,
missing/stale/truncated source handling, rejection of unsafe readiness,
bounded fields and invalid CLI arguments. M19E still requires human acceptance
on clean operator machines, update/rollback and uninstall retention, plus
Windows/Linux and signed release decisions.
