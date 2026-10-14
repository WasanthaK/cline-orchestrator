import assert from "node:assert/strict";
import test from "node:test";
import { reviewServiceRecoveryCloseout, ServiceRecoveryCloseoutError,
  type ServiceCleanupObservationV1, type ServiceRecoveryCloseoutInputV1,
} from "./service-recovery-closeout-review.js";
import { SERVICE_RECOVERY_REQUIRED_SCENARIOS, type ServiceRecoveryManager,
  type ServiceRecoveryMatrixInputV1,
} from "./service-recovery-matrix-review.js";
import type { ServiceFailureEvidenceV1, ServiceFailureScenario,
  ServiceFailureSnapshotV1,
} from "./service-failure-evidence.js";
import type { InstallManifestV1, InstallOwnership } from "./installer-packaging.js";

const A="a".repeat(64), B="b".repeat(64), sha="c".repeat(40);
const serviceName="cline-orch-proof";
const managers: readonly ServiceRecoveryManager[]=["systemd","windows-service"];
function snapshot(manager:ServiceRecoveryManager):ServiceFailureSnapshotV1 {
  return {serviceName,manager,registration:"owned",artifact:"owned",process:"stopped",loopbackHealth:"unhealthy"};
}
function evidence(manager:ServiceRecoveryManager,scenario:ServiceFailureScenario):ServiceFailureEvidenceV1 {
  const base=snapshot(manager);
  let before=base,after=base;
  let attemptOutcome:ServiceFailureEvidenceV1["attemptOutcome"]="refused";
  switch(scenario){
    case "foreign_install_conflict":before={...base,registration:"foreign",artifact:"foreign"};after=before;break;
    case "failed_start":after={...base,process:"failed"};attemptOutcome="failed";break;
    case "restart_recovery":before={...base,process:"failed"};after={...base,process:"running",loopbackHealth:"healthy"};attemptOutcome="succeeded";break;
    case "partial_uninstall":after={...base,registration:"absent"};attemptOutcome="failed";break;
    case "complete_uninstall":after={...base,registration:"absent",artifact:"absent"};attemptOutcome="succeeded";break;
  }
  return {schemaVersion:1,authority:"service_recovery_observation_only",grantsAuthority:false,
    before,after,scenario,attemptOutcome,
    operatorData:{beforeSha256:A,afterSha256:A,completeInventory:true}};
}
function matrix():ServiceRecoveryMatrixInputV1 {
  return {schemaVersion:1,authority:"service_recovery_matrix_observation_only",
    grantsAuthority:false,candidateCommitSha:sha,
    platforms:managers.map(manager=>({manager,serviceName,runId:"38516118584",artifactSha256:B,
      observations:SERVICE_RECOVERY_REQUIRED_SCENARIOS.map(s=>evidence(manager,s))}))};
}
const userKinds: readonly InstallOwnership[]=["user_owned_config","user_owned_workspace_registry","user_owned_secrets","user_owned_task_state"];
function cleanup(manager:ServiceRecoveryManager):ServiceCleanupObservationV1 {
  const manifest:InstallManifestV1={schemaVersion:1,version:"0.1.0",platform:manager==="systemd"?"linux":"windows",
    authority:"install_manifest_plan_only",grantsAuthority:false,entries:[
      {path:"bin/orchestrator",ownership:"product_owned",kind:"file"},
      {path:serviceName,ownership:"product_owned",kind:"service_registration"},
      ...userKinds.map((ownership,i)=>({path:"userdata/sentinel"+i,ownership,kind:"file" as const})),
    ]};
  return {schemaVersion:1,authority:"service_cleanup_observation_only",grantsAuthority:false,
    manager,serviceName,runId:"38516118584",artifactSha256:B,manifest,
    removedProductPaths:["bin/orchestrator"],removedServiceRegistrations:[serviceName],
    preservedUserEntries:userKinds.map((_,i)=>({path:"userdata/sentinel"+i,beforeSha256:A,
      afterSha256:A,existedBefore:true as const,existsAfter:true as const})),
    inventoryComplete:true,partialUninstallRemediation:"cleanup_completed",
    finalState:{...snapshot(manager),registration:"absent",artifact:"absent"},
  };
}
function input(cleanups:readonly ServiceCleanupObservationV1[]):ServiceRecoveryCloseoutInputV1 {
  return {schemaVersion:1,authority:"service_recovery_closeout_observation_only",
    grantsAuthority:false,matrix:matrix(),cleanups};
}
test("M18D4d4 consistent claims remain unverified, inert and release-blocked",()=>{
  const v=reviewServiceRecoveryCloseout(input(managers.map(cleanup)));
  assert.equal(v.assessment,"observations_consistent_for_independent_review");
  assert.equal(v.observationsConsistent,true);
  assert.deepEqual(v.blockers,[]);
  assert.equal(v.physicalAcceptanceProven,false);
  assert.equal(v.provenanceAuthenticated,false);
  assert.equal(v.userDataPreservationPhysicallyVerified,false);
  assert.equal(v.requiresIndependentPhysicalProof,true);
  assert.equal(v.requiresExplicitExecutionConfirmation,true);
  assert.equal(v.executesCommands,false);
  assert.equal(v.mutatesFilesystem,false);
  assert.equal(v.mutatesServiceManager,false);
  assert.equal(v.grantsTaskAuthority,false);
  assert.equal(v.grantsFilesystemAuthority,false);
  assert.equal(v.grantsCredentialAuthority,false);
  assert.equal(v.grantsReleaseAuthority,false);
  assert.equal(Object.isFrozen(v),true);
  assert.equal(Object.isFrozen(v.blockers),true);
});
test("M18D4d4 missing platform, incomplete matrix and forged identity fail closed",()=>{
  const one=reviewServiceRecoveryCloseout(input([cleanup("systemd")]));
  assert.deepEqual(one.blockers,["windows-service:cleanup_observation_missing"]);
  const m=matrix();const incomplete=reviewServiceRecoveryCloseout({...input(managers.map(cleanup)),
    matrix:{...m,platforms:[m.platforms[0]]}});
  assert.ok(incomplete.blockers.includes("recovery_matrix_incomplete_or_inconsistent"));
  assert.ok(incomplete.blockers.includes("windows-service:identity_or_candidate_mismatch"));
  const linux=cleanup("systemd");
  const swapped=reviewServiceRecoveryCloseout(input([{...linux,artifactSha256:A},cleanup("windows-service")]));
  assert.deepEqual(swapped.blockers,["systemd:identity_or_candidate_mismatch"]);
});
test("M18D4d4 blocks incomplete cleanup, inventory drift and unresolved rollback",()=>{
  const linux=cleanup("systemd");
  const windows=cleanup("windows-service");
  const modified=reviewServiceRecoveryCloseout(input([
    {...linux,removedProductPaths:["../other"],inventoryComplete:false,
      partialUninstallRemediation:"unresolved",finalState:snapshot("systemd")},
    {...windows,preservedUserEntries:windows.preservedUserEntries.map((e,i)=>
      i===0?{...e,afterSha256:B}:e)},
  ]));
  for(const expected of ["systemd:product_cleanup_incomplete_or_unscoped",
    "systemd:operator_inventory_incomplete","systemd:cleanup_terminal_state_not_confirmed",
    "systemd:partial_uninstall_remediation_unresolved","windows-service:operator_data_changed_or_missing"]) {
    assert.ok(modified.blockers.includes(expected),expected);
  }
  assert.equal(modified.physicalAcceptanceProven,false);
  const mutated=reviewServiceRecoveryCloseout(input([{...linux,
    preservedUserEntries:linux.preservedUserEntries.slice(1)},windows]));
  assert.ok(mutated.blockers.includes("systemd:operator_inventory_incomplete"));
});
test("M18D4d4 rejects adversarial ownership manifests and duplicate authority",()=>{
  const linux=cleanup("systemd"),windows=cleanup("windows-service");
  const invalidManifest=reviewServiceRecoveryCloseout(input([{...linux,manifest:{
    ...linux.manifest,entries:[{path:"../escape",kind:"file",ownership:"product_owned"}],
  }},windows]));
  assert.ok(invalidManifest.blockers.includes("systemd:ownership_manifest_invalid"));
  const noOwnership=reviewServiceRecoveryCloseout(input([{...linux,manifest:{
    ...linux.manifest,entries:[{path:serviceName,kind:"service_registration",ownership:"product_owned"}],
  }},windows]));
  assert.ok(noOwnership.blockers.includes("systemd:owned_artifacts_or_service_not_identified"));
  for(const bad of [
    {...input([]),grantsAuthority:true},
    {...input([]),authority:"service_manager_execution"},
    input([linux,linux]),
    input([{...linux,grantsAuthority:true} as unknown as ServiceCleanupObservationV1]),
  ]) assert.throws(()=>reviewServiceRecoveryCloseout(bad as ServiceRecoveryCloseoutInputV1),
    ServiceRecoveryCloseoutError);
});
