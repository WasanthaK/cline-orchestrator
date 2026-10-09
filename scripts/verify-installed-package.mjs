import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.npm_execpath, "Run through npm run verify:installed-package");
const tmp = await mkdtemp(path.join(os.tmpdir(), "orch-m18c2-"));
const prefix = path.join(tmp, "prefix"), artifacts = path.join(tmp, "artifacts");
const owned = path.join(tmp, "operator-data"), home = path.join(tmp, "home");
const sentinel = "RAW_SECRET_M18C2_SENTINEL_71b029";
const env = { ...process.env, HOME: home, USERPROFILE: home,
 APPDATA: path.join(home, "AppData"), XDG_CONFIG_HOME: path.join(home, "xdg"),
 npm_config_cache: path.join(tmp, "npm-cache"), npm_config_update_notifier: "false" };
for (const key of Object.keys(env)) if (key.startsWith("ORCH_") || key === "npm_config_prefix") delete env[key];
const run = (command, args, cwd = tmp, timeout = 180000) => {
 const result = spawnSync(command, args, { cwd, env, encoding:"utf8", timeout, maxBuffer:4*1024*1024, windowsHide:true });
 if (result.error) throw result.error;
 return result;
};
const npm = (args, cwd = tmp) => run(process.execPath, [process.env.npm_execpath, ...args], cwd, 600000);
const ok = (r, label) => assert.equal(r.status, 0, label + ": " + r.stderr?.slice(-1000));
const hash = (v) => createHash("sha256").update(v).digest("hex");
const exists = async p => { try { await stat(p); return true; } catch(e) { if(e.code === "ENOENT") return false; throw e; } };
try {
 for (const d of [prefix, artifacts, owned, home]) await mkdir(d, {recursive:true});
 const entries = ["config/config.json","registry/workspaces.json","secrets/provider.ref","tasks/task-state.json"];
 const hashes = new Map();
 for (const name of entries) {
  const p = path.join(owned,name); await mkdir(path.dirname(p),{recursive:true});
  await writeFile(p, "PRESERVE_"+name+"\n"); hashes.set(name, hash(await readFile(p)));
 }
 const packed = npm(["pack","--ignore-scripts","--json","--pack-destination",artifacts],root);
 ok(packed, "pack");
 const list = JSON.parse(packed.stdout); assert.equal(list.length,1);
 const archive = path.join(artifacts,list[0].filename); assert.ok(await exists(archive));
 ok(npm(["install","--global","--prefix",prefix,"--ignore-scripts","--no-audit","--no-fund",archive]),"install");
 const windows = process.platform === "win32";
 const modulePath=windows ? path.join(prefix,"node_modules","cline-orchestrator") : path.join(prefix,"lib","node_modules","cline-orchestrator");
 const shim=windows ? path.join(prefix,"cline-orchestrator.cmd") : path.join(prefix,"bin","cline-orchestrator");
 const runInstalled = args => windows
  ? run(process.env.ComSpec || "cmd.exe", ["/d","/c", `cline-orchestrator.cmd ${args.join(" ")}`], prefix)
  : run(shim,args);
 assert.ok(await exists(modulePath)); assert.ok(await exists(shim));
 assert.ok(await exists(path.join(modulePath,"dist","product-cli.js")));
 const config=runInstalled(["config"]); ok(config,"installed config");
 const output=JSON.parse(config.stdout);
 assert.equal(output.command,"config"); assert.equal(output.grantsAuthority,false);
 assert.equal(output.mutatesConfig,false); assert.equal(output.startsService,false);
 assert.equal(output.payload.daemon.host,"127.0.0.1");
 assert.equal(output.payload.runtime.autoApproveEdits,false);
 assert.equal(output.payload.runtime.autoApproveCommands,false);
 const bad=path.join(tmp,"invalid.json");
 await writeFile(bad,JSON.stringify({schemaVersion:1,provider:{apiKey:sentinel}}));
 const rejected=runInstalled(["--config",bad,"config"]);
 assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/Product configuration is invalid; check schema, field types and secret references/);
 assert.ok(!(rejected.stderr+rejected.stdout).includes(sentinel),"secret leaked");
 assert.equal(await exists(path.join(home,".cline-orchestrator")),false);
 assert.equal(await exists(path.join(home,"xdg","cline-orchestrator")),false);
 ok(npm(["uninstall","--global","--prefix",prefix,"--ignore-scripts","--no-audit","--no-fund","cline-orchestrator"]),"uninstall");
 assert.equal(await exists(modulePath),false); assert.equal(await exists(shim),false);
 assert.ok(await exists(prefix));
 for (const [name,expected] of hashes) assert.equal(hash(await readFile(path.join(owned,name))),expected,name);
 console.log(JSON.stringify({slice:"M18C3",platform:process.platform,package:list[0].filename,installedCli:true,
  sanitizedRejection:true,removed:true,operatorSentinelsPreserved:hashes.size,
  serviceInstalled:false,daemonStarted:false,grantsAuthority:false}));
} finally { await rm(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:150}); }
