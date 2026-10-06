import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceLockError } from "./workspace-lock.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";

const IDS = {
  workspace: "11111111-1111-4111-8111-111111111111",
  workspace2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  task1: "22222222-2222-4222-8222-222222222222",
  task2: "33333333-3333-4333-8333-333333333333",
  owner1: "44444444-4444-4444-8444-444444444444",
  owner2: "55555555-5555-4555-8555-555555555555",
  lease1: "66666666-6666-4666-8666-666666666666",
  fence1: "77777777-7777-4777-8777-777777777777",
  lease2: "88888888-8888-4888-8888-888888888888",
  fence2: "99999999-9999-4999-8999-999999999999",
};

function idFactory(...ids: string[]) {
  const queue = [...ids];
  return () => {
    const value = queue.shift();
    if (!value) throw new Error("test idFactory exhausted");
    return value;
  };
}

async function tempStore(): Promise<{ root: string; store: WorkspaceLockStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-workspace-lock-"));
  return { root, store: new WorkspaceLockStore(root) };
}

const T0 = new Date("2026-09-25T08:00:00.000Z");

test("store persists an opaque coordination-only writer lease across store instances", async () => {
  const { root, store } = await tempStore();
  try {
    const acquired = await store.acquire(
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task1,
        ownerInstanceId: IDS.owner1,
        leaseMs: 60_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
    );

    const reloaded = await new WorkspaceLockStore(root).load(IDS.workspace);
    assert.deepEqual(reloaded, acquired.state);
    assert.equal(reloaded.activeWriter?.taskId, IDS.task1);
    assert.equal(reloaded.activeWriter?.ownerInstanceId, IDS.owner1);
    assert.equal(reloaded.coordination.grantsTaskAuthority, false);
    assert.equal(reloaded.coordination.grantsFilesystemAuthority, false);

    const serialized = JSON.stringify(reloaded);
    for (const forbidden of ["workspaceRoot", "canonicalRoot", "allowedPathPatterns", "validationCommands", "hubSessionId", "apiKey"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent acquire attempts in one gateway process yield exactly one writer", async () => {
  const { root } = await tempStore();
  try {
    const store1 = new WorkspaceLockStore(root);
    const store2 = new WorkspaceLockStore(root);
    const results = await Promise.allSettled([
      store1.acquire(
        {
          workspaceId: IDS.workspace,
          taskId: IDS.task1,
          ownerInstanceId: IDS.owner1,
          leaseMs: 60_000,
        },
        { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
      ),
      store2.acquire(
        {
          workspaceId: IDS.workspace,
          taskId: IDS.task2,
          ownerInstanceId: IDS.owner2,
          leaseMs: 60_000,
        },
        { now: () => T0, idFactory: idFactory(IDS.lease2, IDS.fence2) },
      ),
    ]);

    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejection = results.find((item): item is PromiseRejectedResult => item.status === "rejected");
    assert.ok(rejection);
    assert.ok(rejection.reason instanceof WorkspaceLockError);
    assert.equal(rejection.reason.code, "writer_conflict");

    const persisted = await store1.load(IDS.workspace);
    assert.ok(persisted.activeWriter);
    assert.equal([IDS.task1, IDS.task2].includes(persisted.activeWriter.taskId), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart does not make a stale owner claim valid and expiry replacement receives a new fence", async () => {
  const { root, store } = await tempStore();
  try {
    const first = await store.acquire(
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task1,
        ownerInstanceId: IDS.owner1,
        leaseMs: 1_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
    );

    const afterRestart = new WorkspaceLockStore(root);
    await assert.rejects(
      () => afterRestart.validate(
        { ...first.claim, ownerInstanceId: IDS.owner2 },
        new Date("2026-09-25T08:00:00.500Z"),
      ),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
    );

    const second = await afterRestart.acquire(
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
    assert.notEqual(second.claim.fenceToken, first.claim.fenceToken);

    await assert.rejects(
      () => afterRestart.validate(first.claim, new Date("2026-09-25T08:00:02.500Z")),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renewal extends only the exact live fenced claim and makes the prior claim stale", async () => {
  const { root, store } = await tempStore();
  try {
    const first = await store.acquire(
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task1,
        ownerInstanceId: IDS.owner1,
        leaseMs: 2_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
    );

    const renewed = await store.renew(first.claim, 60_000, {
      now: () => new Date("2026-09-25T08:00:01.000Z"),
    });
    assert.equal(renewed.claim.leaseId, first.claim.leaseId);
    assert.equal(renewed.claim.fenceToken, first.claim.fenceToken);
    assert.equal(renewed.claim.stateRevision, first.claim.stateRevision + 1);
    assert.equal(renewed.claim.expiresAt, "2026-09-25T08:01:01.000Z");

    await assert.rejects(
      () => store.validate(first.claim, new Date("2026-09-25T08:00:01.500Z")),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
    );
    await store.validate(renewed.claim, new Date("2026-09-25T08:00:59.000Z"));

    await assert.rejects(
      () => store.renew(renewed.claim, 60_000, {
        now: () => new Date("2026-09-25T08:01:02.000Z"),
      }),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "lease_expired",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live enumeration is durable, excludes expired leases and fails closed on unsupported files", async () => {
  const { root, store } = await tempStore();
  try {
    await store.acquire(
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task1,
        ownerInstanceId: IDS.owner1,
        leaseMs: 60_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
    );
    await store.acquire(
      {
        workspaceId: IDS.workspace2,
        taskId: IDS.task2,
        ownerInstanceId: IDS.owner2,
        leaseMs: 1_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease2, IDS.fence2) },
    );

    const live = await new WorkspaceLockStore(root).listActive(
      new Date("2026-09-25T08:00:02.000Z"),
    );
    assert.deepEqual(live.map((state) => state.workspaceId), [IDS.workspace]);

    await writeFile(path.join(root, "workspace-locks", "unexpected.tmp"), "x", "utf8");
    await assert.rejects(
      () => store.listActive(new Date("2026-09-25T08:00:02.000Z")),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release is durable and an old fenced claim cannot release a later writer", async () => {
  const { root, store } = await tempStore();
  try {
    const first = await store.acquire(
      {
        workspaceId: IDS.workspace,
        taskId: IDS.task1,
        ownerInstanceId: IDS.owner1,
        leaseMs: 1_000,
      },
      { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
    );
    const released = await store.release(first.claim);
    assert.equal(released.activeWriter, undefined);

    const persisted = await new WorkspaceLockStore(root).load(IDS.workspace);
    assert.equal(persisted.activeWriter, undefined);

    const second = await store.acquire(
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
    await assert.rejects(
      () => store.release(first.claim),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "stale_claim",
    );
    assert.equal((await store.load(IDS.workspace)).activeWriter?.fenceToken, second.claim.fenceToken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed persisted state fails closed instead of resetting the lock", async () => {
  const { root, store } = await tempStore();
  try {
    const dir = path.join(root, "workspace-locks");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${IDS.workspace}.json`), "{not-json", "utf8");

    await assert.rejects(
      () => store.load(IDS.workspace),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
    );
    await assert.rejects(
      () => store.acquire(
        {
          workspaceId: IDS.workspace,
          taskId: IDS.task1,
          ownerInstanceId: IDS.owner1,
          leaseMs: 60_000,
        },
        { now: () => T0, idFactory: idFactory(IDS.lease1, IDS.fence1) },
      ),
      (error: unknown) => error instanceof WorkspaceLockError && error.code === "lock_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
