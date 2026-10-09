import assert from "node:assert/strict";
import test from "node:test";
import { reviewWindowsScmHostInstall, type WindowsScmHostEvidenceV1 } from "./windows-scm-host-review.js";
import type { LocalServiceSpecV1 } from "./local-service-lifecycle.js";
const spec: LocalServiceSpecV1 = {
 schemaVersion:1,manager:"windows-service",serviceName:"cline-orchestrator",displayName:"Cline Orchestrator",
 executable:"C:\\Program Files\\ClineOrchestrator\\scm-host.exe",args:[],
 workingDirectory:"C:\\Program Files\\ClineOrchestrator",configPath:"C:\\ProgramData\\ClineOrchestrator\\config.json",
 secretReferenceNames:[],daemonHost:"127.0.0.1",daemonPort:4317,autoStart:false,
 authority:"local_service_specification_only",grantsAuthority:false,
};
const evidence: WindowsScmHostEvidenceV1 = {
 schemaVersion:1,hostPath:spec.executable,sha256:"f".repeat(64),serviceMainVerified:true,
 stopControlVerified:true,disposableLifecycleVerified:true,evidenceId:"scm-proof-20261009",
};
test("M18D4c2 defaults closed without independent Windows SCM host evidence",()=>{
 assert.throws(()=>reviewWindowsScmHostInstall(spec,undefined));
});
test("M18D4c2 explicitly reviewed SCM host is still not executed or authorized",()=>{
 const r=reviewWindowsScmHostInstall(spec,evidence);
 assert.equal(r.executesCommands,false);assert.equal(r.grantsAuthority,false);
 assert.equal(r.requiresExplicitConfirmation,true);
 assert.deepEqual(r.command,["create","cline-orchestrator","binPath=",spec.executable,"start=","demand"]);
 assert.equal(r.sha256,evidence.sha256);
});
test("M18D4c2 rejects incomplete, cross-bound or malformed host evidence",()=>{
 for(const value of [
  {...evidence,hostPath:"C:\\Other\\scm-host.exe"},
  {...evidence,sha256:"bad"},
  {...evidence,serviceMainVerified:false},
  {...evidence,stopControlVerified:false},
  {...evidence,disposableLifecycleVerified:false},
  {...evidence,evidenceId:"bad id"},
 ]) assert.throws(()=>reviewWindowsScmHostInstall(spec,value as WindowsScmHostEvidenceV1));
 assert.throws(()=>reviewWindowsScmHostInstall({...spec,executable:"C:\\Program Files\\ClineOrchestrator\\product-cli.js"},evidence));
});
