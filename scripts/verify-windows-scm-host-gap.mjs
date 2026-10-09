import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "win32") throw new Error("Windows-only SCM host readiness gate");
const root=fileURLToPath(new URL("../",import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
const bin=manifest.bin?.["cline-orchestrator"];
assert.equal(bin,"dist/product-cli.js","installed CLI contract changed; review SCM assumptions");
assert.equal(manifest.private,true,"distribution contract changed; review Windows SCM readiness");
assert.ok(!Object.values(manifest.bin||{}).some(value=>/service-host\.exe$/i.test(String(value))),
  "A native service host was added; require dedicated SCM lifecycle acceptance before publication");
console.log("PASS: Windows packaging exposes a CLI, not a verified SCM service host");
console.log("BLOCKED: SCM install/start/stop/uninstall must not be claimed from CLI packaging proof");
