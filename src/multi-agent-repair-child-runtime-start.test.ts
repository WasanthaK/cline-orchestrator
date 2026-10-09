import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT,
  MultiAgentRepairChildRuntimeStarter,
  MultiAgentRepairChildRuntimeStartError,
} from "./multi-agent-repair-child-runtime-start.js";
import type { MultiAgentRepairChildActivationContext } from "./multi-agent-repair-child-activation.js";
import type { MultiAgentParentExecutionBindingV1 } from "./multi-agent-child-execution-preparation.js";
import type { ClineRuntimeFactory } from "./cline-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const workspaceId="11111111-1111-4111-8111-111111111111";
const repairChildTaskId="22222222-2222-4222-8222-222222222222";
const priorChildTaskId="33333333-3333-4333-8333-333333333333";
const parentTaskId="44444444-4444-4444-8444-444444444444";

function activation(): MultiAgentRepairChildActivationContext {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion:1,
    workspaceId,
    stateRevision:1,
    leaseId:"55555555-5555-4555-8555-555555555555",
    fenceToken:"66666666-6666-4666-8666-666666666666",
    taskId:repairChildTaskId,
    ownerInstanceId:"77777777-7777-4777-8777-777777777777",
    expiresAt:"2026-10-06T16:10:00.000Z",
    authority:"coordination_only",
  };
  const controller=new AbortController();
  return {
    evidence:{
      schemaVersion:1,
      preparationId:"88888888-8888-4888-8888-888888888888",
      repairChildTaskId,
      priorChildTaskId,
      parentTaskId,
      workspaceId,
      leaseId:claim.leaseId,
      fenceToken:claim.fenceToken,
      ownerInstanceId:claim.ownerInstanceId,
      activatedAt:"2026-10-06T16:00:00.000Z",
      authority:"repair_child_activation_evidence_only",
      runtimeStartAuthorized:false,
      grantsTaskAuthority:false,
      grantsFilesystemAuthority:false,
      grantsSafetyPlanAuthority:false,
      grantsWriterLeaseAuthority:false,
      grantsCredentialAuthority:false,
      grantsReleaseAuthority:false,
    },
    runtimeInput:{
      schemaVersion:1,
      repairChildTaskId,
      priorChildTaskId,
      parentTaskId,
      projectId:"99999999-9999-4999-8999-999999999999",
      workspaceId,
      workspaceRegistryRevision:2,
      safetyPlanId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      safetyPolicyVersion:"policy-v1",
      safetyProfileId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      safetyProfileRevision:3,
      workerProfileId:"default",
      objective:"Implement child safely",
      repairInstruction:"Adjust src/a.ts only.",
      repairAttempt:1,
      acceptanceCriteria:["child passes"],
      trustedValidationCommands:[],
      allowedPathPatterns:["src/a.ts"],
      protectedPathPatterns:[".env*",".git/**"],
      coordinationMode:"parallel_disjoint",
      authority:"repair_child_runtime_input_only",
      runtimeStartAuthorized:false,
      priorChildResumeAllowed:false,
      grantsTaskAuthority:false,
      grantsFilesystemAuthority:false,
      grantsSafetyPlanAuthority:false,
      grantsWriterLeaseAuthority:false,
      grantsCredentialAuthority:false,
      grantsReleaseAuthority:false,
    },
    lease:{
      taskId:repairChildTaskId,
      workspaceId,
      ownerInstanceId:claim.ownerInstanceId,
      signal:controller.signal,
      currentClaim:()=>structuredClone(claim),
      validateCurrent:async()=>undefined,
    },
  };
}

const worker: WorkerConfig = {
  providerId:"openai-compatible",
  modelId:"test",
  apiKey:"test",
  baseUrl:"http://127.0.0.1:1/v1",
  contextWindow:4096,
  maxInputTokens:3000,
  maxTokensPerTurn:512,
  reasoningEffort:"none",
  timeoutMs:0,
  preflightTimeoutMs:1000,
  validationTimeoutMs:1000,
  maxValidationOutputChars:1000,
  maxValidationRepairs:0,
  checkpointMaxUntrackedFiles:10,
  checkpointMaxUntrackedBytes:100000,
  contextRotateAtTokens:0,
  maxContextRotations:0,
  maxIterations:1,
  stallTimeoutMs:1000,
  maxRetries:0,
  retryDelayMs:0,
  autoApproveCommands:false,
  autoApproveEdits:false,
};

function current(input:MultiAgentRepairChildActivationContext["runtimeInput"]): MultiAgentParentExecutionBindingV1 {
  return {
    schemaVersion:1,
    taskId:input.parentTaskId,
    projectId:input.projectId,
    workspaceId:input.workspaceId,
    workspaceRegistryRevision:input.workspaceRegistryRevision,
    safetyPlanId:input.safetyPlanId,
    safetyPolicyVersion:input.safetyPolicyVersion,
    safetyProfileId:input.safetyProfileId,
    safetyProfileRevision:input.safetyProfileRevision,
    workerProfileId:input.workerProfileId,
    allowedPathPatterns:["src/a.ts","src/b.ts"],
    protectedPathPatterns:[...input.protectedPathPatterns],
    trustedValidationCommands:[...input.trustedValidationCommands],
    status:"created",
    hasPendingEscalation:false,
    authority:"current_parent_execution_binding",
  };
}

