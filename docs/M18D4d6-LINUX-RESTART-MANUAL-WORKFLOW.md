# M18D4d6 — Narrowly registered Linux restart physical proof workflow

Status: **manual-workflow registration proposal only; no physical execution authorized or claimed**.

This narrow change to `main` registers `.github/workflows/linux-restart-physical-proof.yml`. It is **only** `workflow_dispatch` and only creates a job when the dispatch ref is `main`, the repository matches, and the human dispatch input exactly equals `RUN_DISPOSABLE_LINUX_RESTART`. It uses an ephemeral GitHub-hosted `ubuntu-24.04` VM, `contents: read` and a fixed source checkout of the reviewed Milestone 18 branch commit `3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a`. The script comes from that immutable checkout; it is never evaluated from the moving `main` branch. Checkout credentials are not persisted.

The runner performs read-only VM/pin preflights, then builds and installs the pinned npm candidate to its temporary consumer prefix. **Only** the final separately authorized proof step invokes the reviewed `scripts/prove-linux-restart-recovery-vm.sh`, which guards service-manager operations, creates a uniquely named temporary runtime unit, checks loopback application health, crashes only its main process, verifies failed state, explicitly restarts it, checks recovery and removes the owned unit. A final always-run inspection fails if a leftover unit or active service is found.

Ordinary PR CI **never** invokes the proof. A static regression check in `scripts/verify-linux-restart-physical-workflow.mjs` validates the workflow's manual trigger, pin, opt-in and negative default; it is not an isolation, privilege, artifact-signature or actual physical proof.

Before a physical dispatch, separately approve the exact candidate/workflow, review GitHub Actions permissions and the hosted VM's temporary service mutation, then trigger on **main** with the literal opt-in. Capture the run URL, archive/package digest, crash/restart health evidence and cleanup output. Failure means physical acceptance is **not established**. This tests Linux restart only, not full ownership, rollback or Windows SCM; M18D and M18F remain open.
