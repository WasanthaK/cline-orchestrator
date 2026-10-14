/**
 * M18D4d4 — independent, non-executing reconciliation of claimed cleanup.
 *
 * No filesystem access, OS probes, service-manager actions, cryptographic
 * attestation or release authority. Every input is an untrusted self-report;
 * even a consistent report cannot establish physical acceptance.
 */
import { planUninstall, type InstallManifestV1, type InstallOwnership } from "./installer-packaging.js";
import {
  reviewServiceRecoveryMatrix,
  type ServiceRecoveryManager, type ServiceRecoveryMatrixInputV1,
} from "./service-recovery-matrix-review.js";
import type { ServiceFailureSnapshotV1 } from "./service-failure-evidence.js";

export interface PreservedUserEntryV1 {
  readonly path: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly existedBefore: true;
  readonly existsAfter: true;
}
export interface ServiceCleanupObservationV1 {
  readonly schemaVersion: 1;
  readonly authority: "service_cleanup_observation_only";
  readonly grantsAuthority: false;
  readonly manager: ServiceRecoveryManager;
  readonly serviceName: string;
  readonly runId: string;
  readonly artifactSha256: string;
  /** Untrusted manifest; validated by the existing install ownership planner. */
  readonly manifest: InstallManifestV1;
  /** Exhaustive list of product paths reported removed after cleanup. */
  readonly removedProductPaths: readonly string[];
  /** Exhaustive list of owned service registrations reported absent. */
  readonly removedServiceRegistrations: readonly string[];
  readonly preservedUserEntries: readonly PreservedUserEntryV1[];
  readonly inventoryComplete: boolean;
  readonly partialUninstallRemediation: "cleanup_completed" | "rollback_completed" | "unresolved";
  readonly finalState: ServiceFailureSnapshotV1;
}
export interface ServiceRecoveryCloseoutInputV1 {
  readonly schemaVersion: 1;
  readonly authority: "service_recovery_closeout_observation_only";
  readonly grantsAuthority: false;
  readonly matrix: ServiceRecoveryMatrixInputV1;
  readonly cleanups: readonly ServiceCleanupObservationV1[];
}
export interface ServiceRecoveryCloseoutReviewV1 {
  readonly schemaVersion: 1;
  readonly authority: "service_recovery_closeout_review_only";
  readonly assessment: "observations_consistent_for_independent_review" | "blocked_on_observations";
  readonly observationsConsistent: boolean;
  readonly blockers: readonly string[];
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
export class ServiceRecoveryCloseoutError extends Error {
  constructor() {
    super("service recovery closeout identity or authority is invalid");
    this.name = "ServiceRecoveryCloseoutError";
  }
}
const managers = ["systemd", "windows-service"] as const;
const digest = /^[a-f0-9]{64}$/i;
const owned: readonly InstallOwnership[] = [
  "user_owned_config", "user_owned_workspace_registry", "user_owned_secrets", "user_owned_task_state",
];
function key(value: string, manager: ServiceRecoveryManager): string {
  // For comparison only: the underlying planner validates real manifest path semantics.
  const standard = value.replace(/\\/g, "/");
  return manager === "windows-service" ? standard.toLowerCase() : standard;
}
function coversExactly(expected: readonly string[], actual: readonly string[], manager: ServiceRecoveryManager): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  if (actual.some(v => typeof v !== "string")) return false;
  const names = actual.map(v => key(v, manager));
  return new Set(names).size === expected.length &&
    expected.every(v => names.includes(key(v, manager)));
}
function finalStateIsRemoved(s: ServiceFailureSnapshotV1, manager: ServiceRecoveryManager, serviceName: string): boolean {
  return s !== null && typeof s === "object" && s.manager === manager && s.serviceName === serviceName
    && s.registration === "absent" && s.artifact === "absent"
    && s.process === "stopped" && s.loopbackHealth === "unhealthy";
}

/** Cross-checks reported identity, manifest ownership and cleanup observations.
 * No observation can unlock installer, workspace, service or release authority. */
