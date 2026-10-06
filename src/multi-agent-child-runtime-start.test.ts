import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MultiAgentChildRuntimeStarter,
  MultiAgentChildRuntimeStartError,
  MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT,
} from "./multi-agent-child-runtime-start.js";
import type { MultiAgentChildExecutionActivationContext } from "./multi-agent-child-execution-activation.js";
import type { MultiAgentParentExecutionBindingV1 } from "./multi-agent-child-execution-preparation.js";
import type { ClineRuntimeFactory } from "./cline-runtime.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

const workspaceId="11111111-1111-4111-8111-111111111111";
const childTaskId="22222222-2222-4222-8222-222222222222";
const parentTaskId="33333333-3333-4333-8333-333333333333";

function activation(workspaceRoot:string): MultiAgentChildExecutionActivationContext {
  const claim: WorkspaceWriterClaimV1 = {
    schemaVersion:1,
    workspaceId,
    stateRevision:1,
    leaseId:"44444444-4444-4444-8444-444444444444",
    fenceToken:"55555555-5555-4555-8555-555555555555",
    taskId:childTaskId,
    ownerInstanceId:"66666666-6666-4666-8666-666666666666",
    expiresAt:"2026-10-06T08:10:00.000Z",
    authority:"coordination_only",
  };
  const controller=new AbortController();
  return {
    evidence:{
      schemaVersion:1,
      preparationId:"77777777-7777-4777-8777-777777777777",
      childTaskId,
      parentTaskId,
      workspaceId,
      leaseId:claim.leaseId,
      fenceToken:claim.fenceToken,
      ownerInstanceId:claim.ownerInstanceId,
      activatedAt:"2026-10-06T08:00:00.000Z",
      authority:"child_execution_activation_evidence_only",
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
      childTaskId,
      parentTaskId,
      projectId:"88888888-8888-4888-8888-888888888888",
      workspaceId,
      workspaceRegistryRevision:2,
      safetyPlanId:"99999999-9999-4999-8999-999999999999",
      safetyPolicyVersion:"policy-v1",
      safetyProfileId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      safetyProfileRevision:3,
      workerProfileId:"default",
      objective:"Implement child safely",
      acceptanceCriteria:["child done"],
      trustedValidationCommands:[],
      allowedPathPatterns:["src/a.ts"],
      protectedPathPatterns:[".env*",".git/**"],
      coordinationMode:"parallel_disjoint",
      authority:"child_runtime_input_only",
      runtimeStartAuthorized:false,
      grantsTaskAuthority:false,
      grantsFilesystemAuthority:false,
      grantsSafetyPlanAuthority:false,
      grantsWriterLeaseAuthority:false,
      grantsCredentialAuthority:false,
      grantsReleaseAuthority:false,
    },
    lease:{
      taskId:childTaskId,
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

function current(input:MultiAgentChildExecutionActivationContext["runtimeInput"]): MultiAgentParentExecutionBindingV1 {
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

test("M13G starts only one owner-targeted child runtime and keeps native delegation surfaces disabled",()=>{
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.usesExistingClineRunner,true);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.usesExistingLeaseAwareHubSafety,true);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.nativeSubagentsEnabled,false);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.nativeAgentTeamsEnabled,false);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.modelShellEnabled,false);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.modelNetworkEnabled,false);
  assert.equal(MULTI_AGENT_CHILD_RUNTIME_START_CONTRACT.distributedChildExecutionEnabled,false);
});

