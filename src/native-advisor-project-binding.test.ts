import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalOperatorControlServer } from "./local-operator-control.js";
import {
  createNativeAdvisorProjectBinding, NATIVE_ADVISOR_BINDING_CONTRACT,
} from "./native-advisor-project-binding.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const password = "local-operator-control-" + "x".repeat(48);
async function testPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const a=server.address();
  if (!a || typeof a==="string") throw Error("missing port");
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  return a.port;
}
async function fixture(run:(context:{
  registry: WorkspaceRegistry;
  bind: ReturnType<typeof createNativeAdvisorProjectBinding>;
  ids: string[];
  names: string[];
})=>Promise<void>) {
  const root=await mkdtemp(path.join(os.tmpdir(),"orch-advisor-host-"));
  const registry = new WorkspaceRegistry(path.join(root,"user-state","workspace-registry.json"));
  try {
    const first=await registry.registerProject("First Project");
    const second=await registry.registerProject("Second Project");
    await run({
      registry,bind:createNativeAdvisorProjectBinding(registry),
      ids:[first.projectId,second.projectId],
      names:[first.displayName,second.displayName],
    });
  } finally { await rm(root,{recursive:true,force:true}); }
}

test("M19R3G native project binding is registry-backed and isolated",async()=>{
  await fixture(async({bind,ids})=>{
    assert.equal(NATIVE_ADVISOR_BINDING_CONTRACT.externalCallsEnabled,false);
    assert.equal(NATIVE_ADVISOR_BINDING_CONTRACT.grantsAuthority,false);
    const projects=await bind.listProjects();
    assert.deepEqual(projects.map(x=>x.projectId),ids);
    await assert.rejects(bind.resolveProject(crypto.randomUUID()),/advisor_project_unavailable/);
    await assert.rejects(bind.resolveProject("../../private"),/advisor_project_unavailable/);
    const first=await bind.resolveProject(ids[0]!);
    const second=await bind.resolveProject(ids[1]!);
    assert.equal((await first.store.inspect()).mode,"off");
    assert.equal((await second.store.inspect()).mode,"off");
    const previous=await first.store.inspect();
    const saved=await first.store.save({
      expectedRevision:previous.revision,mode:"automatic_advice",
      maxEstimatedCentsPerIncident:50,durationDays:7,
      acknowledgedExternalMetadata:true,
    });
    assert.equal(saved.mode,"automatic_advice");
    assert.equal((await second.store.inspect()).mode,"off");
    assert.equal((await (await bind.resolveProject(ids[0]!)).store.inspect()).revision,
      saved.revision);
  });
});

test("M19R3G installed local operator selects project without path inputs",async()=>{
  await fixture(async({bind,ids})=>{
    const port=await testPort(), base="http://127.0.0.1:"+port;
    const fakeMachine={
      getTask:async()=>{throw Error("no tasks needed");},
      rejectEscalation:async()=>{throw Error("cannot execute task action");},
    };
    const server=startLocalOperatorControlServer(fakeMachine as never,
      {host:"127.0.0.1",port,token:password},bind);
    const post=(body:Record<string,string>,cookie?:string,origin=base)=>
      fetch(base+"/operator/advisor-settings",{
        method:"POST",headers:{
          "Content-Type":"application/x-www-form-urlencoded",Origin:origin,
          ...(cookie?{Cookie:cookie}:{})},
        body:new URLSearchParams(body),
      });
    try {
      assert.equal((await fetch(base+"/operator/advisor-settings")).status,401);
      const login=await fetch(base+"/operator/login",{method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:base},
        body:new URLSearchParams({token:password}),
      });
      assert.equal(login.status,200);
      const cookie=(login.headers.get("set-cookie")??"").split(";")[0]!;
      const listing=await (await fetch(base+"/operator/advisor-settings",
        {headers:{Cookie:cookie}})).text();
      assert.match(listing,/Choose the project/);
      assert.match(listing,/First Project/);
      assert.match(listing,/Second Project/);
      assert.doesNotMatch(listing,/workspace-registry\.json|user-state/);
      const settings=await fetch(base+"/operator/advisor-settings?project="+ids[0],
        {headers:{Cookie:cookie}});
      assert.equal(settings.status,200);
      const html=await settings.text();
      const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1]!;
      const revision=html.match(/name="revision" value="([a-f0-9]{64})"/)?.[1]!;
      assert.ok(csrf&&revision);
      assert.match(html,/Change project/);
      assert.match(html,new RegExp('name="project" value="'+ids[0]+'"'));
      const data={csrf,revision,project:ids[0]!,mode:"automatic_advice",
        cents:"50",days:"7",acknowledge:"yes"};
      assert.equal((await post(data,cookie,"http://evil.invalid")).status,403);
      assert.equal((await post({...data,project:"../../private"},cookie)).status,404);
      assert.equal((await post({...data,project:ids[1]!},cookie)).status,200);
      // The submitted revision 0 is valid for the second project and remains
      // a legitimate new selection; it may not mutate the first project.
      assert.equal((await (await bind.resolveProject(ids[0]!)).store.inspect()).mode,"off");
      assert.equal((await (await bind.resolveProject(ids[1]!)).store.inspect()).mode,"automatic_advice");
      const first=await post(data,cookie);
      assert.equal(first.status,200);
      assert.equal((await (await bind.resolveProject(ids[0]!)).store.inspect()).mode,"automatic_advice");
      assert.equal((await post(data,cookie)).status,409);
      assert.equal((await fetch(base+"/operator/advisor-settings?project="+crypto.randomUUID(),
        {headers:{Cookie:cookie}})).status,404);
      assert.equal((await fetch(base+"/operator/advisor-settings?junk=1",
        {headers:{Cookie:cookie}})).status,400);
    } finally {
      await new Promise<void>(resolve=>server.close(()=>resolve()));
    }
  });
});
