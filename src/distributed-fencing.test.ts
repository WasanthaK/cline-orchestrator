import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRIBUTED_FENCING_CONTRACT,
  DistributedFenceAuthority,
  DistributedFenceError,
  ReferenceLinearizableFenceBackend,
  assertDistributedFenceClaim,
  type DistributedFenceBackend,
  type DistributedFenceStateV1,
} from "./distributed-fencing.js";
import type { DistributedWriterCandidateAssignmentV1 } from "./distributed-control-contract.js";

const IDS = {
  taskA: "11111111-1111-4111-8111-111111111111",
  taskB: "12111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  machineA: "33333333-3333-4333-8333-333333333333",
  machineB: "34333333-3333-4333-8333-333333333333",
  registrationA: "44444444-4444-4444-8444-444444444444",
  registrationB: "45444444-4444-4444-8444-444444444444",
  placementA: "55555555-5555-4555-8555-555555555555",
  placementB: "56555555-5555-4555-8555-555555555555",
  assignmentA: "66666666-6666-4666-8666-666666666666",
  assignmentB: "67666666-6666-4666-8666-666666666666",
  fenceA: "77777777-7777-4777-8777-777777777777",
  fenceB: "78777777-7777-4777-8777-777777777777",
  fenceC: "79777777-7777-4777-8777-777777777777",
};

function assignment(
  nowMs: number,
  which: "A" | "B" = "A",
  ttlMs = 120_000,
): DistributedWriterCandidateAssignmentV1 {
  const b = which === "B";
  return {
    schemaVersion: 1,
    assignmentId: b ? IDS.assignmentB : IDS.assignmentA,
    taskId: b ? IDS.taskB : IDS.taskA,
    workspaceId: IDS.workspace,
    machineId: b ? IDS.machineB : IDS.machineA,
    machineRegistrationId: b ? IDS.registrationB : IDS.registrationA,
    machineRegistrationRevision: 1,
    placementId: b ? IDS.placementB : IDS.placementA,
    placementRevision: 1,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    authority: "coordination_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

class CandidateValidator {
  current = new Map<string, boolean>();

  constructor(...assignments: DistributedWriterCandidateAssignmentV1[]) {
    for (const item of assignments) this.current.set(item.assignmentId, true);
  }

  async assertCandidateCurrent(
    item: DistributedWriterCandidateAssignmentV1,
    now = new Date(),
  ): Promise<void> {
    if (!this.current.get(item.assignmentId)) throw new Error("candidate stale");
    if (Date.parse(item.expiresAt) <= now.getTime()) throw new Error("candidate expired");
  }
}

function errorCode(code: DistributedFenceError["code"]) {
  return (error: unknown) => error instanceof DistributedFenceError && error.code === code;
}

test("M12E contract requires linearizable durable monotonic fencing while write execution remains disabled", () => {
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.requiresLinearizableCompareExchange, true);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.requiresDurableMonotonicGeneration, true);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.requiresTargetWriteBoundaryRevalidation, true);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.composesWithLocalWriterLease, true);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.replacesLocalWriterLease, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.referenceBackendSingleProcessOnly, true);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.productionDistributedBackendConfigured, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.distributedWriteDispatchEnabled, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.distributedWriteExecutionEnabled, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.grantsTaskAuthority, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.grantsWriterLeaseAuthority, false);
  assert.equal(DISTRIBUTED_FENCING_CONTRACT.grantsReleaseAuthority, false);
});

test("one live generation prevents a second machine from acquiring the same workspace", async () => {
  let nowMs = Date.parse("2026-09-29T05:00:00.000Z");
  const a = assignment(nowMs, "A");
  const b = assignment(nowMs, "B");
  const candidates = new CandidateValidator(a, b);
  const backend = new ReferenceLinearizableFenceBackend();
  let nextId = IDS.fenceA;
  const authority = new DistributedFenceAuthority(backend, candidates, {
    now: () => new Date(nowMs),
    idFactory: () => nextId,
  });

  const first = await authority.acquire({ assignment: a, ttlMs: 30_000 });
  assert.equal(first.generation, 1);
  assert.equal(first.machineId, IDS.machineA);
  assert.equal(first.authority, "fencing_only");
  await assert.rejects(
    authority.acquire({ assignment: b, ttlMs: 30_000 }),
    errorCode("fence_conflict"),
  );
});

