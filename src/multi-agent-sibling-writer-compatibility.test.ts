import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT,
  MultiAgentSiblingWriterCompatibilityError,
  selectMultiAgentSiblingWriterCandidate,
} from "./multi-agent-sibling-writer-compatibility.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";

function preparation(index:number,mode:"parallel_disjoint"|"serialized"="parallel_disjoint"):MultiAgentChildExecutionPreparationV1{
  return {
    schemaVersion:1,
    preparationId:[
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ][index]!,
    preparedAt:"2026-10-06T21:30:00.000Z",
    admissionPermitId:[
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ][index]!,
    admissionConsumedAt:"2026-10-06T21:29:00.000Z",
    childTaskId:[
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ][index]!,
    delegationSetId:"77777777-7777-4777-8777-777777777777",
    delegationId:[
      "88888888-8888-4888-8888-888888888888",
      "99999999-9999-4999-8999-999999999999",
    ][index]!,
    coordinationMode:mode,
    parentSupervisorTaskId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parentTaskId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    workspaceId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
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
    state:"prepared",
    executable:false,
    requiresFreshParentBindingAtExecution:true,
    requiresFreshWriterLease:true,
    requiresFreshDistributedFenceWhenDistributed:true,
    authority:"child_execution_preparation_only",
    grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
  };
}

function batch(mode:"parallel_disjoint"|"serialized",preps:MultiAgentChildExecutionPreparationV1[]):MultiAgentSiblingDurablePreparationBatchV1{
  return {
    schemaVersion:1,
    delegationSetId:"77777777-7777-4777-8777-777777777777",
    coordinationMode:mode,
    receipts:[],
    preparations:preps,
    blockedChildTaskIds:[],
    terminalChildTaskIds:[],
    authority:"sibling_durable_preparation_batch_only",
    grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,grantsReleaseAuthority:false,
  };
}

test("M13U codifies the existing exclusive workspace writer invariant",()=>{
  assert.equal(MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT.maxActiveWritersPerWorkspace,1);
  assert.equal(MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT.parallelDisjointOverridesWorkspaceWriterLock,false);
  assert.equal(MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT.selectsAtMostOneLeaseCandidate,true);
  assert.equal(MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_SIBLING_WRITER_COMPATIBILITY_CONTRACT.startsCline,false);
});

test("parallel disjoint siblings select one lease candidate and defer the rest",()=>{
  const p0=preparation(0);
  const p1=preparation(1);
  const result=selectMultiAgentSiblingWriterCandidate(batch("parallel_disjoint",[p0,p1]));
  assert.equal(result.selectedCandidate?.childTaskId,p0.childTaskId);
  assert.deepEqual(result.deferredPreparedChildTaskIds,[p1.childTaskId]);
  assert.equal(result.parallelConcurrencyDeferredByExclusiveWorkspaceWriter,true);
  assert.equal(result.selectedCandidate?.runtimeStartAuthorized,false);
});

test("serialized sibling batch selects its sole prepared child",()=>{
  const p0=preparation(0,"serialized");
  const result=selectMultiAgentSiblingWriterCandidate(batch("serialized",[p0]));
  assert.equal(result.selectedCandidate?.childTaskId,p0.childTaskId);
  assert.deepEqual(result.deferredPreparedChildTaskIds,[]);
  assert.equal(result.parallelConcurrencyDeferredByExclusiveWorkspaceWriter,false);
});

test("serialized batch with multiple prepared children fails closed",()=>{
  assert.throws(
    ()=>selectMultiAgentSiblingWriterCandidate(
      batch("serialized",[preparation(0,"serialized"),preparation(1,"serialized")]),
    ),
    (error:unknown)=>error instanceof MultiAgentSiblingWriterCompatibilityError
      && error.code==="binding_mismatch",
  );
});

test("cross-workspace sibling preparations fail closed",()=>{
  const p0=preparation(0);
  const p1={...preparation(1),workspaceId:"12121212-1212-4121-8121-121212121212"};
  assert.throws(
    ()=>selectMultiAgentSiblingWriterCandidate(batch("parallel_disjoint",[p0,p1])),
    (error:unknown)=>error instanceof MultiAgentSiblingWriterCompatibilityError
      && error.code==="binding_mismatch",
  );
});
