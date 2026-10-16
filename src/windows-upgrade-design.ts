/**
 * M19E3B — an *offline design model* for a future Windows binary updater.
 * No filesystem operations, process launches, release permissions, secrets,
 * network listeners, Cline tasks, or authority-bearing output.
 *
 * In particular, an unsigned M19E preview is NEVER eligible for an update
 * merely because a caller supplies booleans claiming to have verified it.
 */
export const WINDOWS_UPGRADE_DESIGN_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  kind: "binary_upgrade_dry_run_only" as const,
  windowsUserScopedOnly: true as const,
  acceptsUnsignedCandidates: false as const,
  currentInstallerPermitsInPlaceUpgrade: false as const,
  refusesOperatorDataOverlap: true as const,
  requiresIndependentReleaseReview: true as const,
  simulatesFaultRecovery: true as const,
  executesUpgrade: false as const,
  executesRollback: false as const,
  writesFiles: false as const,
  changesServiceManager: false as const,
  startsModel: false as const,
  startsTask: false as const,
  grantsAuthority: false as const,
});

export type UpgradeBlocker =
  | "invalid_evidence"
  | "unexpected_platform_or_owner"
  | "invalid_or_nonincreasing_version"
  | "source_or_manifest_unverified"
  | "unsigned_or_untrusted_candidate"
  | "release_gate_unapproved"
  | "user_state_not_isolated"
  | "previous_product_snapshot_missing"
  | "foreground_or_task_not_quiescent"
  | "stale_installed_revision"
  | "update_implementation_not_approved";

export interface WindowsUpgradeEvidenceV1 {
  schemaVersion: 1;
  platform: "windows";
  installation: {
    owner: "current_user";
    currentVersion: string;
    sourceCommit: string;
    manifestSha256: string;
    observedManifestSha256: string;
  };
  candidate: {
    version: string;
    sourceCommit: string;
    manifestSha256: string;
    portableArchiveSha256: string;
    inventoryVerified: boolean;
    runtimeSbomVerified: boolean;
    signed: boolean;
    signerTrusted: boolean;
  };
  previousVersion: {
    manifestSha256: string | null;
    immutableSnapshotVerified: boolean;
    productOwnedFilesOnly: boolean;
  };
  protectedUserState: {
    configUnchanged: boolean;
    workspaceRegistryUnchanged: boolean;
    secretReferencesUnchanged: boolean;
    taskHistoryUnchanged: boolean;
    separateFromProductDirectories: boolean;
  };
  foreground: {
    launcherStopped: boolean;
    viewerStopped: boolean;
    activeTaskCount: number | null;
    activeLeaseCount: number | null;
  };
  review: {
    exactCandidateCommit: string | null;
    independentSigningReview: boolean;
    independentReleaseApproval: boolean;
    explicitOperatorConsent: boolean;
  };
}

export interface WindowsUpgradeDryRunV1 {
  schemaVersion: 1;
  kind: "windows_binary_upgrade_dry_run";
  result: "blocked" | "requires_independent_implementation_review";
  blockers: UpgradeBlocker[];
  reviewSteps: readonly [
    "verify_current_and_candidate",
    "quiesce_foreground_and_writer",
    "stage_candidate_without_user_state",
    "snapshot_owned_previous_version",
    "review_exact_candidate_and_consent",
    "atomic_switch_and_health_check",
    "commit_or_restore_owned_previous_version",
  ];
  userOwnedStateMustRemainUnchanged: true;
  rollbackAvailable: false;
  upgradeAvailable: false;
  releaseAuthorized: false;
  grantsAuthority: false;
}

const sha = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const gitSha = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{40}$/.test(s);

function increasing(from: unknown, to: unknown): boolean {
  if (typeof from !== "string" || typeof to !== "string" ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(from) ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(to)) return false;
  const current = from.split(".").map(Number);
  const target = to.split(".").map(Number);
  if (![...current, ...target].every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) {
    if (target[i]! > current[i]!) return true;
    if (target[i]! < current[i]!) return false;
  }
  return false;
}

