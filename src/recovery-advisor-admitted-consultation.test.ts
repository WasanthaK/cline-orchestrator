import assert from "node:assert/strict";
import crypto from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {WorkspaceRegistry} from "./workspace-registry.js";
import {createNativeAdvisorProjectBinding} from "./native-advisor-project-binding.js";
import {DurableAdvisorAdmissionLedger} from "./recovery-advisor-admission.js";
import {TrustedAdvisorRuntimeGate} from "./recovery-advisor-runtime-gate.js";
import {TrustedAdmittedAdvisorConsultation,
 ADVISOR_ADMITTED_CONSULTATION_CONTRACT} from "./recovery-advisor-admitted-consultation.js";
import {OneShotRecoveryAdvisor,type AdvisorTransportConfigV1} from "./recovery-advisor-transport.js";
import {projectDurableRecoveryEvents} from "./recovery-task-event-bridge.js";
import type {PublicTaskView} from "./machine-orchestrator.js";
import type {TaskEvent,TaskEventType} from "./types.js";

const config:AdvisorTransportConfigV1={
 schemaVersion:1,enabled:true,endpoint:"https://api.openai.com/v1/responses",
 model:"test-model",timeoutMs:3000,maxOutputTokens:128,maxCallsPerHour:2,
 maxEstimatedCentsPerHour:10,inputUsdPerMillionTokens:1,outputUsdPerMillionTokens:2,
};
const response=()=>new Response(JSON.stringify({status:"completed",
 output:[{type:"message",role:"assistant",content:[{type:"output_text",
 text:JSON.stringify({schemaVersion:1,decision:"inspect_evidence",confidence:"medium"})}]}],
 usage:{input_tokens:60,output_tokens:22}}));
