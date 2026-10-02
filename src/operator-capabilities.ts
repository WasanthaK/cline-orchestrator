export type OperatorMutationActionV1 =
  | "reject_escalation"
  | "approve_escalation"
  | "abort_task"
  | "rollback_task"
  | "continue_task"
  | "resume_workflow"
  | "recover_scheduled_writer";

export type OperatorReadOnlyCapabilityV1 =
  | "passive_visualization"
  | "task_validation_status"
  | "supervisor_decision_summary"
  | "active_writer_status";

export type OperatorUnavailableCapabilityV1 =
  | "reviewer_completion_authority"
  | "reviewer_repair_execution"
  | "standalone_validation_execution"
  | "generic_process_control"
  | "raw_hub_control"
  | "lease_management"
  | "credential_access"
  | "pause_state_mutation"
  | "shared_runtime_control"
  | "release_authority";

export interface OperatorMutationCapabilityV1 {
  action: OperatorMutationActionV1;
  category: "task" | "escalation" | "workflow" | "worker";
  confirmation: "short_lived_single_use";
  authority: "delegated_to_trusted_service";
  browserExposure: "none" | "local_loopback_rejection_only";
}

export interface OperatorUnavailableCapabilityReasonV1 {
  capability: OperatorUnavailableCapabilityV1;
  reason:
    | "advisory_only"
    | "no_trusted_service_boundary"
    | "generic_machine_authority_prohibited"
    | "separate_milestone_authority";
}

export interface OperatorCapabilityManifestV1 {
  schemaVersion: 1;
  authorityModel: "bounded_task_services_only";
  mutationActions: readonly OperatorMutationCapabilityV1[];
  readOnlyCapabilities: readonly OperatorReadOnlyCapabilityV1[];
  unavailableCapabilities: readonly OperatorUnavailableCapabilityReasonV1[];
}

const mutationActions = [
  {
    action: "reject_escalation",
    category: "escalation",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "local_loopback_rejection_only",
  },
  {
    action: "approve_escalation",
    category: "escalation",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
  {
    action: "abort_task",
    category: "task",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
  {
    action: "rollback_task",
    category: "task",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
  {
    action: "continue_task",
    category: "task",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
  {
    action: "resume_workflow",
    category: "workflow",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
  {
    action: "recover_scheduled_writer",
    category: "worker",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "none",
  },
] as const satisfies readonly OperatorMutationCapabilityV1[];

const readOnlyCapabilities = [
  "passive_visualization",
  "task_validation_status",
  "supervisor_decision_summary",
  "active_writer_status",
] as const satisfies readonly OperatorReadOnlyCapabilityV1[];

const unavailableCapabilities = [
  { capability: "reviewer_completion_authority", reason: "advisory_only" },
  { capability: "reviewer_repair_execution", reason: "advisory_only" },
  { capability: "standalone_validation_execution", reason: "no_trusted_service_boundary" },
  { capability: "generic_process_control", reason: "generic_machine_authority_prohibited" },
  { capability: "raw_hub_control", reason: "generic_machine_authority_prohibited" },
  { capability: "lease_management", reason: "generic_machine_authority_prohibited" },
  { capability: "credential_access", reason: "generic_machine_authority_prohibited" },
  { capability: "pause_state_mutation", reason: "no_trusted_service_boundary" },
  { capability: "shared_runtime_control", reason: "generic_machine_authority_prohibited" },
  { capability: "release_authority", reason: "separate_milestone_authority" },
] as const satisfies readonly OperatorUnavailableCapabilityReasonV1[];

/**
 * Machine-readable Milestone 10 boundary.
 *
 * This is a capability description, not an authority grant. Every mutating action
 * still has to enter through its action-specific short-lived confirmation wrapper
 * and then the independently authority-enforcing service named by that wrapper.
 *
 * Reviewer output and validation evidence remain observable but do not become
 * operator mutation authority. Raw validation execution, Hub/process/lease control,
 * credentials, shared-runtime control and release authority are intentionally not
 * part of the operator plane.
 */
export function getOperatorCapabilityManifest(): OperatorCapabilityManifestV1 {
  return {
    schemaVersion: 1,
    authorityModel: "bounded_task_services_only",
    mutationActions: mutationActions.map((item) => ({ ...item })),
    readOnlyCapabilities: [...readOnlyCapabilities],
    unavailableCapabilities: unavailableCapabilities.map((item) => ({ ...item })),
  };
}
