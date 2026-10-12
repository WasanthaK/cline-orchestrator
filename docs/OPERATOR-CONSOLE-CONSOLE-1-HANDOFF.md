# Operator Console — Console-1 implementation handoff

Baseline: `2e4299e` on `milestone-13/delegation`.

Source of requirements: Work's attached `OPERATOR-CONSOLE-IMPLEMENTATION-PLAN.md`. This change independently recreates the first read-only slice; it is **not** the unavailable Work commit `521abf4`.

## Console-1 delivered

- Login POST uses an HTTP 303 See Other redirect to `/viewer`, retaining the existing session cookie, same-origin check, CSP, no-store responses and 127.0.0.1 listener.
- Passive task table displays project identifiers, validation and diff safety as Passed/Failed/Not available.
- Overflow tables are labelled keyboard-focusable regions, with visible focus and selected-section anchors.
- Read-only snapshot guidance explains explicit reload, ten-minute session expiry, bounded task history, disconnected sources, and why leases are not agent health.
- Existing passive renderer has no client scripts, mutations, external links or privileges. Hosted installed-package, HTTP and Chrome tests cover the changed login behavior.

## Follow-on backlog

Console-2: snapshot-aware overview redesign with connected/disconnected/stale/truncated feeds and project/workspace summary coverage.

Console-3: bounded passive task details and filtering, with security review for any new routes. Continue to avoid task data, raw paths, secrets, full worker output and browser mutations.

Console-4 onward: dedicated monitoring, guided configuration, human attention, sanitized event history and product UX acceptance. M18D physical SCM/systemd and M18F release remain separately gated.

**Verification:** CI required before merge. Local Windows installation is unchanged until the operator explicitly updates the integrated branch.
