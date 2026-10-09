import assert from "node:assert/strict";
import test from "node:test";
import { planPlatformServiceAction } from "./platform-service-command-plan.js";
import { LocalServiceLifecycleService, LocalServiceLifecycleError, type LocalServiceLifecycleDriver, type LocalServiceSpecV1 } from "./local-service-lifecycle.js";

const linux: LocalServiceSpecV1 = {
 schemaVersion:1,manager:"systemd",serviceName:"cline-orchestrator",displayName:"Cline Orchestrator",
 executable:"/usr/bin/node",args:["/opt/cline/dist/index.js","daemon"],
 workingDirectory:"/opt/cline",configPath:"/opt/cline/config.json",secretReferenceNames:[],
 daemonHost:"127.0.0.1",daemonPort:4317,autoStart:false,authority:"local_service_specification_only",grantsAuthority:false,
};
const windows: LocalServiceSpecV1={...linux,manager:"windows-service",executable:"C:\\Service\\host.exe",args:[],workingDirectory:"C:\\Service",configPath:"C:\\Service\\config.json"};

for(const spec of [linux,windows]) {
 test(`M18D3 ${spec.manager}: composed install/start/status/stop/uninstall plans remain non-executing`,()=>{
  const expected=spec.manager==="systemd"?"systemctl":"sc.exe";
  for(const action of ["install","start","status","stop","uninstall"] as const) {
   const p=planPlatformServiceAction(spec,action);
   assert.equal(p.executable,expected);
   assert.equal(p.executesCommands,false);
   assert.equal(p.mutatesServiceManager,false);
   assert.equal(p.requiresExplicitLocalConfirmation,true);
   assert.equal(p.grantsAuthority,false);
   assert.equal(p.serviceName,spec.serviceName);
  }
 });
 test(`M18D3 ${spec.manager}: lifecycle driver observes exactly each requested action`,async()=>{
  const calls:string[]=[];
  const driver:LocalServiceLifecycleDriver={
   async install(){calls.push("install");},
   async start(){calls.push("start");},
   async stop(){calls.push("stop");},
   async status(){calls.push("status");return {schemaVersion:1,serviceName:spec.serviceName,manager:spec.manager,installed:true,running:false,authority:"local_service_status_observation",grantsAuthority:false};},
  };
  const svc=new LocalServiceLifecycleService(driver,{now:()=>new Date("2026-10-09T00:00:00.000Z")});
  for(const action of ["install","start","status","stop"] as const){
   const result=await svc.execute(action,spec);
   assert.equal(result.action,action);assert.equal(result.grantsReleaseAuthority,false);
  }
  assert.deepEqual(calls,["install","start","status","stop"]);
 });
 test(`M18D3 ${spec.manager}: driver failure sanitized and no implicit retry`,async()=>{
  const calls:string[]=[];
  const driver:LocalServiceLifecycleDriver={
   async install(){calls.push("install");throw new Error("private installer path/token");},
   async start(){calls.push("start");},
   async stop(){calls.push("stop");},
   async status(){calls.push("status");throw new Error("internal diagnostic");},
  };
  const svc=new LocalServiceLifecycleService(driver);
  for(const action of ["install","status"] as const) {
   await assert.rejects(()=>svc.execute(action,spec),(e:unknown)=>e instanceof LocalServiceLifecycleError && e.code==="driver_failed" && e.message==="local service lifecycle driver failed");
  }
  assert.deepEqual(calls,["install","status"]);
 });
 test(`M18D3 ${spec.manager}: fail closed before any driver call on untrusted specification`,async()=>{
  let calls=0;
  const driver:LocalServiceLifecycleDriver={async install(){calls++;},async start(){calls++;},async stop(){calls++;},async status(){calls++;throw Error("unexpected");}};
  await assert.rejects(()=>new LocalServiceLifecycleService(driver).execute("install",{...spec,daemonHost:"0.0.0.0" as any}));
  assert.throws(()=>planPlatformServiceAction({...spec,serviceName:"../escape"},"install"));
  assert.equal(calls,0);
 });
}
