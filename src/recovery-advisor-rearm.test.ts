import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createServer} from "node:http";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {AdvisorSettingsStore,AdvisorSettingsError} from "./recovery-advisor-settings.js";
import {DurableAdvisorStop,AdvisorStopError} from "./recovery-advisor-stop.js";
import {WorkspaceRegistry} from "./workspace-registry.js";
import {createNativeAdvisorProjectBinding} from "./native-advisor-project-binding.js";
import {startLocalOperatorControlServer} from "./local-operator-control.js";

const error=(code:string)=>(e:unknown)=>e instanceof AdvisorSettingsError&&e.code===code;
async function fixture(run:(ctx:{root:string;projectId:string;store:AdvisorSettingsStore;
 stop:DurableAdvisorStop})=>Promise<void>) {
 const root=await mkdtemp(path.join(os.tmpdir(),"orch-advisor-rearm-"));
 const projectId=crypto.randomUUID(),dir=path.join(root,"state",projectId);
 const store=new AdvisorSettingsStore(dir,projectId);
 const stop=new DurableAdvisorStop(dir,projectId);
 try{await run({root,projectId,store,stop});}
 finally{await rm(root,{recursive:true,force:true});}
}
async function enable(store:AdvisorSettingsStore) {
 const state=await store.inspect();
 return store.save({expectedRevision:state.revision,mode:"automatic_advice",
  durationDays:7,maxEstimatedCentsPerIncident:50,
  acknowledgedExternalMetadata:true});
}
test("M19R3L restart-safe reset leaves advisor Off and demands fresh opt-in",async()=>{
 await fixture(async({projectId,store,stop,root})=>{
  const enabled=await enable(store);
  await stop.stopNow();
  const stopped=await store.inspect();
  assert.equal(stopped.stopLatched,true);
  assert.equal(stopped.mode,"off");
  const restarted=new AdvisorSettingsStore(path.join(root,"state",projectId),projectId);
  const reset=await restarted.resetStop(enabled.revision);
  assert.equal(reset.stopLatched,false);
  assert.equal(reset.mode,"off");
  assert.notEqual(reset.revision,enabled.revision);
  assert.equal((await restarted.readCurrentPolicy())?.mode,"off");
  assert.equal(await stop.isStopped(),false);
  await assert.rejects(store.resetStop(enabled.revision),error("stale"));
  const optedIn=await enable(restarted);
  assert.equal(optedIn.mode,"automatic_advice");
  assert.equal(optedIn.externalCallsEnabled,false);
  assert.equal(optedIn.grantsAuthority,false);
 });
});
test("M19R3L reset cannot race an active policy lease or bypass its revision",async()=>{
 await fixture(async({store})=>{
  await enable(store);
  await store.stopNow();
  const saved=await store.inspect();
  await store.withCurrentPolicyLease(async()=>{
   await assert.rejects(store.resetStop(saved.revision),error("busy"));
   assert.equal((await store.inspect()).stopLatched,true);
  });
  await assert.rejects(store.resetStop("1".repeat(64)),error("stale"));
  assert.equal((await store.inspect()).stopLatched,true);
  await store.resetStop(saved.revision);
  assert.equal((await store.inspect()).mode,"off");
 });
});
test("M19R3L cross-process transition contention fails closed",async()=>{
 await fixture(async({store,stop,root,projectId})=>{
  await enable(store);await stop.stopNow();
  const mutex=path.join(root,"state",projectId,".recovery-advisor-stop-transition");
  await mkdir(mutex);
  try {
   assert.equal(await stop.isStopped(),true);
   await assert.rejects(stop.stopNow(),
    (e:unknown)=>e instanceof AdvisorStopError&&e.code==="state_unavailable");
   await assert.rejects(store.resetStop((await store.inspect()).revision),error("unsafe"));
   assert.equal((await store.inspect()).stopLatched,true);
  }finally {await rm(mutex,{recursive:true,force:true});}
  // Even if Off was committed before the failed transition, the marker is
  // still present; repeated reset must not silently resume old consent.
  const state=await store.inspect();
  assert.equal(state.mode,"off");
  await store.resetStop(state.revision);
  assert.equal((await store.inspect()).mode,"off");
 });
});
test("M19R3L malformed stop marker is never treated as clear",async()=>{
 await fixture(async({store,root,projectId})=>{
  const configured=await enable(store);
  const dir=path.join(root,"state",projectId);
  await writeFile(path.join(dir,"recovery-advisor-stopped-v1.json"),"{broken",{
   mode:0o600});
  await assert.rejects(store.resetStop(configured.revision),
    (e:unknown)=>e instanceof AdvisorSettingsError&&e.code==="unsafe");
 });
});
async function freePort():Promise<number>{
 const server=createServer();
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();
 if(!address||typeof address==="string")throw Error("port_missing");
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 return address.port;
}
test("M19R3L authenticated project reset is one click, CSRF protected and stays Off",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"orch-advisor-rearm-ui-"));
 try{
  const registry=new WorkspaceRegistry(path.join(root,"registry","projects.json"));
  const alpha=(await registry.registerProject("Alpha")).projectId;
  const beta=(await registry.registerProject("Beta")).projectId;
  const binding=createNativeAdvisorProjectBinding(registry);
  const store=(await binding.resolveProject(alpha)).store;
  await enable(store);
  await store.stopNow();
  const port=await freePort(),base="http://127.0.0.1:"+port;
  const token="trusted-operator-"+"A".repeat(48);
  const server=startLocalOperatorControlServer({
   getTask:async()=>{throw Error("unexpected task mutation");},
   rejectEscalation:async()=>{throw Error("unexpected task mutation");},
  } as never,{host:"127.0.0.1",port,token},binding);
  try{
   const url=base+"/operator/advisor-reset";
   const post=(cookie:string,data:Record<string,string>,origin=base)=>
    fetch(url,{method:"POST",headers:{Origin:origin,
     "Content-Type":"application/x-www-form-urlencoded",Cookie:cookie},
     body:new URLSearchParams(data)});
   const login=await fetch(base+"/operator/login",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base},
    body:new URLSearchParams({token})});
   const cookie=(login.headers.get("set-cookie")??"").split(";")[0]!;
   assert.equal(login.status,200);
   const page=await(await fetch(base+"/operator/advisor-settings?project="+alpha,
    {headers:{Cookie:cookie}})).text();
   assert.match(page,/Reset Stop \(leave AI advice off\)/);
   const csrf=page.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1]!;
   const revision=page.match(/name="revision" value="([a-f0-9]{64})"/)?.[1]!;
   assert.ok(csrf&&revision);
   assert.equal((await fetch(url,{method:"POST",headers:{
    Origin:base,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({csrf,project:alpha,revision})})).status,401);
   assert.equal((await post(cookie,{csrf,project:alpha,revision},"http://evil.invalid")).status,403);
   assert.equal((await post(cookie,{csrf:"invalid",project:alpha,revision})).status,403);
   assert.equal((await post(cookie,{csrf,project:crypto.randomUUID(),revision})).status,404);
   const res=await post(cookie,{csrf,project:alpha,revision});
   assert.equal(res.status,200);
   assert.match(await res.text(),/AI recovery help remains Off/);
   assert.equal((await store.inspect()).mode,"off");
   assert.equal((await store.inspect()).stopLatched,false);
   assert.equal((await (await binding.resolveProject(beta)).store.inspect()).mode,"off");
   assert.equal((await post(cookie,{csrf,project:alpha,revision})).status,409);
   const newPage=await(await fetch(base+"/operator/advisor-settings?project="+alpha,
    {headers:{Cookie:cookie}})).text();
   assert.doesNotMatch(newPage,/Reset Stop \(leave AI advice off\)/);
   assert.match(newPage,/Automatic advice/);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }finally{await rm(root,{recursive:true,force:true});}
});
