import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") throw new Error("Linux-only unit verification");
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), "orch-systemd-unit-"));
const npmCli = process.env.npm_execpath || createRequire(import.meta.url).resolve("npm/bin/npm-cli.js");
try {
  const archiveDir = path.join(temp, "archives");
  const prefix = path.join(temp, "consumer");
  await mkdir(archiveDir, {recursive:true});
  const run = (cmd, args, cwd=root) => {
    const result=spawnSync(cmd,args,{cwd,encoding:"utf8",timeout:600000,maxBuffer:8*1024*1024});
    if(result.error) throw result.error;
    assert.equal(result.status,0, cmd+" failed: "+(result.stderr||"").slice(-1000));
    return result.stdout;
  };
  const packed=JSON.parse(run(process.execPath,[npmCli,"pack","--ignore-scripts","--json","--pack-destination",archiveDir]));
  assert.equal(packed.length,1);
  const archive=path.join(archiveDir,packed[0].filename);
  run(process.execPath,[npmCli,"install","--global","--prefix",prefix,"--ignore-scripts","--no-audit","--no-fund",archive]);
  const index=path.join(prefix,"lib","node_modules","cline-orchestrator","dist","index.js");
  await readFile(index);
  const unitPath=path.join(temp,"cline-orchestrator.service");
  const unit=["[Unit]","Description=Cline Orchestrator disposable unit validation","[Service]","Type=simple",
    "WorkingDirectory="+path.dirname(index),"ExecStart="+process.execPath+" "+index+" daemon "+path.dirname(index),
    "Restart=no","NoNewPrivileges=true","[Install]","WantedBy=multi-user.target",""].join("\n");
  await writeFile(unitPath,unit);
  const found=spawnSync("systemd-analyze",["--version"],{encoding:"utf8"});
  if(found.error || found.status!==0) throw new Error("systemd-analyze is required; refusing to skip unit validation");
  run("systemd-analyze",["verify",unitPath],temp);
  assert.match(unit,/Type=simple/);
  console.log("PASS: installed Linux package runtime entrypoint and systemd unit static verification");
  console.log("NOT PROVEN: systemctl install/start/status/stop/uninstall; isolated manager required");
} finally {
  await rm(temp,{recursive:true,force:true});
}
