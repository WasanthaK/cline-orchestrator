import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewServiceRecoveryMatrix,
  ServiceRecoveryMatrixError,
  SERVICE_RECOVERY_REQUIRED_SCENARIOS,
  type ServiceRecoveryManager,
  type ServiceRecoveryMatrixInputV1,
  type ServiceRecoveryPlatformEvidenceV1,
} from "./service-recovery-matrix-review.js";
import type {
  ServiceFailureEvidenceV1, ServiceFailureScenario, ServiceFailureSnapshotV1,
} from "./service-failure-evidence.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const candidate = "c".repeat(40);
const name = "cline-orch-proof";
const managers: readonly ServiceRecoveryManager[] = ["systemd", "windows-service"];

function evidence(manager: ServiceRecoveryManager, scenario: ServiceFailureScenario): ServiceFailureEvidenceV1 {
  const base: ServiceFailureSnapshotV1 = {
    serviceName: name, manager, registration: "owned", artifact: "owned",
    process: "stopped", loopbackHealth: "unhealthy",
  };
  let before = base, after = base;
  let attemptOutcome: ServiceFailureEvidenceV1["attemptOutcome"] = "refused";
  switch (scenario) {
    case "foreign_install_conflict":
      before = {...base, registration:"foreign", artifact:"foreign"};
      after = before;
      break;
    case "duplicate_install":
      break;
    case "failed_start":
      after = {...base, process:"failed"};
      attemptOutcome = "failed";
      break;
    case "restart_recovery":
      before = {...base, process:"failed"};
      after = {...base, process:"running", loopbackHealth:"healthy"};
      attemptOutcome = "succeeded";
      break;
    case "partial_uninstall":
      after = {...base, registration:"absent"};
      attemptOutcome = "failed";
      break;
    case "complete_uninstall":
      after = {...base, registration:"absent", artifact:"absent"};
      attemptOutcome = "succeeded";
      break;
  }
  return {
    schemaVersion:1, authority:"service_recovery_observation_only",
    grantsAuthority:false, scenario, before, after, attemptOutcome,
    operatorData:{beforeSha256:hashA,afterSha256:hashA,completeInventory:true},
  };
}

function platform(manager:ServiceRecoveryManager):ServiceRecoveryPlatformEvidenceV1 {
  return {manager,serviceName:name,runId:"38514262703",artifactSha256:hashB,
    observations:SERVICE_RECOVERY_REQUIRED_SCENARIOS.map(s=>evidence(manager,s))};
}
function matrix(platforms:readonly ServiceRecoveryPlatformEvidenceV1[]): ServiceRecoveryMatrixInputV1 {
  return {schemaVersion:1,authority:"service_recovery_matrix_observation_only",
    grantsAuthority:false,candidateCommitSha:candidate,platforms};
}

test("M18D4d3 empty and one-sided coverage cannot appear complete",()=>{
  const empty = reviewServiceRecoveryMatrix(matrix([]));
  assert.equal(empty.assessment,"missing_or_inconsistent_evidence");
  assert.equal(empty.missingCaseKeys.length,12);
  const linux = reviewServiceRecoveryMatrix(matrix([platform("systemd")]));
  assert.equal(linux.missingCaseKeys.length,6);
  assert.equal(linux.consistentCaseCount,6);
  assert.equal(linux.observationsConsistent,false);
  assert.equal(linux.physicalAcceptanceProven,false);
});

test("M18D4d3 complete self-reported matrix remains non-authoritative",()=>{
  const result = reviewServiceRecoveryMatrix(matrix(managers.map(platform)));
  assert.equal(result.assessment,"observations_consistent_for_review");
  assert.equal(result.observationsConsistent,true);
  assert.equal(result.consistentCaseCount,12);
  assert.deepEqual(result.missingCaseKeys,[]);
  assert.deepEqual(result.unresolvedPartialCleanupKeys,
    ["systemd:partial_uninstall","windows-service:partial_uninstall"]);
  assert.equal(result.physicalAcceptanceProven,false);
  assert.equal(result.provenanceAuthenticated,false);
  assert.equal(result.userDataPreservationPhysicallyVerified,false);
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
  assert.equal(Object.isFrozen(result.missingCaseKeys),true);
});

test("M18D4d3 rejects duplicate cases and inconsistent observations",()=>{
  const original = platform("systemd");
  const duplicate = reviewServiceRecoveryMatrix(matrix([{
    ...original, observations:[...original.observations,original.observations[0]],
  },platform("windows-service")]));
  assert.deepEqual(duplicate.duplicateCaseKeys,["systemd:foreign_install_conflict"]);
  assert.equal(duplicate.observationsConsistent,false);

  const badData = {...original.observations[2],
    operatorData:{beforeSha256:hashA,afterSha256:hashB,completeInventory:true}};
  const replaced = reviewServiceRecoveryMatrix(matrix([{
    ...original, observations:original.observations.map((v,i)=>i===2?badData:v),
  },platform("windows-service")]));
  assert.deepEqual(replaced.inconsistentCaseKeys,["systemd:failed_start"]);
  assert.equal(replaced.physicalAcceptanceProven,false);

  const crossed = {...original.observations[0],
    after:{...original.observations[0].after,serviceName:"other"}};
  const crossResult = reviewServiceRecoveryMatrix(matrix([{
    ...original,observations:[crossed,...original.observations.slice(1)],
  },platform("windows-service")]));
  assert.deepEqual(crossResult.inconsistentCaseKeys,["systemd:foreign_install_conflict"]);
});

test("M18D4d3 fails closed on identity, ambiguity, and forged authority",()=>{
  const good = platform("systemd");
  for (const bad of [
    {...matrix([good]),grantsAuthority:true},
    {...matrix([good]),authority:"recovery_execute"},
    {...matrix([good]),candidateCommitSha:"bad"},
    matrix([{...good,artifactSha256:"bad"}]),
    matrix([{...good,runId:"bad"}]),
    matrix([{...good,serviceName:"../unsafe"}]),
    matrix([good,good]),
  ]) assert.throws(
    ()=>reviewServiceRecoveryMatrix(bad as ServiceRecoveryMatrixInputV1),
    ServiceRecoveryMatrixError,
  );

  const forged = {...good.observations[0],grantsAuthority:true};
  const finding = reviewServiceRecoveryMatrix(matrix([{
    ...good,observations:[forged,...good.observations.slice(1)],
  },platform("windows-service")]));
  assert.deepEqual(finding.inconsistentCaseKeys,["systemd:foreign_install_conflict"]);
  assert.equal(finding.observationsConsistent,false);
});
