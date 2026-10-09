import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT,
  MultiAgentDeferredSiblingProgressionError,
  progressMultiAgentDeferredSibling,
} from "./multi-agent-deferred-sibling-progression.js";
import type { MultiAgentSiblingWriterCompatibilityEvidenceV1 } from "./multi-agent-sibling-writer-compatibility.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import { createWorkspaceLockState } from "./workspace-lock.js";

const first="11111111-1111-4111-8111-111111111111";
const second="22222222-2222-4222-8222-222222222222";
const workspaceId="33333333-3333-4333-8333-333333333333";
const delegationSetId="44444444-4444-4444-8444-444444444444";

const selection:MultiAgentSiblingWriterCompatibilityEvidenceV1={
  schemaVersion:1,
  delegationSetId,
  workspaceId,
  coordinationMode:"parallel_disjoint",
  selectedCandidate:{
    schemaVersion:1,
    childTaskId:first,
    preparationId:"55555555-5555-4555-8555-555555555555",
    workspaceId,
    delegationSetId,
    delegationId:"66666666-6666-4666-8666-666666666666",
    coordinationMode:"parallel_disjoint",
    authority:"sibling_writer_activation_candidate_only",
    requiresFreshSchedulerOwnedWriterLease:true,
    runtimeStartAuthorized:false,
    grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,grantsReleaseAuthority:false,
  },
  deferredPreparedChildTaskIds:[second],
  blockedChildTaskIds:[],
  terminalChildTaskIds:[],
  parallelConcurrencyDeferredByExclusiveWorkspaceWriter:true,
  authority:"sibling_writer_compatibility_evidence_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

function prep(id:string,index:number){
  return {
    schemaVersion:1 as const,
    preparationId:index===0?"55555555-5555-4555-8555-555555555555":"77777777-7777-4777-8777-777777777777",
    preparedAt:"2026-10-07T04:00:00.000Z",
    admissionPermitId:index===0?"88888888-8888-4888-8888-888888888888":"99999999-9999-4999-8999-999999999999",
    admissionConsumedAt:"2026-10-07T03:59:00.000Z",
    childTaskId:id,
    delegationSetId,
    delegationId:index===0?"66666666-6666-4666-8666-666666666666":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    coordinationMode:"parallel_disjoint" as const,
    parentSupervisorTaskId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    parentTaskId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    workspaceId,
    workspaceRegistryRevision:2,
    safetyPlanId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    safetyPolicyVersion:"policy-v1",
    safetyProfileId:"ffffffff-ffff-4fff-8fff-ffffffffffff",
    safetyProfileRevision:3,
    workerProfileId:"default",
    objective:`child ${index}`,
    acceptanceCriteria:["done"],
    trustedValidationCommands:["npm test"],
    allowedPathPatterns:[`src/${index}.ts`],
    protectedPathPatterns:[".env*",".git/**"],
    state:"prepared" as const,
    executable:false as const,
    requiresFreshParentBindingAtExecution:true as const,
    requiresFreshWriterLease:true as const,
    requiresFreshDistributedFenceWhenDistributed:true as const,
    authority:"child_execution_preparation_only" as const,
    grantsTaskAuthority:false as const,grantsFilesystemAuthority:false as const,
    grantsSafetyPlanAuthority:false as const,grantsWriterLeaseAuthority:false as const,
    grantsCredentialAuthority:false as const,grantsReleaseAuthority:false as const,
  };
}

const batch:MultiAgentSiblingDurablePreparationBatchV1={
  schemaVersion:1,
  delegationSetId,
  coordinationMode:"parallel_disjoint",
  receipts:[],
  preparations:[prep(first,0),prep(second,1)],
  blockedChildTaskIds:[],
  terminalChildTaskIds:[],
  authority:"sibling_durable_preparation_batch_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const completion:TaskCompletionPacketV1={
  schemaVersion:1,
  taskId:first,
  projectId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  workspaceId,
  capturedAt:"2026-10-07T04:10:00.000Z",
  status:"completed",
  reviewState:"ready_for_supervisor_review",
  completionSignal:{terminal:true,finishReason:"completed",workerReportAvailable:false},
  independentEvidence:{
    validation:{available:true,passed:true,commandsRequested:1,commandsRun:1,source:"orchestrator_validation"},
    diffSafety:{available:true,passed:true,source:"orchestrator_diff_safety"},
    git:{source:"orchestrator_git_snapshot"},
    checkpoint:{available:true,restored:false,source:"orchestrator_checkpoint"},
    recovery:{runCount:1,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,contextHandoffCount:0,retryCount:0,stallCount:0,source:"orchestrator_runtime_state"},
  },
};

test("M13X remains progression evidence only",()=>{
  assert.equal(MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT.requiresPriorSelectedTerminal,true);
  assert.equal(MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT.requiresWorkspaceWriterReleased,true);
  assert.equal(MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT.reusesM13USelection,true);
  assert.equal(MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_DEFERRED_SIBLING_PROGRESSION_CONTRACT.startsCline,false);
});

test("terminal first sibling plus released workspace advances the deferred sibling",()=>{
  const result=progressMultiAgentDeferredSibling(
    selection,
    completion,
    createWorkspaceLockState(workspaceId),
    batch,
  );
  assert.equal(result.previousSelectedChildTaskId,first);
  assert.equal(result.nextSelection.selectedCandidate?.childTaskId,second);
  assert.deepEqual(result.nextSelection.deferredPreparedChildTaskIds,[]);
  assert.ok(result.nextSelection.terminalChildTaskIds.includes(first));
});

test("active workspace writer blocks deferred sibling progression",()=>{
  const lock=createWorkspaceLockState(workspaceId);
  lock.activeWriter={
    leaseId:"12121212-1212-4121-8121-121212121212",
    fenceToken:"13131313-1313-4131-8131-131313131313",
    taskId:first,
    ownerInstanceId:"14141414-1414-4141-8141-141414141414",
    acquiredAt:"2026-10-07T04:05:00.000Z",
    expiresAt:"2026-10-07T04:20:00.000Z",
  };
  assert.throws(
    ()=>progressMultiAgentDeferredSibling(selection,completion,lock,batch),
    (error:unknown)=>error instanceof MultiAgentDeferredSiblingProgressionError
      && error.code==="workspace_lock_active",
  );
});

test("non-terminal completion cannot advance a deferred sibling",()=>{
  assert.throws(
    ()=>progressMultiAgentDeferredSibling(
      selection,
      {...completion,status:"running",reviewState:"worker_in_progress",completionSignal:{...completion.completionSignal,terminal:false}},
      createWorkspaceLockState(workspaceId),
      batch,
    ),
    (error:unknown)=>error instanceof MultiAgentDeferredSiblingProgressionError
      && error.code==="completion_invalid",
  );
});
