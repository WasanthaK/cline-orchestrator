import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeMultiAgentRepairChild,
  MultiAgentRepairChildError,
  MULTI_AGENT_REPAIR_CHILD_CONTRACT,
} from "./multi-agent-repair-child.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentChildRepairAdmissionReceiptV1 } from "./multi-agent-child-repair-admission.js";
import type { MultiAgentChildReviewDecisionV1 } from "./multi-agent-child-review-decision.js";
import type { MultiAgentChildReviewHandoffV1 } from "./multi-agent-child-review-handoff.js";

const preparation: MultiAgentChildExecutionPreparationV1 = {
  schemaVersion:1,
  preparationId:"11111111-1111-4111-8111-111111111111",
  preparedAt:"2026-10-06T12:00:00.000Z",
  admissionPermitId:"22222222-2222-4222-8222-222222222222",
  admissionConsumedAt:"2026-10-06T11:59:00.000Z",
  childTaskId:"33333333-3333-4333-8333-333333333333",
  delegationSetId:"44444444-4444-4444-8444-444444444444",
  delegationId:"55555555-5555-4555-8555-555555555555",
  coordinationMode:"parallel_disjoint",
  parentSupervisorTaskId:"66666666-6666-4666-8666-666666666666",
  parentTaskId:"77777777-7777-4777-8777-777777777777",
  projectId:"88888888-8888-4888-8888-888888888888",
  workspaceId:"99999999-9999-4999-8999-999999999999",
  workspaceRegistryRevision:2,
  safetyPlanId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  safetyPolicyVersion:"policy-v1",
  safetyProfileId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  safetyProfileRevision:3,
  workerProfileId:"default",
  objective:"Implement child",
  acceptanceCriteria:["child passes"],
  trustedValidationCommands:["npm test"],
  allowedPathPatterns:["src/a.ts"],
  protectedPathPatterns:[".env*",".git/**"],
  state:"prepared",
  executable:false,
  requiresFreshParentBindingAtExecution:true,
  requiresFreshWriterLease:true,
  requiresFreshDistributedFenceWhenDistributed:true,
  authority:"child_execution_preparation_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const handoff: MultiAgentChildReviewHandoffV1 = {
  schemaVersion:1,
  capturedAt:"2026-10-06T12:05:00.000Z",
  delegationSetId:preparation.delegationSetId,
  delegationId:preparation.delegationId,
  childTaskId:preparation.childTaskId,
  parentSupervisorTaskId:preparation.parentSupervisorTaskId,
  parentTaskId:preparation.parentTaskId,
  projectId:preparation.projectId,
  workspaceId:preparation.workspaceId,
  coordinationMode:preparation.coordinationMode,
  objective:preparation.objective,
  acceptanceCriteria:[...preparation.acceptanceCriteria],
  approvedWriteScope:[...preparation.allowedPathPatterns],
  protectedPaths:[...preparation.protectedPathPatterns],
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
  delegationSetId:preparation.delegationSetId,
  delegationId:preparation.delegationId,
  childTaskId:preparation.childTaskId,
  parentSupervisorTaskId:preparation.parentSupervisorTaskId,
  parentTaskId:preparation.parentTaskId,
  decision:"repair",
  summary:"repair needed",
  repairInstruction:"Adjust src/a.ts to satisfy the existing child acceptance criterion.",
  authority:"child_review_decision_advisory_only",
  schedulesChild:false,
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const receipt: MultiAgentChildRepairAdmissionReceiptV1 = {
  schemaVersion:1,
  permitId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  childTaskId:preparation.childTaskId,
  delegationSetId:preparation.delegationSetId,
  delegationId:preparation.delegationId,
  parentTaskId:preparation.parentTaskId,
  repairAttempt:1,
  consumedAt:"2026-10-06T12:06:00.000Z",
  authority:"child_repair_admission_consumed_evidence_only",
  startsChild:false,
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

test("M13K rematerializes repair as fresh non-executable child identity",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.freshChildTaskIdentityRequired,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.priorChildResumeAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.priorChildMutationAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.executableTask,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.startsCline,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_CONTRACT.distributedExecutionAllowed,false);
});

test("consumed repair admission creates fresh child with exact inherited binding",()=>{
  const child=materializeMultiAgentRepairChild(
    preparation,handoff,decision,receipt,
    {
      now:()=>new Date("2026-10-06T12:07:00.000Z"),
      idFactory:()=> "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    },
  );
  assert.equal(child.repairChildTaskId,"dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(child.priorChildTaskId,preparation.childTaskId);
  assert.equal(child.repairAttempt,1);
  assert.equal(child.delegationId,preparation.delegationId);
  assert.equal(child.safetyPlanId,preparation.safetyPlanId);
  assert.equal(child.safetyPolicyVersion,preparation.safetyPolicyVersion);
  assert.equal(child.workerProfileId,preparation.workerProfileId);
  assert.deepEqual(child.allowedPathPatterns,preparation.allowedPathPatterns);
  assert.deepEqual(child.protectedPathPatterns,preparation.protectedPathPatterns);
  assert.equal(child.repairInstruction,decision.repairInstruction);
  assert.equal(child.executable,false);
  assert.equal(child.priorChildResumeAllowed,false);
});

test("fresh repair child id cannot reuse prior child id",()=>{
  assert.throws(
    ()=>materializeMultiAgentRepairChild(
      preparation,handoff,decision,receipt,
      {idFactory:()=>preparation.childTaskId},
    ),
    (error:unknown)=>error instanceof MultiAgentRepairChildError
      && error.code==="identity_reuse",
  );
});

test("cross-bound repair receipt or handoff fails closed",()=>{
  assert.throws(
    ()=>materializeMultiAgentRepairChild(
      preparation,
      {...handoff,approvedWriteScope:["src/b.ts"]},
      decision,
      receipt,
    ),
    (error:unknown)=>error instanceof MultiAgentRepairChildError
      && error.code==="binding_mismatch",
  );
  assert.throws(
    ()=>materializeMultiAgentRepairChild(
      preparation,
      handoff,
      decision,
      {...receipt,childTaskId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    ),
    (error:unknown)=>error instanceof MultiAgentRepairChildError
      && error.code==="binding_mismatch",
  );
});

test("non-repair advisory decision cannot materialize a repair child",()=>{
  assert.throws(
    ()=>materializeMultiAgentRepairChild(
      preparation,handoff,{...decision,decision:"pass",repairInstruction:undefined},receipt,
    ),
    (error:unknown)=>error instanceof MultiAgentRepairChildError
      && error.code==="decision_invalid",
  );
});
