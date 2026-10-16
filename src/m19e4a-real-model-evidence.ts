/**
 * M19E4A: evidence gate for an independently operated real llama.cpp task on
 * the installed Windows candidate. The supplied observations are NOT signed
 * attestations, even if every field is positive. No execution or release API.
 */
export const M19E4A_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresActualInstalledWindowsCandidate: true as const,
  localModelIsNotSynthetic: true as const,
  requiresSeparateTaskApproval: true as const,
  requiresIndependentValidationAndDiffSafety: true as const,
  requiresHumanReview: true as const,
  acceptsSubmittedClaimsAsAttestation: false as const,
  conductsRealModelTask: false as const,
  startsModel: false as const,
  startsDaemon: false as const,
  startsTask: false as const,
  changesConfig: false as const,
  installsSoftware: false as const,
  grantsAuthority: false as const,
});

export const M19E4A_GATES = [
  "exact_candidate",
  "installed_runtime",
  "real_local_model",
  "separate_task_consent",
  "safe_disposable_workspace",
  "bounded_completed_task",
  "independent_validation",
  "independent_diff_safety",
  "task_history_drilldown",
  "foreground_shutdown",
  "uninstall_state_retention",
] as const;

export type M19E4AGate = typeof M19E4A_GATES[number];
type EvidenceState = "not_run" | "passed" | "failed";

interface Claim {
  status: EvidenceState;
  evidenceType: "operator_observation" | "artifact_receipt" | "synthetic_test" | "none";
}

export interface M19E4AEvidenceV1 {
  schemaVersion: 1;
  candidate: {
    sourceCommit: string;
    installedManifestCommit: string;
    installerSha256: string;
    provenanceChecked: boolean;
    installedRuntimeChecked: boolean;
    sbomAndInventoryChecked: boolean;
    distribution: "unsigned_windows_foreground_preview";
  };
  environment: {
    actualWindowsInstall: boolean;
    disposableWorkspace: boolean;
    sourceRepositoryUnchanged: boolean;
    serviceManagerUnchanged: boolean;
  };
  model: {
    implementation: "llama.cpp";
    endpointClass: "literal_loopback_http_v1" | "other";
    discoveredAliasMatchesConfigured: boolean;
    nonSyntheticResponseObserved: boolean;
    harmlessPromptAnswered: boolean;
  };
  task: {
    separatelyApproved: boolean;
    authorizationRecorded: boolean;
    actualExecutionObserved: boolean;
    terminalStatus: "completed" | "failed" | "cancelled" | "unknown";
    eventCount: number;
    changedFiles: number;
    changesWithinApprovedScope: boolean;
    boundedValidationPassed: boolean;
    independentDiffSafetyPassed: boolean;
    checkpointObserved: boolean;
    taskHistoryDrilldownObserved: boolean;
  };
  exit: {
    ownedForegroundProcessesStopped: boolean;
    loopbackPortsReleased: boolean;
    noPersistentServiceCreated: boolean;
    ownedBinaryRemoved: boolean;
    configUnchanged: boolean;
    workspaceRegistryUnchanged: boolean;
    secretReferencesUnchanged: boolean;
    taskHistoryPreserved: boolean;
  };
  gateClaims: Partial<Record<M19E4AGate, Claim>>;
  operatorReview: {
    reviewerPresent: boolean;
    exactCandidateCheckedByReviewer: boolean;
    independentEvidenceReviewed: boolean;
    reviewerAccepted: boolean;
  };
}
export interface M19E4AAssessmentV1 {
  schemaVersion: 1;
  kind: "m19e4a_real_model_pilot_evidence_review";
  outcome: "blocked" | "ready_for_independent_human_review";
  gates: readonly { id: M19E4AGate; status: "needs_evidence" | "failed" | "review_only" }[];
  evidenceCanBeForged: true;
  actualPilotExecutedByThisTool: false;
  pilotAutomaticallyAccepted: false;
  releaseAuthorized: false;
  grantsAuthority: false;
}