/** Pure dry-run assessment, not a cryptographic verification implementation. */
export function assessWindowsUpgrade(evidence: WindowsUpgradeEvidenceV1): WindowsUpgradeDryRunV1 {
  const issues = new Set<UpgradeBlocker>();
  if (!evidence || typeof evidence !== "object" || evidence.schemaVersion !== 1 ||
    !evidence.installation || !evidence.candidate || !evidence.previousVersion ||
    !evidence.protectedUserState || !evidence.foreground || !evidence.review)
    issues.add("invalid_evidence");
  else {
    const { installation: old, candidate: next, previousVersion: previous,
      protectedUserState: data, foreground: f, review } = evidence;
    if (evidence.platform !== "windows" || old.owner !== "current_user")
      issues.add("unexpected_platform_or_owner");
    if (!increasing(old.currentVersion, next.version))
      issues.add("invalid_or_nonincreasing_version");
    if (!gitSha(old.sourceCommit) || !gitSha(next.sourceCommit) ||
      !sha(old.manifestSha256) || !sha(next.manifestSha256) ||
      !sha(next.portableArchiveSha256) || !next.inventoryVerified ||
      !next.runtimeSbomVerified) issues.add("source_or_manifest_unverified");
    if (old.observedManifestSha256 !== old.manifestSha256 ||
      review.exactCandidateCommit !== next.sourceCommit)
      issues.add("stale_installed_revision");
    if (next.signed !== true || next.signerTrusted !== true ||
      review.independentSigningReview !== true)
      issues.add("unsigned_or_untrusted_candidate");
    if (review.independentReleaseApproval !== true ||
      review.explicitOperatorConsent !== true)
      issues.add("release_gate_unapproved");
    if (![data.configUnchanged, data.workspaceRegistryUnchanged,
      data.secretReferencesUnchanged, data.taskHistoryUnchanged,
      data.separateFromProductDirectories].every(x => x === true))
      issues.add("user_state_not_isolated");
    if (!sha(previous.manifestSha256) ||
      previous.manifestSha256 !== old.manifestSha256 ||
      previous.immutableSnapshotVerified !== true ||
      previous.productOwnedFilesOnly !== true)
      issues.add("previous_product_snapshot_missing");
    if (f.launcherStopped !== true || f.viewerStopped !== true ||
      f.activeTaskCount !== 0 || f.activeLeaseCount !== 0)
      issues.add("foreground_or_task_not_quiescent");
  }
  // The current installer has no transactional swap path or approved rollback
  // authority. Even a complete externally asserted evidence set is *only*
  // a design-review candidate, never an executable upgrade.
  issues.add("update_implementation_not_approved");
  const blockers = [...issues].sort();
  return Object.freeze({
    schemaVersion: 1,
    kind: "windows_binary_upgrade_dry_run",
    result: blockers.length === 1 && blockers[0] === "update_implementation_not_approved"
      ? "requires_independent_implementation_review" : "blocked",
    blockers,
    reviewSteps: [
      "verify_current_and_candidate",
      "quiesce_foreground_and_writer",
      "stage_candidate_without_user_state",
      "snapshot_owned_previous_version",
      "review_exact_candidate_and_consent",
      "atomic_switch_and_health_check",
      "commit_or_restore_owned_previous_version",
    ] as const,
    userOwnedStateMustRemainUnchanged: true,
    rollbackAvailable: false,
    upgradeAvailable: false,
    releaseAuthorized: false,
    grantsAuthority: false,
  });
}

export type SimulatedUpgradePhase =
  | "observed" | "staged" | "previous_preserved" | "candidate_verified"
  | "switch_simulated" | "health_verified" | "committed"
  | "discard_stage" | "rollback_planned" | "manual_recovery_required";

export type SimulatedUpgradeEvent =
  | "stage" | "preserve_previous" | "verify_candidate" | "switch"
  | "verify_health" | "commit" | "fault";

/**
 * In-memory fault rehearsal only. A step name conveys absolutely no evidence
 * that an OS filesystem step happened.
 */
export function simulateUpgradeTransition(
  phase: SimulatedUpgradePhase,
  event: SimulatedUpgradeEvent,
  immutablePreviousSnapshot: boolean,
): SimulatedUpgradePhase {
  if (event === "fault") {
    if (["switch_simulated", "health_verified", "rollback_planned"].includes(phase))
      return immutablePreviousSnapshot ? "rollback_planned" : "manual_recovery_required";
    if (phase === "committed") return "manual_recovery_required";
    if (phase === "manual_recovery_required") return phase;
    return "discard_stage";
  }
  const transitions: Record<string, [SimulatedUpgradeEvent, SimulatedUpgradePhase]> = {
    observed: ["stage", "staged"],
    staged: ["preserve_previous", "previous_preserved"],
    previous_preserved: ["verify_candidate", "candidate_verified"],
    candidate_verified: ["switch", "switch_simulated"],
    switch_simulated: ["verify_health", "health_verified"],
    health_verified: ["commit", "committed"],
  };
  const matched = transitions[phase];
  if (!matched || matched[0] !== event ||
      (event === "switch" && !immutablePreviousSnapshot))
    throw new Error("Unsupported or unsafe upgrade dry-run transition");
  return matched[1];
}
