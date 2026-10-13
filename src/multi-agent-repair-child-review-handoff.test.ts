import assert from "node:assert/strict";
import test from "node:test";
import {
  createMultiAgentRepairChildReviewHandoff,
  MultiAgentRepairChildReviewHandoffError,
  MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT,
} from "./multi-agent-repair-child-review-handoff.js";
import type { MultiAgentRepairChildPreparationV1 } from "./multi-agent-repair-child-preparation.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const preparation: MultiAgentRepairChildPreparationV1 = {
  schemaVersion:1,
  preparationId:"11111111-1111-4111-8111-111111111111",
  preparedAt:"2026-10-06T17:00:00.000Z",
  executionAdmissionPermitId:"22222222-2222-4222-8222-222222222222",
  executionAdmissionConsumedAt:"2026-10-06T16:59:00.000Z",
  repairChildTaskId:"33333333-3333-4333-8333-333333333333",
  priorChildTaskId:"44444444-4444-4444-8444-444444444444",
  repairAttempt:1,
  delegationSetId:"55555555-5555-4555-8555-555555555555",
  delegationId:"66666666-6666-4666-8666-666666666666",
  coordinationMode:"parallel_disjoint",
  parentSupervisorTaskId:"77777777-7777-4777-8777-777777777777",
  parentTaskId:"88888888-8888-4888-8888-888888888888",
  projectId:"99999999-9999-4999-8999-999999999999",
  workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceRegistryRevision:2,
  safetyPlanId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  safetyPolicyVersion:"policy-v1",
  safetyProfileId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  safetyProfileRevision:3,
  workerProfileId:"default",
  objective:"Implement child",
  repairInstruction:"Adjust src/a.ts only.",
  acceptanceCriteria:["child passes"],
  trustedValidationCommands:["npm test"],
  allowedPathPatterns:["src/a.ts"],
  protectedPathPatterns:[".env*",".git/**"],
  state:"prepared",
  executable:false,
  requiresFreshParentBindingAtExecution:true,
  requiresFreshWriterLease:true,
  requiresFreshDistributedFenceWhenDistributed:true,
  priorChildResumeAllowed:false,
  priorChildMutationAllowed:false,
  authority:"repair_child_preparation_only",
  grantsTaskAuthority:false,
  grantsFilesystemAuthority:false,
  grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,
  grantsCredentialAuthority:false,
  grantsReleaseAuthority:false,
};

const packet: TaskCompletionPacketV1 = {
  schemaVersion:1,
  taskId:preparation.repairChildTaskId,
  projectId:preparation.projectId,
  workspaceId:preparation.workspaceId,
  capturedAt:"2026-10-06T17:05:00.000Z",
  status:"completed",
  reviewState:"ready_for_supervisor_review",
  completionSignal:{terminal:true,finishReason:"completed",workerReportAvailable:true},
  workerCompletion:{
    source:"cline_result",
    trust:"untrusted_worker_claims",
    report:"repair done",
    truncated:false,
    rawReportPreservedLocally:true,
  },
  independentEvidence:{
    validation:{
      available:true,
      passed:true,
      commandsRequested:1,
      commandsRun:1,
      completedAt:"2026-10-06T17:04:00.000Z",
      source:"orchestrator_validation",
    },
    diffSafety:{
      available:true,
      passed:true,
      changedFiles:1,
      warningCount:0,
      failureCount:0,
      summary:"1 file changed",
      checkedAt:"2026-10-06T17:04:30.000Z",
      source:"orchestrator_diff_safety",
    },
    git:{
      before:{capturedAt:"2026-10-06T17:00:01.000Z",available:true,dirty:false,changedFiles:0},
      after:{capturedAt:"2026-10-06T17:04:40.000Z",available:true,dirty:true,changedFiles:1},
      source:"orchestrator_git_snapshot",
    },
    checkpoint:{
      available:true,
      createdAt:"2026-10-06T17:00:02.000Z",
      runCount:1,
      restored:false,
      source:"orchestrator_checkpoint",
    },
    recovery:{
      runCount:1,
      sessionGeneration:1,
      recoveryCount:0,
      contextRotationCount:0,
      contextHandoffCount:0,
      retryCount:0,
      stallCount:0,
      source:"orchestrator_runtime_state",
    },
  },
};

test("M13P remains repair review evidence only",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.trustsWorkerClaims,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.issuesRepairAdmission,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.schedulesChild,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.startsChild,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.automaticRepairAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_REVIEW_HANDOFF_CONTRACT.grantsReleaseAuthority,false);
});

test("completed repair child packages exact attempt/prior-child/delegation binding",()=>{
  const handoff=createMultiAgentRepairChildReviewHandoff(preparation,packet);
  assert.equal(handoff.repairChildTaskId,preparation.repairChildTaskId);
  assert.equal(handoff.priorChildTaskId,preparation.priorChildTaskId);
  assert.equal(handoff.repairAttempt,1);
  assert.equal(handoff.delegationId,preparation.delegationId);
  assert.equal(handoff.repairInstruction,preparation.repairInstruction);
  assert.deepEqual(handoff.approvedWriteScope,["src/a.ts"]);
  assert.equal(handoff.workerCompletion?.trust,"untrusted_worker_claims");
  assert.equal(handoff.independentEvidence.validation.passed,true);
  assert.equal(handoff.independentEvidence.diffSafety.passed,true);
  assert.equal(handoff.authority,"repair_child_review_evidence_only");
});

test("cross-bound completion packet fails closed",()=>{
  assert.throws(
    ()=>createMultiAgentRepairChildReviewHandoff(
      preparation,
      {...packet,taskId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    ),
    (error:unknown)=>error instanceof MultiAgentRepairChildReviewHandoffError
      && error.code==="binding_mismatch",
  );
});

test("failed diff safety or missing checkpoint cannot reach review",()=>{
  for(const bad of [
    {
      ...packet,
      independentEvidence:{
        ...packet.independentEvidence,
        diffSafety:{...packet.independentEvidence.diffSafety,passed:false},
      },
    },
    {
      ...packet,
      independentEvidence:{
        ...packet.independentEvidence,
        checkpoint:{...packet.independentEvidence.checkpoint,available:false},
      },
    },
  ]){
    assert.throws(
      ()=>createMultiAgentRepairChildReviewHandoff(preparation,bad),
      (error:unknown)=>error instanceof MultiAgentRepairChildReviewHandoffError
        && error.code==="evidence_insufficient",
    );
  }
});

test("aborted or in-progress repair child cannot be packaged as review-ready",()=>{
  for(const bad of [
    {...packet,status:"aborted" as const,reviewState:"closed_without_completion_review" as const},
    {...packet,status:"running" as const,reviewState:"worker_in_progress" as const,completionSignal:{...packet.completionSignal,terminal:false}},
  ]){
    assert.throws(
      ()=>createMultiAgentRepairChildReviewHandoff(preparation,bad),
      (error:unknown)=>error instanceof MultiAgentRepairChildReviewHandoffError
        && error.code==="packet_invalid",
    );
  }
});
