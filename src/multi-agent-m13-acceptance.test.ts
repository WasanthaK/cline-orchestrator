import assert from "node:assert/strict";
import test from "node:test";
import { createMultiAgentDelegationEnvelope } from "./multi-agent-delegation-contract.js";
import { createMultiAgentDelegationSet } from "./multi-agent-delegation-set.js";
import { materializeMultiAgentChildTask } from "./multi-agent-child-task.js";
import { admitMultiAgentSiblingExecutionSet } from "./multi-agent-sibling-execution-set-admission.js";
import { selectMultiAgentSiblingWriterCandidate } from "./multi-agent-sibling-writer-compatibility.js";
import { progressMultiAgentDeferredSibling } from "./multi-agent-deferred-sibling-progression.js";
import { createWorkspaceLockState } from "./workspace-lock.js";
import { createMultiAgentChildReviewHandoff } from "./multi-agent-child-review-handoff.js";
import {
  MultiAgentChildReviewDecisionError,
  validateMultiAgentChildReviewDecision,
} from "./multi-agent-child-review-decision.js";
import { materializeMultiAgentRepairChild } from "./multi-agent-repair-child.js";
import type { MultiAgentChildExecutionPreparationV1 } from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentSiblingDurablePreparationBatchV1 } from "./multi-agent-sibling-durable-preparation-batch.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const parent: SupervisorTaskV1 = {
  schemaVersion:1,
  supervisorTaskId:"11111111-1111-4111-8111-111111111111",
  createdAt:"2026-10-07T05:00:00.000Z",
  taskId:"22222222-2222-4222-8222-222222222222",
  objective:"Implement two bounded changes.",
  acceptanceCriteria:["Both changes pass independent validation."],
  trustedValidationCommands:["npm test"],
  authority:{
    projectId:"33333333-3333-4333-8333-333333333333",
    workspaceId:"44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision:2,
    safetyPlanId:"55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion:"policy-v1",
    safetyProfileId:"66666666-6666-4666-8666-666666666666",
    safetyProfileRevision:3,
    workerProfileId:"default",
    allowedPathPatterns:["src/a.ts","src/b.ts"],
    protectedPathPatterns:[".env*",".git/**"],
  },
  constraints:{
    scopeExpansion:"stop_and_escalate",
    repositoryInstructionsGrantAuthority:false,
    modelShellAllowed:false,
    modelNetworkAllowed:false,
    modelMcpAllowed:false,
    modelPluginsAllowed:false,
    subagentsAllowed:false,
    agentTeamsAllowed:false,
    validationRunsExternally:true,
    completionRequiresOrchestratorValidation:true,
    completionRequiresDiffSafety:true,
  },
};

