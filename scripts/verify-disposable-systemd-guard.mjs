import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script=fileURLToPath(new URL("./prove-disposable-linux-systemd.sh",import.meta.url));
const env={...process.env};
delete env.ORCH_DISPOSABLE_SYSTEMD_PROOF;
const result=spawnSync("bash",[script],{env,encoding:"utf8",timeout:10000});
if(result.error) throw result.error;
assert.equal(result.status,64,"systemd lifecycle harness must refuse unapproved execution");
assert.match(result.stderr,/explicit disposable proof opt-in missing/);
assert.equal(result.stdout,"");
console.log("PASS: unapproved Linux systemd lifecycle proof fails closed before service access");
