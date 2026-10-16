import assert from "node:assert/strict";
import test from "node:test";
import { LiveClineRecoveryObserver } from "./recovery-live-cline-observer.js";
import { ClineRunner } from "./cline-runner.js";
import type { WorkerConfig } from "./types.js";
import type { InferenceSnapshotV1 } from "./recovery-inference-monitor.js";
const event = (type: string, toolName: string) => ({
 type:"agent_event", payload:{event:{type,contentType:"tool",toolName,secret:"Bearer private"}},
});
const start=(n:string)=>event("content_start",n);
const end=(n:string)=>event("content_end",n);
const busy: InferenceSnapshotV1={schemaVersion:1,backend:"llama.cpp",availability:"available",
 telemetry:"available",activeRequests:2,readOnly:true,grantsAuthority:false};

test("M19R2C matched tool lifecycle counts a completed tool, not source change",()=>{
 const o=new LiveClineRecoveryObserver(); o.begin(1000);
 o.recordRuntimeEvent({type:"agent_event",payload:{event:{type:"usage",outputTokens:10000}}},1100);
 assert.equal(o.snapshot(1100)?.lastVerifiedProgressAtMs,undefined);
 o.recordRuntimeEvent(start("read_files"),1200);
 assert.equal(o.snapshot(1200)?.activeTool,true);
 o.recordRuntimeEvent(end("read_files"),1300);
 assert.equal(o.snapshot(1300)?.pairedToolCompletions,1);
 assert.equal(o.snapshot(1300)?.toolLifecycle,"paired");
 assert.equal(o.correlation(1300,busy)?.correlation.classification,"verified_progress");
 assert.equal(o.correlation(1300,busy)?.correlation.retryAuthorized,false);
 assert.doesNotMatch(JSON.stringify(o.snapshot(1300)),/read_files|Bearer|private|secret/i);
});

test("M19R2C missing, concurrent, mismatched, malformed tool events are ambiguous",()=>{
 for(const events of [
  [end("run_commands")],
  [start("read_files"),end("run_commands")],
  [start("read_files"),start("run_commands"),end("read_files")],
  [start("read_files"),end("read_files"),end("read_files")],
  [start("../../../secrets"),end("../../../secrets")],
 ]) {
  const o=new LiveClineRecoveryObserver();o.begin(1000);
  events.forEach((e,i)=>o.recordRuntimeEvent(e,1200+i));
  assert.equal(o.snapshot(2000)?.toolLifecycle,"ambiguous");
  assert.equal(o.snapshot(2000)?.activeTool,undefined);
  assert.ok((o.snapshot(2000)?.pairedToolCompletions??0)<=1);
 }
});

test("M19R2C backend busy does not prove Cline progress or grant actions",()=>{
 const o=new LiveClineRecoveryObserver(); o.begin(1000);
 o.recordRuntimeEvent({type:"chunk",payload:{text:"secret text"}},1100);
 assert.equal(o.correlation(200000,busy)?.correlation.classification,"backend_busy_without_cline_progress");
 assert.equal(o.correlation(200000)?.correlation.classification,"insufficient_evidence");
 assert.equal(o.correlation(200000,busy)?.correlation.skipExecutionPermitted,false);
 assert.equal(o.correlation(200000,busy)?.grantsAuthority,false);
});

test("M19R2C verified watchdog, active tool, and unknown evidence remain distinct",()=>{
 const active=new LiveClineRecoveryObserver();active.begin(1000);
 active.recordRuntimeEvent(start("read_files"),1200);active.recordVerifiedWatchdogStall(200000);
 assert.equal(active.correlation(200000,busy)?.correlation.classification,"tool_in_flight");
 const uncertain=new LiveClineRecoveryObserver();uncertain.begin(1000);
 uncertain.recordRuntimeEvent(end("read_files"),1200);uncertain.recordVerifiedWatchdogStall(200000);
 assert.equal(uncertain.correlation(200000,busy)?.correlation.classification,"backend_busy_without_cline_progress");
 const stalled=new LiveClineRecoveryObserver();stalled.begin(1000);
 stalled.recordRuntimeEvent({type:"status"},1100);stalled.recordVerifiedWatchdogStall(200000);
 assert.equal(stalled.correlation(200000,busy)?.correlation.classification,"watchdog_stall_verified");
});

test("M19R2C reset and human wait seal live progress and never persist raw output",()=>{
 const o=new LiveClineRecoveryObserver();assert.equal(o.snapshot(10),undefined);
 o.begin(1000);o.recordRuntimeEvent(start("read_files"),1100);
 o.finish("waiting_for_human",1200);o.recordRuntimeEvent(end("read_files"),1300);
 assert.equal(o.snapshot(1300)?.pairedToolCompletions,0);
 assert.equal(o.correlation(1300,busy)?.correlation.classification,"waiting_for_human");
 o.begin(2000);o.recordRuntimeEvent(start("read_files"),1900);
 assert.equal(o.snapshot(2000)?.pairedToolCompletions,0);
 assert.equal(o.snapshot(2000)?.activeTool,false);
});

test("M19R2C ClineRunner subscription observes only paired SDK tools",async()=>{
 const callbacks:{emit?:(e:unknown)=>void}={};
 const runtime={subscribe:(fn:(e:unknown)=>void)=>{callbacks.emit=fn;return()=>undefined;}};
 const runner=new ClineRunner(".",{} as WorkerConfig,
   {runtimeFactory:{create:async()=>runtime as never}});
 assert.equal(runner.getRecoveryCorrelation(),undefined);
 const internal=runner as unknown as {getCore:()=>Promise<unknown>;
   beginRun:(task:Record<string,unknown>,prompt:string)=>void;};
 await internal.getCore();
 internal.beginRun({runCount:0,status:"created"},"private goal");
 callbacks.emit?.(start("read_files"));callbacks.emit?.(end("read_files"));
 const projection=runner.getRecoveryCorrelation();
 assert.equal(projection?.observation.pairedToolCompletions,1);
 assert.equal(projection?.correlation.grantsAuthority,false);
 assert.doesNotMatch(JSON.stringify(projection),/read_files|private goal/);
});
