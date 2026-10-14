# M18D4d3 — Disposable service recovery evidence review

Scope: evidence-only review of the **remaining physical recovery matrix**; this document does **not** authorize or perform system service operations. The existing M18D4d2 scenario classifier only interprets caller-supplied snapshots. M18D4d3 adds coverage and identity-consistency review across both supported platforms without assuming the supplied run IDs, hashes, inventory or snapshots are authentic.

## Minimum reviewed candidate matrix

Both platforms must exercise the **same pinned full commit SHA**, with independently captured installed artifact SHA-256, disposable runner identity, service name and operator-data inventory. A basic successful create/start/stop/delete test is insufficient. The six scenario rows must be collected on **each** platform (12 observations total):

| Scenario | Observable acceptance question | Release gate |
|---|---|---|
| Foreign install conflict | Is an unrelated service/artifact refused without changes? | Independently inspect before/after identities and foreign artifacts |
| Duplicate install | Is repeat registration refused without replacement? | Independently confirm no changed registration, files or running state |
| Failed start | Is failure bounded and reported without secret disclosure? | Independently verify no listener, unexpected service or leaked state |
| Restart recovery | Does the actual installed process recover after a controlled failure? | Independently check service-manager state and loopback application health |
| Partial uninstall | Is interrupted removal identified and contained? | **Requires subsequent cleanup/rollback proof**; the observation itself is not a pass |
| Complete uninstall | Are product-owned service and binaries removed, preserving data? | Independently verify no residual registration and user-owned state unchanged |

## Evidence to retain outside the code

- GitHub run URL/ID, manual authorization record, isolated machine/VM identity, pinned commit, installed artifact SHA-256 and (Windows) native host signing/provenance evidence.
- Before/after service-manager state, application-level loopback health, product-owned registration/artifact identity, cleaned-up files, error/exit observations and redacted logs for each scenario.
- Complete enumerated user-owned workspace/config/secret/durable-task state inventory with pre/post digests, including the independent way coverage and equality were checked.
- For each failure, explicit non-escalating operator remediation and a separate verified terminal state; partial uninstall remains unresolved until a cleanup/rollback scenario is physically demonstrated.
- Reviewer sign-off on artifact origin, run provenance, scope containment and cleanup, distinct from the executor's explicit authorization. Keep credentials and personal operator data out of logs and PR fixtures.

## Code behavior and open gates

`reviewServiceRecoveryMatrix` requires 6 scenario observations for both `systemd` and `windows-service`, with consistent service manager/name, digest-shaped artifact identity, run ID and a common full candidate SHA. It classifies missing, duplicate, malformed/cross-bound and inconsistent observations, and separately reports partial-uninstall follow-up. It never probes the OS, invokes an installer, starts a service, mutates files, authorizes execution or authenticates caller claims. Even a complete self-reported matrix sets `physicalAcceptanceProven: false`, `provenanceAuthenticated: false` and `userDataPreservationPhysicallyVerified: false`.

Current physical history is **basic lifecycle only**: Windows SCM run #38364810465 and Linux systemd disposable VM run #38504506033 used **different pinned candidates**. Do not combine them into a falsely unified recovery acceptance record. Real, separately authorized, same-candidate full recovery runs and independent review remain to be done. Milestone 18D and 18F stay open.
