import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteControlSessionCurrent,
  createRemoteControlSessionClaims,
  REMOTE_CONTROL_CONTRACT,
  RemoteControlContractError,
  type RemoteControlRegistrationV1,
} from "./remote-control-contract.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
};

function registration(overrides: Partial<RemoteControlRegistrationV1> = {}): RemoteControlRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId: IDS.registration,
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    revision: 1,
    createdAt: "2026-09-27T10:00:00.000Z",
    allowedMutationActions: ["abort_task", "continue_task", "resume_workflow"],
    allowedReadOnlyCapabilities: ["passive_visualization", "task_validation_status"],
    ...overrides,
  };
}

const now = new Date("2026-09-27T10:05:00.000Z");

test("remote transport projects only locally registered M10 capabilities and grants no task authority", () => {
  const claims = createRemoteControlSessionClaims(
    registration(),
    {
      mutationActions: ["continue_task", "abort_task"],
      readOnlyCapabilities: ["task_validation_status"],
      ttlMs: 5 * 60 * 1000,
    },
    { now, idFactory: () => IDS.session },
  );

  assert.deepEqual(claims.mutationActions, ["continue_task", "abort_task"]);
  assert.deepEqual(claims.readOnlyCapabilities, ["task_validation_status"]);
  assert.equal(claims.transportAuthority, "authenticated_session_only");
  assert.equal(claims.humanConfirmationAuthority, "none");
  assert.equal(claims.safetyPlanAuthority, "none");
  assert.equal(claims.credentialAuthority, "none");
  assert.equal(claims.releaseAuthority, "none");
  assert.equal(claims.registrationRevision, 1);
  assert.equal(claims.operatorCapabilitySchemaVersion, 1);
  assertRemoteControlSessionCurrent(claims, registration(), new Date("2026-09-27T10:09:00.000Z"));
});

test("remote session cannot request a capability not allowed by the local registration", () => {
  assert.throws(
    () => createRemoteControlSessionClaims(
      registration(),
      {
        mutationActions: ["rollback_task"],
        readOnlyCapabilities: [],
        ttlMs: 60_000,
      },
      { now, idFactory: () => IDS.session },
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "capability_not_allowed",
  );
});

test("remote registration itself cannot smuggle capabilities outside the M10 manifest", () => {
  const invalid = registration({
    allowedMutationActions: ["abort_task", "raw_hub_control" as never],
  });
  assert.throws(
    () => createRemoteControlSessionClaims(
      invalid,
      { mutationActions: ["abort_task"], readOnlyCapabilities: [], ttlMs: 60_000 },
      { now, idFactory: () => IDS.session },
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "registration_invalid",
  );
});

test("remote sessions are short lived and expiry fails closed", () => {
  assert.equal(REMOTE_CONTROL_CONTRACT.maxSessionTtlMs, 15 * 60 * 1000);
  assert.equal(REMOTE_CONTROL_CONTRACT.transportGrantsTaskAuthority, false);
  assert.equal(REMOTE_CONTROL_CONTRACT.transportGrantsHumanConfirmation, false);

  assert.throws(
    () => createRemoteControlSessionClaims(
      registration(),
      { mutationActions: [], readOnlyCapabilities: [], ttlMs: 16 * 60 * 1000 },
      { now, idFactory: () => IDS.session },
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_invalid",
  );

  const claims = createRemoteControlSessionClaims(
    registration(),
    { mutationActions: [], readOnlyCapabilities: [], ttlMs: 60_000 },
    { now, idFactory: () => IDS.session },
  );
  assert.throws(
    () => assertRemoteControlSessionCurrent(claims, registration(), new Date("2026-09-27T10:06:00.000Z")),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_expired",
  );
});

test("revocation or local registration revision change invalidates an existing remote session", () => {
  const claims = createRemoteControlSessionClaims(
    registration(),
    { mutationActions: ["abort_task"], readOnlyCapabilities: [], ttlMs: 10 * 60 * 1000 },
    { now, idFactory: () => IDS.session },
  );

  assert.throws(
    () => assertRemoteControlSessionCurrent(
      claims,
      registration({ revokedAt: "2026-09-27T10:07:00.000Z" }),
      new Date("2026-09-27T10:08:00.000Z"),
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "registration_revoked",
  );

  assert.throws(
    () => assertRemoteControlSessionCurrent(
      claims,
      registration({ revision: 2 }),
      new Date("2026-09-27T10:08:00.000Z"),
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_stale",
  );
});

test("capability reduction invalidates an existing remote session rather than preserving stale authority", () => {
  const claims = createRemoteControlSessionClaims(
    registration(),
    { mutationActions: ["continue_task"], readOnlyCapabilities: ["task_validation_status"], ttlMs: 10 * 60 * 1000 },
    { now, idFactory: () => IDS.session },
  );

  assert.throws(
    () => assertRemoteControlSessionCurrent(
      claims,
      registration({ allowedMutationActions: ["abort_task"] }),
      new Date("2026-09-27T10:08:00.000Z"),
    ),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_stale",
  );
});

test("remote session claims cannot be upgraded into human, Safety Plan, credential or release authority", () => {
  const claims = createRemoteControlSessionClaims(
    registration(),
    { mutationActions: [], readOnlyCapabilities: [], ttlMs: 60_000 },
    { now, idFactory: () => IDS.session },
  );
  const forged = {
    ...claims,
    humanConfirmationAuthority: "remote_client" as never,
  };

  assert.throws(
    () => assertRemoteControlSessionCurrent(forged, registration(), new Date("2026-09-27T10:05:30.000Z")),
    (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_invalid",
  );
});
