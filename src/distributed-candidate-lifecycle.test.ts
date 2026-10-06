import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import {
  DISTRIBUTED_CANDIDATE_LIFECYCLE_CONTRACT,
  DistributedCandidateLifecycle,
  DistributedCandidateLifecycleError,
  DistributedCandidateRenewalAuthority,
} from "./distributed-candidate-lifecycle.js";

function assignment(now: Date): DistributedWriterCandidateAssignmentV1 {
  return {
    schemaVersion: 1,
    assignmentId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    machineId: crypto.randomUUID(),
    machineRegistrationId: crypto.randomUUID(),
    machineRegistrationRevision: 3,
    placementId: crypto.randomUUID(),
    placementRevision: 7,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

async function settle(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("M12M candidate renewal preserves exact identity/bindings and remains coordination-only", async () => {
  let now = new Date("2026-09-29T12:00:00.000Z");
  const original = assignment(now);
  let validations = 0;
  const authority = new DistributedCandidateRenewalAuthority(
    {
      async assertCandidateCurrent(value, observedNow) {
        validations += 1;
        assert.equal(value.assignmentId, original.assignmentId);
        assert.equal(value.taskId, original.taskId);
        assert.equal(value.workspaceId, original.workspaceId);
        assert.equal(value.machineId, original.machineId);
        assert.equal(value.machineRegistrationId, original.machineRegistrationId);
        assert.equal(value.machineRegistrationRevision, original.machineRegistrationRevision);
        assert.equal(value.placementId, original.placementId);
        assert.equal(value.placementRevision, original.placementRevision);
        assert.ok(Date.parse(value.expiresAt) > (observedNow ?? now).getTime());
      },
    },
    { now: () => new Date(now) },
  );

  now = new Date("2026-09-29T12:00:10.000Z");
  const renewed = await authority.renew(original, 60_000);

  assert.equal(validations, 2);
  assert.equal(renewed.assignmentId, original.assignmentId);
  assert.equal(renewed.taskId, original.taskId);
  assert.equal(renewed.workspaceId, original.workspaceId);
  assert.equal(renewed.machineId, original.machineId);
  assert.equal(renewed.machineRegistrationId, original.machineRegistrationId);
  assert.equal(renewed.machineRegistrationRevision, original.machineRegistrationRevision);
  assert.equal(renewed.placementId, original.placementId);
  assert.equal(renewed.placementRevision, original.placementRevision);
  assert.equal(renewed.issuedAt, now.toISOString());
  assert.equal(renewed.expiresAt, new Date(now.getTime() + 60_000).toISOString());
  assert.equal(renewed.authority, "coordination_only");
  assert.equal(renewed.grantsTaskAuthority, false);
  assert.equal(renewed.grantsFilesystemAuthority, false);
  assert.equal(renewed.grantsSafetyPlanAuthority, false);
  assert.equal(renewed.grantsWriterLeaseAuthority, false);
  assert.equal(renewed.grantsCredentialAuthority, false);
  assert.equal(renewed.grantsReleaseAuthority, false);
  assert.equal(DISTRIBUTED_CANDIDATE_LIFECYCLE_CONTRACT.replacementCandidateIncluded, false);
  assert.equal(DISTRIBUTED_CANDIDATE_LIFECYCLE_CONTRACT.renewalGrantsAuthority, false);
});

test("M12M renewal fails closed if current routing/liveness disappears before renewal", async () => {
  let now = new Date("2026-09-29T12:10:00.000Z");
  const original = assignment(now);
  const authority = new DistributedCandidateRenewalAuthority(
    {
      async assertCandidateCurrent() {
        throw new Error("placement disabled");
      },
    },
    { now: () => new Date(now) },
  );

  now = new Date("2026-09-29T12:10:05.000Z");
  await assert.rejects(
    () => authority.renew(original, 30_000),
    (error: unknown) => error instanceof DistributedCandidateLifecycleError
      && error.code === "candidate_not_current",
  );
});

test("M12M renewal catches routing/liveness drift between pre-check and post-check", async () => {
  let now = new Date("2026-09-29T12:20:00.000Z");
  const original = assignment(now);
  let calls = 0;
  const authority = new DistributedCandidateRenewalAuthority(
    {
      async assertCandidateCurrent() {
        calls += 1;
        if (calls === 2) throw new Error("registration revision changed");
      },
    },
    { now: () => new Date(now) },
  );

  now = new Date("2026-09-29T12:20:05.000Z");
  await assert.rejects(
    () => authority.renew(original, 30_000),
    (error: unknown) => error instanceof DistributedCandidateLifecycleError
      && error.code === "candidate_not_current",
  );
  assert.equal(calls, 2);
});

test("M12M lifecycle refreshes the same assignment identity", async () => {
  let now = new Date("2026-09-29T12:30:00.000Z");
  const original = assignment(now);
  const authority = new DistributedCandidateRenewalAuthority(
    { async assertCandidateCurrent() {} },
    { now: () => new Date(now) },
  );
  let scheduled: (() => void) | undefined;
  const lifecycle = new DistributedCandidateLifecycle(original, authority, {
    renewTtlMs: 60_000,
    renewIntervalMs: 5_000,
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
  });

  lifecycle.start();
  assert.ok(scheduled);
  now = new Date("2026-09-29T12:30:05.000Z");
  scheduled!();
  await settle(() => lifecycle.currentAssignment().issuedAt === now.toISOString());

  const current = lifecycle.currentAssignment();
  assert.equal(current.assignmentId, original.assignmentId);
  assert.equal(current.machineRegistrationRevision, original.machineRegistrationRevision);
  assert.equal(current.placementRevision, original.placementRevision);
  assert.equal(lifecycle.signal.aborted, false);
  await lifecycle.stop();
});

test("M12M lifecycle emits fail-closed abort signal when renewal loses routing authority", async () => {
  let now = new Date("2026-09-29T12:40:00.000Z");
  const original = assignment(now);
  let current = true;
  const authority = new DistributedCandidateRenewalAuthority(
    {
      async assertCandidateCurrent() {
        if (!current) throw new Error("liveness lost");
      },
    },
    { now: () => new Date(now) },
  );
  let scheduled: (() => void) | undefined;
  const lifecycle = new DistributedCandidateLifecycle(original, authority, {
    renewTtlMs: 30_000,
    renewIntervalMs: 5_000,
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
  });

  lifecycle.start();
  current = false;
  now = new Date("2026-09-29T12:40:05.000Z");
  scheduled!();
  await settle(() => lifecycle.signal.aborted);

  assert.ok(lifecycle.signal.reason instanceof DistributedCandidateLifecycleError);
  assert.equal(lifecycle.signal.reason.code, "renewal_failed");
  assert.equal(lifecycle.currentAssignment().assignmentId, original.assignmentId);
  await lifecycle.stop();
});
