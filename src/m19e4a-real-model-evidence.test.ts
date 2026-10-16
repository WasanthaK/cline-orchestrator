import assert from "node:assert/strict";
import test from "node:test";
import { inspectM19E4AEvidence, M19E4A_EVIDENCE_CONTRACT,
  M19E4A_GATES, type M19E4AEvidenceV1 } from "./m19e4a-real-model-evidence.js";

function optimisticClaims(): M19E4AEvidenceV1 {
  const all = Object.fromEntries(M19E4A_GATES.map(id =>
    [id, { status: "passed", evidenceType: "operator_observation" }]));
  return {
    schemaVersion: 1,
    candidate: {
      sourceCommit: "a".repeat(40), installedManifestCommit: "a".repeat(40),
      installerSha256: "b".repeat(64), provenanceChecked: true,
      installedRuntimeChecked: true, sbomAndInventoryChecked: true,
      distribution: "unsigned_windows_foreground_preview",
    },
    environment: {
      actualWindowsInstall: true, disposableWorkspace: true,
      sourceRepositoryUnchanged: true, serviceManagerUnchanged: true,
    },
    model: {
      implementation: "llama.cpp", endpointClass: "literal_loopback_http_v1",
      discoveredAliasMatchesConfigured: true, nonSyntheticResponseObserved: true,
      harmlessPromptAnswered: true,
    },
    task: {
      separatelyApproved: true, authorizationRecorded: true,
      actualExecutionObserved: true, terminalStatus: "completed",
      eventCount: 12, changedFiles: 1, changesWithinApprovedScope: true,
      boundedValidationPassed: true, independentDiffSafetyPassed: true,
      checkpointObserved: true, taskHistoryDrilldownObserved: true,
    },
    exit: {
      ownedForegroundProcessesStopped: true, loopbackPortsReleased: true,
      noPersistentServiceCreated: true, ownedBinaryRemoved: true,
      configUnchanged: true, workspaceRegistryUnchanged: true,
      secretReferencesUnchanged: true, taskHistoryPreserved: true,
    },
    gateClaims: all,
    operatorReview: {
      reviewerPresent: true, exactCandidateCheckedByReviewer: true,
      independentEvidenceReviewed: true, reviewerAccepted: true,
    },
  };
}

test("M19E4A a missing pilot is blocked, never confused with successful synthetic CI", () => {
  const report = inspectM19E4AEvidence({});
  assert.equal(report.outcome, "blocked");
  assert.equal(report.gates.length, M19E4A_GATES.length);
  assert.ok(report.gates.every(g => g.status === "needs_evidence"));
  assert.equal(report.releaseAuthorized, false);
  assert.equal(report.pilotAutomaticallyAccepted, false);
});

test("M19E4A even an ideal operator claim requires independent human review", () => {
  const report = inspectM19E4AEvidence(optimisticClaims());
  assert.equal(report.outcome, "ready_for_independent_human_review");
  assert.ok(report.gates.every(g => g.status === "review_only"));
  assert.equal(report.evidenceCanBeForged, true);
  assert.equal(report.actualPilotExecutedByThisTool, false);
  assert.equal(report.pilotAutomaticallyAccepted, false);
  assert.equal(report.grantsAuthority, false);
});

test("M19E4A rejects synthetic or unsupported sources for a claimed real task", () => {
  const e = optimisticClaims();
  e.gateClaims.real_local_model = { status: "passed", evidenceType: "synthetic_test" };
  assert.equal(inspectM19E4AEvidence(e).outcome, "blocked");
  assert.equal(inspectM19E4AEvidence(e).gates.find(x => x.id === "real_local_model")?.status, "needs_evidence");
});

test("M19E4A fails closed for all critical missing observations", () => {
  const mutations: Array<(e: M19E4AEvidenceV1) => void> = [
    e => { e.candidate.installedManifestCommit = "c".repeat(40); },
    e => { e.candidate.provenanceChecked = false; },
    e => { e.environment.actualWindowsInstall = false; },
    e => { e.model.nonSyntheticResponseObserved = false; },
    e => { e.model.endpointClass = "other"; },
    e => { e.task.separatelyApproved = false; },
    e => { e.task.authorizationRecorded = false; },
    e => { e.environment.disposableWorkspace = false; },
    e => { e.task.terminalStatus = "unknown"; },
    e => { e.task.eventCount = 0; },
    e => { e.task.boundedValidationPassed = false; },
    e => { e.task.independentDiffSafetyPassed = false; },
    e => { e.task.checkpointObserved = false; },
    e => { e.task.taskHistoryDrilldownObserved = false; },
    e => { e.exit.loopbackPortsReleased = false; },
    e => { e.exit.taskHistoryPreserved = false; },
  ];
  for (const mutate of mutations) {
    const e = optimisticClaims();
    mutate(e);
    const report = inspectM19E4AEvidence(e);
    assert.equal(report.outcome, "blocked");
    assert.ok(report.gates.some(x => x.status === "failed"));
    assert.equal(report.releaseAuthorized, false);
  }
});

test("M19E4A never includes raw prompts, local paths, IDs, secrets or model output", () => {
  const report = inspectM19E4AEvidence(optimisticClaims());
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /C:\\|\/mnt\/|apiKey|taskId|workspaceId|prompt|modelId|sourcePath|rawOutput|bearer|token/i);
  assert.equal(M19E4A_EVIDENCE_CONTRACT.startsTask, false);
  assert.equal(M19E4A_EVIDENCE_CONTRACT.installsSoftware, false);
  assert.equal(M19E4A_EVIDENCE_CONTRACT.acceptsSubmittedClaimsAsAttestation, false);
});
