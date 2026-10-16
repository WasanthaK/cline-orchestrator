import assert from "node:assert/strict";
import test from "node:test";
import { triageRecovery, type RecoveryObservationV1 } from "./recovery-supervisor-triage.js";
const base: RecoveryObservationV1 = {schemaVersion:1,signal:"repeated_attempt",
  taskStatus:"running",attemptCount:3,priorFingerprint:"a".repeat(64),
  currentFingerprint:"a".repeat(64),validatedNoProgress:true};
test("M19R1 repeated identical verified nonprogress recommends review but never skips",()=>{
 const r=triageRecovery(base);
 assert.equal(r.advice,"change_strategy_review");
 assert.equal(r.repeatedWithoutProgress,true);
 assert.equal(r.skipExecutionPermitted,false);
 assert.equal(r.retryAuthorized,false);
 assert.equal(r.grantsAuthority,false);
});
test("M19R1 changed fingerprint, missing proof, invalid task evidence fail closed",()=>{
 for(const v of [{...base,currentFingerprint:"b".repeat(64)},
  {...base,validatedNoProgress:false},{...base,priorFingerprint:"not-a-hash"},
  {...base,attemptCount:-1}]) {
  const r=triageRecovery(v); assert.equal(r.repeatedWithoutProgress,false);
  assert.equal(r.skipExecutionPermitted,false);
 }
});
test("M19R1 human approval always escalates; verified nonapproval question only advises",()=>{
 assert.equal(triageRecovery({...base,signal:"human_approval"}).state,"needs_human");
 assert.equal(triageRecovery({...base,signal:"human_question",humanApprovalRequired:true,questionEvidenceVerified:true}).advice,"escalate_to_human");
 assert.equal(triageRecovery({...base,signal:"human_question",humanApprovalRequired:false,questionEvidenceVerified:true}).advice,"answer_from_verified_evidence");
});
test("M19R1 contextual and watchdog observations preserve uncertainty",()=>{
 assert.equal(triageRecovery({...base,signal:"context_pressure",contextTokens:90,contextThreshold:100}).state,"insufficient_evidence");
 assert.equal(triageRecovery({...base,signal:"context_pressure",contextTokens:110,contextThreshold:100}).advice,"prepare_context_handoff");
 assert.equal(triageRecovery({...base,signal:"context_overflow"}).advice,"replace_session");
 assert.equal(triageRecovery({...base,signal:"watchdog_stall",hasActiveTool:true}).advice,"inspect_worker_activity");
 assert.equal(triageRecovery({...base,signal:"tool_protocol_failure"}).advice,"bounded_tool_repair");
 assert.equal(triageRecovery({}).state,"insufficient_evidence");
});
test("M19R1 public receipt has no raw source, prompt, secret or fingerprint",()=>{
 const out=JSON.stringify(triageRecovery(base));
 assert.doesNotMatch(out,/aaaaaa|prompt|apiKey|workspace|source|token|secret/i);
});
