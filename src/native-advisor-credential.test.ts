import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { createNativeAdvisorProjectBinding } from "./native-advisor-project-binding.js";
import {
  ADVISOR_CREDENTIAL_REFERENCE, NativeAdvisorCredentialError,
  createNativeAdvisorCredentialSource,
} from "./native-advisor-credential.js";
import { startLocalOperatorControlServer } from "./local-operator-control.js";

const token="local-operator-"+"z".repeat(48);
async function freePort():Promise<number>{
  const server=createServer();
  await new Promise<void>(ready=>server.listen(0,"127.0.0.1",ready));
  const a=server.address();
  if(!a||typeof a==="string")throw new Error("port_unavailable");
  await new Promise<void>(done=>server.close(()=>done()));
  return a.port;
}
test("M19R3J readiness never reads or echoes the secret",async()=>{
  let checks=0,reads=0;
  const secret="sk-example-private-test-only-value";
  const provider=createNativeAdvisorCredentialSource(name=>{
    checks++;assert.equal(name,ADVISOR_CREDENTIAL_REFERENCE);return true;
  },name=>{
    reads++;assert.equal(name,ADVISOR_CREDENTIAL_REFERENCE);return secret;
  });
  const state=provider.readiness();
  assert.equal(checks,1);
  assert.equal(reads,0);
  assert.equal(state.state,"reference_present_unverified");
  assert.equal(state.validatedWithProvider,false);
  assert.equal(state.externalCallsEnabled,false);
  assert.equal(state.grantsAuthority,false);
  assert.doesNotMatch(JSON.stringify(state),/private-test|Bearer|sk-example/);
  assert.equal(await provider.resolve(),secret);
  assert.equal(reads,1);
  const missing=createNativeAdvisorCredentialSource(()=>false,()=>undefined);
  assert.equal(missing.readiness().state,"not_configured");
  await assert.rejects(missing.resolve(),
    (err:unknown)=>err instanceof NativeAdvisorCredentialError
      && err.code==="credential_unavailable");
  const bad=createNativeAdvisorCredentialSource(()=>true,()=>"\nsecret\n");
  await assert.rejects(bad.resolve(),
    (err:unknown)=>err instanceof NativeAdvisorCredentialError
      && err.code==="credential_unavailable");
});

test("M19R3J installed operator readiness and truthful in-flight Off status",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"orch-native-advisor-j-"));
  try {
    const registry=new WorkspaceRegistry(path.join(root,"registered","projects.json"));
    const project=(await registry.registerProject("Test Project")).projectId;
    let reads=0,configured=true;
    const provider=createNativeAdvisorCredentialSource(()=>configured,()=>{
      reads++;return "private-credential-must-not-be-read-in-ui";
    });
    const binding=createNativeAdvisorProjectBinding(registry,provider);
    const p=await freePort(),base="http://127.0.0.1:"+p;
    const server=startLocalOperatorControlServer({
      getTask:async()=>{throw new Error("no task authorization");},
      rejectEscalation:async()=>{throw new Error("no task authorization");},
    } as never,{host:"127.0.0.1",port:p,token},binding);
    const post=(cookie:string,data:Record<string,string>)=>fetch(
      base+"/operator/advisor-settings",{method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base,Cookie:cookie},
        body:new URLSearchParams(data),
      });
    try {
      assert.equal((await fetch(base+"/operator/advisor-settings?project="+project)).status,401);
      const login=await fetch(base+"/operator/login",{method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base},
        body:new URLSearchParams({token}),
      });
      assert.equal(login.status,200);
      const cookie=(login.headers.get("set-cookie")??"").split(";")[0]!;
      const load=async()=> (await (await fetch(
        base+"/operator/advisor-settings?project="+project,{headers:{Cookie:cookie}})).text());
      const page=await load();
      assert.match(page,/Credential reference found, but not verified/);
      assert.match(page,/External calls remain disabled/);
      assert.doesNotMatch(page,/private-credential-must-not-be-read|sk-example|Bearer/);
      assert.equal(reads,0);
      const csrf=page.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1]!;
      const revision=page.match(/name="revision" value="([a-f0-9]{64})"/)?.[1]!;
      assert.ok(csrf&&revision);
      const store=(await binding.resolveProject(project)).store;
      const enable={csrf,revision,project,mode:"automatic_advice",
        cents:"50",days:"7",acknowledge:"yes"};
      assert.equal((await post(cookie,enable)).status,200);
      const current=await store.inspect();
      assert.equal(current.mode,"automatic_advice");
      // Simulates the isolated consultation holding the project policy lease.
      await store.withCurrentPolicyLease(async()=>{
        const result=await post(cookie,{csrf,revision:current.revision,project,
          mode:"off",cents:"50",days:"7"});
        assert.equal(result.status,409);
        const html=await result.text();
        assert.match(html,/A consultation may be in progress/);
        assert.match(html,/Your preference has not changed/);
        assert.match(html,/cannot be recalled/);
        assert.doesNotMatch(html,/private-credential|private auth|Bearer/);
        assert.equal((await store.inspect()).mode,"automatic_advice");
      });
      const paused=await post(cookie,{csrf,revision:current.revision,project,
        mode:"off",cents:"50",days:"7"});
      assert.equal(paused.status,200);
      assert.equal((await store.inspect()).mode,"off");
      configured=false;
      const missing=await load();
      assert.match(missing,/credential has not been configured/);
      assert.equal(reads,0);
    } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
  } finally {await rm(root,{recursive:true,force:true});}
});
