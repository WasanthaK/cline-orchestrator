import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistributedMachineRegistration,
  assertDistributedPlacementCurrent,
  assertDistributedWorkspacePlacement,
  assertDistributedWriterCandidateAssignment,
  assertDistributedWriterCandidateCurrent,
  createDistributedWriterCandidateAssignment,
  DISTRIBUTED_CONTROL_CONTRACT,
  DistributedControlContractError,
  type DistributedMachineRegistrationV1,
  type DistributedWorkspacePlacementV1,
} from "./distributed-control-contract.js";

const IDs = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  placement: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  task: "55555555-5555-4555-8555-555555555555",
  assignment: "66666666-6666-4666-8666-666666666666",
};
const now = new Date("2026-09-28T07:00:00.000Z");

function registration(overrides: Partial<DistributedMachineRegistrationV1> = {}): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: IDs.registration,
    machineId: IDs.machine,
    revision: 1,
    createdAt: "2026-09-28T06:00:00.000Z",
    updatedAt: "2026-09-28T06:00:00.000Z",
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
    authority: "identity_only",
    ...overrides,
  };
}

function placement(overrides: Partial<DistributedWorkspacePlacementV1> = {}): DistributedWorkspacePlacementV1 {
  return {
    schemaVersion: 1,
    placementId: IDs.placement,
    workspaceId: IDs.workspace,
    machineId: IDs.machine,
    machineRegistrationId: IDs.registration,
    machineRegistrationRevision: 1,
    revision: 1,
    createdAt: "2026-09-28T06:10:00.000Z",
    updatedAt: "2026-09-28T06:10:00.000Z",
    authority: "routing_only",
    ...overrides,
  };
}

function assignment() {
  return createDistributedWriterCandidateAssignment(
    registration(),
    placement(),
    { taskId: IDs.task, workspaceId: IDs.workspace, ttlMs: 60_000 },
    { now: () => now, idFactory: () => IDs.assignment },
  );
}

test("M12A distributed artifacts are coordination-only and writes remain disabled", () => {
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.globalWriteExecutionEnabled, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.machineRegistrationGrantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.workspacePlacementGrantsFilesystemAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.dispatchGrantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.dispatchGrantsSafetyPlanAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.dispatchGrantsWriterLeaseAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.dispatchGrantsCredentialAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.dispatchGrantsReleaseAuthority, false);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.requiresDistributedFencingBeforeWrites, true);
  assert.equal(DISTRIBUTED_CONTROL_CONTRACT.requiresLocalWriterLeaseBeforeWrites, true);
});

test("machine registration and workspace placement contain identity/routing evidence only", () => {
  assert.doesNotThrow(() => assertDistributedMachineRegistration(registration()));
  assert.doesNotThrow(() => assertDistributedWorkspacePlacement(placement()));
  assert.doesNotThrow(() => assertDistributedPlacementCurrent(placement(), registration()));

  assert.throws(
    () => assertDistributedMachineRegistration({ ...registration(), canonicalRoot: "C:\\secret\\workspace" }),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "registration_invalid",
  );
  assert.throws(
    () => assertDistributedWorkspacePlacement({ ...placement(), endpoint: "https://machine.example.invalid" }),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "placement_invalid",
  );
});

test("candidate assignment is short-lived, exact-binding coordination evidence", () => {
  const value = assignment();
  assert.equal(value.assignmentId, IDs.assignment);
  assert.equal(value.machineRegistrationRevision, 1);
  assert.equal(value.placementRevision, 1);
  assert.equal(value.authority, "coordination_only");
  assert.equal(value.grantsTaskAuthority, false);
  assert.equal(value.grantsFilesystemAuthority, false);
  assert.equal(value.grantsSafetyPlanAuthority, false);
  assert.equal(value.grantsWriterLeaseAuthority, false);
  assert.doesNotThrow(() => assertDistributedWriterCandidateCurrent(
    value,
    registration(),
    placement(),
    new Date("2026-09-28T07:00:30.000Z"),
  ));
});

test("machine capability is explicit and unsupported capabilities fail closed", () => {
  assert.throws(
    () => createDistributedWriterCandidateAssignment(
      registration({ allowedCapabilities: ["report_status"] }),
      placement(),
      { taskId: IDs.task, workspaceId: IDs.workspace, ttlMs: 60_000 },
      { now: () => now, idFactory: () => IDs.assignment },
    ),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "capability_not_allowed",
  );
  assert.throws(
    () => assertDistributedMachineRegistration({
      ...registration(),
      allowedCapabilities: ["accept_writer_candidates", "raw_shell"],
    }),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "registration_invalid",
  );
});

test("registration or placement changes invalidate stale routing and assignments", () => {
  const value = assignment();
  assert.throws(
    () => assertDistributedPlacementCurrent(
      placement(),
      registration({ revision: 2, updatedAt: "2026-09-28T06:30:00.000Z" }),
    ),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "placement_stale",
  );
  assert.throws(
    () => assertDistributedWriterCandidateCurrent(
      value,
      registration(),
      placement({ revision: 2, updatedAt: "2026-09-28T07:00:05.000Z" }),
      new Date("2026-09-28T07:00:20.000Z"),
    ),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "assignment_stale",
  );
  assert.throws(
    () => assertDistributedWriterCandidateCurrent(
      value,
      registration({ revokedAt: "2026-09-28T07:00:10.000Z" }),
      placement(),
      new Date("2026-09-28T07:00:20.000Z"),
    ),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "registration_revoked",
  );
});

test("assignment expiry and forged authority fail closed", () => {
  const short = createDistributedWriterCandidateAssignment(
    registration(),
    placement(),
    { taskId: IDs.task, workspaceId: IDs.workspace, ttlMs: 1_000 },
    { now: () => now, idFactory: () => IDs.assignment },
  );
  assert.throws(
    () => assertDistributedWriterCandidateCurrent(short, registration(), placement(), new Date("2026-09-28T07:00:01.000Z")),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "assignment_expired",
  );
  assert.throws(
    () => assertDistributedWriterCandidateAssignment({ ...assignment(), grantsTaskAuthority: true }),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "assignment_invalid",
  );
  assert.throws(
    () => assertDistributedWriterCandidateAssignment({ ...assignment(), command: "npm test" }),
    (error: unknown) => error instanceof DistributedControlContractError && error.code === "assignment_invalid",
  );
});
