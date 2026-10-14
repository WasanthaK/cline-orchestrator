import assert from "node:assert/strict";
import test from "node:test";
import { assessServiceFailureEvidence, ServiceFailureEvidenceError,
  type ServiceFailureEvidenceV1, type ServiceFailureSnapshotV1,
  type ServiceFailureScenario } from "./service-failure-evidence.js";

const hashA = "a".repeat(64), hashB = "b".repeat(64);
const base: ServiceFailureSnapshotV1 = {
  serviceName:"cline-proof-123",manager:"systemd",registration:"owned",
  artifact:"owned",process:"stopped",loopbackHealth:"unhealthy",
};
function check(scenario:ServiceFailureScenario, before:ServiceFailureSnapshotV1,
  after:ServiceFailureSnapshotV1, attemptOutcome:ServiceFailureEvidenceV1["attemptOutcome"],
  overrides:Partial<ServiceFailureEvidenceV1> = {}) {
  return assessServiceFailureEvidence({
    schemaVersion:1,authority:"service_recovery_observation_only",grantsAuthority:false,
    scenario,before,after,attemptOutcome,operatorData:{
      beforeSha256:hashA,afterSha256:hashA,completeInventory:true,
    },...overrides,
  });
}

const cases: Array<[ServiceFailureScenario,ServiceFailureSnapshotV1,ServiceFailureSnapshotV1,ServiceFailureEvidenceV1["attemptOutcome"],string]> = [
 ["foreign_install_conflict",{...base,registration:"foreign",artifact:"foreign"}, {...base,registration:"foreign",artifact:"foreign"},"refused","matches_expected_observation"],
 ["duplicate_install",base,base,"refused","matches_expected_observation"],
 ["failed_start",base,{...base,process:"failed"},"failed","matches_expected_observation"],
 ["restart_recovery",{...base,process:"failed"}, {...base,process:"running",loopbackHealth:"healthy"},"succeeded","matches_expected_observation"],
 ["partial_uninstall",base,{...base,registration:"absent"},"failed","partial_cleanup_requires_review"],
 ["complete_uninstall",base,{...base,registration:"absent",artifact:"absent"},"succeeded","matches_expected_observation"],
];
for(const [scenario,before,after,outcome,expected] of cases) {
  test("M18D4d2 "+scenario+" classifies non-authoritative observations",()=>{
    const result=check(scenario,before,after,outcome);
    assert.equal(result.assessment,expected);
    assert.equal(result.physicalAcceptanceProven,false);
    assert.equal(result.requiresIndependentPhysicalProof,true);
    assert.equal(result.requiresExplicitExecutionConfirmation,true);
    assert.equal(result.executesCommands,false);
    assert.equal(result.mutatesFilesystem,false);
    assert.equal(result.mutatesServiceManager,false);
    assert.equal(result.grantsTaskAuthority,false);
    assert.equal(result.grantsFilesystemAuthority,false);
    assert.equal(result.grantsCredentialAuthority,false);
    assert.equal(result.grantsReleaseAuthority,false);
    assert.equal(Object.isFrozen(result),true);
  });
}
test("M18D4d2 fails closed on unexpected service changes and incomplete evidence",()=>{
  assert.equal(check("foreign_install_conflict",{...base,registration:"foreign"},base,"refused").assessment,"observation_mismatch");
  assert.equal(check("duplicate_install",base,{...base,process:"running",loopbackHealth:"healthy"},"refused").assessment,"observation_mismatch");
  assert.equal(check("restart_recovery",{...base,process:"failed"},base,"succeeded").assessment,"observation_mismatch");
  assert.equal(check("complete_uninstall",base,{...base,registration:"absent",artifact:"owned"},"succeeded").assessment,"observation_mismatch");
  assert.equal(check("failed_start",base,{...base,process:"unknown"},"failed").assessment,"evidence_incomplete");
  assert.equal(check("failed_start",base,{...base,process:"failed"},"failed",{
    operatorData:{beforeSha256:hashA,afterSha256:hashA,completeInventory:false},
  }).assessment,"evidence_incomplete");
  assert.equal(check("complete_uninstall",base,{...base,registration:"absent",artifact:"absent"},"succeeded",{
    operatorData:{beforeSha256:hashA,afterSha256:hashB,completeInventory:true},
  }).assessment,"operator_data_modified");
});
test("M18D4d2 refuses forged authority, identity crossing and invalid digests",()=>{
 const evidence:ServiceFailureEvidenceV1={
  schemaVersion:1,authority:"service_recovery_observation_only",grantsAuthority:false,
  scenario:"duplicate_install",before:base,after:base,attemptOutcome:"refused",
  operatorData:{beforeSha256:hashA,afterSha256:hashA,completeInventory:true},
 };
 for(const candidate of [
  {...evidence,grantsAuthority:true},
  {...evidence,authority:"release" as any},
  {...evidence,after:{...base,serviceName:"other"}},
  {...evidence,after:{...base,manager:"windows-service" as const}},
  {...evidence,after:{...base,registration:"trusted" as any}},
  {...evidence,operatorData:{...evidence.operatorData,beforeSha256:"invalid"}},
 ]) assert.throws(()=>assessServiceFailureEvidence(candidate as ServiceFailureEvidenceV1),ServiceFailureEvidenceError);
});
