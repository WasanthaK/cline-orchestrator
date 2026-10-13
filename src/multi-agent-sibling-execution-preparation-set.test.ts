import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSiblingChildAdmittedForPreparation,
  MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT,
  MultiAgentSiblingExecutionPreparationSetError,
  prepareMultiAgentSiblingExecutionSet,
} from "./multi-agent-sibling-execution-preparation-set.js";
import type { MultiAgentSiblingExecutionSetAdmissionV1 } from "./multi-agent-sibling-execution-set-admission.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";

const set: MultiAgentDelegationSetV1 = {
  schemaVersion:1,
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  createdAt:"2026-10-06T19:00:00.000Z",
  coordinationMode:"parallel_disjoint",
  parentSupervisorTaskId:"22222222-2222-4222-8222-222222222222",
  taskId:"33333333-3333-4333-8333-333333333333",
  projectId:"44444444-4444-4444-8444-444444444444",
  workspaceId:"55555555-5555-4555-8555-555555555555",
  workspaceRegistryRevision:2,
  safetyPlanId:"66666666-6666-4666-8666-666666666666",
  safetyProfileId:"77777777-7777-4777-8777-777777777777",
  safetyProfileRevision:3,
  workerProfileId:"default",
  delegationIds:[
    "88888888-8888-4888-8888-888888888888",
    "99999999-9999-4999-8999-999999999999",
  ],
  overlappingDelegationPairs:[],
  authority:"delegation_set_evidence_only",
  grantsTaskAuthority:false,
  grantsFilesystemAuthority:false,
  grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,
  grantsCredentialAuthority:false,
  grantsReleaseAuthority:false,
};

function child(index:number): MultiAgentChildTaskDescriptorV1 {
  return {
    schemaVersion:1,
    childTaskId:[
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ][index]!,
    materializedAt:"2026-10-06T19:01:00.000Z",
    delegationSetId:set.delegationSetId,
    delegationId:set.delegationIds[index]!,
    coordinationMode:set.coordinationMode,
    parentSupervisorTaskId:set.parentSupervisorTaskId,
    parentTaskId:set.taskId,
    projectId:set.projectId,
    workspaceId:set.workspaceId,
    workspaceRegistryRevision:set.workspaceRegistryRevision,
    safetyPlanId:set.safetyPlanId,
    safetyProfileId:set.safetyProfileId,
    safetyProfileRevision:set.safetyProfileRevision,
    workerProfileId:set.workerProfileId,
    objective:`child ${index}`,
    acceptanceCriteria:["done"],
    allowedPathPatterns:[`src/${index}.ts`],
    protectedPathPatterns:[".env*",".git/**"],
    authority:"child_task_materialization_only",
    executable:false,
    requiresIndependentExecutionAdmission:true,
    requiresFreshWriterLease:true,
    requiresFreshDistributedFenceWhenDistributed:true,
    requiresParentBindingRevalidation:true,
    allowsSubdelegation:false,
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

function admission(
  mode:"parallel_disjoint"|"serialized",
  admitted:string[],
  blocked:string[],
): MultiAgentSiblingExecutionSetAdmissionV1 {
  return {
    schemaVersion:1,
    delegationSetId:set.delegationSetId,
    coordinationMode:mode,
    admittedChildTaskIds:admitted,
    blockedChildTaskIds:blocked,
    terminalChildTaskIds:[],
    authority:"sibling_execution_set_admission_only",
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

test("M13R emits preparation requests only and still grants no execution authority",()=>{
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT.requiresM13QAdmission,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT.emitsOnlyAdmittedChildren,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT.issuesChildExecutionAdmissionToken,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_PREPARATION_SET_CONTRACT.startsWorker,false);
});

test("parallel admitted siblings map to exact per-child preparation requests",()=>{
  const children=[child(0),child(1)];
  const result=prepareMultiAgentSiblingExecutionSet(
    set,
    admission("parallel_disjoint",children.map((item)=>item.childTaskId),[]),
    children,
  );
  assert.deepEqual(
    result.preparationRequests.map((item)=>item.childTaskId),
    children.map((item)=>item.childTaskId),
  );
  assert.deepEqual(result.preparationRequests[0]!.allowedPathPatterns,["src/0.ts"]);
  assert.equal(result.preparationRequests[0]!.executable,false);
});

test("serialized preparation exposes only the one admitted child",()=>{
  const serialized={...set,coordinationMode:"serialized" as const};
  const children=[child(0),child(1)].map((item)=>({...item,coordinationMode:"serialized" as const}));
  const result=prepareMultiAgentSiblingExecutionSet(
    serialized,
    admission("serialized",[children[0]!.childTaskId],[children[1]!.childTaskId]),
    children,
  );
  assert.deepEqual(result.preparationRequests.map((item)=>item.childTaskId),[children[0]!.childTaskId]);
  assert.throws(
    ()=>assertSiblingChildAdmittedForPreparation(result,children[1]!.childTaskId),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionPreparationSetError
      && error.code==="non_admitted_child",
  );
});

test("M13Q admission referencing a child outside the exact set fails closed",()=>{
  const children=[child(0),child(1)];
  assert.throws(
    ()=>prepareMultiAgentSiblingExecutionSet(
      set,
      admission("parallel_disjoint",["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],children.map((item)=>item.childTaskId)),
      children,
    ),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionPreparationSetError
      && error.code==="binding_mismatch",
  );
});

test("blocked child cannot be requested for preparation",()=>{
  const children=[child(0),child(1)];
  const result=prepareMultiAgentSiblingExecutionSet(
    set,
    admission("parallel_disjoint",[children[0]!.childTaskId],[children[1]!.childTaskId]),
    children,
  );
  assert.equal(assertSiblingChildAdmittedForPreparation(result,children[0]!.childTaskId).delegationId,children[0]!.delegationId);
  assert.throws(
    ()=>assertSiblingChildAdmittedForPreparation(result,children[1]!.childTaskId),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionPreparationSetError
      && error.code==="non_admitted_child",
  );
});
