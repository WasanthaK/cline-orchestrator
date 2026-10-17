/**
 * Disposable hosted Windows acceptance of the exact packed runtime module.
 * Invocation: node scripts/verify-windows-advisor-rearm.mjs <unpacked-tarball-package-root>
 * No network, model, task or persistent operator state.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if(process.platform!=="win32") throw new Error("Windows hosted runner required");
if(process.argv.length!==3) throw new Error("Unpacked exact-commit package path required");
const root=path.resolve(process.argv[2]);
const {AdvisorSettingsStore}=await import(pathToFileURL(path.join(root,
  "dist","recovery-advisor-settings.js")).href);
const {DurableAdvisorStop}=await import(pathToFileURL(path.join(root,
  "dist","recovery-advisor-stop.js")).href);

const tmp=await mkdtemp(path.join(os.tmpdir(),"advisor-packed-win-"));
try {
  const projectId=crypto.randomUUID();
  const directory=path.join(tmp,"state",projectId);
  const store=new AdvisorSettingsStore(directory,projectId);
  const start=await store.inspect();
  assert.equal(start.mode,"off");
  const on=await store.save({expectedRevision:start.revision,
    mode:"automatic_advice",maxEstimatedCentsPerIncident:50,
    durationDays:7,acknowledgedExternalMetadata:true});
  assert.equal(on.mode,"automatic_advice");
  const stop=new DurableAdvisorStop(directory,projectId);
  let inLease=false;
  await store.withCurrentPolicyLease(async()=>{
    inLease=true;
    assert.equal((await store.stopNow()).status,"stopped");
    assert.equal(await stop.isStopped(),true);
    assert.equal((await store.inspect()).mode,"off");
  });
  assert.equal(inLease,true);
  const restarted=new AdvisorSettingsStore(directory,projectId);
  const stopState=await restarted.inspect();
  assert.equal(stopState.stopLatched,true);
  assert.equal((await restarted.readCurrentPolicy()),undefined);
  await assert.rejects(restarted.save({expectedRevision:stopState.revision,
    mode:"automatic_advice",maxEstimatedCentsPerIncident:50,
    durationDays:7,acknowledgedExternalMetadata:true}));
  const cleared=await restarted.resetStop(stopState.revision);
  assert.equal(cleared.mode,"off");
  assert.equal(cleared.stopLatched,false);
  assert.equal(await stop.isStopped(),false);
  assert.notEqual(cleared.revision,on.revision);
  assert.equal((await restarted.readCurrentPolicy())?.mode,"off");
  const next=new AdvisorSettingsStore(directory,projectId);
  assert.equal((await next.inspect()).mode,"off");
  assert.equal((await next.inspect()).grantsAuthority,false);
  console.log("M19R3L packed Windows module acceptance passed: "
    +"restart, single-project Stop, explicit Off reset, no auto re-enable");
} finally {
  await rm(tmp,{recursive:true,force:true});
}
