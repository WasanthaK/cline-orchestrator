import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prove-linux-restart-recovery-vm.sh", import.meta.url));
const syntax = spawnSync("bash", ["-n", script], { encoding: "utf8", timeout: 10000 });
if (syntax.error) throw syntax.error;
assert.equal(syntax.status, 0, "proof script must parse without executing");

for (const [label, vars, expected] of [
  ["no approval", {
    ORCH_LINUX_RESTART_CONFIRMATION: "", GITHUB_ACTIONS: "false",
  }, /explicit proof confirmation absent/],
  ["forged local opt-in", {
    ORCH_LINUX_RESTART_CONFIRMATION: "RUN_DISPOSABLE_LINUX_RESTART",
    GITHUB_ACTIONS: "false", RUNNER_OS: "Linux",
    ORCH_PROOF_RUNNER_KIND: "github-hosted",
  }, /GitHub-hosted Linux runner required/],
]) {
  const run = spawnSync("bash", [script], {
    env: { ...process.env, ...vars },
    encoding: "utf8",
    timeout: 10000,
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 64, label + ": invalid context must refuse before operations");
  assert.match(run.stderr, expected);
  assert.equal(run.stdout, "", "refused execution must not print proof receipts");
}
console.log("PASS: disposable restart script syntax and unapproved fail-closed gates");
