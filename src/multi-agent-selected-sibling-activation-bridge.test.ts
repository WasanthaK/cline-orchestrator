import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiAgentChildExecutionActivationCoordinator,
} from "./multi-agent-child-execution-activation.js";
import type {
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import {
  MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT,
  MultiAgentSelectedSiblingActivationBridge,
  MultiAgentSelectedSiblingActivationBridgeError,
} from "./multi-agent-selected-sibling-activation-bridge.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import type { MultiAgentSiblingWriterCompatibilityEvidenceV1 } from "./multi-agent-sibling-writer-compatibility.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const childTaskId="11111111-1111-4111-8111-111111111111";
const otherChildTaskId="22222222-2222-4222-8222-222222222222";
const workspaceId="33333333-3333-4333-8333-333333333333";
const delegationSetId="44444444-4444-4444-8444-444444444444";
const preparationId="55555555-5555-4555-8555-555555555555";
const delegationId="66666666-6666-4666-8666-666666666666";

const preparation: any = {
  schemaVersion:1,
  preparationId,
  preparedAt:"2026-10-06T22:00:00.000Z",
  admissionPermitId:"77777777-7777-4777-8777-777777777777",
  admissionConsumedAt:"2026-10-06T21:59:00.000Z",
  childTaskId,
  delegationSetId,
  delegationId,
  coordinationMode:"parallel_disjoint",
  parentSupervisorTaskId:"88888888-8888-4888-8888-888888888888",
  parentTaskId:"99999999-9999-4999-8999-999999999999",
  projectId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId,
  workspaceRegistryRevision:2,
  safetyPlanId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  safetyPolicyVersion:"policy-v1",
  safetyProfileId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  safetyProfileRevision:3,
  workerProfileId:"default",
  objective:"child 0",
  acceptanceCriteria:["done"],
  trustedValidationCommands:["npm test"],
  allowedPathPatterns:["src/0.ts"],
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

const batch: MultiAgentSiblingDurablePreparationBatchV1 = {
  schemaVersion:1,
  delegationSetId,
  coordinationMode:"parallel_disjoint",
  receipts:[],
  preparations:[
    preparation,
    {...preparation,preparationId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",childTaskId:otherChildTaskId,delegationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",allowedPathPatterns:["src/1.ts"]},
  ],
  blockedChildTaskIds:[],
  terminalChildTaskIds:[],
  authority:"sibling_durable_preparation_batch_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const selection: MultiAgentSiblingWriterCompatibilityEvidenceV1 = {
  schemaVersion:1,
  delegationSetId,
  workspaceId,
  coordinationMode:"parallel_disjoint",
  selectedCandidate:{
    schemaVersion:1,
    childTaskId,
    preparationId,
    workspaceId,
    delegationSetId,
    delegationId,
    coordinationMode:"parallel_disjoint",
    authority:"sibling_writer_activation_candidate_only",
    requiresFreshSchedulerOwnedWriterLease:true,
    runtimeStartAuthorized:false,
    grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,grantsReleaseAuthority:false,
  },
  deferredPreparedChildTaskIds:[otherChildTaskId],
  blockedChildTaskIds:[],
  terminalChildTaskIds:[],
  parallelConcurrencyDeferredByExclusiveWorkspaceWriter:true,
  authority:"sibling_writer_compatibility_evidence_only",
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

function current(): MultiAgentParentExecutionBindingV1 {
  return {
    schemaVersion:1,
    taskId:preparation.parentTaskId,
    projectId:preparation.projectId,
    workspaceId,
    workspaceRegistryRevision:2,
    safetyPlanId:preparation.safetyPlanId,
    safetyPolicyVersion:preparation.safetyPolicyVersion,
    safetyProfileId:preparation.safetyProfileId,
    safetyProfileRevision:3,
    workerProfileId:"default",
    allowedPathPatterns:["src/0.ts","src/1.ts"],
    protectedPathPatterns:[".env*",".git/**"],
    trustedValidationCommands:["npm test"],
    status:"created",
    hasPendingEscalation:false,
    authority:"current_parent_execution_binding",
  };
}

function lease(taskId=childTaskId):WriterLeaseSession{
  const claim:WorkspaceWriterClaimV1={
    schemaVersion:1,workspaceId,stateRevision:1,
    leaseId:"ffffffff-ffff-4fff-8fff-ffffffffffff",
    fenceToken:"12121212-1212-4121-8121-121212121212",
    taskId,
    ownerInstanceId:"13131313-1313-4131-8131-131313131313",
    expiresAt:"2026-10-06T22:10:00.000Z",
    authority:"coordination_only",
  };
  return {
    taskId,workspaceId,ownerInstanceId:claim.ownerInstanceId,
    signal:new AbortController().signal,
    currentClaim:()=>structuredClone(claim),
    validateCurrent:async()=>undefined,
  };
}

test("M13V reuses M13F and remains pre-runtime",()=>{
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT.requiresM13USelection,true);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT.reusesM13FActivationCoordinator,true);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT.deferredSiblingActivationAllowed,false);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT.startsCline,false);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_ACTIVATION_BRIDGE_CONTRACT.acquiresWriterLease,false);
});

test("selected sibling enters existing M13F activation under exact fresh lease",async()=>{
  const bridge=new MultiAgentSelectedSiblingActivationBridge(
    new MultiAgentChildExecutionActivationCoordinator({
      async revalidateCurrent(){return current();},
    }),
  );
  const context=await bridge.activateSelected(selection,batch,lease());
  assert.equal(context.runtimeInput.childTaskId,childTaskId);
  assert.equal(context.runtimeInput.runtimeStartAuthorized,false);
  assert.equal(context.evidence.preparationId,preparationId);
});

test("deferred sibling cannot enter activation",async()=>{
  const bridge=new MultiAgentSelectedSiblingActivationBridge(
    new MultiAgentChildExecutionActivationCoordinator({
      async revalidateCurrent(){return current();},
    }),
  );
  assert.throws(
    ()=>bridge.assertChildSelected(selection,otherChildTaskId),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingActivationBridgeError
      && error.code==="non_selected_child",
  );
  await assert.rejects(
    ()=>bridge.activateSelected(selection,batch,lease(otherChildTaskId)),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingActivationBridgeError
      && error.code==="selection_mismatch",
  );
});

test("candidate/preparation identity mismatch fails before M13F",async()=>{
  const bridge=new MultiAgentSelectedSiblingActivationBridge(
    new MultiAgentChildExecutionActivationCoordinator({
      async revalidateCurrent(){throw new Error("must not be reached");},
    }),
  );
  await assert.rejects(
    ()=>bridge.activateSelected(
      {
        ...selection,
        selectedCandidate:{...selection.selectedCandidate!,preparationId:"14141414-1414-4141-8141-141414141414"},
      },
      batch,
      lease(),
    ),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingActivationBridgeError
      && error.code==="selection_mismatch",
  );
});
