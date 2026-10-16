import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { createNativeAdvisorProjectBinding } from "./native-advisor-project-binding.js";
import { OneShotRecoveryAdvisor, type AdvisorTransportConfigV1 } from "./recovery-advisor-transport.js";
import { DurableAdvisorAdmissionLedger } from "./recovery-advisor-admission.js";
import { projectDurableRecoveryEvents } from "./recovery-task-event-bridge.js";
import type { PublicTaskView } from "./machine-orchestrator.js";
import type { TaskEvent, TaskEventType } from "./types.js";
import { TrustedAdvisorRuntimeGate, type AdvisorBudgetReader } from "./recovery-advisor-runtime-gate.js";

const cfg: AdvisorTransportConfigV1={
  schemaVersion:1,enabled:true,endpoint:"https://api.openai.com/v1/responses",
  model:"test-model",timeoutMs:3000,maxOutputTokens:128,maxCallsPerHour:2,
  maxEstimatedCentsPerHour:10,inputUsdPerMillionTokens:1,outputUsdPerMillionTokens:2,
};
const taskId=crypto.randomUUID(), workspaceId=crypto.randomUUID();
async function fixture(run:(s:{
  gate:TrustedAdvisorRuntimeGate; clock:()=>number; projectId:string; otherProjectId:string;
  configure:(mode:"off"|"automatic_advice"|"ask_before_consulting",cents?:10|50|100|500)=>Promise<void>;
  changeTask:(fn:(task:PublicTaskView)=>PublicTaskView)=>void;
  events:TaskEvent[]; push:(type:TaskEventType,nowOffsetMs?:number)=>void;
  admission:DurableAdvisorAdmissionLedger; bind:ReturnType<typeof createNativeAdvisorProjectBinding>;
  setBudgets:(v:AdvisorBudgetReader)=>void;
  price:OneShotRecoveryAdvisor;
  setNow:(v:number)=>void;
})=>Promise<void>) {
  const root=await mkdtemp(path.join(os.tmpdir(),"advisor-runtime-gate-"));
  try {
    const registry=new WorkspaceRegistry(path.join(root,"registry","workspace-registry.json"));
    const projectId=(await registry.registerProject("Alpha")).projectId;
    const otherProjectId=(await registry.registerProject("Beta")).projectId;
    const bind=createNativeAdvisorProjectBinding(registry);
    let now=Date.now()+5000; // Virtual evidence clock is ahead of real settings issuance.
    let current:PublicTaskView={
      taskId,projectId,workspaceId,goal:"PRIVATE task goal",
      status:"stalled",createdAt:new Date(now-10000).toISOString(),
      updatedAt:new Date(now-1000).toISOString(),
      runCount:2,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,
      validation:{configuredCommands:0,runCount:0,repairCount:0},
      safety:{safetyPlanId:crypto.randomUUID(),policyVersion:"v1",workerProfileId:"test",
        allowedPathPatterns:[],protectedPathPatterns:[]},
    } as PublicTaskView;
    const events:TaskEvent[]=[];
    const push=(type:TaskEventType,offsetMs=-1000)=>{
      events.push({
        id:crypto.randomUUID(),taskId,type,
        timestamp:new Date(now+offsetMs).toISOString(),
        message:"private event details must never leak",
        data:{credentials:"private auth token"},
      });
    };
    push("stalled");
    const admission=new DurableAdvisorAdmissionLedger({
      schemaVersion:1,directory:path.join(root,"admissions"),
      maxCallsPerHour:2,maxEstimatedCentsPerHour:10,maxGrantCents:10,
    },()=>now);
    const price=new OneShotRecoveryAdvisor(cfg,
      (async()=>{throw Error("transport must never be contacted");}) as typeof fetch,()=>now);
    const source={
      getTask:async(id:string)=>{assert.equal(id,taskId);return current;},
      getTaskRecoveryEvidence:async(id:string)=>{
        assert.equal(id,taskId);
        return projectDurableRecoveryEvents({
          id:taskId,status:current.status,runCount:current.runCount,
        },events,new Date(now).toISOString());
      },
    };
    let budgets:AdvisorBudgetReader={
      inspectAdmissionCapacity:async(_project,id,cents)=>admission.inspectAdmissionCapacity(id,cents),
    };
    const gate=new TrustedAdvisorRuntimeGate(source,bind,price,{
      inspectAdmissionCapacity:(project,id,cents)=>{
        assert.equal(project,projectId);
        return budgets.inspectAdmissionCapacity(project,id,cents);
      },
    },()=>now);
    const configure=async(mode:"off"|"automatic_advice"|"ask_before_consulting",cents:10|50|100|500=50)=>{
      const store=(await bind.resolveProject(projectId)).store;
      const previous=await store.inspect();
      await store.save({expectedRevision:previous.revision,mode,
        maxEstimatedCentsPerIncident:cents,durationDays:7,
        acknowledgedExternalMetadata:mode!=="off"});
    };
    await run({gate,clock:()=>now,projectId,otherProjectId,configure,
      changeTask:fn=>{current=fn(current);},events,push,
      admission,bind,setBudgets:v=>{budgets=v;},price,
      setNow:v=>{now=v},
    });
  } finally {await rm(root,{recursive:true,force:true});}
}
const resultIsNonAuthoritative=(r:Awaited<ReturnType<TrustedAdvisorRuntimeGate["evaluate"]>>)=>{
  assert.equal(r.readOnly,true);
  assert.equal(r.grantsAuthority,false);
  assert.equal(r.admissionReserved,false);
  assert.equal(r.liveAdvisorConnected,false);
  assert.equal(r.consultedAdvisor,false);
  assert.equal(r.autoResumePermitted,false);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE|credential|model text|source code|private auth/);
};

