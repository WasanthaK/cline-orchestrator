import assert from "node:assert/strict";
import test from "node:test";
import {
  createMultiAgentChildReviewHandoff,
  MultiAgentChildReviewHandoffError,
  MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT,
} from "./multi-agent-child-review-handoff.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const preparation: MultiAgentChildExecutionPreparationV1 = {
  schemaVersion:1,
  preparationId:"11111111-1111-4111-8111-111111111111",
  preparedAt:"2026-10-06T09:00:00.000Z",
  admissionPermitId:"22222222-2222-4222-8222-222222222222",
  admissionConsumedAt:"2026-10-06T08:59:00.000Z",
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
  objective:"Implement child safely",
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
  grantsTaskAuthority:false,
  grantsFilesystemAuthority:false,
  grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,
  grantsCredentialAuthority:false,
  grantsReleaseAuthority:false,
};

const set: MultiAgentDelegationSetV1 = {
  schemaVersion:1,
  delegationSetId:preparation.delegationSetId,
  createdAt:"2026-10-06T08:58:00.000Z",
  coordinationMode:preparation.coordinationMode,
  parentSupervisorTaskId:preparation.parentSupervisorTaskId,
  taskId:preparation.parentTaskId,
  projectId:preparation.projectId,
  workspaceId:preparation.workspaceId,
  workspaceRegistryRevision:preparation.workspaceRegistryRevision,
  safetyPlanId:preparation.safetyPlanId,
  safetyProfileId:preparation.safetyProfileId,
  safetyProfileRevision:preparation.safetyProfileRevision,
  workerProfileId:preparation.workerProfileId,
  delegationIds:[preparation.delegationId],
  overlappingDelegationPairs:[],
  authority:"delegation_set_evidence_only",
  grantsTaskAuthority:false,
  grantsFilesystemAuthority:false,
  grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,
  grantsCredentialAuthority:false,
  grantsReleaseAuthority:false,
};

const packet: TaskCompletionPacketV1 = {
  schemaVersion:1,
  taskId:preparation.childTaskId,
  projectId:preparation.projectId,
  workspaceId:preparation.workspaceId,
  capturedAt:"2026-10-06T09:05:00.000Z",
  status:"completed",
  reviewState:"ready_for_supervisor_review",
  completionSignal:{terminal:true,finishReason:"completed",workerReportAvailable:true},
  workerCompletion:{
    source:"cline_result",
    trust:"untrusted_worker_claims",
    report:"done",
    truncated:false,
    rawReportPreservedLocally:true,
  },
  independentEvidence:{
    validation:{
      available:true,
      passed:true,
      commandsRequested:1,
      commandsRun:1,
      completedAt:"2026-10-06T09:04:00.000Z",
      source:"orchestrator_validation",
    },
    diffSafety:{
      available:true,
      passed:true,
      changedFiles:1,
      warningCount:0,
      failureCount:0,
      summary:"1 file changed",
      checkedAt:"2026-10-06T09:04:30.000Z",
      source:"orchestrator_diff_safety",
    },
    git:{
      before:{capturedAt:"2026-10-06T09:00:01.000Z",available:true,dirty:false,changedFiles:0},
      after:{capturedAt:"2026-10-06T09:04:40.000Z",available:true,dirty:true,changedFiles:1},
      source:"orchestrator_git_snapshot",
    },
    checkpoint:{
      available:true,
      createdAt:"2026-10-06T09:00:02.000Z",
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

test("M13H remains review evidence only and never trusts worker prose as authority",()=>{
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.trustsWorkerClaims,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.schedulesSibling,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.startsChild,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.automaticRepairAllowed,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.recursiveDelegationAllowed,false);
  assert.equal(MULTI_AGENT_CHILD_REVIEW_HANDOFF_CONTRACT.grantsReleaseAuthority,false);
});

test("completed child packet produces parent-bound narrowed review handoff",()=>{
  const handoff=createMultiAgentChildReviewHandoff(preparation,set,packet);
  assert.equal(handoff.childTaskId,preparation.childTaskId);
  assert.equal(handoff.parentTaskId,preparation.parentTaskId);
  assert.deepEqual(handoff.approvedWriteScope,["src/a.ts"]);
  assert.equal(handoff.workerCompletion?.trust,"untrusted_worker_claims");
  assert.equal(handoff.independentEvidence.validation.passed,true);
  assert.equal(handoff.independentEvidence.diffSafety.passed,true);
  assert.equal(handoff.independentEvidence.checkpoint.available,true);
  assert.equal(handoff.authority,"child_review_evidence_only");
});

test("cross-bound completion packet is rejected",()=>{
  assert.throws(
    ()=>createMultiAgentChildReviewHandoff(
      preparation,
      set,
      {...packet,taskId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    ),
    (error:unknown)=>error instanceof MultiAgentChildReviewHandoffError
      && error.code==="binding_mismatch",
  );
});

test("packet without passing diff safety or checkpoint cannot reach supervisor review",()=>{
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
      ()=>createMultiAgentChildReviewHandoff(preparation,set,bad),
      (error:unknown)=>error instanceof MultiAgentChildReviewHandoffError
        && error.code==="evidence_insufficient",
    );
  }
});

test("aborted or in-progress child cannot be packaged as review-ready completion",()=>{
  for(const bad of [
    {...packet,status:"aborted" as const,reviewState:"closed_without_completion_review" as const},
    {...packet,status:"running" as const,reviewState:"worker_in_progress" as const,completionSignal:{...packet.completionSignal,terminal:false}},
  ]){
    assert.throws(
      ()=>createMultiAgentChildReviewHandoff(preparation,set,bad),
      (error:unknown)=>error instanceof MultiAgentChildReviewHandoffError
        && error.code==="packet_invalid",
    );
  }
});
