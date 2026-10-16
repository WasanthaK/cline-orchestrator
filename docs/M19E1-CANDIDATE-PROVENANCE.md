# M19E1 — Unsigned Windows Candidate Provenance Gate

Status: stacked review candidate on top of M19D4 PR #61. This does not authorize deployment, signing, installation on an operator workstation or a public release.

## Purpose

Before using the existing disposable Windows installer-smoke harness, check
that a single built candidate corresponds to the exact Git revision selected
by the hosted run. The checks use only fixed local artifact files and do not
invoke any installer, model, Cline task, service or remote API.

The verifier rejects absent, altered, redirected or stale evidence:
- BUILD-EVIDENCE.json and embedded product-manifest.json agree with the exact SHA.
- Node 22.23.3's pinned x64 SHA-256 matches the installed bundle runtime.
- Embedded launcher and installed product CLI SHA-256 values match actual bytes.
- The portable archive and unsigned NSIS installer match external SHA-256 evidence.
- Bundle contains only regular files/directories, without symlinks; its regular-file count agrees with the packager.
- No service/model/task/config mutation or release authority is asserted.

## Scope limit

Passing is **candidate integrity consistency**, not an authenticity signature,
full-SBOM/whole-tree cryptographic attestation, reproducible clean rebuild,
confirmed rollback, installation on this workstation, real llama.cpp integration,
or human accessibility/product acceptance. Unsigned artifacts remain internal
review candidates, retained per CI retention limits.

## Next gates

1. Integrate reviewed M19D PR #57 through #61 in dependency order, then land
   this preflight only on the exact review head after all CI checks pass.
2. Produce a complete dependency inventory/SBOM and full bundle inventory hash
   with a separate policy review; record candidate SHA and review packet.
3. Run clean VM install/first run, and a separately approved bounded real
   local llama.cpp task in disposable workspace with validation/diff proof.
4. Demonstrate user-state preservation across fresh install, upgrade policy,
   rollback/recovery, restart and uninstall. Candidate currently refuses
   installation into an existing target; upgrades are **not** implemented.
5. Obtain explicit release/signing and Linux support decisions under the
   independent M18F/M19E gates. Do not infer those from green CI.
