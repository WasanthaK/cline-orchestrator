import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDistributedExecutionDispatch,
  DistributedExecutionAdmissionError,
  DistributedExecutionAdmissionGateway,
  FileDistributedDispatchReplayStore,
} from "./distributed-execution-admission.js";
import type {
  DistributedMachineRegistrationV1,
  DistributedWorkspacePlacementV1,
  DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import type { DistributedFenceClaimV1 } from "./distributed-fencing.js";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  machine: "33333333-3333-4333-8333-333333333333",
  registration: "44444444-4444-4444-8444-444444444444",
  placement: "55555555-5555-4555-8555-555555555555",
  assignment: "66666666-6666-4666-8666-666666666666",
  fence: "77777777-7777-4777-8777-777777777777",
  dispatch: "88888888-8888-4888-8888-888888888888",
  otherMachine: "99999999-9999-4999-8999-999999999999",
};

const issuedAt = "2026-09-29T05:00:00.000Z";
const expiresAt = "2026-09-29T05:01:00.000Z";
const now = new Date("2026-09-29T05:00:10.000Z");

function registration(): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: ids.registration,
    machineId: ids.machine,
    revision: 1,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
    authority: "identity_only",
  };
}

function placement(): DistributedWorkspacePlacementV1 {
  return {
    schemaVersion: 1,
    placementId: ids.placement,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    revision: 1,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    authority: "routing_only",
  };
}

function assignment(): DistributedWriterCandidateAssignmentV1 {
  return {
    schemaVersion: 1,
    assignmentId: ids.assignment,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    issuedAt,
    expiresAt,
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function fence(): DistributedFenceClaimV1 {
  return {
    schemaVersion: 1,
    fenceId: ids.fence,
    workspaceId: ids.workspace,
    taskId: ids.task,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
    placementId: ids.placement,
    placementRevision: 1,
    candidateAssignmentId: ids.assignment,
    generation: 3,
    issuedAt,
    expiresAt,
    authority: "fencing_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function makeGateway(directory: string, overrides: {
  targetMachineId?: string;
  registration?: DistributedMachineRegistrationV1;
  placement?: DistributedWorkspacePlacementV1;
  candidateError?: Error;
  fenceError?: Error;
  observedNow?: Date;
} = {}) {
  const currentRegistration = overrides.registration ?? registration();
  const currentPlacement = overrides.placement ?? placement();
  return new DistributedExecutionAdmissionGateway({
    targetIdentity: {
      machineId: overrides.targetMachineId ?? ids.machine,
      machineRegistrationId: ids.registration,
      machineRegistrationRevision: 1,
    },
    registrations: { async get() { return currentRegistration; } },
    placements: { async get() { return currentPlacement; } },
    candidates: {
      async assertCandidateCurrent() {
        if (overrides.candidateError) throw overrides.candidateError;
      },
    },
    fences: {
      async validateCurrent() {
        if (overrides.fenceError) throw overrides.fenceError;
      },
    },
    replayStore: new FileDistributedDispatchReplayStore(directory),
    now: () => overrides.observedNow ?? now,
  });
}

function dispatch() {
  return createDistributedExecutionDispatch(
    { assignment: assignment(), fence: fence(), ttlMs: 20_000 },
    { now: () => now, idFactory: () => ids.dispatch },
  );
}

async function expectCode(promise: Promise<unknown>, code: DistributedExecutionAdmissionError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DistributedExecutionAdmissionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M12G dispatch is opaque authority-free evidence only", () => {
  const value = dispatch();
  assert.equal(value.authority, "execution_request_only");
  assert.equal(value.grantsTaskAuthority, false);
  assert.equal(value.grantsFilesystemAuthority, false);
  assert.equal(value.grantsSafetyPlanAuthority, false);
  assert.equal(value.grantsWriterLeaseAuthority, false);
  assert.equal(value.grantsCredentialAuthority, false);
  assert.equal(value.grantsReleaseAuthority, false);
  assert.deepEqual(Object.keys(value).sort(), [
    "authority",
    "candidateAssignmentId",
    "dispatchId",
    "expiresAt",
    "fenceGeneration",
    "fenceId",
    "grantsCredentialAuthority",
    "grantsFilesystemAuthority",
    "grantsReleaseAuthority",
    "grantsSafetyPlanAuthority",
    "grantsTaskAuthority",
    "grantsWriterLeaseAuthority",
    "issuedAt",
    "machineId",
    "machineRegistrationId",
    "machineRegistrationRevision",
    "placementId",
    "placementRevision",
    "schemaVersion",
    "taskId",
    "workspaceId",
  ].sort());
});

test("M12G admits once only after all exact current bindings validate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12g-replay-"));
  try {
    const gateway = makeGateway(directory);
    const receipt = await gateway.admit(dispatch(), assignment(), fence());
    assert.equal(receipt.dispatchId, ids.dispatch);
    assert.equal(receipt.fenceGeneration, 3);
    assert.equal(receipt.authority, "admission_evidence_only");
    assert.equal(receipt.grantsTaskAuthority, false);
    assert.equal(receipt.grantsFilesystemAuthority, false);

    // A fresh gateway simulates target process restart. Durable replay consumption wins.
    const restarted = makeGateway(directory);
    await expectCode(restarted.admit(dispatch(), assignment(), fence()), "dispatch_replayed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M12G rejects a dispatch for a different target machine before replay consumption", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12g-target-"));
  try {
    await expectCode(makeGateway(directory, { targetMachineId: ids.otherMachine }).admit(
      dispatch(), assignment(), fence(),
    ), "target_mismatch");
    // Since the wrong target did not consume it, the correct target may still admit it.
    const receipt = await makeGateway(directory).admit(dispatch(), assignment(), fence());
    assert.equal(receipt.dispatchId, ids.dispatch);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M12G fails closed on revoked registration and disabled placement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12g-stale-"));
  try {
    const revoked = { ...registration(), revokedAt: "2026-09-29T05:00:05.000Z", updatedAt: "2026-09-29T05:00:05.000Z" };
    await expectCode(makeGateway(directory, { registration: revoked }).admit(
      dispatch(), assignment(), fence(),
    ), "registration_not_current");

    const disabled = { ...placement(), disabledAt: "2026-09-29T05:00:05.000Z", updatedAt: "2026-09-29T05:00:05.000Z" };
    await expectCode(makeGateway(directory, { placement: disabled }).admit(
      dispatch(), assignment(), fence(),
    ), "placement_not_current");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M12G fails closed when candidate or shared fence is stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12g-fence-"));
  try {
    await expectCode(makeGateway(directory, { candidateError: new Error("stale assignment") }).admit(
      dispatch(), assignment(), fence(),
    ), "candidate_not_current");
    await expectCode(makeGateway(directory, { fenceError: new Error("stale generation") }).admit(
      dispatch(), assignment(), fence(),
    ), "fence_not_current");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("M12G rejects expired dispatch and cross-bound evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "m12g-expired-"));
  try {
    await expectCode(makeGateway(directory, {
      observedNow: new Date("2026-09-29T05:00:31.000Z"),
    }).admit(dispatch(), assignment(), fence()), "dispatch_expired");

    const wrongFence = { ...fence(), candidateAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    await expectCode(makeGateway(directory).admit(dispatch(), assignment(), wrongFence), "binding_mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
