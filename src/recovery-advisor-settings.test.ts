import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AdvisorSettingsStore, AdvisorSettingsError } from "./recovery-advisor-settings.js";
import { startLocalOperatorControlServer } from "./local-operator-control.js";

const projectId=crypto.randomUUID();
const token="local-operator-"+"q".repeat(48);
const isError=(code:string)=>(e:unknown)=>e instanceof AdvisorSettingsError && e.code===code;
async function fixture(fn:(ctx:{
  directory:string; store:AdvisorSettingsStore; now:(v?:number)=>number;
})=>Promise<void>) {
  const root=await mkdtemp(path.join(os.tmpdir(),"advisor-settings-"));
  const directory=path.join(root,"operator-state");
  let at=1_000_000;
  const store=new AdvisorSettingsStore(directory,projectId,()=>at);
  try {await fn({directory,store,now:(next?:number)=>{
    if(next!==undefined)at=next;return at;
  }});} finally {await rm(root,{recursive:true,force:true});}
}
test("M19R3F defaults Off and persists bounded opt-in without credentials",async()=>{
  await fixture(async({directory,store})=>{
    const before=await store.inspect();
    assert.equal(before.mode,"off");
    assert.equal(before.externalCallsEnabled,false);
    assert.equal(before.grantsAuthority,false);
    await assert.rejects(store.save({
      expectedRevision:before.revision,mode:"automatic_advice",
      maxEstimatedCentsPerIncident:100,durationDays:7,
      acknowledgedExternalMetadata:false,
    }),isError("invalid"));
    const result=await store.save({
      expectedRevision:before.revision,mode:"automatic_advice",
      maxEstimatedCentsPerIncident:50,durationDays:7,
      acknowledgedExternalMetadata:true,
    });
    assert.equal(result.mode,"automatic_advice");
    const restarted=new AdvisorSettingsStore(directory,projectId,()=>1_000_000);
    assert.equal((await restarted.inspect()).revision,result.revision);
    assert.equal((await restarted.inspect()).mode,"automatic_advice");
    const disk=await readFile(path.join(directory,"recovery-advisor-settings-v1.json"),"utf8");
    assert.doesNotMatch(disk,/sourceCode|Bearer|credentialValue|apiKey/);
    await assert.rejects(store.save({
      expectedRevision:before.revision,mode:"off",
      maxEstimatedCentsPerIncident:10,durationDays:7,
      acknowledgedExternalMetadata:false,
    }),isError("stale"));
    const off=await restarted.save({
      expectedRevision:result.revision,mode:"off",
      maxEstimatedCentsPerIncident:10,durationDays:7,
      acknowledgedExternalMetadata:false,
    });
    assert.equal(off.mode,"off");
    assert.notEqual(off.revision,result.revision);
    assert.equal(off.externalCallsEnabled,false);
  });
});
test("M19R3F expiry never presents an enabled preference",async()=>{
 await fixture(async({store,now})=>{
  const before=await store.inspect();
  await store.save({expectedRevision:before.revision,mode:"automatic_advice",
    maxEstimatedCentsPerIncident:100,durationDays:7,acknowledgedExternalMetadata:true});
  now(1_000_000+7*86400000);
  const expired=await store.inspect();
  assert.equal(expired.mode,"off");
  assert.equal(expired.expired,true);
  assert.equal(expired.externalCallsEnabled,false);
 });
});
test("M19R3F refuses aliases, unsafe/corrupt state and wrong project binding",async()=>{
 await fixture(async({directory,store})=>{
  const before=await store.inspect();
  await store.save({expectedRevision:before.revision,mode:"automatic_advice",
    maxEstimatedCentsPerIncident:100,durationDays:30,acknowledgedExternalMetadata:true});
  const wrongProject=new AdvisorSettingsStore(directory,crypto.randomUUID());
  await assert.rejects(wrongProject.inspect(),isError("unsafe"));
  assert.throws(()=>new AdvisorSettingsStore("/",projectId),isError("unsafe"));
 });
});

async function port():Promise<number>{
 const s=createServer();
 await new Promise<void>(ok=>s.listen(0,"127.0.0.1",ok));
 const address=s.address();
 if(!address || typeof address==="string")throw Error("no port");
 await new Promise<void>(ok=>s.close(()=>ok()));
 return address.port;
}
test("M19R3F authenticated operator settings form supports save, pause and CSRF guards",async()=>{
 await fixture(async({store})=>{
  const p=await port();
  const base="http://127.0.0.1:"+p;
  const server=startLocalOperatorControlServer({
    getTask:async()=>{throw Error("task not needed")},
    rejectEscalation:async()=>{throw Error("task not needed")},
  } as never,{host:"127.0.0.1",port:p,token},{
    store,projectLabel:"Demonstration project",
  });
  const post=(data:Record<string,string>,cookie?:string,origin=base)=>
    fetch(base+"/operator/advisor-settings",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:origin,
        ...(cookie?{Cookie:cookie}:{})},
      body:new URLSearchParams(data),
    });
  try {
    assert.equal((await fetch(base+"/operator/advisor-settings")).status,401);
    const login=await fetch(base+"/operator/login",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base},
      body:new URLSearchParams({token}),
    });
    assert.equal(login.status,200);
    const cookie=(login.headers.get("set-cookie")??"").split(";")[0]!;
    const page=await (await fetch(base+"/operator/advisor-settings",{headers:{Cookie:cookie}})).text();
    assert.match(page,/AI recovery help/);
    assert.match(page,/Automatic advice/);
    assert.match(page,/Ask me first/);
    assert.match(page,/Off/);
    assert.match(page,/Saving this preference does not enable network calls/);
    assert.doesNotMatch(page,/private prompt|secret-value|<script/i);
    const csrf=page.match(/name="csrf" value="([0-9a-f]{64})"/)?.[1]!;
    const revision=page.match(/name="revision" value="([0-9a-f]{64})"/)?.[1]!;
    assert.ok(csrf&&revision);
    const options={csrf,revision,mode:"automatic_advice",cents:"50",days:"7"};
    assert.equal((await post(options,cookie)).status,400); // missing consent
    assert.equal((await post({...options,acknowledge:"yes"},cookie,"http://evil.invalid")).status,403);
    assert.equal((await post({...options,csrf:"bad",acknowledge:"yes"},cookie)).status,403);
    const result=await post({...options,acknowledge:"yes"},cookie);
    assert.equal(result.status,200);
    assert.match(await result.text(),/Settings saved/);
    const enabled=await store.inspect();
    assert.equal(enabled.mode,"automatic_advice");
    assert.equal((await post({...options,acknowledge:"yes"},cookie)).status,409);
    const pause=await post({
      csrf,revision:enabled.revision,mode:"off",cents:"50",days:"7",
    },cookie);
    assert.equal(pause.status,200);
    assert.equal((await store.inspect()).mode,"off");
    assert.equal((await fetch(base+"/operator/advisor-settings")).status,401);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
 });
});