test("M13O starts only a fresh repair-child runtime and forbids prior-child state reuse",()=>{
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.persistsFreshRepairChildTaskAtStart,true);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.resumesExistingRepairChildTask,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.reusesPriorChildTaskState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.reusesPriorChildSessionState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.reusesPriorChildCheckpointState,false);
  assert.equal(MULTI_AGENT_REPAIR_CHILD_RUNTIME_START_CONTRACT.distributedRepairExecutionEnabled,false);
});

test("fresh repair child persists zeroed task state and invokes runner once",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13o-"));
  try{
    const ctx=activation();
    let runnerCalls=0;
    let captured:OrchestratorTask|undefined;
    const starter=new MultiAgentRepairChildRuntimeStarter({
      parentBinding:{async revalidateCurrent(){return current(ctx.runtimeInput);}},
      workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:2,canonicalRoot:root};}},
      resolveWorkerProfile:()=>worker,
      baseRuntimeFactory:{} as ClineRuntimeFactory,
      providerPreflight:async()=>({
        checkedAt:new Date().toISOString(),ok:true,supported:true,providerId:worker.providerId,
        modelId:worker.modelId,code:"ok",message:"ok",
      }),
      runnerFactory:()=>({
        async start(task){
          runnerCalls+=1;
          captured=task;
          return {...task,status:"completed",finishReason:"completed"} as OrchestratorTask;
        },
        async abort(){ return undefined as any; },
        async close(){},
      }),
      now:()=>new Date("2026-10-06T16:01:00.000Z"),
    });

    const result=await starter.start(ctx);
    assert.equal(runnerCalls,1);
    assert.equal(result.status,"completed");
    const durable=captured as any;
    assert.equal(durable.id,repairChildTaskId);
    assert.notEqual(durable.id,priorChildTaskId);
    assert.equal(durable.sessionGeneration,0);
    assert.equal(durable.runCount,0);
    assert.equal(durable.recoveryCount,0);
    assert.equal(durable.retryCount,0);
    assert.equal(durable.priorChildTaskId,priorChildTaskId);
    assert.equal(durable.repairAttempt,1);
    assert.match(durable.goal,/Repair instruction: Adjust src\/a\.ts only\./);
    assert.deepEqual(durable.approvedAllowedPathPatterns,["src/a.ts"]);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("existing repair-child state blocks replay/resume",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13o-"));
  try{
    const ctx=activation();
    const {TaskStore}=await import("./state.js");
    const store=new TaskStore(root);
    await store.save({
      id:repairChildTaskId,goal:"old repair",workspace:root,status:"created",
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    });
    let calls=0;
    const starter=new MultiAgentRepairChildRuntimeStarter({
      parentBinding:{async revalidateCurrent(){return current(ctx.runtimeInput);}},
      workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:2,canonicalRoot:root};}},
      resolveWorkerProfile:()=>worker,
      baseRuntimeFactory:{} as ClineRuntimeFactory,
      providerPreflight:async()=>({
        checkedAt:new Date().toISOString(),ok:true,supported:true,providerId:worker.providerId,
        modelId:worker.modelId,code:"ok",message:"ok",
      }),
      runnerFactory:()=>({
        async start(task){calls+=1;return task;},
        async abort(){return undefined as any;},
        async close(){},
      }),
    });
    await assert.rejects(
      ()=>starter.start(ctx),
      (error:unknown)=>error instanceof MultiAgentRepairChildRuntimeStartError
        && error.code==="repair_child_state_exists",
    );
    assert.equal(calls,0);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("prior-child lease identity cannot start repair child",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13o-"));
  try{
    const ctx=activation();
    const claim=ctx.lease.currentClaim();
    ctx.lease={
      ...ctx.lease,
      taskId:priorChildTaskId,
      currentClaim:()=>({...claim,taskId:priorChildTaskId}),
    };
    const starter=new MultiAgentRepairChildRuntimeStarter({
      parentBinding:{async revalidateCurrent(){return current(ctx.runtimeInput);}},
      workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:2,canonicalRoot:root};}},
      resolveWorkerProfile:()=>worker,
      baseRuntimeFactory:{} as ClineRuntimeFactory,
      providerPreflight:async()=>({
        checkedAt:new Date().toISOString(),ok:true,supported:true,providerId:worker.providerId,
        modelId:worker.modelId,code:"ok",message:"ok",
      }),
    });
    await assert.rejects(()=>starter.start(ctx));
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
