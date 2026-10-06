import assert from "node:assert/strict";
import test from "node:test";
import {
  admitMultiAgentSiblingExecutionSet,
  MultiAgentSiblingExecutionSetAdmissionError,
  MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT,
  type MultiAgentSiblingChildStateEvidenceV1,
} from "./multi-agent-sibling-execution-set-admission.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";

const set: MultiAgentDelegationSetV1 = {
  schemaVersion:1,
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  createdAt:"2026-10-06T18:00:00.000Z",
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
  const ids=[
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  return {
    schemaVersion:1,
    childTaskId:ids[index]!,
    materializedAt:"2026-10-06T18:01:00.000Z",
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

function state(
  item: MultiAgentChildTaskDescriptorV1,
  value: MultiAgentSiblingChildStateEvidenceV1["state"],
): MultiAgentSiblingChildStateEvidenceV1 {
  return {
    schemaVersion:1,
    childTaskId:item.childTaskId,
    delegationId:item.delegationId,
    state:value,
    authority:"sibling_child_state_evidence_only",
  };
}

test("M13Q remains admission-only and non-executing",()=>{
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT.parallelRequiresDisjointSetEvidence,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT.serializedAdmitsExactlyOne,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT.startsWorker,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_SET_ADMISSION_CONTRACT.grantsReleaseAuthority,false);
});

test("parallel disjoint admits all pending siblings",()=>{
  const children=[child(0),child(1)];
  const result=admitMultiAgentSiblingExecutionSet(
    set,
    children,
    children.map((item)=>state(item,"pending")),
  );
  assert.deepEqual(result.admittedChildTaskIds,children.map((item)=>item.childTaskId));
  assert.deepEqual(result.blockedChildTaskIds,[]);
});

test("serialized admits exactly one next pending child",()=>{
  const serialized={...set,coordinationMode:"serialized" as const};
  const children=[child(0),child(1)].map((item)=>({...item,coordinationMode:"serialized" as const}));
  const result=admitMultiAgentSiblingExecutionSet(
    serialized,
    children,
    children.map((item)=>state(item,"pending")),
  );
  assert.deepEqual(result.admittedChildTaskIds,[children[0]!.childTaskId]);
  assert.deepEqual(result.blockedChildTaskIds,[children[1]!.childTaskId]);
});

test("serialized with one running child admits no second child",()=>{
  const serialized={...set,coordinationMode:"serialized" as const};
  const children=[child(0),child(1)].map((item)=>({...item,coordinationMode:"serialized" as const}));
  const result=admitMultiAgentSiblingExecutionSet(
    serialized,
    children,
    [state(children[0]!,"running"),state(children[1]!,"pending")],
  );
  assert.deepEqual(result.admittedChildTaskIds,[]);
  assert.deepEqual(result.blockedChildTaskIds,children.map((item)=>item.childTaskId));
});

test("parallel set with overlap evidence fails closed",()=>{
  const children=[child(0),child(1)];
  assert.throws(
    ()=>admitMultiAgentSiblingExecutionSet(
      {
        ...set,
        overlappingDelegationPairs:[{
          leftDelegationId:set.delegationIds[0]!,
          rightDelegationId:set.delegationIds[1]!,
        }],
      },
      children,
      children.map((item)=>state(item,"pending")),
    ),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionSetAdmissionError
      && error.code==="set_invalid",
  );
});

test("cross-bound state evidence fails closed",()=>{
  const children=[child(0),child(1)];
  assert.throws(
    ()=>admitMultiAgentSiblingExecutionSet(
      set,
      children,
      [
        state(children[0]!,"pending"),
        {...state(children[1]!,"pending"),delegationId:set.delegationIds[0]!},
      ],
    ),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionSetAdmissionError
      && error.code==="state_invalid",
  );
});
