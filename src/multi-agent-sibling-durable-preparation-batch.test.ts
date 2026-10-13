import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MultiAgentChildExecutionAdmissionService,
  type MultiAgentParentAuthoritySnapshotV1,
} from "./multi-agent-child-execution-admission.js";
import {
  FileMultiAgentChildExecutionPreparationStore,
  MultiAgentChildExecutionPreparationService,
  type MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import {
  MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT,
  MultiAgentSiblingDurablePreparationBatchError,
  MultiAgentSiblingDurablePreparationBatchService,
} from "./multi-agent-sibling-durable-preparation-batch.js";
import type { MultiAgentSiblingExecutionAdmissionBatchV1 } from "./multi-agent-sibling-execution-admission-batch.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";

const set: MultiAgentDelegationSetV1 = {
  schemaVersion:1,
  delegationSetId:"11111111-1111-4111-8111-111111111111",
  createdAt:"2026-10-06T21:00:00.000Z",
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
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

function child(index:number): MultiAgentChildTaskDescriptorV1 {
  return {
    schemaVersion:1,
    childTaskId:[
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ][index]!,
    materializedAt:"2026-10-06T21:01:00.000Z",
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
    grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
  };
}

function parentAuthority(): MultiAgentParentAuthoritySnapshotV1 {
  return {
    schemaVersion:1,
    taskId:set.taskId,projectId:set.projectId,workspaceId:set.workspaceId,
    workspaceRegistryRevision:set.workspaceRegistryRevision,
    safetyPlanId:set.safetyPlanId,safetyProfileId:set.safetyProfileId,
    safetyProfileRevision:set.safetyProfileRevision,workerProfileId:set.workerProfileId,
    allowedPathPatterns:["src/0.ts","src/1.ts"],
    protectedPathPatterns:[".env*",".git/**"],
    status:"created",hasPendingEscalation:false,
    authority:"current_parent_task_authority",
  };
}

function parentBinding(): MultiAgentParentExecutionBindingV1 {
  return {
    schemaVersion:1,
    taskId:set.taskId,projectId:set.projectId,workspaceId:set.workspaceId,
    workspaceRegistryRevision:set.workspaceRegistryRevision,
    safetyPlanId:set.safetyPlanId,safetyPolicyVersion:"policy-v1",
    safetyProfileId:set.safetyProfileId,safetyProfileRevision:set.safetyProfileRevision,
    workerProfileId:set.workerProfileId,
    allowedPathPatterns:["src/0.ts","src/1.ts"],
    protectedPathPatterns:[".env*",".git/**"],
    trustedValidationCommands:["npm test"],
    status:"created",hasPendingEscalation:false,
    authority:"current_parent_execution_binding",
  };
}

test("M13T reuses M13D consumption and M13E durable preparation only",()=>{
  assert.equal(MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT.reusesM13DConsumption,true);
  assert.equal(MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT.reusesM13EDurablePreparation,true);
  assert.equal(MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT.blockedSiblingPreparationAllowed,false);
  assert.equal(MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT.acquiresWriterLease,false);
  assert.equal(MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT.startsWorker,false);
});

test("parallel ticketed siblings consume independently into durable M13E preparations",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13t-"));
  try{
    const children=[child(0),child(1)];
    let id=0;
    let token=0;
    let prepId=0;
    const childAdmission=new MultiAgentChildExecutionAdmissionService(
      {async revalidateCurrent(){return parentAuthority();}},
      {
        idFactory:()=>[
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        ][id++]!,
        tokenFactory:()=>`mae_${"x".repeat(40)}${token++}`,
      },
    );
    const tickets=[
      await childAdmission.issue(children[0]!,set),
      await childAdmission.issue(children[1]!,set),
    ];
    const batch: MultiAgentSiblingExecutionAdmissionBatchV1 = {
      schemaVersion:1,
      delegationSetId:set.delegationSetId,
      coordinationMode:set.coordinationMode,
      tickets,
      blockedChildTaskIds:[],
      terminalChildTaskIds:[],
      authority:"sibling_execution_admission_batch_only",
      grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
      grantsCredentialAuthority:false,grantsReleaseAuthority:false,
    };
    const service=new MultiAgentSiblingDurablePreparationBatchService(
      childAdmission,
      new MultiAgentChildExecutionPreparationService(
        {async revalidateCurrent(){return parentBinding();}},
        new FileMultiAgentChildExecutionPreparationStore(root),
        {
          idFactory:()=>[
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
          ][prepId++]!,
        },
      ),
    );
    const result=await service.prepare(set,batch,children);
    assert.equal(result.receipts.length,2);
    assert.equal(result.preparations.length,2);
    assert.deepEqual(result.preparations.map((item)=>item.childTaskId),children.map((item)=>item.childTaskId));
    assert.ok(result.preparations.every((item)=>item.state==="prepared" && item.executable===false));
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("blocked sibling cannot produce durable preparation",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13t-"));
  try{
    const children=[child(0),child(1)];
    const childAdmission=new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent(){return parentAuthority();},
    });
    const ticket=await childAdmission.issue(children[0]!,set);
    const batch: MultiAgentSiblingExecutionAdmissionBatchV1 = {
      schemaVersion:1,
      delegationSetId:set.delegationSetId,
      coordinationMode:set.coordinationMode,
      tickets:[ticket],
      blockedChildTaskIds:[children[1]!.childTaskId],
      terminalChildTaskIds:[],
      authority:"sibling_execution_admission_batch_only",
      grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
      grantsCredentialAuthority:false,grantsReleaseAuthority:false,
    };
    const service=new MultiAgentSiblingDurablePreparationBatchService(
      childAdmission,
      new MultiAgentChildExecutionPreparationService(
        {async revalidateCurrent(){return parentBinding();}},
        new FileMultiAgentChildExecutionPreparationStore(root),
      ),
    );
    await assert.rejects(
      ()=>service.prepareChild(set,batch,children,children[1]!.childTaskId),
      (error:unknown)=>error instanceof MultiAgentSiblingDurablePreparationBatchError
        && error.code==="non_ticketed_child",
    );
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("serialized batch rejects more than one ticket before consumption",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13t-"));
  try{
    const children=[child(0),child(1)].map((item)=>({...item,coordinationMode:"serialized" as const}));
    const serialized={...set,coordinationMode:"serialized" as const};
    const childAdmission=new MultiAgentChildExecutionAdmissionService({
      async revalidateCurrent(){return parentAuthority();},
    });
    const t0=await childAdmission.issue(children[0]!,serialized);
    const t1=await childAdmission.issue(children[1]!,serialized);
    const batch: MultiAgentSiblingExecutionAdmissionBatchV1 = {
      schemaVersion:1,
      delegationSetId:serialized.delegationSetId,
      coordinationMode:"serialized",
      tickets:[t0,t1],
      blockedChildTaskIds:[],
      terminalChildTaskIds:[],
      authority:"sibling_execution_admission_batch_only",
      grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
      grantsCredentialAuthority:false,grantsReleaseAuthority:false,
    };
    const service=new MultiAgentSiblingDurablePreparationBatchService(
      childAdmission,
      new MultiAgentChildExecutionPreparationService(
        {async revalidateCurrent(){return parentBinding();}},
        new FileMultiAgentChildExecutionPreparationStore(root),
      ),
    );
    await assert.rejects(
      ()=>service.prepare(serialized,batch,children),
      (error:unknown)=>error instanceof MultiAgentSiblingDurablePreparationBatchError
        && error.code==="admission_batch_invalid",
    );
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
