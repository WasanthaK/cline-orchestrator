import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FileMultiAgentRepairChildPreparationStore,
  MultiAgentRepairChildPreparationError,
  MultiAgentRepairChildPreparationService,
  MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT,
} from "./multi-agent-repair-child-preparation.js";
import type { MultiAgentParentExecutionBindingV1 } from "./multi-agent-child-execution-preparation.js";
import type {
  MultiAgentPriorChildStateV1,
  MultiAgentRepairChildExecutionAdmissionReceiptV1,
} from "./multi-agent-repair-child-execution-admission.js";
import type { MultiAgentRepairChildDescriptorV1 } from "./multi-agent-repair-child.js";

const child: MultiAgentRepairChildDescriptorV1 = {
  schemaVersion:1,
  repairChildTaskId:"11111111-1111-4111-8111-111111111111",
  priorChildTaskId:"22222222-2222-4222-8222-222222222222",
  materializedAt:"2026-10-06T14:00:00.000Z",
  repairAttempt:1,
  repairAdmissionPermitId:"33333333-3333-4333-8333-333333333333",
  repairAdmissionConsumedAt:"2026-10-06T13:59:00.000Z",
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
  objective:"Implement child",
  repairInstruction:"Adjust src/a.ts only.",
  acceptanceCriteria:["child passes"],
  trustedValidationCommands:["npm test"],
  allowedPathPatterns:["src/a.ts"],
  protectedPathPatterns:[".env*",".git/**"],
  authority:"repair_child_materialization_only",
  executable:false,
  requiresFreshExecutionAdmission:true,
  requiresFreshParentBindingRevalidation:true,
  requiresFreshWriterLease:true,
  priorChildResumeAllowed:false,
  priorChildMutationAllowed:false,
  allowsSubdelegation:false,
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const receipt: MultiAgentRepairChildExecutionAdmissionReceiptV1 = {
  schemaVersion:1,
  permitId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  repairChildTaskId:child.repairChildTaskId,
  priorChildTaskId:child.priorChildTaskId,
  delegationSetId:child.delegationSetId,
  delegationId:child.delegationId,
  parentTaskId:child.parentTaskId,
  workspaceId:child.workspaceId,
  repairAttempt:child.repairAttempt,
  consumedAt:"2026-10-06T14:01:00.000Z",
  authority:"repair_child_execution_admission_consumed_evidence_only",
  startsChild:false,
  grantsTaskAuthority:false,grantsFilesystemAuthority:false,grantsSafetyPlanAuthority:false,
  grantsWriterLeaseAuthority:false,grantsCredentialAuthority:false,grantsReleaseAuthority:false,
};

const current: MultiAgentParentExecutionBindingV1 = {
  schemaVersion:1,
  taskId:child.parentTaskId,
  projectId:child.projectId,
  workspaceId:child.workspaceId,
  workspaceRegistryRevision:child.workspaceRegistryRevision,
  safetyPlanId:child.safetyPlanId,
  safetyPolicyVersion:child.safetyPolicyVersion,
  safetyProfileId:child.safetyProfileId,
  safetyProfileRevision:child.safetyProfileRevision,
  workerProfileId:child.workerProfileId,
  allowedPathPatterns:["src/a.ts","src/b.ts"],
  protectedPathPatterns:[...child.protectedPathPatterns],
  trustedValidationCommands:[...child.trustedValidationCommands],
  status:"created",
  hasPendingEscalation:false,
  authority:"current_parent_execution_binding",
};

const prior: MultiAgentPriorChildStateV1 = {
  schemaVersion:1,
  childTaskId:child.priorChildTaskId,
  projectId:child.projectId,
  workspaceId:child.workspaceId,
  status:"completed",
  authority:"prior_child_state_evidence_only",
};

test("M13M is durable but carries no prior runtime/checkpoint/session state",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.durable,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.executableTask,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.carriesPriorRuntimeState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.carriesPriorCheckpointState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.carriesPriorSessionState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT.startsCline,false);
});

test("consumed M13L receipt plus fresh binding persists one repair-child preparation",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13m-"));
  try{
    const store=new FileMultiAgentRepairChildPreparationStore(root);
    const service=new MultiAgentRepairChildPreparationService(
      {async revalidateCurrent(){return structuredClone(current);}},
      {async loadCurrent(){return structuredClone(prior);}},
      store,
      {
        now:()=>new Date("2026-10-06T14:02:00.000Z"),
        idFactory:()=> "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    );
    const prepared=await service.prepare(child,receipt);
    assert.equal(prepared.preparationId,"dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    assert.equal(prepared.repairChildTaskId,child.repairChildTaskId);
    assert.equal(prepared.priorChildTaskId,child.priorChildTaskId);
    assert.equal(prepared.repairInstruction,child.repairInstruction);
    assert.deepEqual(prepared.allowedPathPatterns,child.allowedPathPatterns);
    assert.equal(prepared.executable,false);

    const durable=await store.load(child.repairChildTaskId);
    assert.deepEqual(durable,prepared);

    await assert.rejects(
      ()=>service.prepare(child,receipt),
      (error:unknown)=>error instanceof MultiAgentRepairChildPreparationError
        && error.code==="preparation_replayed",
    );
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("cross-bound consumed receipt fails before authority lookups",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13m-"));
  let parentCalls=0;
  let priorCalls=0;
  try{
    const service=new MultiAgentRepairChildPreparationService(
      {async revalidateCurrent(){parentCalls+=1;return structuredClone(current);}},
      {async loadCurrent(){priorCalls+=1;return structuredClone(prior);}},
      new FileMultiAgentRepairChildPreparationStore(root),
    );
    await assert.rejects(
      ()=>service.prepare(child,{...receipt,repairChildTaskId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
      (error:unknown)=>error instanceof MultiAgentRepairChildPreparationError
        && error.code==="binding_mismatch",
    );
    assert.equal(parentCalls,0);
    assert.equal(priorCalls,0);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("parent drift or non-terminal prior child fails closed",async()=>{
  for(const variation of [
    {parent:{...current,safetyPolicyVersion:"policy-v2"},prior},
    {parent:current,prior:{...prior,status:"running" as const}},
  ]){
    const root=await mkdtemp(path.join(os.tmpdir(),"m13m-"));
    try{
      const service=new MultiAgentRepairChildPreparationService(
        {async revalidateCurrent(){return variation.parent as MultiAgentParentExecutionBindingV1;}},
        {async loadCurrent(){return variation.prior as MultiAgentPriorChildStateV1;}},
        new FileMultiAgentRepairChildPreparationStore(root),
      );
      await assert.rejects(()=>service.prepare(child,receipt));
    }finally{
      await rm(root,{recursive:true,force:true});
    }
  }
});