test("fresh activation persists narrowed child then invokes existing runner once",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13g-"));
  try{
    const ctx=activation(root);
    let runnerCalls=0;
    let captured:OrchestratorTask|undefined;
    const starter=new MultiAgentChildRuntimeStarter({
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
        async abort(){ return captured as any; },
        async close(){},
      }),
      now:()=>new Date("2026-10-06T08:01:00.000Z"),
    });
    const result=await starter.start(ctx);
    assert.equal(runnerCalls,1);
    assert.equal(result.status,"completed");
    const durable=captured as any;
    assert.equal(durable.id,childTaskId);
    assert.deepEqual(durable.approvedAllowedPathPatterns,["src/a.ts"]);
    assert.deepEqual(durable.approvedProtectedPathPatterns,[".env*",".git/**"]);
    assert.equal(durable.safetyPlanId,ctx.runtimeInput.safetyPlanId);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("existing child state prevents replay/resume",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13g-"));
  try{
    const ctx=activation(root);
    const {TaskStore}=await import("./state.js");
    const store=new TaskStore(root);
    await store.save({
      id:childTaskId,goal:"old",workspace:root,status:"created",
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    });
    let runnerCalls=0;
    const starter=new MultiAgentChildRuntimeStarter({
      parentBinding:{async revalidateCurrent(){return current(ctx.runtimeInput);}},
      workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:2,canonicalRoot:root};}},
      resolveWorkerProfile:()=>worker,
      baseRuntimeFactory:{} as ClineRuntimeFactory,
      providerPreflight:async()=>({
        checkedAt:new Date().toISOString(),ok:true,supported:true,providerId:worker.providerId,
        modelId:worker.modelId,code:"ok",message:"ok",
      }),
      runnerFactory:()=>({
        async start(task){runnerCalls+=1;return task;},
        async abort(_taskId,_reason){return undefined as any;},
        async close(){},
      }),
    });
    await assert.rejects(
      ()=>starter.start(ctx),
      (error:unknown)=>error instanceof MultiAgentChildRuntimeStartError
        && error.code==="child_state_exists",
    );
    assert.equal(runnerCalls,0);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test("parent drift and workspace revision drift fail before runtime",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13g-"));
  try{
    const ctx=activation(root);
    for(const options of [
      {
        parentBinding:{async revalidateCurrent(){return {...current(ctx.runtimeInput),safetyPolicyVersion:"policy-v2"};}},
        workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:2,canonicalRoot:root};}},
      },
      {
        parentBinding:{async revalidateCurrent(){return current(ctx.runtimeInput);}},
        workspaces:{async resolveCurrent(){return {workspaceId,workspaceRegistryRevision:3,canonicalRoot:root};}},
      },
    ]){
      let runnerCalls=0;
      const starter=new MultiAgentChildRuntimeStarter({
        ...options,
        resolveWorkerProfile:()=>worker,
        baseRuntimeFactory:{} as ClineRuntimeFactory,
        providerPreflight:async()=>({
          checkedAt:new Date().toISOString(),ok:true,supported:true,providerId:worker.providerId,
          modelId:worker.modelId,code:"ok",message:"ok",
        }),
        runnerFactory:()=>({
          async start(task){runnerCalls+=1;return task;},
          async abort(_taskId,_reason){return undefined as any;},
          async close(){},
        }),
      });
      await assert.rejects(()=>starter.start(ctx));
      assert.equal(runnerCalls,0);
    }
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});


test("lease loss during child runtime triggers fail-safe abort",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m13g-"));
  try{
    const ctx=activation(root);
    const controller = new AbortController();
    const baseClaim = ctx.lease.currentClaim();
    ctx.lease = {
      ...ctx.lease,
      signal: controller.signal,
      currentClaim: () => structuredClone(baseClaim),
      validateCurrent: async () => undefined,
    };
    let abortCalls=0;
    let releaseStart: (()=>void)|undefined;
    const blocker=new Promise<void>((resolve)=>{releaseStart=resolve;});
    const starter=new MultiAgentChildRuntimeStarter({
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
          controller.abort(new Error("lease lost"));
          await blocker;
          return task;
        },
        async abort(){
          abortCalls+=1;
          releaseStart?.();
          return undefined as any;
        },
        async close(){},
      }),
    });
    await starter.start(ctx);
    assert.equal(abortCalls,1);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