test("expired holder can be replaced only by a strictly newer generation and old machine cannot rejoin", async () => {
  let nowMs = Date.parse("2026-09-29T05:10:00.000Z");
  const a = assignment(nowMs, "A");
  const b = assignment(nowMs, "B");
  const candidates = new CandidateValidator(a, b);
  const backend = new ReferenceLinearizableFenceBackend();
  let nextId = IDS.fenceA;
  const authority = new DistributedFenceAuthority(backend, candidates, {
    now: () => new Date(nowMs),
    idFactory: () => nextId,
  });

  const first = await authority.acquire({ assignment: a, ttlMs: 5_000 });
  nowMs += 5_001;
  nextId = IDS.fenceB;
  const second = await authority.acquire({ assignment: b, ttlMs: 30_000 });
  assert.equal(second.generation, 2);
  assert.equal(second.machineId, IDS.machineB);

  await assert.rejects(
    authority.validateCurrent(first, a),
    (error: unknown) => error instanceof DistributedFenceError
      && (error.code === "fence_expired" || error.code === "fence_stale"),
  );
  await assert.rejects(
    authority.renew(first, a, 30_000),
    (error: unknown) => error instanceof DistributedFenceError
      && (error.code === "fence_expired" || error.code === "fence_stale"),
  );
  await authority.validateCurrent(second, b);
});

test("revocation preserves generation history and next acquisition advances rather than resetting", async () => {
  let nowMs = Date.parse("2026-09-29T05:20:00.000Z");
  const a = assignment(nowMs, "A");
  const b = assignment(nowMs, "B");
  const candidates = new CandidateValidator(a, b);
  const backend = new ReferenceLinearizableFenceBackend();
  let nextId = IDS.fenceA;
  const authority = new DistributedFenceAuthority(backend, candidates, {
    now: () => new Date(nowMs),
    idFactory: () => nextId,
  });

  const first = await authority.acquire({ assignment: a, ttlMs: 30_000 });
  await authority.revoke(first);
  nextId = IDS.fenceB;
  const second = await authority.acquire({ assignment: b, ttlMs: 30_000 });
  assert.equal(second.generation, 2);
  await assert.rejects(authority.validateCurrent(first, a), errorCode("fence_stale"));
});

test("candidate or placement invalidation immediately makes the distributed fence unusable", async () => {
  const nowMs = Date.parse("2026-09-29T05:30:00.000Z");
  const a = assignment(nowMs, "A");
  const candidates = new CandidateValidator(a);
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    candidates,
    { now: () => new Date(nowMs), idFactory: () => IDS.fenceA },
  );
  const claim = await authority.acquire({ assignment: a, ttlMs: 30_000 });
  candidates.current.set(a.assignmentId, false);
  await assert.rejects(
    authority.validateCurrent(claim, a),
    errorCode("candidate_not_current"),
  );
});

test("renewal keeps the same generation but makes the previous exact claim stale", async () => {
  let nowMs = Date.parse("2026-09-29T05:40:00.000Z");
  const a = assignment(nowMs, "A");
  const candidates = new CandidateValidator(a);
  const backend = new ReferenceLinearizableFenceBackend();
  const authority = new DistributedFenceAuthority(backend, candidates, {
    now: () => new Date(nowMs),
    idFactory: () => IDS.fenceA,
  });
  const first = await authority.acquire({ assignment: a, ttlMs: 10_000 });
  nowMs += 1_000;
  const renewed = await authority.renew(first, a, 20_000);
  assert.equal(renewed.generation, first.generation);
  assert.equal(renewed.fenceId, first.fenceId);
  assert.notEqual(renewed.expiresAt, first.expiresAt);
  await assert.rejects(authority.validateCurrent(first, a), errorCode("fence_stale"));
  await authority.validateCurrent(renewed, a);
});

