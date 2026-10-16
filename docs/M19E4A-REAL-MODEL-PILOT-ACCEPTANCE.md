# M19E4A — Real-model pilot evidence and independent acceptance

**Status:** draft/stacked source slice. This is an observation contract,
**not** a completed pilot, automatically launched Cline task or release signoff.

## Objective

Test the **installed** foreground Windows application end to end with an
already running, real `llama.cpp` OpenAI-compatible model and one separately
authorized, bounded task in a newly created disposable Git repository.

The product must be tested as a developer actually experiences it: Start menu
launch, first-run model selection, confirmed project/workspace/Safety setup,
Operations & settings, authenticated task-history drill-down and clean exit.

## Pilot checklist (operator, not CI)

1. Record the reviewed exact source commit, unsigned installer SHA-256 and
   bundled manifest identity; match M19E1 provenance and M19E2 inventory/SBOM.
2. Use a disposable Windows machine with no existing installation or
   registered workspaces. Install the exact reviewed candidate through the
   normal user-facing installer; do not extract/modify source or bypass UI.
3. Inspect the already-running `llama.cpp` local model at a literal
   127.0.0.1 (or IPv6 loopback) `/v1` URL. Verify the configured model
   alias exactly matches the discovered identity, then ask a harmless
   non-synthetic prompt. Do not install, download, change GPU flags or start
   another model as part of app setup.
4. Register one new disposable Git project/workspace through confirmed native
   setup. Set an explicit Safety profile that limits changed files and paths,
   includes protected paths and a bounded validation command.
5. **Only after a separate human approval**, start one small supervised Cline
   task using the existing trusted command/authority path; do not add a
   browser task-start button. Capture completion, task events, independent
   validation, diff-safety result, checkpoint and review that changes stayed
   within the disposable scope. Denial must not start a task.
6. Inspect the authenticated localhost dashboard, task timeline and status
   gauges. Unavailable feeds must remain **Unknown**, not verified healthy.
   Confirm buttons have no mutation route or implicit release authority.
7. Close the foreground app and verify owned processes stop and loopback
   ports release. Uninstall only product-owned files; compare byte hashes of
   external config, registry, secret references and task history.

## What the evidence code proves (and does not)

`inspectM19E4AEvidence` maps these 11 acceptance obligations into
fail-closed `needs_evidence`, `failed` or `review_only` statuses.
Synthetic or missing data is never accepted as real-model/task evidence.
A "ready_for_independent_human_review" result is **not** a passed pilot,
authenticated attestation, installed-system validation, permission grant or
release approval. The assessor never executes or installs anything.

**Remaining:** real-device witnessed pilot; independent artifact/task
provenance review; Windows keyboard/accessibility acceptance; true binary
upgrade/rollback engine and interruption evidence; Linux packaging decision;
signed build/release approval under M18F. This code does not impersonate those
checks and does not add task, model, daemon, filesystem, credential or release
authority.
