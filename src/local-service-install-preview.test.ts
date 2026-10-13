import assert from "node:assert/strict";
import test from "node:test";
import { previewLocalServiceInstall } from "./local-service-install-preview.js";
import type { LocalServiceSpecV1 } from "./local-service-lifecycle.js";
const base: LocalServiceSpecV1 = {
 schemaVersion:1, manager:"systemd",serviceName:"cline-orchestrator",displayName:"Cline Orchestrator",
 executable:"/opt/cline/bin/node",args:["/opt/cline/dist/index.js","daemon","/srv/work space"],
 workingDirectory:"/opt/cline",configPath:"/etc/cline/config.json",secretReferenceNames:[],
 daemonHost:"127.0.0.1",daemonPort:4317,autoStart:false,authority:"local_service_specification_only",grantsAuthority:false,
};
test("M18D1 renders reviewable systemd unit without mutation",()=>{
 const r=previewLocalServiceInstall(base);
 assert.equal(r.mutatesServiceManager,false);
 assert.equal(r.grantsAuthority,false);
 assert.match(r.content!,/ExecStart="\/opt\/cline\/bin\/node" "\/opt\/cline\/dist\/index.js" "daemon" "\/srv\/work space"/);
 assert.match(r.content!,/Restart=no/);
 assert.doesNotMatch(r.content!,/Environment=/);
});
test("M18D1 rejects unsafe systemd tokens and secret provisioning",()=>{
 for(const change of [{args:["a\n[Service]"]},{args:["foo%bar"]},{secretReferenceNames:["API_KEY"]},{daemonHost:"0.0.0.0" as any},{serviceName:"../bad"}]){
  assert.throws(()=>previewLocalServiceInstall({...base,...change}));
 }
});
test("M18D1 Windows preview cannot treat arbitrary CLI args as a Windows service",()=>{
 const spec={...base,manager:"windows-service" as const,executable:"C:\\Program Files\\Orchestrator\\service-host.exe",workingDirectory:"C:\\Program Files\\Orchestrator",configPath:"C:\\ProgramData\\Orchestrator\\config.json"};
 assert.throws(()=>previewLocalServiceInstall(spec));
 const r=previewLocalServiceInstall({...spec,args:[]});
 assert.deepEqual(r.command,["sc.exe","create","cline-orchestrator","binPath=",spec.executable,"start=","demand"]);
 assert.equal(r.grantsAuthority,false);
});
