import assert from "node:assert/strict";
import test from "node:test";
import {
  assessWindowsUpgrade, simulateUpgradeTransition,
  WINDOWS_UPGRADE_DESIGN_CONTRACT,
  type WindowsUpgradeEvidenceV1,
} from "./windows-upgrade-design.js";

const digest = "a".repeat(64);
const revision = "b".repeat(40);
const newer = "c".repeat(40);
function evidence(): WindowsUpgradeEvidenceV1 {
  return {
    schemaVersion: 1, platform: "windows",
    installation: {
      owner: "current_user", currentVersion: "0.1.0", sourceCommit: revision,
      manifestSha256: digest, observedManifestSha256: digest,
    },
    candidate: {
      version: "0.2.0", sourceCommit: newer, manifestSha256: "d".repeat(64),
      portableArchiveSha256: "e".repeat(64), inventoryVerified: true,
      runtimeSbomVerified: true, signed: true, signerTrusted: true,
    },
    previousVersion: {
      manifestSha256: digest, immutableSnapshotVerified: true,
      productOwnedFilesOnly: true,
    },
    protectedUserState: {
      configUnchanged: true, workspaceRegistryUnchanged: true,
      secretReferencesUnchanged: true, taskHistoryUnchanged: true,
      separateFromProductDirectories: true,
    },
    foreground: {
      launcherStopped: true, viewerStopped: true, activeTaskCount: 0,
      activeLeaseCount: 0,
    },
    review: {
      exactCandidateCommit: newer, independentSigningReview: true,
      independentReleaseApproval: true, explicitOperatorConsent: true,
    },
  };
}
test("M19E3B unsigned real candidate is blocked; no upgrade or rollback authority", () => {
  const v = evidence();
  v.candidate.signed = false;
  v.candidate.signerTrusted = false;
  v.review.independentSigningReview = false;
  v.review.independentReleaseApproval = false;
  const report = assessWindowsUpgrade(v);
  assert.equal(report.result, "blocked");
  assert.ok(report.blockers.includes("unsigned_or_untrusted_candidate"));
  assert.ok(report.blockers.includes("release_gate_unapproved"));
  assert.ok(report.blockers.includes("update_implementation_not_approved"));
  assert.equal(report.upgradeAvailable, false);
  assert.equal(report.rollbackAvailable, false);
  assert.equal(report.grantsAuthority, false);
  assert.equal(WINDOWS_UPGRADE_DESIGN_CONTRACT.executesUpgrade, false);
});
test("M19E3B even hypothetical perfect evidence only starts implementation review", () => {
  const report = assessWindowsUpgrade(evidence());
  assert.equal(report.result, "requires_independent_implementation_review");
  assert.deepEqual(report.blockers, ["update_implementation_not_approved"]);
  assert.equal(report.releaseAuthorized, false);
  assert.equal(report.upgradeAvailable, false);
  assert.equal(report.userOwnedStateMustRemainUnchanged, true);
});
test("M19E3B stale, active writer, missing snapshot, changed operator data fail closed", () => {
  for (const mutate of [
    (v: WindowsUpgradeEvidenceV1) => { v.installation.observedManifestSha256 = "f".repeat(64); },
    (v: WindowsUpgradeEvidenceV1) => { v.foreground.activeLeaseCount = null; },
    (v: WindowsUpgradeEvidenceV1) => { v.foreground.activeTaskCount = 1; },
    (v: WindowsUpgradeEvidenceV1) => { v.previousVersion.immutableSnapshotVerified = false; },
    (v: WindowsUpgradeEvidenceV1) => { v.protectedUserState.secretReferencesUnchanged = false; },
    (v: WindowsUpgradeEvidenceV1) => { v.protectedUserState.taskHistoryUnchanged = false; },
    (v: WindowsUpgradeEvidenceV1) => { v.candidate.inventoryVerified = false; },
    (v: WindowsUpgradeEvidenceV1) => { v.candidate.version = "0.1.0"; },
    (v: WindowsUpgradeEvidenceV1) => { v.candidate.version = "0.0.9"; },
    (v: WindowsUpgradeEvidenceV1) => { v.candidate.sourceCommit = "latest"; },
  ]) {
    const v = evidence(); mutate(v);
    const result = assessWindowsUpgrade(v);
    assert.equal(result.result, "blocked");
    assert.ok(result.blockers.length >= 2);
    assert.equal(result.grantsAuthority, false);
  }
});
test("M19E3B corrupt runtime evidence cannot mint an executable plan", () => {
  const result = assessWindowsUpgrade({schemaVersion: 1} as WindowsUpgradeEvidenceV1);
  assert.ok(result.blockers.includes("invalid_evidence"));
  assert.equal(result.upgradeAvailable, false);
});
test("M19E3B in-memory transaction dry run has deterministic fault recovery only", () => {
  let phase = simulateUpgradeTransition("observed", "stage", true);
  phase = simulateUpgradeTransition(phase, "preserve_previous", true);
  phase = simulateUpgradeTransition(phase, "verify_candidate", true);
  assert.throws(() => simulateUpgradeTransition(phase, "switch", false));
  phase = simulateUpgradeTransition(phase, "switch", true);
  assert.equal(phase, "switch_simulated");
  assert.equal(simulateUpgradeTransition(phase, "fault", true), "rollback_planned");
  assert.equal(simulateUpgradeTransition(phase, "fault", false), "manual_recovery_required");
  assert.throws(() => simulateUpgradeTransition("staged", "commit", true));
  assert.equal(simulateUpgradeTransition("staged", "fault", true), "discard_stage");
});
test("M19E3B public dry run never contains paths, settings, secrets or action tokens", () => {
  const serialized = JSON.stringify(assessWindowsUpgrade(evidence()));
  assert.doesNotMatch(serialized, /LOCALAPPDATA|config\.json|workspace-registry|apiKey|secretRef|confirmationToken|C:\\/);
  assert.equal(WINDOWS_UPGRADE_DESIGN_CONTRACT.changesServiceManager, false);
  assert.equal(WINDOWS_UPGRADE_DESIGN_CONTRACT.grantsAuthority, false);
});
