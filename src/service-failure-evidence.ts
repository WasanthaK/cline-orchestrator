/**
 * M18D4d2: immutable, non-executing assessment of supplied service snapshots.
 *
 * This is NOT an OS probe, installer, recovery executor, or physical acceptance
 * receipt. Callers must independently establish provenance and verify the
 * operator-data inventory. No finding can authorize an operation.
 */
export type ServiceFailureScenario =
  | "foreign_install_conflict"
  | "duplicate_install"
  | "failed_start"
  | "restart_recovery"
  | "partial_uninstall"
  | "complete_uninstall";

export type ServiceAttemptOutcome = "refused" | "failed" | "succeeded";
export type ServiceOwnershipObservation = "absent" | "owned" | "foreign" | "unknown";
export type ServiceProcessObservation = "stopped" | "running" | "failed" | "unknown";
export type ServiceHealthObservation = "healthy" | "unhealthy" | "unknown";

export interface ServiceFailureSnapshotV1 {
  serviceName: string;
  manager: "systemd" | "windows-service";
  registration: ServiceOwnershipObservation;
  artifact: ServiceOwnershipObservation;
  process: ServiceProcessObservation;
  loopbackHealth: ServiceHealthObservation;
}

export interface OperatorDataComparisonV1 {
  beforeSha256: string;
  afterSha256: string;
  completeInventory: boolean;
}

export interface ServiceFailureEvidenceV1 {
  schemaVersion: 1;
  authority: "service_recovery_observation_only";
  grantsAuthority: false;
  scenario: ServiceFailureScenario;
  attemptOutcome: ServiceAttemptOutcome;
  before: ServiceFailureSnapshotV1;
  after: ServiceFailureSnapshotV1;
  operatorData: OperatorDataComparisonV1;
}

export type ServiceFailureAssessment =
  | "matches_expected_observation"
  | "partial_cleanup_requires_review"
  | "operator_data_modified"
  | "evidence_incomplete"
  | "observation_mismatch";

