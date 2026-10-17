import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {AdvisorSettingsStore,AdvisorSettingsError} from "./recovery-advisor-settings.js";
import {DurableAdvisorStop} from "./recovery-advisor-stop.js";
import {OneShotRecoveryAdvisor,type AdvisorTransportConfigV1} from "./recovery-advisor-transport.js";
import {WorkspaceRegistry} from "./workspace-registry.js";
import {createNativeAdvisorProjectBinding} from "./native-advisor-project-binding.js";
import {startLocalOperatorControlServer} from "./local-operator-control.js";
const config:AdvisorTransportConfigV1={
 schemaVersion:1,enabled:true,endpoint:"https://api.openai.com/v1/responses",
 model:"test-model",timeoutMs:3000,maxOutputTokens:128,maxCallsPerHour:2,
 maxEstimatedCentsPerHour:10,inputUsdPerMillionTokens:1,outputUsdPerMillionTokens:2,
};
const request={
 schemaVersion:1,incidentId:"a".repeat(64),taskStatus:"stalled",
 signal:"watchdog_stall",attempts:1,consent:true,evidenceOnly:true,
};
const credential=async()=> "example-runtime-test-secret-key";
const approve=async()=>true;
const response=()=>new Response(JSON.stringify({
 status:"completed",output:[{type:"message",role:"assistant",content:[{
 type:"output_text",text:JSON.stringify({
 schemaVersion:1,decision:"inspect_evidence",confidence:"medium",
 })}]}],usage:{input_tokens:100,output_tokens:20},
}));
async function fixture(run:(dir:string,id:string,store:AdvisorSettingsStore)=>Promise<void>){
 const root=await mkdtemp(path.join(os.tmpdir(),"orch-advisor-stop-"));
 const id=crypto.randomUUID(),dir=path.join(root,"project",id);
 try{await run(dir,id,new AdvisorSettingsStore(dir,id));}
 finally{await rm(root,{recursive:true,force:true});}
}
async function enabled(store:AdvisorSettingsStore) {
 const start=await store.inspect();
 await store.save({expectedRevision:start.revision,
  mode:"automatic_advice",maxEstimatedCentsPerIncident:50,durationDays:7,
  acknowledgedExternalMetadata:true});
}
test("M19R3K emergency Stop bypasses occupied lease; survives restart",async()=>{
 await fixture(async(dir,id,store)=>{
  await enabled(store);
  const latch=new DurableAdvisorStop(dir,id);
  const before=await store.inspect();
  assert.equal(before.mode,"automatic_advice");
  assert.equal(before.stopLatched,false);
  await store.withCurrentPolicyLease(async()=>{
   const stopped=await store.stopNow(); // no consultation-lock acquisition
   assert.equal(stopped.persisted,true);
   assert.equal(stopped.deliveryCanBeRecalled,false);
   assert.equal(await latch.isStopped(),true);
   assert.equal((await store.inspect()).mode,"off");
   assert.equal((await store.readCurrentPolicy()),undefined);
  });
  const restarted=new AdvisorSettingsStore(dir,id);
  const view=await restarted.inspect();
  assert.equal(view.mode,"off");
  assert.equal(view.stopLatched,true);
  await assert.rejects(restarted.save({expectedRevision:view.revision,
   mode:"automatic_advice",maxEstimatedCentsPerIncident:50,durationDays:7,
   acknowledgedExternalMetadata:true}),
   (e:unknown)=>e instanceof AdvisorSettingsError && e.code==="unsafe");
  assert.equal((await restarted.stopNow()).status,"stopped");
 });
});
test("M19R3K stop monitor cancels provider HTTP and discards advice",async()=>{
 await fixture(async(dir,id,store)=>{
  await enabled(store);
  const watch=store.watchImmediateStop(50);
  let began:()=>void=()=>undefined;
  const started=new Promise<void>(resolve=>{began=resolve;});
  let sent=0;
  const transport=new OneShotRecoveryAdvisor(config,(async(_url,options)=>{
   sent++;
   began();
   return await new Promise<Response>((resolve,reject)=>{
    if(options?.signal?.aborted) {reject(new Error("aborted"));return;}
    options?.signal?.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
   });
  }) as typeof fetch);
  try {
   const pending=transport.consult(request,{authorizeOnce:approve,
    resolveCredential:credential,beforeSend:async()=>!await store.isEmergencyStopped(),
    cancellationSignal:watch.signal});
   await started;
   await store.stopNow();
   const report=await pending;
   assert.equal(report.reason,"cancelled");
   assert.equal(report.contacted,true); // HTTP had begun; not recalled
   assert.equal(report.grantsAuthority,false);
   assert.equal(report.retryAuthorized,false);
   assert.equal(sent,1);
  } finally {watch.close();}
 });
});
test("M19R3K stop before send denies sending and even provider advice receipts",async()=>{
 await fixture(async(_dir,_id,store)=>{
  await enabled(store);
  const watch=store.watchImmediateStop(50);
  let sent=0;
  const transport=new OneShotRecoveryAdvisor(config,(async()=>{
    sent++;return response();
  }) as typeof fetch);
  try{
   await store.stopNow();
   const report=await transport.consult(request,{
    authorizeOnce:approve,resolveCredential:credential,
    beforeSend:async()=>!await store.isEmergencyStopped(),
    cancellationSignal:watch.signal,
   });
   assert.equal(report.contacted,false);
   assert.ok(["cancelled","permission_denied"].includes(report.reason??""));
   assert.equal(sent,0);
  }finally{watch.close();}
 });
});
async function port():Promise<number>{
 const server=createServer();
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const a=server.address();if(!a||typeof a==="string")throw Error("missing-port");
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 return a.port;
}
test("M19R3K authenticated one-click Stop is project-bound and CSRF protected",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"orch-advisor-ui-stop-"));
 try{
  const registry=new WorkspaceRegistry(path.join(root,"registry","projects.json"));
  const first=(await registry.registerProject("Alpha")).projectId;
  const second=(await registry.registerProject("Beta")).projectId;
  const binding=createNativeAdvisorProjectBinding(registry);
  const store=(await binding.resolveProject(first)).store;
  await enabled(store);
  const p=await port(),base="http://127.0.0.1:"+p,token="operator-"+"x".repeat(48);
  const app=startLocalOperatorControlServer({
    getTask:async()=>{throw Error("not a task action");},
    rejectEscalation:async()=>{throw Error("not a task action");},
  } as never,{host:"127.0.0.1",port:p,token},binding);
  try {
   const endpoint=base+"/operator/advisor-stop";
   assert.equal((await fetch(endpoint,{method:"POST",headers:{
    "Content-Type":"application/x-www-form-urlencoded",Origin:base},
    body:new URLSearchParams({project:first,csrf:"x".repeat(64)})})).status,401);
   const login=await fetch(base+"/operator/login",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base},
    body:new URLSearchParams({token})});
   assert.equal(login.status,200);
   const cookie=(login.headers.get("set-cookie")??"").split(";")[0]!;
   const page=await(await fetch(base+"/operator/advisor-settings?project="+first,
    {headers:{Cookie:cookie}})).text();
   assert.match(page,/Stop AI advisor now/);
   const csrf=page.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1]!;
   const post=(details:Record<string,string>,origin=base)=>fetch(endpoint,{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",
      Origin:origin,Cookie:cookie},body:new URLSearchParams(details)});
   assert.equal((await post({csrf:"wrong",project:first})).status,403);
   assert.equal((await post({csrf,project:first},"http://evil.invalid")).status,403);
   assert.equal((await post({csrf,project:crypto.randomUUID()})).status,404);
   const response=await post({csrf,project:first});
   assert.equal(response.status,200);
   assert.match(await response.text(),/AI advisor stopped/);
   assert.equal((await store.inspect()).mode,"off");
   const offPage=await(await fetch(base+"/operator/advisor-settings?project="+first,
    {headers:{Cookie:cookie}})).text();
   assert.match(offPage,/Emergency Stop is active/);
   assert.doesNotMatch(offPage,/Stop AI advisor now/);
   assert.equal((await (await binding.resolveProject(second)).store.inspect()).mode,"off");
  }finally{await new Promise<void>(resolve=>app.close(()=>resolve()));}
 }finally{await rm(root,{recursive:true,force:true});}
});
