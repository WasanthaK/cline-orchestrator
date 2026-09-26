import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireWorkspaceWriter,
  assertWorkspaceLockState,
  createWorkspaceLockState,
  releaseWorkspaceWriter,
  validateWorkspaceWriterClaim,
  WORKSPACE_LOCK_LIMITS,
  WorkspaceLockError,
  workspaceAccessRequiresWriterLease,
} from "./workspace-lock.js";

const IDS = {
  workspace: "11111111-1111-4111-8111-111111111111",
  task1: "22222222-2222-4222-8222-222222222222",
  task2: "33333333-3333-4333-8333-333333333333",
  owner1: "44444444-4444-4444-8444-444444444444",
  owner2: "55555555-5555-4555-8555-555555555555",
  lease1: "66666666-6666-4666-8666-666666666666",
  fence1: "77777777-7777-4777-8777-777777777777",
  lease2: "88888888-8888-4888-8888-888888888888",
  fence2: "99999999-9999-4999-8999-999999999999",
  lease3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fence3: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function idFactory(...ids: string[]) {
  const queue = [...ids];
  return () => {
    const value = queue.shift();
    if (!value) throw new Error("test idFactory exhausted");
    return value;
  };
}

const T0 = new Date("2026-09-25T08:00:00.000Z");

function acquireFirst(leaseMs = 60_000) {
  return acquireWorkspaceWriter(
    createWorkspaceLockState(IDS.workspace),
    {
      workspaceId: IDS.workspace,
      taskId: IDS.task1,
      ownerInstanceId: IDS.owner1,
      leaseMs,
    },
    {
      now: () => T0,
      idFactory: idFactory(IDS.lease1, IDS.fence1),
    },
  );
}

test("workspace lock is exclusive coordination only and observers require no lease", () => {
  const initial = createWorkspaceLockState(IDS.workspace);
  assert.equal(workspaceAccessRequiresWriterLease("observe"), false);
  assert.equal(workspaceAccessRequiresWriterLease("write"), true);
  assert.deepEqual(initial.coordination, {
    exclusiveWriter: true,
    observersRequireLease: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
  });

  const acquired = acquireFirst();
  assert.equal(acquired.replacedExpiredLease, false);
  assert.equal(acquired.claim.authority, "coordination_only");
  assert.equal(acquired.claim.taskId, IDS.task1);
  assert.equal(acquired.claim.ownerInstanceId, IDS.owner1);
  assert.equal(acquired.state.activeWriter?.fenceToken, IDS.fence1);
  assert.equal(acquired.state.revision, 2);
  assert.doesNotThrow(() => validateWorkspaceWriterClaim(
    acquired.state,
    acquired.claim,
    new Date("2026-09-25T08:00:30.000Z"),
  ));

  const serialized = JSON.stringify(acquired);
  for (const forbidden of ["workspaceRoot", "allowedPathPatterns", "shell", "hubSessionId", "apiKey"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("a live writer lease causes a deterministic writer conflict", () => {
  const acquired = acquireFirst();
  assert.throws(
    () => acquireWorkspaceWriter(
      acquired.state,
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task2,
        ownerInstanceId: IDS.owner2,
        leaseMs: 60_000,
      },
      {
        now: () => new Date("2026-09-25T08:00:30.000Z"),
        idFactory: idFactory(IDS.lease2, IDS.fence2),
      },
    ),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "writer_conflict",
  );
});

test("an expired lease can be replaced only with a new lease and fence, invalidating the old claim", () => {
  const first = acquireFirst(1_000);
  const second = acquireWorkspaceWriter(
    first.state,
    {
      workspaceId: IDS.workspace,
      taskId: IDS.task2,
      ownerInstanceId: IDS.owner2,
      leaseMs: 60_000,
    },
    {
      now: () => new Date("2026-09-25T08:00:02.000Z"),
      idFactory: idFactory(IDS.lease2, IDS.fence2),
    },
  );

  assert.equal(second.replacedExpiredLease, true);
  assert.equal(second.state.revision, first.state.revision + 1);
  assert.notEqual(second.claim.leaseId, first.claim.leaseId);
  assert.notEqual(second.claim.fenceToken, first.claim.fenceToken);
  assert.equal(second.claim.taskId, IDS.task2);

  assert.throws(
    () => validateWorkspaceWriterClaim(second.state, first.claim, new Date("2026-09-25T08:00:03.000Z")),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
  );
  assert.throws(
    () => releaseWorkspaceWriter(second.state, first.claim),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
  );
});

test("owner restart cannot reuse an old lease by changing owner identity or reconstructing a claim", () => {
  const acquired = acquireFirst();
  const restartedOwnerClaim = {
    ...acquired.claim,
    ownerInstanceId: IDS.owner2,
  };

  assert.throws(
    () => validateWorkspaceWriterClaim(
      acquired.state,
      restartedOwnerClaim,
      new Date("2026-09-25T08:00:30.000Z"),
    ),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
  );

  assert.throws(
    () => validateWorkspaceWriterClaim(
      acquired.state,
      acquired.claim,
      new Date("2026-09-25T08:01:00.000Z"),
    ),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "lease_expired",
  );
});

test("release requires the exact current fenced claim and a later writer receives a new fence", () => {
  const first = acquireFirst();
  const released = releaseWorkspaceWriter(first.state, first.claim);
  assert.equal(released.activeWriter, undefined);
  assert.equal(released.revision, 3);

  assert.throws(
    () => validateWorkspaceWriterClaim(released, first.claim, new Date("2026-09-25T08:00:30.000Z")),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
  );

  const second = acquireWorkspaceWriter(
    released,
    {
      workspaceId: IDS.workspace,
      taskId: IDS.task2,
      ownerInstanceId: IDS.owner2,
      leaseMs: 60_000,
    },
    {
      now: () => new Date("2026-09-25T08:00:30.000Z"),
      idFactory: idFactory(IDS.lease3, IDS.fence3),
    },
  );
  assert.equal(second.claim.fenceToken, IDS.fence3);
  assert.equal(second.state.revision, 4);
});

test("lease duration is bounded and persisted coordination flags cannot be relaxed", () => {
  const initial = createWorkspaceLockState(IDS.workspace);
  for (const invalid of [
    WORKSPACE_LOCK_LIMITS.minLeaseMs - 1,
    WORKSPACE_LOCK_LIMITS.maxLeaseMs + 1,
    1.5,
  ]) {
    assert.throws(
      () => acquireWorkspaceWriter(
        initial,
        {
          workspaceId: IDS.workspace,
          taskId: IDS.task1,
          ownerInstanceId: IDS.owner1,
          leaseMs: invalid,
        },
        { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
      ),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
    );
  }

  assert.throws(
    () => assertWorkspaceLockState({
      ...initial,
      coordination: {
        ...initial.coordination,
        grantsFilesystemAuthority: true,
      },
    }),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
  );
});

test("lock state and claims reject cross-workspace and malformed identities", () => {
  const acquired = acquireFirst();
  assert.throws(
    () => acquireWorkspaceWriter(
      acquired.state,
      {
        workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        taskId: IDS.task2,
        ownerInstanceId: IDS.owner2,
        leaseMs: 60_000,
      },
      {
        now: () => new Date("2026-09-25T08:00:30.000Z"),
        idFactory: idFactory(IDS.lease2, IDS.fence2),
      },
    ),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
  );

  assert.throws(
    () => createWorkspaceLockState("../outside"),
    (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
  );
});
