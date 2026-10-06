import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT,
  MultiAgentRepairChildExecutionAdmissionError,
  MultiAgentRepairChildExecutionAdmissionService,
  type MultiAgentParentExecutionBindingV1,
  type MultiAgentPriorChildStateV1,
} from "./multi-agent-repair-child-execution-admission.js";
import type { MultiAgentRepairChildDescriptorV1 } from "./multi-agent-repair-child.js";

const child: MultiAgentRepairChildDescriptorV1 = {
  schemaVersion:1,
  repairChildTaskId:"11111111-1111-4111-8111-111111111111",
  priorChildTaskId:"22222222-2222-4222-8222-222222222222",
  materializedAt:"2026-10-06T13:00:00.000Z",
  repairAttempt:1,
  repairAdmissionPermitId:"33333333-3333-4333-8333-333333333333",
  repairAdmissionConsumedAt:"2026-10-06T12:59:00.000Z",
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

test("M13L is short-lived/single-use and remains non-executing",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.shortLived,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.singleUse,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.requiresPriorChildStillTerminal,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.priorChildResumeAllowed,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.startsChild,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_EXECUTION_ADMISSION_CONTRACT.distributedExecutionAllowed,false);
});

test("current parent plus terminal prior child issues and consumes exact permit once",async()=>{
  let now=new Date("2026-10-06T13:01:00.000Z");
  const service=new MultiAgentRepairChildExecutionAdmissionService(
    {async revalidateCurrent(){return structuredClone(current);}},
    {async loadCurrent(){return structuredClone(prior);}},
    {
      now:()=>new Date(now),
      ttlMs:60_000,
      idFactory:()=> "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tokenFactory:()=> "marl_abcdefghijklmnopqrstuvwxyz1234567890",
    },
  );
  const ticket=await service.issue(child);
  assert.equal(ticket.permit.repairChildTaskId,child.repairChildTaskId);
  assert.equal(ticket.permit.priorChildTaskId,child.priorChildTaskId);
  assert.equal(ticket.permit.startsChild,false);

  now=new Date("2026-10-06T13:01:30.000Z");
  const receipt=await service.consume(ticket.token,child);
  assert.equal(receipt.repairChildTaskId,child.repairChildTaskId);
  assert.equal(receipt.authority,"repair_child_execution_admission_consumed_evidence_only");

  await assert.rejects(
    ()=>service.consume(ticket.token,child),
    (error:unknown)=>error instanceof MultiAgentRepairChildExecutionAdmissionError
      && error.code==="permit_replayed",
  );
});

test("non-terminal or cross-bound prior child blocks admission",async()=>{
  for(const evidence of [
    {...prior,status:"running" as const},
    {...prior,childTaskId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    {...prior,workspaceId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
  ]){
    const service=new MultiAgentRepairChildExecutionAdmissionService(
      {async revalidateCurrent(){return structuredClone(current);}},
      {async loadCurrent(){return evidence;}},
    );
    await assert.rejects(
      ()=>service.issue(child),
      (error:unknown)=>error instanceof MultiAgentRepairChildExecutionAdmissionError
        && error.code==="prior_child_not_terminal",
    );
  }
});

test("parent policy/scope drift blocks admission before permit creation",async()=>{
  for(const drift of [
    {...current,safetyPolicyVersion:"policy-v2"},
    {...current,allowedPathPatterns:["src/b.ts"]},
    {...current,trustedValidationCommands:["npm run other"]},
    {...current,hasPendingEscalation:true},
  ]){
    const service=new MultiAgentRepairChildExecutionAdmissionService(
      {async revalidateCurrent(){return drift as MultiAgentParentExecutionBindingV1;}},
      {async loadCurrent(){return structuredClone(prior);}},
    );
    await assert.rejects(()=>service.issue(child));
  }
});

test("expired permit fails closed",async()=>{
  let now=new Date("2026-10-06T13:02:00.000Z");
  const service=new MultiAgentRepairChildExecutionAdmissionService(
    {async revalidateCurrent(){return structuredClone(current);}},
    {async loadCurrent(){return structuredClone(prior);}},
    {
      now:()=>new Date(now),
      ttlMs:5_000,
      tokenFactory:()=> "marl_abcdefghijklmnopqrstuvwxyz0987654321",
    },
  );
  const ticket=await service.issue(child);
  now=new Date("2026-10-06T13:02:05.000Z");
  await assert.rejects(
    ()=>service.consume(ticket.token,child),
    (error:unknown)=>error instanceof MultiAgentRepairChildExecutionAdmissionError
      && error.code==="permit_expired",
  );
});
