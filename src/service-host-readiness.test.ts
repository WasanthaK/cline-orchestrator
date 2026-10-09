import assert from "node:assert/strict";
import test from "node:test";
import { assessServiceHostReadiness } from "./service-host-readiness.js";
import type { LocalServiceSpecV1 } from "./local-service-lifecycle.js";

const linux: LocalServiceSpecV1 = {
  schemaVersion:1, manager:"systemd", serviceName:"cline-orchestrator",
  displayName:"Cline Orchestrator", executable:"/usr/bin/node",
  args:["/opt/cline/dist/index.js","daemon"],
  workingDirectory:"/opt/cline", configPath:"/opt/cline/config.json",
  secretReferenceNames:[], daemonHost:"127.0.0.1", daemonPort:4317,
  autoStart:false, authority:"local_service_specification_only", grantsAuthority:false,
};
test("M18D4a Linux install preview is not physical readiness", () => {
  const result = assessServiceHostReadiness(linux);
  assert.equal(result.ready,false);
  assert.deepEqual(result.reasons,["foreground_entrypoint_not_proven","disposable_lifecycle_not_proven"]);
  assert.equal(result.executesCommands,false);
  assert.equal(result.grantsAuthority,false);
});
test("M18D4a Windows SCM preview is not a proven Windows service", () => {
  const spec: LocalServiceSpecV1 = {...linux,manager:"windows-service",
    executable:"C:\\Service\\host.exe",args:[],workingDirectory:"C:\\Service",configPath:"C:\\Service\\config.json"};
  const result=assessServiceHostReadiness(spec);
  assert.equal(result.ready,false);
  assert.deepEqual(result.reasons,["scm_host_not_proven","disposable_lifecycle_not_proven"]);
});
test("M18D4a rejects unsafe definitions before readiness result", () => {
  assert.throws(()=>assessServiceHostReadiness({...linux,daemonHost:"0.0.0.0" as any}));
});
