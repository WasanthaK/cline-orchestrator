import assert from "node:assert/strict";
import test from "node:test";
import {ADVISOR_CONTRACT,validateAdvisorRequest,validateAdvisorSuggestion} from "./recovery-advisor-contract.js";
const input={schemaVersion:1,incidentId:"a".repeat(64),taskStatus:"stalled",
 signal:"watchdog_stall",attempts:2,consent:true,evidenceOnly:true};
test("M19R3A requires explicit consent and typed minimal evidence",()=>{
 assert.ok(validateAdvisorRequest(input));
 for(const bad of [{...input,consent:false},{...input,prompt:"secret"},
  {...input,incidentId:"x"},{...input,attempts:-1}])assert.equal(validateAdvisorRequest(bad),undefined);
 assert.equal(validateAdvisorRequest(null),undefined);
 assert.equal(ADVISOR_CONTRACT.networkCalls,false);
});
test("M19R3A treats every advisor suggestion as human-reviewed non-authority",()=>{
 const v=validateAdvisorSuggestion({schemaVersion:1,decision:"prepare_context_handoff",confidence:"high"});
 assert.equal(v?.state,"review_required");
 assert.equal(v?.grantsAuthority,false);
 assert.equal(v?.retryAuthorized,false);
 assert.equal(v?.advisorContacted,false);
 for(const bad of [{schemaVersion:1,decision:"run_commands",confidence:"high"},
  {schemaVersion:1,decision:"observe_only",confidence:"high",command:"rm -rf /"},
  {schemaVersion:1,decision:"observe_only",confidence:"high",retryAuthorized:true}])
  assert.equal(validateAdvisorSuggestion(bad),undefined);
});
