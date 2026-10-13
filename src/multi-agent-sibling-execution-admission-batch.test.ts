import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiAgentChildExecutionAdmissionService,
  type MultiAgentParentAuthoritySnapshotV1,
} from "./multi-agent-child-execution-admission.js";
import {
  MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT,
  MultiAgentSiblingExecutionAdmissionBatchError,
  MultiAgentSiblingExecutionAdmissionBatchService,
} from "./multi-agent-sibling-execution-admission-batch.js";
import type { MultiAgentSiblingExecutionPreparationSetV1 } from "./multi-agent-sibling-execution-preparation-set.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";

const set: MultiAgentDelegationSetV1 = {
  schemaVersion:1,
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  createdAt:"2026-10-06T20:00:00.000Z",
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
    materializedAt:"2026-10-06T20:01:00.000Z",
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

function parent(): MultiAgentParentAuthoritySnapshotV1 {
  return {
    schemaVersion:1,
    taskId:set.taskId,
    projectId:set.projectId,
    workspaceId:set.workspaceId,
    workspaceRegistryRevision:set.workspaceRegistryRevision,
    safetyPlanId:set.safetyPlanId,
    safetyProfileId:set.safetyProfileId,
    safetyProfileRevision:set.safetyProfileRevision,
    workerProfileId:set.workerProfileId,
    allowedPathPatterns:["src/0.ts","src/1.ts"],
    protectedPathPatterns:[".env*",".git/**"],
    status:"created",
    hasPendingEscalation:false,
    authority:"current_parent_task_authority",
  };
}

function prepared(children:MultiAgentChildTaskDescriptorV1[], admitted:number[]): MultiAgentSiblingExecutionPreparationSetV1 {
  const admittedSet=new Set(admitted);
  return {
    schemaVersion:1,
    delegationSetId:set.delegationSetId,
    coordinationMode:set.coordinationMode,
    preparationRequests:children
      .filter((_,i)=>admittedSet.has(i))
      .map((item)=>({
        schemaVersion:1,
        childTaskId:item.childTaskId,
        delegationSetId:item.delegationSetId,
        delegationId:item.delegationId,
        coordinationMode:item.coordinationMode,
        parentSupervisorTaskId:item.parentSupervisorTaskId,
        parentTaskId:item.parentTaskId,
        projectId:item.projectId,
        workspaceId:item.workspaceId,
        workspaceRegistryRevision:item.workspaceRegistryRevision,
        safetyPlanId:item.safetyPlanId,
        safetyProfileId:item.safetyProfileId,
        safetyProfileRevision:item.safetyProfileRevision,
        workerProfileId:item.workerProfileId,
        objective:item.objective,
        acceptanceCriteria:[...item.acceptanceCriteria],
        allowedPathPatterns:[...item.allowedPathPatterns],
        protectedPathPatterns:[...item.protectedPathPatterns],
        authority:"sibling_child_preparation_request_only" as const,
        executable:false as const,
        requiresIndependentChildExecutionAdmission:true as const,
        grantsTaskAuthority:false as const,
        grantsFilesystemAuthority:false as const,
        grantsSafetyPlanAuthority:false as const,
        grantsCredentialAuthority:false as const,
        grantsReleaseAuthority:false as const,
      })),
    blockedChildTaskIds:children.filter((_,i)=>!admittedSet.has(i)).map((item)=>item.childTaskId),
    terminalChildTaskIds:[],
    authority:"sibling_execution_preparation_set_only",
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

test("M13S reuses M13D tickets and still stops before durable preparation/runtime",()=>{
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.reusesM13DAdmissionSemantics,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.issuesOnlyPreparedChildren,true);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.blockedSiblingTicketAllowed,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.createsDurablePreparation,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_SIBLING_EXECUTION_ADMISSION_BATCH_CONTRACT.startsWorker,false);
});

test("parallel prepared siblings receive independent one-shot M13D tickets",async()=>{
  const children=[child(0),child(1)];
  let ids=0;
  let tokens=0;
  const admission=new MultiAgentChildExecutionAdmissionService(
    {async revalidateCurrent(){return parent();}},
    {
      idFactory:()=>[
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ][ids++]!,
      tokenFactory:()=>`mae_${"x".repeat(40)}${tokens++}`,
    },
  );
  const service=new MultiAgentSiblingExecutionAdmissionBatchService(admission);
  const batch=await service.issue(set,prepared(children,[0,1]),children);
  assert.equal(batch.tickets.length,2);
  assert.deepEqual(batch.tickets.map((item)=>item.permit.childTaskId),children.map((item)=>item.childTaskId));
  assert.ok(batch.tickets.every((item)=>item.permit.authority==="child_execution_admission_only"));
});

test("blocked sibling cannot obtain a ticket through targeted issuance",async()=>{
  const children=[child(0),child(1)];
  const service=new MultiAgentSiblingExecutionAdmissionBatchService(
    new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent(){return parent();},
    }),
  );
  await assert.rejects(
    ()=>service.issueForChild(set,prepared(children,[0]),children,children[1]!.childTaskId),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionAdmissionBatchError
      && error.code==="non_prepared_child",
  );
});

test("cross-bound preparation request fails before M13D issuance",async()=>{
  const children=[child(0),child(1)];
  let parentCalls=0;
  const service=new MultiAgentSiblingExecutionAdmissionBatchService(
    new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent(){parentCalls+=1;return parent();},
    }),
  );
  const p=prepared(children,[0]);
  p.preparationRequests[0]={...p.preparationRequests[0]!,allowedPathPatterns:["src/1.ts"]};
  await assert.rejects(
    ()=>service.issue(set,p,children),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionAdmissionBatchError
      && error.code==="child_invalid",
  );
  assert.equal(parentCalls,0);
});

test("serialized batch refuses more than one prepared sibling",async()=>{
  const children=[child(0),child(1)].map((item)=>({...item,coordinationMode:"serialized" as const}));
  const serialized={...set,coordinationMode:"serialized" as const};
  const p=prepared(children,[0,1]);
  p.coordinationMode="serialized";
  p.preparationRequests=p.preparationRequests.map((item)=>({...item,coordinationMode:"serialized"}));
  const service=new MultiAgentSiblingExecutionAdmissionBatchService(
    new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent(){return parent();},
    }),
  );
  await assert.rejects(
    ()=>service.issue(serialized,p,children),
    (error:unknown)=>error instanceof MultiAgentSiblingExecutionAdmissionBatchError
      && error.code==="preparation_set_invalid",
  );
});
