import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";
import {
  DistributedFenceAuthority,
  DistributedFenceError,
  ReferenceLinearizableFenceBackend,
} from "./distributed-fencing.js";
import {
  DistributedFenceLifecycle,
  DistributedFenceLifecycleError,
  DISTRIBUTED_FENCE_LIFECYCLE_CONTRACT,
} from "./distributed-fence-lifecycle.js";
import { createDistributedWriterFenceGuard } from "./distributed-write-fence-guard.js";
import type { DistributedWriterFenceGuard } from "./lease-aware-hub-safety-runtime.js";

function assignment(now: Date): DistributedWriterCandidateAssignmentV1 {
  return {
    schemaVersion: 1,
    assignmentId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    machineId: crypto.randomUUID(),
    machineRegistrationId: crypto.randomUUID(),
    machineRegistrationRevision: 1,
    placementId: crypto.randomUUID(),
    placementRevision: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 120_000).toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

async function fixture() {
  let now = new Date("2026-09-29T10:30:00.000Z");
  let candidateCurrent = true;
  const currentAssignment = assignment(now);
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    {
      async assertCandidateCurrent(value, observedNow) {
        assert.equal(value.assignmentId, currentAssignment.assignmentId);
        if (!candidateCurrent || Date.parse(value.expiresAt) <= (observedNow ?? now).getTime()) {
          throw new Error("candidate not current");
        }
      },
    },
    { now: () => new Date(now) },
  );
  const claim = await authority.acquire({ assignment: currentAssignment, ttlMs: 10_000 });
  const guard = createDistributedWriterFenceGuard(authority, claim, currentAssignment);
  return {
    authority,
    assignment: currentAssignment,
    originalClaim: claim,
    guard,
    setNow(value: Date) { now = value; },
    invalidateCandidate() { candidateCurrent = false; },
  };
}

async function settle(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("M12K renewal-aware guard advances exact claim state without changing generation", async () => {
  const value = await fixture();
  value.setNow(new Date("2026-09-29T10:30:05.000Z"));

  const renewed = await value.guard.renew(10_000);
  assert.equal(renewed.fenceId, value.originalClaim.fenceId);
  assert.equal(renewed.generation, value.originalClaim.generation);
  assert.equal(renewed.taskId, value.originalClaim.taskId);
  assert.equal(renewed.workspaceId, value.originalClaim.workspaceId);
  assert.equal(renewed.authority, "fencing_only");
  assert.equal(renewed.grantsTaskAuthority, false);
  assert.equal(renewed.grantsFilesystemAuthority, false);
  assert.equal(renewed.grantsSafetyPlanAuthority, false);
  assert.equal(renewed.grantsWriterLeaseAuthority, false);
  assert.equal(renewed.grantsCredentialAuthority, false);
  assert.equal(renewed.grantsReleaseAuthority, false);
  assert.ok(Date.parse(renewed.expiresAt) > Date.parse(value.originalClaim.expiresAt));
  assert.deepEqual(value.guard.currentClaim(), renewed);
  await value.guard.validateCurrent();

  await assert.rejects(
    () => value.authority.validateCurrent(value.originalClaim, value.assignment),
    (error: unknown) => error instanceof DistributedFenceError && error.code === "fence_stale",
  );
});

test("M12K lifecycle renews through the same guard and remains authority-free", async () => {
  const value = await fixture();
  let scheduled: (() => void) | undefined;
  const lifecycle = new DistributedFenceLifecycle(value.guard, {
    renewTtlMs: 10_000,
    renewIntervalMs: 2_000,
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
  });
  const before = lifecycle.currentClaim();
  lifecycle.start();
  assert.ok(scheduled);

  value.setNow(new Date("2026-09-29T10:30:05.000Z"));
  scheduled!();
  await settle(() => lifecycle.currentClaim().issuedAt !== before.issuedAt);
  const after = lifecycle.currentClaim();
  assert.equal(after.generation, before.generation);
  assert.equal(after.fenceId, before.fenceId);
  assert.equal(lifecycle.signal.aborted, false);
  assert.equal(DISTRIBUTED_FENCE_LIFECYCLE_CONTRACT.renewalGrantsAuthority, false);
  assert.equal(DISTRIBUTED_FENCE_LIFECYCLE_CONTRACT.candidateRenewalIncluded, false);
  await lifecycle.stop();
});

test("M12K lifecycle fails closed when candidate authority disappears", async () => {
  const value = await fixture();
  let scheduled: (() => void) | undefined;
  const lifecycle = new DistributedFenceLifecycle(value.guard, {
    renewTtlMs: 10_000,
    renewIntervalMs: 2_000,
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
  });
  lifecycle.start();
  value.invalidateCandidate();
  value.setNow(new Date("2026-09-29T10:30:05.000Z"));
  scheduled!();

  await settle(() => lifecycle.signal.aborted);
  assert.ok(lifecycle.signal.reason instanceof DistributedFenceLifecycleError);
  assert.equal(lifecycle.signal.reason.code, "renewal_failed");
  await lifecycle.stop();
});

test("M12K refuses a non-renewable generic distributed fence guard", () => {
  const generic: DistributedWriterFenceGuard = {
    taskId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    async validateCurrent() {},
  };
  assert.throws(
    () => new DistributedFenceLifecycle(generic, { renewTtlMs: 10_000, renewIntervalMs: 2_000 }),
    (error: unknown) => error instanceof DistributedFenceLifecycleError
      && error.code === "guard_not_renewable",
  );
});
