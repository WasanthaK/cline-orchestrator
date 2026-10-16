import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AdvisorAdmissionError, DurableAdvisorAdmissionLedger,
  ADVISOR_ADMISSION_CONTRACT, type AdvisorAdmissionPolicyV1,
} from "./recovery-advisor-admission.js";

const id = (char: string) => char.repeat(64);
const approve = async () => true;
const reject = async () => false;
const policy = (directory: string): AdvisorAdmissionPolicyV1 => ({
  schemaVersion:1, directory, maxCallsPerHour:2,
  maxEstimatedCentsPerHour:6, maxGrantCents:4,
});
const errorCode = (code: string) => (err: unknown) =>
  err instanceof AdvisorAdmissionError && err.code === code;
async function fixture(
  run: (directory: string, setTime: (v: number)=>void, now: ()=>number) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(),"orch-advisor-"));
  const directory = path.join(root,"protected");
  let time = 1_000_000;
  try { await run(directory, v=>{time=v;}, ()=>time); }
  finally { await rm(root,{recursive:true,force:true}); }
}
test("M19R3C issue needs operator approval; no permission means no state writes",async()=>{
  await fixture(async(directory, _setTime, now)=>{
    const ledger=new DurableAdvisorAdmissionLedger(policy(directory),now);
    await assert.rejects(ledger.issue(id("a"),2,120_000,reject),errorCode("permission_denied"));
    await assert.rejects(ledger.issue(id("a"),2,120_000,async()=>{
      throw new Error("private authentication detail");
    }),errorCode("permission_denied"));
    const grant=await ledger.issue(id("a"),2,120_000,approve);
    assert.equal(grant.state,"pending");
    assert.equal(grant.grantsAuthority,false);
    assert.equal(ADVISOR_ADMISSION_CONTRACT.networkCalls,false);
    const disk=await readFile(path.join(directory,"admission-v1.json"),"utf8");
    assert.doesNotMatch(disk,/authentication detail|Bearer|private prompt/i);
  });
});
test("M19R3C restart-safe single-use reservations and incident deduplication",async()=>{
  await fixture(async(directory, _setTime, now)=>{
    const first=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const grant=await first.issue(id("a"),3,300_000,approve);
    // Simulate a restart: a different instance sees the same persisted grant.
    const second=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const receipt=await second.reserveOnce(grant.grantId,id("a"),2);
    assert.equal(receipt.reservation,"held");
    assert.equal(receipt.retryAuthorized,false);
    assert.equal(receipt.skipExecutionPermitted,false);
    assert.equal(receipt.grantsAuthority,false);
    await assert.rejects(first.reserveOnce(grant.grantId,id("a"),1),errorCode("already_decided"));
    await assert.rejects(first.issue(id("a"),2,120_000,approve),errorCode("duplicate_incident"));
    await assert.rejects(first.reserveOnce(grant.grantId,id("b"),1),errorCode("not_found"));
  });
});
test("M19R3C preserves rolling hourly spending and call limits after restart",async()=>{
  await fixture(async(directory,setTime,now)=>{
    const one=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g1=await one.issue(id("a"),4,300_000,approve);
    await one.reserveOnce(g1.grantId,id("a"),4);
    setTime(1_000_500);
    const two=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g2=await two.issue(id("b"),4,300_000,approve);
    await assert.rejects(two.reserveOnce(g2.grantId,id("b"),3),errorCode("budget_exceeded"));
    await two.reserveOnce(g2.grantId,id("b"),2);
    const g3=await two.issue(id("c"),4,300_000,approve);
    await assert.rejects(two.reserveOnce(g3.grantId,id("c"),1),errorCode("budget_exceeded"));
    setTime(4_601_000);
    // Historic grant can expire; reserve a new one once hourly window advances.
    const g4=await two.issue(id("d"),4,300_000,approve);
    assert.equal((await two.reserveOnce(g4.grantId,id("d"),1)).reservation,"held");
    await assert.rejects(two.reserveOnce(g3.grantId,id("c"),1),errorCode("expired"));
  });
});
test("M19R3C revocation and global emergency stop survive restart",async()=>{
  await fixture(async(directory,_setTime,now)=>{
    const a=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g1=await a.issue(id("a"),2,100_000,approve);
    const g2=await a.issue(id("b"),2,100_000,approve);
    await assert.rejects(a.revoke(g1.grantId,reject),errorCode("permission_denied"));
    await a.revoke(g1.grantId,approve);
    const b=new DurableAdvisorAdmissionLedger(policy(directory),now);
    await assert.rejects(b.reserveOnce(g1.grantId,id("a"),1),errorCode("already_decided"));
    assert.equal(await b.revokeAllPending(approve),1);
    await assert.rejects(a.reserveOnce(g2.grantId,id("b"),1),errorCode("already_decided"));
    assert.equal(await a.revokeAllPending(approve),0);
  });
});
test("M19R3C detects expired grants and rejects clock rollback",async()=>{
  await fixture(async(directory,setTime,now)=>{
    const a=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g=await a.issue(id("a"),1,1000,approve);
    setTime(1_001_000);
    await assert.rejects(a.reserveOnce(g.grantId,id("a"),1),errorCode("expired"));
    const other=await a.issue(id("b"),1,1000,approve);
    setTime(999_000);
    await assert.rejects(a.reserveOnce(other.grantId,id("b"),1),errorCode("state_unavailable"));
  });
});
test("M19R3C lock contention is denied and does not bypass durable state",async()=>{
  await fixture(async(directory,_setTime,now)=>{
    const a=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g=await a.issue(id("a"),1,100_000,approve);
    await mkdir(path.join(directory,".admission.lock"));
    const b=new DurableAdvisorAdmissionLedger(policy(directory),now);
    await assert.rejects(b.reserveOnce(g.grantId,id("a"),1),errorCode("state_busy"));
    await rm(path.join(directory,".admission.lock"),{recursive:true});
    assert.equal((await b.reserveOnce(g.grantId,id("a"),1)).reservation,"held");
  });
});
test("M19R3C corrupt or permissive state never becomes fresh untracked budget",async()=>{
  await fixture(async(directory,_setTime,now)=>{
    const a=new DurableAdvisorAdmissionLedger(policy(directory),now);
    await a.issue(id("a"),1,100_000,approve);
    const file=path.join(directory,"admission-v1.json");
    await writeFile(file,'{"schemaVersion":1,"secret":"private text"}');
    await assert.rejects(a.issue(id("b"),1,100_000,approve),errorCode("state_corrupt"));
  });
});
test("M19R3C two parallel consumers of the same grant cannot double-reserve",async()=>{
  await fixture(async(directory,_setTime,now)=>{
    const a=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const g=await a.issue(id("a"),1,100_000,approve);
    const second=new DurableAdvisorAdmissionLedger(policy(directory),now);
    const outcomes=await Promise.allSettled([
      a.reserveOnce(g.grantId,id("a"),1),
      second.reserveOnce(g.grantId,id("a"),1),
    ]);
    assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
    const rejected=outcomes.find(x=>x.status==="rejected");
    assert.ok(rejected?.status==="rejected");
    assert.ok(["state_busy","already_decided"].includes(rejected.reason?.code));
  });
});