export interface ServiceFailureAssessmentV1 {
  schemaVersion: 1;
  scenario: ServiceFailureScenario;
  assessment: ServiceFailureAssessment;
  authority: "service_recovery_assessment_only";
  evidenceOnly: true;
  physicalAcceptanceProven: false;
  requiresIndependentPhysicalProof: true;
  requiresExplicitExecutionConfirmation: true;
  executesCommands: false;
  mutatesFilesystem: false;
  mutatesServiceManager: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class ServiceFailureEvidenceError extends Error {
  constructor() {
    super("service recovery evidence is invalid or cross-bound");
    this.name = "ServiceFailureEvidenceError";
  }
}

const scenarios: readonly ServiceFailureScenario[] = [
  "foreign_install_conflict", "duplicate_install", "failed_start",
  "restart_recovery", "partial_uninstall", "complete_uninstall",
];
const outcomes: readonly ServiceAttemptOutcome[] = ["refused", "failed", "succeeded"];
const ownerships: readonly ServiceOwnershipObservation[] = ["absent", "owned", "foreign", "unknown"];
const processes: readonly ServiceProcessObservation[] = ["stopped", "running", "failed", "unknown"];
const healths: readonly ServiceHealthObservation[] = ["healthy", "unhealthy", "unknown"];
const digest = /^[a-f0-9]{64}$/i;
const safeName = /^[A-Za-z0-9._-]{1,96}$/;

function isSnapshot(v: ServiceFailureSnapshotV1): boolean {
  return v !== null && typeof v === "object"
    && safeName.test(v.serviceName)
    && (v.manager === "systemd" || v.manager === "windows-service")
    && ownerships.includes(v.registration)
    && ownerships.includes(v.artifact)
    && processes.includes(v.process)
    && healths.includes(v.loopbackHealth);
}

function isUnknown(v: ServiceFailureSnapshotV1): boolean {
  return v.registration === "unknown" || v.artifact === "unknown"
    || v.process === "unknown" || v.loopbackHealth === "unknown";
}

function sameSnapshot(a: ServiceFailureSnapshotV1, b: ServiceFailureSnapshotV1): boolean {
  return a.registration === b.registration && a.artifact === b.artifact
    && a.process === b.process && a.loopbackHealth === b.loopbackHealth;
}

/** Pure consistency check. A caller-provided observation never becomes authority. */
export function assessServiceFailureEvidence(
  evidence: ServiceFailureEvidenceV1,
): Readonly<ServiceFailureAssessmentV1> {
  if (!evidence || typeof evidence !== "object"
    || evidence.schemaVersion !== 1
    || evidence.authority !== "service_recovery_observation_only"
    || evidence.grantsAuthority !== false
    || !scenarios.includes(evidence.scenario)
    || !outcomes.includes(evidence.attemptOutcome)
    || !isSnapshot(evidence.before)
    || !isSnapshot(evidence.after)
    || evidence.before.manager !== evidence.after.manager
    || evidence.before.serviceName !== evidence.after.serviceName
    || !evidence.operatorData || typeof evidence.operatorData !== "object"
    || !digest.test(evidence.operatorData.beforeSha256)
    || !digest.test(evidence.operatorData.afterSha256)
    || typeof evidence.operatorData.completeInventory !== "boolean"
  ) {
    throw new ServiceFailureEvidenceError();
  }

  const { before, after, scenario, attemptOutcome, operatorData } = evidence;
  let assessment: ServiceFailureAssessment;
  if (operatorData.beforeSha256.toLowerCase() !== operatorData.afterSha256.toLowerCase()) {
    assessment = "operator_data_modified";
  } else if (!operatorData.completeInventory || isUnknown(before) || isUnknown(after)) {
    assessment = "evidence_incomplete";
  } else {
    let matches = false;
    switch (scenario) {
      case "foreign_install_conflict":
        matches = attemptOutcome === "refused" && before.registration === "foreign"
          && sameSnapshot(before, after);
        break;
      case "duplicate_install":
        matches = attemptOutcome === "refused" && before.registration === "owned"
          && before.artifact === "owned" && sameSnapshot(before, after);
        break;
      case "failed_start":
        matches = attemptOutcome === "failed" && before.registration === "owned"
          && before.artifact === "owned" && before.process === "stopped"
          && before.loopbackHealth === "unhealthy"
          && after.registration === "owned" && after.artifact === "owned"
          && (after.process === "failed" || after.process === "stopped")
          && after.loopbackHealth === "unhealthy";
        break;
      case "restart_recovery":
        matches = attemptOutcome === "succeeded" && before.registration === "owned"
          && before.artifact === "owned" && before.process === "failed"
          && before.loopbackHealth === "unhealthy"
          && after.registration === "owned" && after.artifact === "owned"
          && after.process === "running" && after.loopbackHealth === "healthy";
        break;
      case "partial_uninstall":
        matches = attemptOutcome === "failed" && before.registration === "owned"
          && before.artifact === "owned"
          && (after.registration === "owned" || after.registration === "absent")
          && (after.artifact === "owned" || after.artifact === "absent")
          && (after.registration === "owned" || after.artifact === "owned")
          && after.process === "stopped" && after.loopbackHealth === "unhealthy";
        break;
      case "complete_uninstall":
        matches = attemptOutcome === "succeeded" && before.registration === "owned"
          && before.artifact === "owned" && after.registration === "absent"
          && after.artifact === "absent" && after.process === "stopped"
          && after.loopbackHealth === "unhealthy";
        break;
    }
    assessment = matches
      ? scenario === "partial_uninstall" ? "partial_cleanup_requires_review" : "matches_expected_observation"
      : "observation_mismatch";
  }

  return Object.freeze({
    schemaVersion: 1,
    scenario,
    assessment,
    authority: "service_recovery_assessment_only",
    evidenceOnly: true,
    physicalAcceptanceProven: false,
    requiresIndependentPhysicalProof: true,
    requiresExplicitExecutionConfirmation: true,
    executesCommands: false,
    mutatesFilesystem: false,
    mutatesServiceManager: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
}
