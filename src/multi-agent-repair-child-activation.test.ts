import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT,
  MultiAgentRepairChildActivationCoordinator,
  MultiAgentRepairChildActivationError,
} from "./multi-agent-repair-child-activation.js";
import type {
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentRepairChildPreparationV1 } from "./multi-agent-repair-child-preparation.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const preparation: MultiAgentRepairChildPreparationV1 = {
  schemaVersion:1,
  preparationId:"11111111-1111-4111-8111-111111111111",
  preparedAt:"2026-10-06T15:00:00.000Z",
  executionAdmissionPermitId:"22222222-2222-4222-8222-222222222222",
  executionAdmissionConsumedAt:"2026-10-06T14:59:00.000Z",
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
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const current: MultiAgentParentExecutionBindingV1 = {
  schemaVersion:1,
  taskId:preparation.parentTaskId,
  projectId:preparation.projectId,
  workspaceId:preparation.workspaceId,
  workspaceRegistryRevision:preparation.workspaceRegistryRevision,
  safetyPlanId:preparation.safetyPlanId,
  safetyPolicyVersion:preparation.safetyPolicyVersion,
  safetyProfileId:preparation.safetyProfileId,
  safetyProfileRevision:preparation.safetyProfileRevision,
  workerProfileId:preparation.workerProfileId,
  allowedPathPatterns:["src/a.ts","src/b.ts"],
  protectedPathPatterns:[...preparation.protectedPathPatterns],
  trustedValidationCommands:[...preparation.trustedValidationCommands],
  status:"created",
  hasPendingEscalation:false,
  authority:"current_parent_execution_binding",
};

function lease(taskId=preparation.repairChildTaskId): WriterLeaseSession {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion:1,
    workspaceId:preparation.workspaceId,
    stateRevision:1,
    leaseId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    fenceToken:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    taskId,
    ownerInstanceId:"ffffffff-ffff-4fff-8fff-ffffffffffff",
    expiresAt:"2026-10-06T15:10:00.000Z",
    authority:"coordination_only",
  };
  return {
    taskId:claim.taskId,
    workspaceId:claim.workspaceId,
    ownerInstanceId:claim.ownerInstanceId,
    signal:new AbortController().signal,
    currentClaim:()=>structuredClone(claim),
    validateCurrent:async()=>undefined,
  };
}

test("M13N uses a fresh repair-child lease and still stops before runtime",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT.requiresFreshRepairChildIdentity,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT.priorChildLeaseReuseAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT.priorChildRuntimeReuseAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT.startsCline,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_ACTIVATION_CONTRACT.invokesRuntime,false);
});

test("fresh parent binding and fresh repair-child lease emit bounded runtime input",async()=>{
  const session=lease();
  const coordinator=new MultiAgentRepairChildActivationCoordinator(
    {async revalidateCurrent(){return structuredClone(current);}},
    {now:()=>new Date("2026-10-06T15:01:00.000Z")},
  );
  const context=await coordinator.activate(preparation,session);
  assert.equal(context.lease,session);
  assert.equal(context.runtimeInput.repairChildTaskId,preparation.repairChildTaskId);
  assert.equal(context.runtimeInput.priorChildTaskId,preparation.priorChildTaskId);
  assert.equal(context.runtimeInput.repairInstruction,preparation.repairInstruction);
  assert.deepEqual(context.runtimeInput.allowedPathPatterns,["src/a.ts"]);
  assert.equal(context.runtimeInput.runtimeStartAuthorized,false);
  assert.equal(context.evidence.runtimeStartAuthorized,false);
});

test("prior-child lease identity is rejected",async()=>{
  const coordinator=new MultiAgentRepairChildActivationCoordinator({
    async revalidateCurrent(){return structuredClone(current);},
  });
  await assert.rejects(
    ()=>coordinator.activate(preparation,lease(preparation.priorChildTaskId)),
    (error:unknown)=>error instanceof MultiAgentRepairChildActivationError
      && ["lease_invalid","prior_child_reuse"].includes(error.code),
  );
});

test("parent policy or scope drift fails before lease validation",async()=>{
  for(const drift of [
    {...current,safetyPolicyVersion:"policy-v2"},
    {...current,allowedPathPatterns:["src/b.ts"]},
    {...current,trustedValidationCommands:["npm run other"]},
  ]){
    let checks=0;
    const session=lease();
    const wrapped: WriterLeaseSession = {
      ...session,
      validateCurrent:async()=>{checks+=1;},
    };
    const coordinator=new MultiAgentRepairChildActivationCoordinator({
      async revalidateCurrent(){return drift as MultiAgentParentExecutionBindingV1;},
    });
    await assert.rejects(()=>coordinator.activate(preparation,wrapped));
    assert.equal(checks,0);
  }
});