const safe=(r:Awaited<ReturnType<TrustedAdmittedAdvisorConsultation["consult"]>>)=>{
 assert.equal(r.grantsAuthority,false);
 assert.equal(r.readOnly,true);
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.retryAuthorized,false);
 assert.doesNotMatch(JSON.stringify(r),/private|Bearer|source_code|api_key|command output/i);
};
async function fixture(action:(f:{
 consult:()=>Promise<Awaited<ReturnType<TrustedAdmittedAdvisorConsultation["consult"]>>>;
 configure:(mode:"off"|"automatic_advice"|"ask_before_consulting")=>Promise<void>;
 add:(event:TaskEventType)=>void;
 store:Awaited<ReturnType<ReturnType<typeof createNativeAdvisorProjectBinding>["resolveProject"]>>["store"];
 counters:()=>{sent:number;keys:number};
 setSecretHook:(fn:()=>Promise<void>)=>void;
})=>Promise<void>) {
 const root=await mkdtemp(path.join(os.tmpdir(),"advisor-admitted-"));
 try {
  const registry=new WorkspaceRegistry(path.join(root,"registry","projects.json"));
  const projectId=(await registry.registerProject("Example Project")).projectId;
  const binding=createNativeAdvisorProjectBinding(registry);
  const scoped=(await binding.resolveProject(projectId));
  const taskId=crypto.randomUUID();
  const ws=crypto.randomUUID();
  const now=()=>Date.now()+5000; // Later than real settings issuance.
  const task={
   taskId,projectId,workspaceId:ws,goal:"private task goal",status:"stalled",
   createdAt:new Date(now()-10000).toISOString(),updatedAt:new Date(now()-2000).toISOString(),
   runCount:2,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,
   validation:{configuredCommands:0,runCount:0,repairCount:0},
   safety:{safetyPlanId:crypto.randomUUID(),policyVersion:"test",workerProfileId:"test",
     allowedPathPatterns:[],protectedPathPatterns:[]},
  } as PublicTaskView;
  const events:TaskEvent[]=[];
  const add=(type:TaskEventType)=>{
   events.push({id:crypto.randomUUID(),taskId,type,
    timestamp:new Date(now()-1000+events.length*10).toISOString(),
    message:"private command output",data:{secret:"Bearer fake"}});
  };
  add("stalled");
  const source={
   getTask:async(id:string)=>{assert.equal(id,taskId);return task;},
   getTaskRecoveryEvidence:async(id:string)=>{
    assert.equal(id,taskId);
    return projectDurableRecoveryEvents({id:taskId,status:task.status,runCount:2},
      events,new Date(now()).toISOString());
   },
  };
  const incident=projectDurableRecoveryEvents({id:taskId,status:task.status,runCount:2},
      events,new Date(now()).toISOString()).incidents[0]!.incidentId;
  const ledger=new DurableAdvisorAdmissionLedger({
   schemaVersion:1,directory:path.join(root,"ledger",projectId),
   maxCallsPerHour:2,maxEstimatedCentsPerHour:10,maxGrantCents:10,
  },now);
  let sent=0,keys=0;
  let secretHook:()=>Promise<void>=async()=>undefined;
  const resolver=async()=>{keys++;await secretHook();return "x".repeat(40)};
  const transport=new OneShotRecoveryAdvisor(config,(async()=>{
   sent++;return response();
  }) as typeof fetch,now);
  const budget={
   inspectAdmissionCapacity:async(project:string,id:string,cents:number)=>{
    assert.equal(project,projectId);
    return ledger.inspectAdmissionCapacity(id,cents);
   },
  };
  const gate=new TrustedAdvisorRuntimeGate(source,binding,transport,budget,now);
  const coordinator=new TrustedAdmittedAdvisorConsultation(
    source,binding,gate,{forProject:async project=>({projectId:project,ledger})},
    transport,resolver,now);
  const configure=async(mode:"off"|"automatic_advice"|"ask_before_consulting")=>{
   const current=await scoped.store.inspect();
   await scoped.store.save({
    expectedRevision:current.revision,mode,durationDays:7,
    maxEstimatedCentsPerIncident:50,
    acknowledgedExternalMetadata:mode!=="off",
   });
  };
  await action({
   consult:()=>coordinator.consult(taskId,incident),
   configure,add,store:scoped.store,
   counters:()=>({sent,keys}),setSecretHook:fn=>{secretHook=fn},
  });
 } finally {await rm(root,{recursive:true,force:true})}
}
test("M19R3I default Off and Ask first never fetch credentials or network",async()=>{
 await fixture(async({consult,configure,counters})=>{
  const disabled=await consult();assert.equal(disabled.outcome,"disabled");safe(disabled);
  await configure("ask_before_consulting");
  const ask=await consult();assert.equal(ask.outcome,"operator_attention");safe(ask);
  assert.deepEqual(counters(),{sent:0,keys:0});
 });
});
test("M19R3I approved project uses a single durable grant; replay does not send",async()=>{
 await fixture(async({consult,configure,counters})=>{
  await configure("automatic_advice");
  const first=await consult();
  assert.equal(first.outcome,"review_required");
  assert.equal(first.suggestion?.decision,"inspect_evidence");
  assert.equal(first.contacted,true);safe(first);
  assert.deepEqual(counters(),{sent:1,keys:1});
  const replay=await consult();assert.equal(replay.outcome,"already_handled");
  safe(replay);
  assert.deepEqual(counters(),{sent:1,keys:1});
  assert.equal(ADVISOR_ADMITTED_CONSULTATION_CONTRACT.autonomousCallsEnabled,false);
 });
});
test("M19R3I incident resolves during credential lookup: grant burned and no HTTP",async()=>{
 await fixture(async({consult,configure,counters,add,setSecretHook})=>{
  await configure("automatic_advice");
  setSecretHook(async()=>{add("session_recovered")});
  const r=await consult();
  assert.equal(r.outcome,"unavailable");
  assert.equal(r.contacted,false);
  assert.equal(r.reason,"trusted_evidence_changed");
  safe(r);
  assert.deepEqual(counters(),{sent:0,keys:1});
  const retry=await consult();
  assert.notEqual(retry.outcome,"review_required");
  assert.deepEqual(counters(),{sent:0,keys:1});
 });
});
test("M19R3I saving Off while provider is active fails closed, without silent change",async()=>{
 await fixture(async({consult,configure,counters,store,setSecretHook})=>{
  await configure("automatic_advice");
  let blocked=false;
  setSecretHook(async()=>{
   const current=await store.inspect();
   try {
    await store.save({expectedRevision:current.revision,mode:"off",
      durationDays:7,maxEstimatedCentsPerIncident:50,
      acknowledgedExternalMetadata:false});
   } catch(e) {blocked=true; assert.equal((e as {code?:string}).code,"busy");}
  });
  const r=await consult();
  assert.equal(blocked,true);
  assert.equal(r.outcome,"review_required");safe(r);
  assert.deepEqual(counters(),{sent:1,keys:1});
  const current=await store.inspect();
  const off=await store.save({expectedRevision:current.revision,mode:"off",
    durationDays:7,maxEstimatedCentsPerIncident:50,
    acknowledgedExternalMetadata:false});
  assert.equal(off.mode,"off");
  assert.equal((await consult()).outcome,"disabled");
 });
});

test("M19R3K durable Stop during credential lookup blocks outbound consultation",async()=>{
 await fixture(async({consult,configure,counters,store,setSecretHook})=>{
  await configure("automatic_advice");
  setSecretHook(async()=>{await store.stopNow();});
  const r=await consult();
  assert.equal(r.outcome,"unavailable");
  assert.equal(r.contacted,false);
  assert.notEqual(r.reason,"advice_ready");
  safe(r);
  assert.deepEqual(counters(),{sent:0,keys:1});
  assert.equal((await store.inspect()).mode,"off");
  assert.equal((await consult()).outcome,"disabled");
  assert.deepEqual(counters(),{sent:0,keys:1});
 });
});
