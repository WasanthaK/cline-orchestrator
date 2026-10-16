import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  ADVISOR_STANDING_POLICY_CONTRACT, evaluateStandingAdvisorPolicy,
  type AdvisorStandingPolicyV1, type AdvisorPolicyIncidentV1,
} from "./recovery-advisor-policy.js";

const projectId=crypto.randomUUID();
const otherProject=crypto.randomUUID();
const now=1_000_000;
const policy: AdvisorStandingPolicyV1={
  schemaVersion:1,source:"operator_approved_settings",projectId,
  mode:"automatic_advice",destination:"openai_responses_api",
  disclosure:"incident_metadata_only",approvedAtMs:now-1000,
  expiresAtMs:now+86_400_000,revision:"a".repeat(64),
  allowedSignals:["context_pressure","watchdog_stall","validation_failure"],
  maxEstimatedCentsPerIncident:3,
  operatorAcknowledgedExternalTransfer:true,
};
const event: AdvisorPolicyIncidentV1={
  schemaVersion:1,source:"trusted_task_store",projectId,
  incidentId:"b".repeat(64),state:"open",signal:"watchdog_stall",
  observedAtMs:now-1000,estimatedCents:2,
  disclosure:"incident_metadata_only",
};
test("M19R3E default is off, not repetitive approval prompts",()=>{
  assert.equal(ADVISOR_STANDING_POLICY_CONTRACT.defaultMode,"off");
  assert.equal(evaluateStandingAdvisorPolicy(undefined,event,now).decision,"disabled");
  const result=evaluateStandingAdvisorPolicy(policy,event,now);
  assert.equal(result.decision,"automatic_advice_eligible");
  assert.equal(result.reason,"within_preapproved_scope");
  assert.equal(result.contactedAdvisor,false);
  assert.equal(result.admissionReserved,false);
  assert.equal(result.grantsAuthority,false);
  assert.equal(result.canExecuteRecovery,false);
});
test("M19R3E human questions or approvals notify regardless of standing consent",()=>{
  for(const signal of ["human_question","human_approval"] as const) {
    const result=evaluateStandingAdvisorPolicy(policy,{...event,signal},now);
    assert.equal(result.decision,"notify_operator");
    assert.equal(result.reason,"human_decision");
  }
});
test("M19R3E budget, scope, disallowed signal and expiry notify only on exception",()=>{
  const over=evaluateStandingAdvisorPolicy(policy,{...event,estimatedCents:4},now);
  assert.equal(over.reason,"budget_review");
  assert.equal(evaluateStandingAdvisorPolicy(policy,{
    ...event,projectId:otherProject},now).reason,"outside_approved_scope");
  assert.equal(evaluateStandingAdvisorPolicy(policy,{
    ...event,signal:"repeated_attempt"},now).reason,"outside_approved_scope");
  assert.equal(evaluateStandingAdvisorPolicy(policy,event,policy.expiresAtMs).reason,"consent_expired");
});
test("M19R3E optional ask-first mode exists, but no phrase is required",()=>{
  const ask=evaluateStandingAdvisorPolicy({...policy,mode:"ask_before_consulting"},event,now);
  assert.equal(ask.reason,"operator_review_mode");
  assert.equal(ask.decision,"notify_operator");
  assert.doesNotMatch(JSON.stringify(ask),/confirmationToken|prompt|SEND ADVISOR/);
});
test("M19R3E fail-closed for malformed, raw or stale policy metadata",()=>{
  const badPolicies=[
    {...policy,consentText:"source contents"},
    {...policy,operatorAcknowledgedExternalTransfer:false},
    {...policy,disclosure:"full_source_code"},
    {...policy,approvedAtMs:now+1000},
    {...policy,revision:"invalid"},
    {...policy,allowedSignals:["watchdog_stall","watchdog_stall"]},
    {...policy,expiresAtMs:policy.approvedAtMs+31*86400000},
  ];
  for(const bad of badPolicies) {
    const result=evaluateStandingAdvisorPolicy(bad,event,now);
    assert.notEqual(result.decision,"automatic_advice_eligible");
    assert.equal(result.admissionReserved,false);
  }
  assert.equal(evaluateStandingAdvisorPolicy(policy,{
    ...event,output:"private model output"},now).decision,"insufficient_evidence");
  assert.equal(evaluateStandingAdvisorPolicy(policy,{
    ...event,observedAtMs:now-60001},now).decision,"insufficient_evidence");
  assert.equal(evaluateStandingAdvisorPolicy(policy,{
    ...event,source:"model_text"},now).decision,"insufficient_evidence");
});
test("M19R3E switching off denies eligible advice without sending anything",()=>{
  const off=evaluateStandingAdvisorPolicy({...policy,mode:"off"},event,now);
  assert.equal(off.decision,"disabled");
  assert.equal(off.contactedAdvisor,false);
  assert.equal(off.canExecuteRecovery,false);
});
