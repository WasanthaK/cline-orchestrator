import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT,
  MultiAgentSelectedSiblingRuntimeBridge,
  MultiAgentSelectedSiblingRuntimeBridgeError,
} from "./multi-agent-selected-sibling-runtime-bridge.js";
import type { MultiAgentChildExecutionActivationContext } from "./multi-agent-child-execution-activation.js";
import type { MultiAgentSiblingWriterCompatibilityEvidenceV1 } from "./multi-agent-sibling-writer-compatibility.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import type { OrchestratorTask } from "./types.js";

const childTaskId="11111111-1111-4111-8111-111111111111";
const otherChildTaskId="22222222-2222-4222-8222-222222222222";
const workspaceId="33333333-3333-4333-8333-333333333333";

const selection: MultiAgentSiblingWriterCompatibilityEvidenceV1 = {
  schemaVersion:1,
  delegationSetId:"44444444-4444-4444-8444-444444444444",
  workspaceId,
  coordinationMode:"parallel_disjoint",
  selectedCandidate:{
    schemaVersion:1,
    childTaskId,
    preparationId:"55555555-5555-4555-8555-555555555555",
    workspaceId,
    delegationSetId:"44444444-4444-4444-8444-444444444444",
    delegationId:"66666666-6666-4666-8666-666666666666",
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

function context(taskId=childTaskId): MultiAgentChildExecutionActivationContext {
  const claim:WorkspaceWriterClaimV1={
    schemaVersion:1,
    workspaceId,
    stateRevision:1,
    leaseId:"77777777-7777-4777-8777-777777777777",
    fenceToken:"88888888-8888-4888-8888-888888888888",
    taskId,
    ownerInstanceId:"99999999-9999-4999-8999-999999999999",
    expiresAt:"2026-10-07T02:00:00.000Z",
    authority:"coordination_only",
  };
  return {
    evidence:{
      schemaVersion:1,
      preparationId:"55555555-5555-4555-8555-555555555555",
      childTaskId:taskId,
      parentTaskId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspaceId,
      leaseId:claim.leaseId,
      fenceToken:claim.fenceToken,
      ownerInstanceId:claim.ownerInstanceId,
      activatedAt:"2026-10-07T01:55:00.000Z",
      authority:"child_execution_activation_evidence_only",
      runtimeStartAuthorized:false,
      grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
      grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
    },
    runtimeInput:{
      schemaVersion:1,
      childTaskId:taskId,
      parentTaskId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspaceId,
      workspaceRegistryRevision:2,
      safetyPlanId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      safetyPolicyVersion:"policy-v1",
      safetyProfileId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      safetyProfileRevision:3,
      workerProfileId:"default",
      objective:"child",
      acceptanceCriteria:["done"],
      trustedValidationCommands:["npm test"],
      allowedPathPatterns:["src/0.ts"],
      protectedPathPatterns:[".env*",".git/**"],
      coordinationMode:"parallel_disjoint",
      authority:"child_runtime_input_only",
      runtimeStartAuthorized:false,
      grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
      grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
    },
    lease:{
      taskId,
      workspaceId,
      ownerInstanceId:claim.ownerInstanceId,
      signal:new AbortController().signal,
      currentClaim:()=>structuredClone(claim),
      validateCurrent:async()=>undefined,
    },
  };
}

test("M13W delegates only the selected sibling to M13G",()=>{
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT.requiresM13USelection,true);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT.requiresM13VActivationContext,true);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT.reusesM13GRuntimeStarter,true);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT.deferredSiblingRuntimeAllowed,false);
  assert.equal(MULTI_AGENT_SELECTED_SIBLING_RUNTIME_BRIDGE_CONTRACT.createsSecondWriter,false);
});

test("selected activated sibling enters existing M13G starter once",async()=>{
  let calls=0;
  const resultTask:OrchestratorTask={
    id:childTaskId,
    goal:"child",
    workspace:"/tmp/workspace",
    status:"completed",
    createdAt:"2026-10-07T01:55:00.000Z",
    updatedAt:"2026-10-07T01:56:00.000Z",
  };
  const bridge=new MultiAgentSelectedSiblingRuntimeBridge({
    async start(received: MultiAgentChildExecutionActivationContext){
      calls+=1;
      assert.equal(received.runtimeInput.childTaskId,childTaskId);
      return resultTask;
    },
  } as any);
  const result=await bridge.startSelected(selection,context());
  assert.equal(calls,1);
  assert.equal(result.id,childTaskId);
});

test("deferred sibling cannot enter runtime bridge",async()=>{
  let calls=0;
  const bridge=new MultiAgentSelectedSiblingRuntimeBridge({
    async start(task: MultiAgentChildExecutionActivationContext){calls+=1;return task as any;},
  } as any);
  assert.throws(
    ()=>bridge.assertChildSelected(selection,otherChildTaskId),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingRuntimeBridgeError
      && error.code==="non_selected_child",
  );
  await assert.rejects(
    ()=>bridge.startSelected(selection,context(otherChildTaskId)),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingRuntimeBridgeError
      && error.code==="activation_invalid",
  );
  assert.equal(calls,0);
});

test("cross-bound activation workspace fails before M13G",async()=>{
  let calls=0;
  const bridge=new MultiAgentSelectedSiblingRuntimeBridge({
    async start(task: MultiAgentChildExecutionActivationContext){calls+=1;return task as any;},
  } as any);
  const bad=context();
  bad.runtimeInput={...bad.runtimeInput,workspaceId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"};
  await assert.rejects(
    ()=>bridge.startSelected(selection,bad),
    (error:unknown)=>error instanceof MultiAgentSelectedSiblingRuntimeBridgeError
      && error.code==="activation_invalid",
  );
  assert.equal(calls,0);
});
