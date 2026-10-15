import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32" || process.argv.length !== 4) throw new Error("Installed Windows CLI required");
const [node, entry] = process.argv.slice(2);
const root = await mkdtemp(path.join(os.tmpdir(), "m19d3b-installed-"));
const state = path.join(root, "user-state");
const directory = path.join(state, "ClineOrchestrator");
await mkdir(directory, { recursive: true });
const env = { ...process.env, LOCALAPPDATA: state };
for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("ORCH_")) delete env[key];

const server = createServer((req,res) => {
  if (req.url !== "/v1/models") { res.writeHead(404); res.end(); return; }
  res.writeHead(200,{ "Content-Type":"application/json" });
  res.end(JSON.stringify({ data:[{id:"old-model"}] }));
});
const digest = s=>crypto.createHash("sha256").update(s).digest("hex");
async function run(args,reply) {
  const child = spawn(node,[entry,...args],{env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr="",reviewed=false;
  child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk=>{
    stdout+=chunk;
    if(reply!==undefined && !reviewed && stdout.includes("\n")) {
      reviewed=true;
      const doc=JSON.parse(stdout.split("\n")[0]);
      assert.equal(doc.kind,"settings-restore-review");
      assert.equal(doc.requiresExactReply,"RESTORE CONFIG");
      assert.equal(doc.grantsAuthority,false);
      child.stdin.end(reply+"\n");
    }
  });
  child.stderr.on("data",chunk=>{stderr+=chunk;});
  const status=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve)});
  return {status,stdout,stderr,reviewed};
}
try {
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  const url="http://127.0.0.1:"+server.address().port+"/v1";
  const old=JSON.stringify({schemaVersion:1,
    provider:{providerId:"openai-compatible",modelId:"old-model",baseUrl:url},
    runtime:{maxIterations:17,autoApproveCommands:false,autoApproveEdits:false},
    daemon:{host:"127.0.0.1"}});
  const current=JSON.stringify({schemaVersion:1,
    provider:{providerId:"openai-compatible",modelId:"new-model",baseUrl:url},
    runtime:{maxIterations:5,autoApproveCommands:false,autoApproveEdits:false},
    daemon:{host:"127.0.0.1"}});
  const target=path.join(directory,"config.json"),backup=path.join(directory,"config.previous-"+digest(old)+".json");
  await writeFile(target,current); await writeFile(backup,old);
  const options=await run(["restore-choices-desktop"]);
  assert.equal(options.status,0,options.stderr);
  const choices=JSON.parse(options.stdout);
  assert.equal(choices.command,"restore-choices-desktop");
  assert.equal(choices.readOnly,true);
  assert.equal(choices.grantsAuthority,false);
  assert.equal(choices.currentRevision,digest(current));
  assert.deepEqual(choices.choices.map(x=>x.revision),[digest(old)]);
  assert.doesNotMatch(options.stdout,/config.json|user-state|apiKeySecretRef/);
  const args=["restore-model-desktop",digest(current),digest(old)];
  const declined=await run(args,"CANCEL");
  assert.equal(declined.status,0,declined.stderr);
  assert.equal(JSON.parse(declined.stdout.trim().split("\n").at(-1)).outcome,"cancelled");
  assert.equal(await readFile(target,"utf8"),current);
  const approved=await run(args,"RESTORE CONFIG");
  assert.equal(approved.status,0,approved.stderr);
  assert.equal(JSON.parse(approved.stdout.trim().split("\n").at(-1)).outcome,"restored");
  const saved=JSON.parse(await readFile(target,"utf8"));
  assert.equal(saved.provider.modelId,"old-model");
  assert.equal(saved.runtime.maxIterations,5);
  assert.equal(saved.runtime.autoApproveCommands,false);
  assert.equal(saved.runtime.autoApproveEdits,false);
  assert.equal(await readFile(backup,"utf8"),old);
  assert.equal(await readFile(path.join(directory,"config.previous-"+digest(current)+".json"),"utf8"),current);
  const stale=await run(args,"RESTORE CONFIG");
  assert.notEqual(stale.status,0);
  assert.equal(stale.reviewed,false);
  assert.equal((await readdir(directory)).length,3);
  console.log(JSON.stringify({proof:"M19D3B-installed-model-restore",
    reviewed:true,cancelledWithoutMutation:true,restoredPreviousModel:true,
    currentRuntimePreserved:true,staleDenied:true,grantsAuthority:false}));
} finally {
  if(server.listening) await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
}
