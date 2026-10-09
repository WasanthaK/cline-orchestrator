import assert from "node:assert/strict";
import test from "node:test";
import { planPlatformServiceAction } from "./platform-service-command-plan.js";
import type { LocalServiceSpecV1 } from "./local-service-lifecycle.js";
const linux: LocalServiceSpecV1 = {
 schemaVersion:1,manager:"systemd",serviceName:"cline-orchestrator",displayName:"Cline Orchestrator",
 executable:"/usr/bin/node",args:["/opt/cline/dist/index.js","daemon","/srv/work"],
 workingDirectory:"/opt/cline",configPath:"/opt/cline/config.json",secretReferenceNames:[],
 daemonHost:"127.0.0.1",daemonPort:4317,autoStart:false,authority:"local_service_specification_only",grantsAuthority:false,
};
const windows: LocalServiceSpecV1 = { ...linux, manager:"windows-service",
 executable:"C:\\Service\\host.exe",args:[],workingDirectory:"C:\\Service",
 configPath:"C:\\Service\\config.json" };
test("M18D2 Linux exact status/start/stop planning without execution",()=>{
 for(const action of ["status","start","stop"] as const){
  const plan=planPlatformServiceAction(linux,action);
  assert.deepEqual(plan.argv,[action==="status"?"is-active":action,"cline-orchestrator.service"]);
  assert.equal(plan.executesCommands,false);assert.equal(plan.mutatesServiceManager,false);
  assert.equal(plan.grantsAuthority,false);assert.equal(plan.requiresExplicitLocalConfirmation,true);
 }
});
test("M18D2 Linux install and removal stay separate from unit file writes",()=>{
 assert.match(planPlatformServiceAction(linux,"install").unitContent!,/ExecStart=/);
 assert.deepEqual(planPlatformServiceAction(linux,"uninstall").argv,["daemon-reload"]);
});
test("M18D2 Windows plans bounded SCM operations with no CLI-as-service assumption",()=>{
 assert.deepEqual(planPlatformServiceAction(windows,"status").argv,["query","cline-orchestrator"]);
 assert.deepEqual(planPlatformServiceAction(windows,"start").argv,["start","cline-orchestrator"]);
 assert.deepEqual(planPlatformServiceAction(windows,"stop").argv,["stop","cline-orchestrator"]);
 assert.deepEqual(planPlatformServiceAction(windows,"uninstall").argv,["delete","cline-orchestrator"]);
 assert.deepEqual(planPlatformServiceAction(windows,"install").argv,["create","cline-orchestrator","binPath=","C:\\Service\\host.exe","start=","demand"]);
});
test("M18D2 rejects unsafe or authority-expanded service specifications",()=>{
 assert.throws(()=>planPlatformServiceAction({...linux,daemonHost:"0.0.0.0" as any},"start"));
 assert.throws(()=>planPlatformServiceAction({...windows,args:["start"]},"install"));
 assert.throws(()=>planPlatformServiceAction(linux,"restart" as any));
});
