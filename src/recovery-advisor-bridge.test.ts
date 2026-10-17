import assert from "node:assert/strict";
import crypto from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {DurableAdvisorAdmissionLedger} from "./recovery-advisor-admission.js";
import {OneShotRecoveryAdvisor,type AdvisorTransportConfigV1} from "./recovery-advisor-transport.js";
import {consultWithDurableGrant} from "./recovery-advisor-bridge.js";
const cfg:AdvisorTransportConfigV1={schemaVersion:1,enabled:true,
 endpoint:"https://api.openai.com/v1/responses",model:"test-model",timeoutMs:3000,
 maxOutputTokens:128,maxCallsPerHour:2,maxEstimatedCentsPerHour:10,
 inputUsdPerMillionTokens:1,outputUsdPerMillionTokens:2};
const incident=(id:string)=>({schemaVersion:1,incidentId:id,taskStatus:"stalled",
 signal:"watchdog_stall",attempts:1,consent:true,evidenceOnly:true});
const reply=()=>new Response(JSON.stringify({status:"completed",output:[{
 type:"message",role:"assistant",content:[{type:"output_text",text:JSON.stringify({
 schemaVersion:1,decision:"inspect_evidence",confidence:"medium"})}]}],
 usage:{input_tokens:100,output_tokens:20}}));
test("M19R3D consumes durable grant before contacting provider and denies duplicates",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"advisor-bridge-"));
 try {
  const ledger=new DurableAdvisorAdmissionLedger({schemaVersion:1,directory:path.join(root,"state"),
   maxCallsPerHour:2,maxEstimatedCentsPerHour:10,maxGrantCents:10});
  let sent=0;const advisor=new OneShotRecoveryAdvisor(cfg,(async()=>{
   sent++;return reply();
  }) as typeof fetch);
  const data=incident("a".repeat(64));
  const cents=advisor.quoteEstimatedCents(data);
  assert.ok(cents && cents<=10);
  const grant=await ledger.issue(data.incidentId,cents!,60000,async()=>true);
  const input={grantId:grant.grantId,incident:data};
  const resolver=async()=> "x".repeat(40);
  const accepted=await consultWithDurableGrant(ledger,advisor,input,resolver);
  assert.equal(accepted.status,"review_required");
  assert.equal(accepted.grantsAuthority,false);
  assert.equal(sent,1);
  const again=await consultWithDurableGrant(
    new DurableAdvisorAdmissionLedger({schemaVersion:1,directory:path.join(root,"state"),
     maxCallsPerHour:2,maxEstimatedCentsPerHour:10,maxGrantCents:10}),advisor,input,resolver);
  assert.equal(again.status,"unavailable");assert.equal(sent,1);
  assert.equal(again.retryAuthorized,false);
 } finally {await rm(root,{recursive:true,force:true})}
});
test("M19R3D absent grant never resolves secret or contacts server",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"advisor-deny-"));
 try {
  const ledger=new DurableAdvisorAdmissionLedger({schemaVersion:1,directory:path.join(root,"state"),
   maxCallsPerHour:2,maxEstimatedCentsPerHour:10,maxGrantCents:10});
  let contacted=0,credentials=0;
  const advisor=new OneShotRecoveryAdvisor(cfg,(async()=>{
   contacted++;return reply();
  }) as typeof fetch);
  const result=await consultWithDurableGrant(ledger,advisor,{
   grantId:crypto.randomUUID(),incident:incident("b".repeat(64))},
   async()=>{credentials++;return "x".repeat(40)});
  assert.equal(result.status,"unavailable");assert.equal(contacted,0);
  assert.equal(credentials,0);
 } finally {await rm(root,{recursive:true,force:true})}
});