const sha40 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const sha64 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const bool = (v: unknown): v is true => v === true;
const safeInt = (value: unknown, min: number, max: number): boolean =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

export function inspectM19E4AEvidence(input: unknown): M19E4AAssessmentV1 {
  const evidence = input && typeof input === "object" ? input as Partial<M19E4AEvidenceV1> : {};
  const candidate = evidence.candidate;
  const env = evidence.environment;
  const model = evidence.model;
  const task = evidence.task;
  const exit = evidence.exit;
  const conditions: Record<M19E4AGate, boolean> = {
    exact_candidate: evidence.schemaVersion === 1 &&
      sha40(candidate?.sourceCommit) &&
      candidate?.installedManifestCommit === candidate.sourceCommit &&
      sha64(candidate?.installerSha256) &&
      bool(candidate?.provenanceChecked) &&
      bool(candidate?.sbomAndInventoryChecked) &&
      candidate?.distribution === "unsigned_windows_foreground_preview",
    installed_runtime: bool(candidate?.installedRuntimeChecked) &&
      bool(env?.actualWindowsInstall) && bool(env?.serviceManagerUnchanged),
    real_local_model: model?.implementation === "llama.cpp" &&
      model?.endpointClass === "literal_loopback_http_v1" &&
      bool(model?.discoveredAliasMatchesConfigured) &&
      bool(model?.nonSyntheticResponseObserved) &&
      bool(model?.harmlessPromptAnswered),
    separate_task_consent: bool(task?.separatelyApproved) &&
      bool(task?.authorizationRecorded),
    safe_disposable_workspace: bool(env?.disposableWorkspace) &&
      bool(env?.sourceRepositoryUnchanged) &&
      bool(task?.changesWithinApprovedScope) &&
      safeInt(task?.changedFiles, 0, 100),
    bounded_completed_task: bool(task?.actualExecutionObserved) &&
      task?.terminalStatus === "completed" &&
      safeInt(task?.eventCount, 1, 100_000),
    independent_validation: bool(task?.boundedValidationPassed),
    independent_diff_safety: bool(task?.independentDiffSafetyPassed) &&
      bool(task?.checkpointObserved),
    task_history_drilldown: bool(task?.taskHistoryDrilldownObserved),
    foreground_shutdown: bool(exit?.ownedForegroundProcessesStopped) &&
      bool(exit?.loopbackPortsReleased) &&
      bool(exit?.noPersistentServiceCreated),
    uninstall_state_retention: bool(exit?.ownedBinaryRemoved) &&
      bool(exit?.configUnchanged) &&
      bool(exit?.workspaceRegistryUnchanged) &&
      bool(exit?.secretReferencesUnchanged) &&
      bool(exit?.taskHistoryPreserved),
  };
  const claims = evidence.gateClaims ?? {};
  const gates = M19E4A_GATES.map(id => {
    const claim = claims[id];
    const sourceOK = claim?.status === "passed" &&
      ["artifact_receipt", "operator_observation"].includes(claim.evidenceType);
    const failed = claim?.status === "failed" ||
      (claim?.status === "passed" && !conditions[id]);
    return {
      id,
      status: failed ? "failed" as const
        : conditions[id] && sourceOK ? "review_only" as const
        : "needs_evidence" as const,
    };
  });
  // All positive submitted claims still require an independent human review.
  // A JSON document, test fixture or caller-set reviewer boolean cannot prove
  // that a Windows task actually happened or grant release authority.
  const ready = gates.every(g => g.status === "review_only");
  return Object.freeze({
    schemaVersion: 1,
    kind: "m19e4a_real_model_pilot_evidence_review",
    outcome: ready ? "ready_for_independent_human_review" : "blocked",
    gates,
    evidenceCanBeForged: true,
    actualPilotExecutedByThisTool: false,
    pilotAutomaticallyAccepted: false,
    releaseAuthorized: false,
    grantsAuthority: false,
  });
}
