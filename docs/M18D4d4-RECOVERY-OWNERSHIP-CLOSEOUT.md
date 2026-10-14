# M18D4d4 — Service recovery ownership and rollback closeout review

**Disposition:** code-only and evidence-only; full physical recovery/ownership acceptance remains blocked.

M18D4d2 classifies six recovery scenarios. M18D4d3 checks that each scenario is represented for both platforms on one claimed candidate. **M18D4d4 adds a separate cleanup/ownership reconciliation** using the existing `planUninstall` authority-free manifest validation, without duplicating or bypassing its ownership safeguards.

## Acceptance contract

For both `systemd` and `windows-service`, supply an independently collected, pinned service recovery matrix and a matching cleanup observation (same manager, service name, run ID, artifact hash). The cleanup must include:

1. A valid platform-specific install manifest, with exactly one product-owned service registration for the scoped service, product-owned binaries and separately identified user-owned config, workspace registry, secrets and durable task state.
2. Exhaustive observed removed-product paths and removed-service registrations that match the manifest exactly; reject extra, missing, duplicate or cross-platform path identities (Windows paths compared case-insensitively).
3. Exhaustive preserved-user entries; independently measure before/after SHA-256 for each, proving the same data existed before and after, and certify inventory coverage via separate collection evidence.
4. Terminal absent registration and binary, stopped process, unhealthy loopback, with evidence of remediation after partial uninstall. Neither a partially removed product nor a bare declaration of completion is a release pass.
5. Captured and reviewed logs, a same-candidate archived npm package, exact deployed host identity/signature for Windows, non-wildcard localhost listener, disposable-runner isolation and clean shutdown.

`reviewServiceRecoveryCloseout` checks **only the consistency** of caller-supplied strings, inventory and observations. It performs no filesystem, process, network or service-manager operation, does not authenticate artifact or run provenance, and cannot measure real-world preservation. Even a complete review says `physicalAcceptanceProven: false`, `provenanceAuthenticated: false`, `userDataPreservationPhysicallyVerified: false` and cannot grant execution, credentials, workspace, release or cleanup authority. The explicit operator authorization to perform real, disposable service tests is separate.

## Physical release gates still open

- A separately reviewed and authorized **same-candidate** full recovery suite on disposable Windows and Linux, including conflict, double-install, start failure, recovery after crash, failed/partial removal and independently verified repair or rollback.
- Manifest ownership reconciliation against actual package-installed binaries and service registrations, plus operator-data sentinels measured before and after without exposing their contents.
- Windows installed native SCM host signature/provenance and application-level health; both operating systems' logs, identities, temporary environment cleanup, and independent reviewer sign-off.
- A final M18E installed GUI/operator acceptance and M18F explicit staged release decision; do not claim release-ready from green CI on this pure reviewer.

The earlier basic physical Windows SCM run #38364810465 and Linux VM #38504506033 use **different reviewed candidates**. They do not satisfy this same-candidate matrix. Do not merge broad development branches, relax runner isolation, or run this on a shared host to create passing evidence.
