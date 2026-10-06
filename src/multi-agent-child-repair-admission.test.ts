import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FileMultiAgentChildRepairAdmissionStore,
  MultiAgentChildRepairAdmissionError,
  MultiAgentChildRepairAdmissionService,
  MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT,
  type MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-repair-admission.js";
import type { MultiAgentChildReviewDecisionV1 } from "./multi-agent-child-review-decision.js";
import type { MultiAgentChildReviewHandoffV1 } from "./multi-agent-child-review-handoff.js";

const handoff: MultiAgentChildReviewHandoffV1 = {
  schemaVersion:1,capturedAt:"2026-10-06T11:00:00.000Z",
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  delegationId:"22222222-2222-4222-8222-222222222222",
  childTaskId:"33333333-3333-4333-8333-333333333333",
  parentSupervisorTaskId:"44444444-4444-4444-8444-444444444444",
  parentTaskId:"55555555-5555-4555-8555-555555555555",
  projectId:"66666666-6666-4666-8666-666666666666",
  workspaceId:"77777777-7777-4777-8777-777777777777",
  coordinationMode:"parallel_disjoint",
  objective:"Implement child safely",
  acceptanceCriteria:["child passes"],
  approvedWriteScope:["src/a.ts"],
  protectedPaths:[".env*",".git/**"],
  childStatus:"completed",
  reviewState:"ready_for_supervisor_review",
  independentEvidence:{
    validation:{available:true,passed:true,source:"orchestrator_validation"},
    diffSafety:{available:true,passed:true,changedFiles:1,source:"orchestrator_diff_safety"},
    git:{source:"orchestrator_git_snapshot"},
    checkpoint:{available:true,restored:false,source:"orchestrator_checkpoint"},
    recovery:{runCount:1,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,contextHandoffCount:0,retryCount:0,stallCount:0,source:"orchestrator_runtime_state"},
  },
  authority:"child_review_evidence_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const decision: MultiAgentChildReviewDecisionV1 = {
  schemaVersion:1,
  delegationSetId:handoff.delegationSetId,
  delegationId:handoff.delegationId,
  childTaskId:handoff.childTaskId,
  parentSupervisorTaskId:handoff.parentSupervisorTaskId,
  parentTaskId:handoff.parentTaskId,
  decision:"repair",
  summary:"One bounded correction is needed.",
  repairInstruction:"Adjust src/a.ts to satisfy the existing child acceptance criterion.",
  authority:"child_review_decision_advisory_only",
  schedulesChild:false,
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const current: MultiAgentParentExecutionBindingV1 = {
  schemaVersion:1,
  taskId:handoff.parentTaskId,
  projectId:handoff.projectId,
  workspaceId:handoff.workspaceId,
  workspaceRegistryRevision:2,
  safetyPlanId:"88888888-8888-4888-8888-888888888888",
  safetyPolicyVersion:"policy-v1",
  safetyProfileId:"99999999-9999-4999-8999-999999999999",
  safetyProfileRevision:3,
  workerProfileId:"default",
  allowedPathPatterns:["src/a.ts","src/b.ts"],
  protectedPathPatterns:[...handoff.protectedPaths],
  trustedValidationCommands:["npm test"],
  status:"created",
  hasPendingEscalation:false,
  authority:"current_parent_execution_binding",
};

test("M13J is bounded, durable-budgeted, single-use and non-executing",()=>{
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.maxRepairAttempts,2);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.durableAttemptBudget,true);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.singleUse,true);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.startsChild,false);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.resumesChild,false);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.scopeExpansionAllowed,false);
  assert.equal(MULTI_AGENT_CHILD_REPAIR_ADMISSION_CONTRACT.grantsReleaseAuthority,false);
});

test("reviewed child repair decision issues and consumes one bounded permit",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13j-"));
  let now=new Date("2026-10-06T11:01:00.000Z");
  try{
    const service=new MultiAgentChildRepairAdmissionService(
      {async revalidateCurrent(){return structuredClone(current);}},
      new FileMultiAgentChildRepairAdmissionStore(root),
      {
        now:()=>new Date(now),
        ttlMs:60_000,
        idFactory:()=> "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tokenFactory:()=> "mar_abcdefghijklmnopqrstuvwxyz1234567890",
      },
    );
    const ticket=await service.issue(handoff,decision);
    assert.equal(ticket.permit.repairAttempt,1);
    assert.equal(ticket.permit.startsChild,false);
    now=new Date("2026-10-06T11:01:30.000Z");
    const receipt=await service.consume(ticket.token,handoff,decision);
    assert.equal(receipt.repairAttempt,1);
    assert.equal(receipt.authority,"child_repair_admission_consumed_evidence_only");
    await assert.rejects(
      ()=>service.consume(ticket.token,handoff,decision),
      (error:unknown)=>error instanceof MultiAgentChildRepairAdmissionError
        && error.code==="permit_replayed",
    );
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("durable repair budget blocks a third admission",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13j-"));
  try{
    let permitNo=0;
    const service=new MultiAgentChildRepairAdmissionService(
      {async revalidateCurrent(){return structuredClone(current);}},
      new FileMultiAgentChildRepairAdmissionStore(root),
      {
        idFactory:()=>[
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ][permitNo++]!,
        tokenFactory:()=>`mar_${"x".repeat(40)}${permitNo}`,
      },
    );
    const first=await service.issue(handoff,decision);
    assert.equal(first.permit.repairAttempt,1);
    const second=await service.issue(handoff,decision);
    assert.equal(second.permit.repairAttempt,2);
    await assert.rejects(
      ()=>service.issue(handoff,decision),
      (error:unknown)=>error instanceof MultiAgentChildRepairAdmissionError
        && error.code==="repair_budget_exhausted",
    );
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("non-repair decision or cross-bound decision fails before parent lookup",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13j-"));
  let calls=0;
  try{
    const service=new MultiAgentChildRepairAdmissionService(
      {async revalidateCurrent(){calls+=1;return structuredClone(current);}},
      new FileMultiAgentChildRepairAdmissionStore(root),
    );
    await assert.rejects(
      ()=>service.issue(handoff,{...decision,decision:"pass",repairInstruction:undefined}),
      (error:unknown)=>error instanceof MultiAgentChildRepairAdmissionError
        && error.code==="decision_invalid",
    );
    await assert.rejects(
      ()=>service.issue(handoff,{...decision,childTaskId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}),
      (error:unknown)=>error instanceof MultiAgentChildRepairAdmissionError
        && error.code==="binding_mismatch",
    );
    assert.equal(calls,0);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("parent scope drift or pending escalation fails closed",async()=>{
  for(const drift of [
    {...current,allowedPathPatterns:["src/b.ts"]},
    {...current,hasPendingEscalation:true},
  ]){
    const root=await mkdtemp(path.join(os.tmpdir(),"m13j-"));
    try{
      const service=new MultiAgentChildRepairAdmissionService(
        {async revalidateCurrent(){return drift as MultiAgentParentExecutionBindingV1;}},
        new FileMultiAgentChildRepairAdmissionStore(root),
      );
      await assert.rejects(()=>service.issue(handoff,decision));
    }finally{
      await rm(root,{recursive:true,force:true});
    }
  }
});