test("fence claim carries no path, command, credential, local lease or release authority", async () => {
  const nowMs = Date.parse("2026-09-29T05:50:00.000Z");
  const a = assignment(nowMs, "A");
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    new CandidateValidator(a),
    { now: () => new Date(nowMs), idFactory: () => IDS.fenceA },
  );
  const claim = await authority.acquire({ assignment: a, ttlMs: 30_000 });
  assertDistributedFenceClaim(claim);
  const serialized = JSON.stringify(claim);
  for (const forbidden of [
    "workspacePath",
    "canonicalRoot",
    "command",
    "safetyPlan",
    "credential",
    "hubToken",
    "localWriterLease",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(claim.grantsTaskAuthority, false);
  assert.equal(claim.grantsFilesystemAuthority, false);
  assert.equal(claim.grantsWriterLeaseAuthority, false);
  assert.equal(claim.grantsReleaseAuthority, false);
});

test("request widening cannot smuggle unsupported authority into fence acquisition", async () => {
  const nowMs = Date.parse("2026-09-29T06:00:00.000Z");
  const a = assignment(nowMs, "A");
  const authority = new DistributedFenceAuthority(
    new ReferenceLinearizableFenceBackend(),
    new CandidateValidator(a),
    { now: () => new Date(nowMs), idFactory: () => IDS.fenceA },
  );
  await assert.rejects(
    authority.acquire({
      assignment: a,
      ttlMs: 30_000,
      command: "npm test",
    } as unknown as { assignment: DistributedWriterCandidateAssignmentV1; ttlMs: number }),
    errorCode("request_invalid"),
  );
});

test("corrupt or reset backend state fails closed instead of resurrecting an earlier generation", async () => {
  const nowMs = Date.parse("2026-09-29T06:10:00.000Z");
  const a = assignment(nowMs, "A");
  const corrupt: DistributedFenceBackend = {
    async read() {
      return {
        schemaVersion: 1,
        workspaceId: IDS.workspace,
        revision: 4,
        generation: 3,
        activeFence: {
          schemaVersion: 1,
          fenceId: IDS.fenceA,
          workspaceId: IDS.workspace,
          taskId: IDS.taskA,
          machineId: IDS.machineA,
          machineRegistrationId: IDS.registrationA,
          machineRegistrationRevision: 1,
          placementId: IDS.placementA,
          placementRevision: 1,
          candidateAssignmentId: IDS.assignmentA,
          generation: 2,
          issuedAt: new Date(nowMs).toISOString(),
          expiresAt: new Date(nowMs + 30_000).toISOString(),
          authority: "fencing_only",
          grantsTaskAuthority: false,
          grantsFilesystemAuthority: false,
          grantsSafetyPlanAuthority: false,
          grantsWriterLeaseAuthority: false,
          grantsCredentialAuthority: false,
          grantsReleaseAuthority: false,
        },
        authority: "fencing_state_only",
      } satisfies DistributedFenceStateV1;
    },
    async compareExchange() { return true; },
  };
  const authority = new DistributedFenceAuthority(
    corrupt,
    new CandidateValidator(a),
    { now: () => new Date(nowMs), idFactory: () => IDS.fenceB },
  );
  await assert.rejects(
    authority.acquire({ assignment: a, ttlMs: 30_000 }),
    errorCode("backend_invalid"),
  );
});

test("CAS contention is bounded and cannot silently issue two fencing claims", async () => {
  const nowMs = Date.parse("2026-09-29T06:20:00.000Z");
  const a = assignment(nowMs, "A");
  const backend: DistributedFenceBackend = {
    async read() { return undefined; },
    async compareExchange() { return false; },
  };
  const authority = new DistributedFenceAuthority(
    backend,
    new CandidateValidator(a),
    {
      now: () => new Date(nowMs),
      idFactory: () => IDS.fenceC,
      maxCasAttempts: 2,
    },
  );
  await assert.rejects(
    authority.acquire({ assignment: a, ttlMs: 30_000 }),
    errorCode("contention_exhausted"),
  );
});