export function reviewServiceRecoveryCloseout(
  input: ServiceRecoveryCloseoutInputV1,
): Readonly<ServiceRecoveryCloseoutReviewV1> {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1
    || input.authority !== "service_recovery_closeout_observation_only"
    || input.grantsAuthority !== false || !Array.isArray(input.cleanups)) {
    throw new ServiceRecoveryCloseoutError();
  }
  const matrix = reviewServiceRecoveryMatrix(input.matrix);
  const blockers: string[] = [];
  if (!matrix.observationsConsistent) blockers.push("recovery_matrix_incomplete_or_inconsistent");

  const observed = new Map<ServiceRecoveryManager, ServiceCleanupObservationV1>();
  for (const item of input.cleanups) {
    if (!item || typeof item !== "object" || item.schemaVersion !== 1
      || item.authority !== "service_cleanup_observation_only" || item.grantsAuthority !== false
      || !managers.includes(item.manager) || observed.has(item.manager)) {
      throw new ServiceRecoveryCloseoutError();
    }
    observed.set(item.manager, item);
  }
  for (const manager of managers) {
    const cleanup = observed.get(manager);
    if (!cleanup) {
      blockers.push(manager + ":cleanup_observation_missing");
      continue;
    }
    const platform = input.matrix.platforms.find(p => p.manager === manager);
    if (!platform || cleanup.serviceName !== platform.serviceName
      || cleanup.runId !== platform.runId
      || typeof cleanup.artifactSha256 !== "string"
      || cleanup.artifactSha256.toLowerCase() !== platform.artifactSha256.toLowerCase()) {
      blockers.push(manager + ":identity_or_candidate_mismatch");
      continue;
    }

    let plan;
    try {
      if (!cleanup.manifest || cleanup.manifest.platform !== (manager === "systemd" ? "linux" : "windows")) {
        throw new ServiceRecoveryCloseoutError();
      }
      plan = planUninstall(cleanup.manifest);
    } catch {
      blockers.push(manager + ":ownership_manifest_invalid");
      continue;
    }
    if (plan.productOwnedPaths.length === 0
      || plan.serviceRegistrations.length !== 1
      || key(plan.serviceRegistrations[0],manager) !== key(cleanup.serviceName,manager)) {
      blockers.push(manager + ":owned_artifacts_or_service_not_identified");
    }

    if (!coversExactly(plan.productOwnedPaths,cleanup.removedProductPaths,manager)
      || !coversExactly(plan.serviceRegistrations,cleanup.removedServiceRegistrations,manager)) {
      blockers.push(manager + ":product_cleanup_incomplete_or_unscoped");
    }

    const expectedUsers = cleanup.manifest.entries.filter(e => e.ownership !== "product_owned" && e.kind !== "service_registration");
    const coveredKinds = new Set(expectedUsers.map(e => e.ownership));
    if (owned.some(kind => !coveredKinds.has(kind))
      || !Array.isArray(cleanup.preservedUserEntries)
      || !coversExactly(plan.preservedUserOwnedPaths,cleanup.preservedUserEntries.map(e=>e?.path),manager)
      || cleanup.inventoryComplete !== true) {
      blockers.push(manager + ":operator_inventory_incomplete");
    } else if (cleanup.preservedUserEntries.some(e =>
      !e || !digest.test(e.beforeSha256) || !digest.test(e.afterSha256)
      || e.beforeSha256.toLowerCase() !== e.afterSha256.toLowerCase()
      || e.existedBefore !== true || e.existsAfter !== true)) {
      blockers.push(manager + ":operator_data_changed_or_missing");
    }

    if (!finalStateIsRemoved(cleanup.finalState,manager,cleanup.serviceName)) {
      blockers.push(manager + ":cleanup_terminal_state_not_confirmed");
    }
    if (cleanup.partialUninstallRemediation !== "cleanup_completed"
      && cleanup.partialUninstallRemediation !== "rollback_completed") {
      blockers.push(manager + ":partial_uninstall_remediation_unresolved");
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    authority: "service_recovery_closeout_review_only",
    assessment: blockers.length === 0
      ? "observations_consistent_for_independent_review" : "blocked_on_observations",
    observationsConsistent: blockers.length === 0,
    blockers: Object.freeze(blockers),
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
