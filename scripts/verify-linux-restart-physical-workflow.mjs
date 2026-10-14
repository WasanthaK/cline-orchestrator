import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/linux-restart-physical-proof.yml", import.meta.url)),
  "utf8",
);
const candidate = "3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a";
assert.match(workflow, /^on:\n  workflow_dispatch:/m, "workflow must be manually dispatched");
assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|schedule|workflow_run):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /runs-on: ubuntu-24\.04/);
assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
assert.match(workflow, /inputs\.confirmation == 'RUN_DISPOSABLE_LINUX_RESTART'/);
assert.match(workflow, /RUNNER_KIND.*runner\.environment/);
assert.match(workflow, /ref: 3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a/);
assert.match(workflow, /EXPECTED_CANDIDATE: 3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a/);
assert.match(workflow, /ORCH_PROOF_CANDIDATE_SHA: 3cf0ae1f5e5e3ae873b2915113e5c382ae0dfe8a/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /npm ci --ignore-scripts/);
assert.match(workflow, /npm pack --ignore-scripts/);
assert.match(workflow, /npm install --global --prefix/);
assert.match(workflow, /ORCH_LINUX_RESTART_CONFIRMATION:.*inputs\.confirmation/);
assert.match(workflow, /ORCH_PROOF_PACKAGE_SHA256=/);
assert.match(workflow, /bash scripts\/prove-linux-restart-recovery-vm\.sh/);
assert.match(workflow, /if: always\(\)/);
assert.match(workflow, /No active disposable restart service or unit file detected/);
assert.equal((workflow.match(new RegExp(candidate, "g")) || []).length, 3,
  "all three candidate bindings must match the reviewed immutable commit");
// This is a static regression check only, not physical or workflow security proof.
console.log("PASS: manually gated pinned Linux crash/restart workflow structure");