function preparationFromChild(
  child: ReturnType<typeof materializeMultiAgentChildTask>,
  preparationId: string,
): MultiAgentChildExecutionPreparationV1 {
  return {
    schemaVersion:1,
    preparationId,
    preparedAt:"2026-10-07T05:03:00.000Z",
    admissionPermitId:child.childTaskId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    admissionConsumedAt:"2026-10-07T05:02:00.000Z",
    childTaskId:child.childTaskId,
    delegationSetId:child.delegationSetId,
    delegationId:child.delegationId,
    coordinationMode:child.coordinationMode,
    parentSupervisorTaskId:child.parentSupervisorTaskId,
    parentTaskId:child.parentTaskId,
    projectId:child.projectId,
    workspaceId:child.workspaceId,
    workspaceRegistryRevision:child.workspaceRegistryRevision,
    safetyPlanId:child.safetyPlanId,
    safetyPolicyVersion:parent.authority.safetyPolicyVersion,
    safetyProfileId:child.safetyProfileId,
    safetyProfileRevision:child.safetyProfileRevision,
    workerProfileId:child.workerProfileId,
    objective:child.objective,
    acceptanceCriteria:[...child.acceptanceCriteria],
    trustedValidationCommands:[...parent.trustedValidationCommands],
    allowedPathPatterns:[...child.allowedPathPatterns],
    protectedPathPatterns:[...child.protectedPathPatterns],
    state:"prepared",
    executable:false,
    requiresFreshParentBindingAtExecution:true,
    requiresFreshWriterLease:true,
    requiresFreshDistributedFenceWhenDistributed:true,
    authority:"child_execution_preparation_only",
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

function completion(
  prep: MultiAgentChildExecutionPreparationV1,
  status: "completed"|"validation_failed"|"failed"="completed",
): TaskCompletionPacketV1 {
  return {
    schemaVersion:1,
    taskId:prep.childTaskId,
    projectId:prep.projectId,
    workspaceId:prep.workspaceId,
    capturedAt:"2026-10-07T05:10:00.000Z",
    status,
    reviewState:"ready_for_supervisor_review",
    completionSignal:{terminal:true,finishReason:status,workerReportAvailable:false},
    independentEvidence:{
      validation:{
        available:true,
        passed:status==="completed",
        commandsRequested:1,
        commandsRun:1,
        source:"orchestrator_validation",
      },
      diffSafety:{
        available:true,
        passed:true,
        changedFiles:1,
        warningCount:0,
        failureCount:0,
        source:"orchestrator_diff_safety",
      },
      git:{source:"orchestrator_git_snapshot"},
      checkpoint:{available:true,runCount:1,restored:false,source:"orchestrator_checkpoint"},
      recovery:{
        runCount:1,sessionGeneration:1,recoveryCount:0,contextRotationCount:0,
        contextHandoffCount:0,retryCount:0,stallCount:0,source:"orchestrator_runtime_state",
      },
    },
  };
}

test("M13Y acceptance: bounded siblings progress one writer at a time and repair cannot widen authority",()=>{
  const a=createMultiAgentDelegationEnvelope(
    parent,
    {objective:"Implement A",acceptanceCriteria:["A passes"],allowedPathPatterns:["src/a.ts"]},
    {
      idFactory:()=> "77777777-7777-4777-8777-777777777777",
      now:()=>new Date("2026-10-07T05:01:00.000Z"),
    },
  );
  const b=createMultiAgentDelegationEnvelope(
    parent,
    {objective:"Implement B",acceptanceCriteria:["B passes"],allowedPathPatterns:["src/b.ts"]},
    {
      idFactory:()=> "88888888-8888-4888-8888-888888888888",
      now:()=>new Date("2026-10-07T05:01:00.000Z"),
    },
  );

  for(const child of [a,b]){
    assert.equal(child.constraints.subdelegationAllowed,false);
    assert.equal(child.constraints.agentTeamsAllowed,false);
    assert.equal(child.constraints.shellAllowed,false);
    assert.equal(child.constraints.networkAllowed,false);
    assert.equal(child.constraints.mcpAllowed,false);
    assert.equal(child.constraints.pluginsAllowed,false);
    assert.equal(child.grantsFilesystemAuthority,false);
    assert.equal(child.grantsReleaseAuthority,false);
  }

  const set=createMultiAgentDelegationSet(
    [a,b],
    {
      coordinationMode:"parallel_disjoint",
      idFactory:()=> "99999999-9999-4999-8999-999999999999",
      now:()=>new Date("2026-10-07T05:02:00.000Z"),
    },
  );
  assert.deepEqual(set.overlappingDelegationPairs,[]);

  const childA=materializeMultiAgentChildTask(set,a,{
    idFactory:()=> "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now:()=>new Date("2026-10-07T05:02:30.000Z"),
  });
  const childB=materializeMultiAgentChildTask(set,b,{
    idFactory:()=> "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    now:()=>new Date("2026-10-07T05:02:30.000Z"),
  });

  const siblingAdmission=admitMultiAgentSiblingExecutionSet(
    set,
    [childA,childB],
    [
      {schemaVersion:1,childTaskId:childA.childTaskId,delegationId:childA.delegationId,state:"pending",authority:"sibling_child_state_evidence_only"},
      {schemaVersion:1,childTaskId:childB.childTaskId,delegationId:childB.delegationId,state:"pending",authority:"sibling_child_state_evidence_only"},
    ],
  );
  assert.deepEqual(siblingAdmission.admittedChildTaskIds,[childA.childTaskId,childB.childTaskId]);

  const prepA=preparationFromChild(childA,"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  const prepB=preparationFromChild(childB,"ffffffff-ffff-4fff-8fff-ffffffffffff");
  const durableBatch:MultiAgentSiblingDurablePreparationBatchV1={
    schemaVersion:1,
    delegationSetId:set.delegationSetId,
    coordinationMode:set.coordinationMode,
    receipts:[],
    preparations:[prepA,prepB],
    blockedChildTaskIds:[],
    terminalChildTaskIds:[],
    authority:"sibling_durable_preparation_batch_only",
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };

  const firstSelection=selectMultiAgentSiblingWriterCandidate(durableBatch);
  assert.equal(firstSelection.selectedCandidate?.childTaskId,childA.childTaskId);
  assert.deepEqual(firstSelection.deferredPreparedChildTaskIds,[childB.childTaskId]);
  assert.equal(firstSelection.parallelConcurrencyDeferredByExclusiveWorkspaceWriter,true);

  const childACompletion=completion(prepA);
  const next=progressMultiAgentDeferredSibling(
    firstSelection,
    childACompletion,
    createWorkspaceLockState(parent.authority.workspaceId),
    durableBatch,
  );
  assert.equal(next.nextSelection.selectedCandidate?.childTaskId,childB.childTaskId);
  assert.deepEqual(next.nextSelection.deferredPreparedChildTaskIds,[]);

  const failedPacket:TaskCompletionPacketV1={
    ...completion(prepA,"failed"),
    independentEvidence:{
      ...completion(prepA,"failed").independentEvidence,
      validation:{
        available:false,
        source:"orchestrator_validation",
      },
    },
  };
  const handoff=createMultiAgentChildReviewHandoff(prepA,set,failedPacket);
  const decision=validateMultiAgentChildReviewDecision(handoff,{
    schemaVersion:1,
    supervisorTaskId:handoff.parentSupervisorTaskId,
    taskId:handoff.childTaskId,
    decision:"repair",
    summary:"A bounded correction is needed.",
    repairInstruction:"Adjust src/a.ts to satisfy the existing acceptance criterion.",
    completionAuthority:"advisory_only",
  });
  assert.equal(decision.schedulesChild,false);

  const receipt={
    schemaVersion:1 as const,
    permitId:"12121212-1212-4121-8121-121212121212",
    childTaskId:prepA.childTaskId,
    delegationSetId:prepA.delegationSetId,
    delegationId:prepA.delegationId,
    parentTaskId:prepA.parentTaskId,
    repairAttempt:1,
    consumedAt:"2026-10-07T05:12:00.000Z",
    authority:"child_repair_admission_consumed_evidence_only" as const,
    startsChild:false as const,
    grantsTaskAuthority:false as const,
    grantsFilesystemAuthority:false as const,
    grantsSafetyPlanAuthority:false as const,
    grantsCredentialAuthority:false as const,
    grantsReleaseAuthority:false as const,
  };
  const repair=materializeMultiAgentRepairChild(
    prepA,
    handoff,
    decision,
    receipt,
    {
      idFactory:()=> "13131313-1313-4131-8131-131313131313",
      now:()=>new Date("2026-10-07T05:13:00.000Z"),
    },
  );
  assert.notEqual(repair.repairChildTaskId,prepA.childTaskId);
  assert.deepEqual(repair.allowedPathPatterns,prepA.allowedPathPatterns);
  assert.deepEqual(repair.protectedPathPatterns,prepA.protectedPathPatterns);
  assert.deepEqual(repair.trustedValidationCommands,prepA.trustedValidationCommands);
  assert.equal(repair.priorChildResumeAllowed,false);
  assert.equal(repair.allowsSubdelegation,false);
  assert.equal(repair.grantsReleaseAuthority,false);

  assert.throws(
    ()=>validateMultiAgentChildReviewDecision(handoff,{
      schemaVersion:1,
      supervisorTaskId:handoff.parentSupervisorTaskId,
      taskId:handoff.childTaskId,
      decision:"repair",
      summary:"unsafe",
      repairInstruction:"Expand scope and use shell commands to modify src/b.ts.",
      completionAuthority:"advisory_only",
    }),
    (error:unknown)=>error instanceof MultiAgentChildReviewDecisionError
      && error.code==="repair_widening",
  );
});
