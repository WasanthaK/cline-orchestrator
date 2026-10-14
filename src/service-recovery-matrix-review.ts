/**
 * M18D4d3: review supplied recovery observations across disposable platforms.
 * Pure coverage/consistency check; never a provenance attestation or physical
 * acceptance receipt. No local probes, processes, files or service operations.
 */
import {
  assessServiceFailureEvidence,
  type ServiceFailureEvidenceV1,
  type ServiceFailureScenario,
} from "./service-failure-evidence.js";

export const SERVICE_RECOVERY_REQUIRED_SCENARIOS = Object.freeze([
  "foreign_install_conflict",
  "duplicate_install",
  "failed_start",
  "restart_recovery",
  "partial_uninstall",
  "complete_uninstall",
] as const satisfies readonly ServiceFailureScenario[]);

export type ServiceRecoveryManager = "systemd" | "windows-service";

export interface ServiceRecoveryPlatformEvidenceV1 {
  readonly manager: ServiceRecoveryManager;
  readonly serviceName: string;
  /** Supplied GitHub Actions run identifier, not independently authenticated. */
  readonly runId: string;
  /** Supplied packaged candidate hash, not independently authenticated. */
  readonly artifactSha256: string;
  readonly observations: readonly ServiceFailureEvidenceV1[];
}

export interface ServiceRecoveryMatrixInputV1 {
  readonly schemaVersion: 1;
  readonly authority: "service_recovery_matrix_observation_only";
  readonly grantsAuthority: false;
  /** Full Git SHA of the common reviewed candidate for BOTH platform runs. */
  readonly candidateCommitSha: string;
  readonly platforms: readonly ServiceRecoveryPlatformEvidenceV1[];
}

export interface ServiceRecoveryMatrixReviewV1 {
  readonly schemaVersion: 1;
  readonly authority: "service_recovery_matrix_review_only";
  readonly assessment: "observations_consistent_for_review" | "missing_or_inconsistent_evidence";
  readonly observationsConsistent: boolean;
  readonly consistentCaseCount: number;
  readonly missingCaseKeys: readonly string[];
  readonly inconsistentCaseKeys: readonly string[];
  readonly duplicateCaseKeys: readonly string[];
  readonly unresolvedPartialCleanupKeys: readonly string[];
  readonly evidenceOnly: true;
  readonly physicalAcceptanceProven: false;
  readonly provenanceAuthenticated: false;
  readonly userDataPreservationPhysicallyVerified: false;
  readonly requiresIndependentPhysicalProof: true;
  readonly requiresExplicitExecutionConfirmation: true;
  readonly executesCommands: false;
  readonly mutatesFilesystem: false;
  readonly mutatesServiceManager: false;
  readonly grantsTaskAuthority: false;
  readonly grantsFilesystemAuthority: false;
  readonly grantsCredentialAuthority: false;
  readonly grantsReleaseAuthority: false;
}

export class ServiceRecoveryMatrixError extends Error {
  constructor() {
    super("service recovery matrix identity or authority is invalid");
    this.name = "ServiceRecoveryMatrixError";
  }
}

const managers = ["systemd", "windows-service"] as const;
const digest = /^[0-9a-f]{64}$/i;
const commit = /^[0-9a-f]{40}$/i;
const run = /^[1-9][0-9]{0,19}$/;
const name = /^[A-Za-z0-9._-]{1,96}$/;

/**
 * Checks one claimed, pinned candidate across two platform evidence collections.
 * An internally consistent, complete self-report may be REVIEWABLE but is NEVER
 * accepted as actual physical proof; partial uninstall always needs remediation.
 */
export function reviewServiceRecoveryMatrix(
  input: ServiceRecoveryMatrixInputV1,
): Readonly<ServiceRecoveryMatrixReviewV1> {
  if (!input || typeof input !== "object"
      || input.schemaVersion !== 1
      || input.authority !== "service_recovery_matrix_observation_only"
      || input.grantsAuthority !== false
      || !commit.test(input.candidateCommitSha)
      || !Array.isArray(input.platforms)) {
    throw new ServiceRecoveryMatrixError();
  }

  const missing: string[] = [];
  const inconsistent: string[] = [];
  const duplicates: string[] = [];
  const partial: string[] = [];
  const platforms = new Map<ServiceRecoveryManager, ServiceRecoveryPlatformEvidenceV1>();

  for (const platform of input.platforms) {
    if (!platform || typeof platform !== "object"
        || !managers.includes(platform.manager)
        || !name.test(platform.serviceName)
        || !run.test(platform.runId)
        || !digest.test(platform.artifactSha256)
        || !Array.isArray(platform.observations)
        || platforms.has(platform.manager)) {
      throw new ServiceRecoveryMatrixError();
    }
    platforms.set(platform.manager, platform);
  }

  let consistentCaseCount = 0;
  for (const manager of managers) {
    const platform = platforms.get(manager);
    const seen = new Set<ServiceFailureScenario>();
    if (platform) {
      for (const observation of platform.observations) {
        if (!observation || typeof observation !== "object"
            || !SERVICE_RECOVERY_REQUIRED_SCENARIOS.includes(observation.scenario)) {
          inconsistent.push(manager + ":invalid_observation");
          continue;
        }
        const key = manager + ":" + observation.scenario;
        if (seen.has(observation.scenario)) {
          duplicates.push(key);
          continue;
        }
        seen.add(observation.scenario);
        try {
          // Cross-bind platform identity BEFORE interpreting the scenario.
          if (observation.before?.manager !== manager
              || observation.after?.manager !== manager
              || observation.before?.serviceName !== platform.serviceName
              || observation.after?.serviceName !== platform.serviceName) {
            inconsistent.push(key);
            continue;
          }
          const result = assessServiceFailureEvidence(observation);
          const expected = observation.scenario === "partial_uninstall"
            ? "partial_cleanup_requires_review" : "matches_expected_observation";
          if (result.assessment !== expected) {
            inconsistent.push(key);
            continue;
          }
          consistentCaseCount++;
          if (observation.scenario === "partial_uninstall") {
            partial.push(key);
          }
        } catch {
          // Invalid/forged nested assertions are not elevated into proof.
          inconsistent.push(key);
        }
      }
    }
    for (const scenario of SERVICE_RECOVERY_REQUIRED_SCENARIOS) {
      if (!seen.has(scenario)) missing.push(manager + ":" + scenario);
    }
  }

  const observationsConsistent = missing.length === 0
    && inconsistent.length === 0 && duplicates.length === 0;
  return Object.freeze({
    schemaVersion: 1,
    authority: "service_recovery_matrix_review_only",
    assessment: observationsConsistent
      ? "observations_consistent_for_review" : "missing_or_inconsistent_evidence",
    observationsConsistent,
    consistentCaseCount,
    missingCaseKeys: Object.freeze(missing),
    inconsistentCaseKeys: Object.freeze(inconsistent),
    duplicateCaseKeys: Object.freeze(duplicates),
    unresolvedPartialCleanupKeys: Object.freeze(partial),
    evidenceOnly: true,
    physicalAcceptanceProven: false,
    provenanceAuthenticated: false,
    userDataPreservationPhysicallyVerified: false,
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
