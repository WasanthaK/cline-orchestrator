import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT,
  MultiAgentChildReviewDecisionError,
  runMultiAgentChildReviewDecision,
  validateMultiAgentChildReviewDecision,
} from "./multi-agent-child-review-decision.js";
import type { MultiAgentChildReviewHandoffV1 } from "./multi-agent-child-review-handoff.js";

const handoff: MultiAgentChildReviewHandoffV1 = {
  schemaVersion:1,
  capturedAt:"2026-10-06T10:00:00.000Z",
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  delegationId:"22222222-2222-4222-8222-222222222222",
  childTaskId:"33333333-3333-4333-8333-333333333333",
  parentSupervisorTaskId:"44444444-4444-4444-8444-444444444444",
  parentTaskId:"55555555-5555-4555-8555-555555555555",
  projectId:"66666666-6666-4666-8666-666666666666",
  workspaceId:"77777777-7777-4777-8777-777777777777",
  coordinationMode:"parallel_disjoint",
  objective:"Implement A",
  acceptanceCriteria:["A passes"],
  approvedWriteScope:["src/a.ts"],
  protectedPaths:[".env*",".git/**"],
  childStatus:"completed",
  reviewState:"ready_for_supervisor_review",
  independentEvidence:{
    validation:{available:true,passed:true,commandsRequested:1,commandsRun:1,source:"orchestrator_validation"},
    diffSafety:{available:true,passed:true,changedFiles:1,warningCount:0,failureCount:0,source:"orchestrator_diff_safety"},
    git:{source:"orchestrator_git_snapshot"},
    checkpoint:{available:true,runCount:1,restored:false,source:"orchestrator_checkpoint"},
    recovery:{runCount:1,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,contextHandoffCount:0,retryCount:0,stallCount:0,source:"orchestrator_runtime_state"},
  },
  authority:"child_review_evidence_only",
  grantsTaskAuthority:false,
  grantsFilesystemAuthority:false,
  grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,
  grantsReleaseAuthority:false,
};

test("M13I is advisory only and cannot schedule/repair automatically",()=>{
  assert.deepEqual(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.allowedDecisions,["pass","repair","escalate"]);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.schedulesChild,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.startsChild,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.automaticRepairAllowed,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.recursiveDelegationAllowed,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_DECISION_CONTRACT.grantsReleaseAuthority,false);
});

test("pass returns child-bound advisory decision only",()=>{
  const result=validateMultiAgentChildReviewDecision(handoff,{
    schemaVersion:1,
    supervisorTaskId:handoff.parentSupervisorTaskId,
    taskId:handoff.childTaskId,
    decision:"pass",
    summary:"Independent evidence is sufficient.",
    completionAuthority:"advisory_only",
  });
  assert.equal(result.decision,"pass");
  assert.equal(result.childTaskId,handoff.childTaskId);
  assert.equal(result.schedulesChild,false);
  assert.equal(result.authority,"child_review_decision_advisory_only");
});

test("bounded repair is advisory and remains inside existing child scope",()=>{
  const result=validateMultiAgentChildReviewDecision(handoff,{
    schemaVersion:1,
    supervisorTaskId:handoff.parentSupervisorTaskId,
    taskId:handoff.childTaskId,
    decision:"repair",
    summary:"A small correction is needed.",
    repairInstruction:"Adjust the implementation in src/a.ts to satisfy the existing acceptance criterion.",
    completionAuthority:"advisory_only",
  });
  assert.equal(result.decision,"repair");
  assert.match(result.repairInstruction??"",/src\/a\.ts/);
  assert.equal(result.schedulesChild,false);
});

test("repair language attempting policy/tool/scope widening fails closed",()=>{
  for(const instruction of [
    "Use shell commands to fix the issue.",
    "Modify validation commands and rerun.",
    "Expand scope to config/secrets.json.",
    "Push and merge the fix.",
  ]){
    assert.throws(
      ()=>validateMultiAgentChildReviewDecision(handoff,{
        schemaVersion:1,
        supervisorTaskId:handoff.parentSupervisorTaskId,
        taskId:handoff.childTaskId,
        decision:"repair",
        summary:"Need more work.",
        repairInstruction:instruction,
        completionAuthority:"advisory_only",
      }),
      (error:unknown)=>error instanceof MultiAgentChildReviewDecisionError
        && error.code==="repair_widening",
    );
  }
});

test("cross-bound reviewer output fails closed",()=>{
  assert.throws(
    ()=>validateMultiAgentChildReviewDecision(handoff,{
      schemaVersion:1,
      supervisorTaskId:handoff.parentSupervisorTaskId,
      taskId:"88888888-8888-4888-8888-888888888888",
      decision:"pass",
      summary:"pass",
      completionAuthority:"advisory_only",
    }),
    (error:unknown)=>error instanceof MultiAgentChildReviewDecisionError
      && error.code==="decision_invalid",
  );
});

test("model runner passes bounded child prompt and validates output",async()=>{
  let seen="";
  const result=await runMultiAgentChildReviewDecision(handoff,{
    async review(request){
      seen=request.prompt;
      return {
        schemaVersion:1,
        supervisorTaskId:handoff.parentSupervisorTaskId,
        taskId:handoff.childTaskId,
        decision:"escalate",
        summary:"Human decision required.",
        escalationReason:"Acceptance intent is ambiguous.",
        completionAuthority:"advisory_only",
      };
    },
  });
  assert.match(seen,/Approved child write scope/);
  assert.match(seen,/advisory only/i);
  assert.equal(result.decision,"escalate");
  assert.equal(result.schedulesChild,false);
});
