# M19E3B — Transactional upgrade and rollback design, not an updater

Status: **design and test-only stacked PR**, following M19E3A PR #64. No code
path in this slice copies or deletes a binary, calls NSIS, restarts a process,
or changes local services, tasks, user settings or installed state.

## Candidate and review gates

The future Windows user-scoped updater must first prove current installation
ownership and revision, candidate source commit and every package hash,
runtime SBOM and inventory, independent signature/trust, a full product-only
immutable prior-version snapshot, explicit user authorization, independent
M18F release gate, no active task lease, stopped owned viewer and launcher,
and unchanged external configuration, registry, secrets and task history.

The public dry-run result shows enumerated blockers without exposing paths,
tokens, local models or credentials. A complete hypothetical evidence set is
**not** a trusted attestation; it can only start independent design review.

## Intended durable transaction (not yet implemented)

1. Observe exact current product revision and external-state fingerprints.
2. Stage verified candidate in a distinct product-owned directory without
   changing the active installation or external data.
3. Create and fsync an immutable, complete previous product snapshot,
   validating paths, hashes, ownership and no symlinks/reparse points.
4. Explicitly quiesce launcher/viewer/writer and confirm no active leases.
5. Review exact candidate/source/signature with the operator and independent
   release gate. An unsigned preview must be refused.
6. Replace only product-owned binaries using a Windows-safe two-phase
   activation/rename journal; record durable state before each transition.
7. Launch only after independent health checks. On pre-commit failure,
   restore verified previous product or hold in explicit manual recovery,
   never silently recover by overwriting user-owned state.
8. Retain immutable previous-version evidence until independent post-upgrade
   approval; record operator-visible version and rollback status.

M19E3B unit tests exercise fail-closed conditions and simulated interruption
before and after a conceptual switch. **None** is an executed binary swap,
real rollback, crash-durability proof, CI installation, or production rollout.

## Independent gates remaining

M19E3A CI acceptance, full executable upgrade and rollback isolation,
signed distribution strategy, real llama.cpp task on a fresh Windows VM,
accessible on-device UI acceptance, Linux install strategy, and M18F
release authorization. User-owned data must remain separate at all times.
