# M19E2 — Installed runtime SBOM and whole-bundle inventory

Status: **stacked development candidate**, based on M19E1 PR #62. No signing, release or operator workstation installation.

## Evidence generation

The disposable Windows acceptance workflow uses `npm sbom --sbom-format cyclonedx --omit=dev` on the exact checked-out source root after pinned `npm ci`. npm's generated CycloneDX file is stored as `DEPENDENCY-SBOM.cdx.json`. This deliberately uses the **source root**, not the installed consumer prefix; npm creates an anonymous `app@` prefix root and cannot generate a valid root package URL from it.

`windows-candidate-inventory.mjs create` creates a new, create-only
`BUNDLE-INVENTORY.json` containing sorted relative product file names,
byte sizes, SHA-256 and the source commit. It refuses symlinks, hardlinks,
unsupported Windows names, collisions and unbounded inventories.

## Independent pre-install verification

`windows-candidate-inventory.mjs verify` runs before the disposable CI install.
It independently scans every packaged file, compares hashes against the
create-only inventory, checks the actual installed consumer `app/package-lock.json`
dependency name/version set is represented by CycloneDX components, verifies
the SBOM SHA-256, and cross-checks the build and embedded manifest Git SHA.

The console receipt is sanitized and explicitly marks `signed:false`,
`installationPerformed:false`, `releasesSoftware:false`,
`grantsAuthority:false`. Negative source tests cover a tampered runtime
file, replaced SBOM, missing dependency, stale source SHA, symlinked payload,
and create-only inventory persistence.

## Known limits / next gates

A transitive component inventory and package-lock comparison does **not** prove
vulnerability freedom, fully reproducible builds, provenance of every upstream
package, code signature authenticity or stable upgrade/uninstall behavior.
Exact source package versions remain governed by existing npm lockfiles and
standard supply-chain policy. Real model task, UI accessibility, configuration
update/rollback and human clean-machine acceptance remain M19E gates.

No browser mutation, task/model/daemon launch, automatic service install,
GitHub Release or publication authority is introduced.
