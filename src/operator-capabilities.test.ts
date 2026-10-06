import assert from "node:assert/strict";
import test from "node:test";
import { getOperatorCapabilityManifest } from "./operator-capabilities.js";

test("operator capability manifest exposes only the bounded Milestone 10 mutation actions", () => {
  const manifest = getOperatorCapabilityManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.authorityModel, "bounded_task_services_only");
  assert.deepEqual(
    manifest.mutationActions.map((item) => item.action),
    [
      "reject_escalation",
      "approve_escalation",
      "abort_task",
      "rollback_task",
      "continue_task",
      "resume_workflow",
      "recover_scheduled_writer",
    ],
  );
  assert.ok(manifest.mutationActions.every(
    (item) => item.confirmation === "short_lived_single_use"
      && item.authority === "delegated_to_trusted_service",
  ));
});

test("only escalation rejection is currently browser-exposed", () => {
  const manifest = getOperatorCapabilityManifest();
  const browserExposed = manifest.mutationActions.filter(
    (item) => item.browserExposure !== "none",
  );

  assert.deepEqual(browserExposed, [{
    action: "reject_escalation",
    category: "escalation",
    confirmation: "short_lived_single_use",
    authority: "delegated_to_trusted_service",
    browserExposure: "local_loopback_rejection_only",
  }]);
});

test("reviewer and validation remain observable without becoming mutation authority", () => {
  const manifest = getOperatorCapabilityManifest();

  assert.ok(manifest.readOnlyCapabilities.includes("task_validation_status"));
  assert.ok(manifest.readOnlyCapabilities.includes("supervisor_decision_summary"));

  const unavailable = new Map(
    manifest.unavailableCapabilities.map((item) => [item.capability, item.reason]),
  );
  assert.equal(unavailable.get("reviewer_completion_authority"), "advisory_only");
  assert.equal(unavailable.get("reviewer_repair_execution"), "advisory_only");
  assert.equal(unavailable.get("standalone_validation_execution"), "no_trusted_service_boundary");
  assert.equal(
    manifest.mutationActions.some((item) => item.action.includes("validation") || item.action.includes("review")),
    false,
  );
});

test("generic machine, runtime and release authority stay outside the operator plane", () => {
  const manifest = getOperatorCapabilityManifest();
  const unavailable = new Map(
    manifest.unavailableCapabilities.map((item) => [item.capability, item.reason]),
  );

  for (const capability of [
    "generic_process_control",
    "raw_hub_control",
    "lease_management",
    "credential_access",
    "shared_runtime_control",
  ] as const) {
    assert.equal(unavailable.get(capability), "generic_machine_authority_prohibited");
  }
  assert.equal(unavailable.get("pause_state_mutation"), "no_trusted_service_boundary");
  assert.equal(unavailable.get("release_authority"), "separate_milestone_authority");
});

test("capability manifest returns detached arrays so callers cannot mutate the canonical contract", () => {
  const first = getOperatorCapabilityManifest();
  const second = getOperatorCapabilityManifest();

  (first.mutationActions as unknown as Array<unknown>).pop();
  (first.readOnlyCapabilities as unknown as Array<unknown>).pop();
  (first.unavailableCapabilities as unknown as Array<unknown>).pop();

  assert.equal(second.mutationActions.length, 7);
  assert.equal(second.readOnlyCapabilities.length, 4);
  assert.equal(second.unavailableCapabilities.length, 10);
});