test("M19R3H default Off does not quote, reserve or contact advisor",async()=>{
 await fixture(async({gate,events})=>{
   const result=await gate.evaluate(taskId,"a".repeat(64));
   assert.equal(result.result,"disabled");
   assert.equal(result.reason,"consent_disabled");
   resultIsNonAuthoritative(result);
   assert.equal(events.length,1);
 });
});
test("M19R3H trusted incident and current standing consent permit admission review, not network",async()=>{
 await fixture(async({gate,configure,events,clock})=>{
  await configure("automatic_advice");
  const initial=await gate.evaluate(taskId,"a".repeat(64));
  assert.equal(initial.result,"unavailable"); // fabricated incident ID
  const digest=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  const result=await gate.evaluate(taskId,digest);
  assert.equal(result.result,"eligible_for_admission");
  assert.equal(result.reason,"within_approved_scope");
  assert.equal(result.policy,"automatic_advice_eligible");
  assert.ok(result.estimatedCents && result.estimatedCents>0);
  resultIsNonAuthoritative(result);
 });
});
test("M19R3H saved switch Off, Ask first and expiry prevent new eligibility",async()=>{
 await fixture(async({gate,configure,events,setNow,clock,push})=>{
  const digest=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  await configure("automatic_advice");
  assert.equal((await gate.evaluate(taskId,digest)).result,"eligible_for_admission");
  await configure("ask_before_consulting");
  const ask=await gate.evaluate(taskId,digest);
  assert.equal(ask.result,"notify_operator");
  assert.equal(ask.reason,"operator_review_mode");
  await configure("off");
  assert.equal((await gate.evaluate(taskId,digest)).result,"disabled");
  await configure("automatic_advice");
  // Refresh durable incident activity after time advances so the
  // test covers expired *consent* rather than simply stale event evidence.
  setNow(clock()+8*86400000);
  push("stalled",-1000);
  const expired=await gate.evaluate(taskId,digest);
  assert.equal(expired.result,"notify_operator");
  assert.equal(expired.reason,"consent_expired");
 });
});
test("M19R3H exceeding current durable budget requests operator attention",async()=>{
 await fixture(async({gate,configure,events,setBudgets,clock})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  setBudgets({inspectAdmissionCapacity:async()=> "budget_exceeded"});
  const report=await gate.evaluate(taskId,id);
  assert.equal(report.result,"notify_operator");
  assert.equal(report.reason,"budget_exceeded");
  resultIsNonAuthoritative(report);
 });
});
test("M19R3H human approvals never become eligible automatically",async()=>{
 await fixture(async({gate,configure,events,push,changeTask,clock})=>{
  await configure("automatic_advice");
  events.splice(0,events.length);push("human_escalation_requested");
  changeTask(t=>({...t,status:"waiting_for_human"}));
  const id=projectDurableRecoveryEvents({id:taskId,status:"waiting_for_human",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  const r=await gate.evaluate(taskId,id);
  assert.equal(r.result,"notify_operator");
  assert.equal(r.reason,"human_decision");
  resultIsNonAuthoritative(r);
 });
});
test("M19R3H durable ledger duplicate and budget exhaustion deny eligibility",async()=>{
 await fixture(async({gate,configure,events,admission,clock,price})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  const quote=price.quoteEstimatedCents({
    schemaVersion:1,incidentId:id,taskStatus:"stalled",signal:"watchdog_stall",
    attempts:2,consent:true,evidenceOnly:true,
  })!;
  const grant=await admission.issue(id,quote,60000,async()=>true);
  assert.equal((await gate.evaluate(taskId,id)).result,"already_recorded");
  await admission.reserveOnce(grant.grantId,id,quote);
  assert.equal((await gate.evaluate(taskId,id)).reason,"duplicate_incident");
 });
});
test("M19R3H revoked policy during quota check cannot yield eligibility",async()=>{
 await fixture(async({gate,configure,events,setBudgets,bind,projectId,clock})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  setBudgets({inspectAdmissionCapacity:async()=>{
    const store=(await bind.resolveProject(projectId)).store;
    const before=await store.inspect();
    await store.save({expectedRevision:before.revision,mode:"off",
      maxEstimatedCentsPerIncident:50,durationDays:7,
      acknowledgedExternalMetadata:false});
    return "available";
  }});
  const outcome=await gate.evaluate(taskId,id);
  assert.equal(outcome.result,"unavailable");
  assert.equal(outcome.reason,"binding_changed");
 });
});
test("M19R3H resolved event during check and workspace status drift fail closed",async()=>{
 await fixture(async({gate,configure,events,push,setBudgets,changeTask,clock})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  setBudgets({inspectAdmissionCapacity:async()=>{push("session_recovered",-100);return "available"}});
  assert.equal((await gate.evaluate(taskId,id)).reason,"binding_changed");
  events.pop();
  setBudgets({inspectAdmissionCapacity:async()=>{
    changeTask(t=>({...t,updatedAt:new Date(clock()).toISOString()}));
    return "available";
  }});
  assert.equal((await gate.evaluate(taskId,id)).reason,"binding_changed");
 });
});
test("M19R3H unknown/missing/unregistered context fails closed",async()=>{
 await fixture(async({gate,configure,events,changeTask,clock})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  assert.equal((await gate.evaluate("invalid",id)).result,"unavailable");
  assert.equal((await gate.evaluate(taskId,"private-text")).result,"unavailable");
  changeTask(t=>({...t,projectId:crypto.randomUUID()}));
  assert.equal((await gate.evaluate(taskId,id)).result,"unavailable");
 });
});
test("M19R3H expired/suspicious historical incidents are not fresh progress evidence",async()=>{
 await fixture(async({gate,configure,events,clock,setNow})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  setNow(clock()+65_000);
  assert.equal((await gate.evaluate(taskId,id)).reason,"stale_evidence");
 });
});
test("M19R3H corrupted admission state is unavailable, never eligible",async()=>{
 await fixture(async({gate,configure,events,setBudgets,clock})=>{
  await configure("automatic_advice");
  const id=projectDurableRecoveryEvents({id:taskId,status:"stalled",runCount:2},
    events,new Date(clock()).toISOString()).incidents[0]!.incidentId;
  setBudgets({inspectAdmissionCapacity:async()=>{throw new Error("PRIVATE ledger failure");}});
  const r=await gate.evaluate(taskId,id);
  assert.equal(r.result,"unavailable");
  assert.equal(r.reason,"state_unavailable");
  resultIsNonAuthoritative(r);
 });
});
