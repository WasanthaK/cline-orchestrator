import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import {
  WriterConcurrencyScheduler,
  type ApprovedWriterBindingV1,
  type WriterAuthorityRunner,
  type WriterLeaseSession,
} from "./writer-concurrency-scheduler.js";

const IDS = {
  workspace1: "11111111-1111-4111-8111-111111111111",
  workspace2: "22222222-2222-4222-8222-222222222222",
  workspace3: "33333333-3333-4333-8333-333333333333",
  task1: "44444444-4444-4444-8444-444444444444",
  task2: "55555555-5555-4555-8555-555555555555",
  task3: "66666666-6666-4666-8666-666666666666",
  owner1: "77777777-7777-4777-8777-777777777777",
  owner2: "88888888-8888-4888-8888-888888888888",
  owner3: "99999999-9999-4999-8999-999999999999",
};

async function tempLocks(): Promise<{ root: string; locks: WorkspaceLockStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-writer-scheduler-"));
  return { root, locks: new WorkspaceLockStore(root) };
}

function binding(taskId: string, workspaceId: string, ownerInstanceId: string): ApprovedWriterBindingV1 {
  return { taskId, workspaceId, ownerInstanceId };
}

class FakeRunner implements WriterAuthorityRunner {
  readonly revalidationCounts = new Map<string, number>();
  readonly started: string[] = [];
  active = 0;
  maxActive = 0;

  constructor(
    private readonly bindings: Map<string, ApprovedWriterBindingV1>,
    private readonly mutateOnRevalidation?: (taskId: string, count: number, value: ApprovedWriterBindingV1) => ApprovedWriterBindingV1,
  ) {}

  async revalidateApprovedTask(taskId: string): Promise<ApprovedWriterBindingV1> {
    const value = this.bindings.get(taskId);
    if (!value) throw new Error("task authority unavailable");
    const count = (this.revalidationCounts.get(taskId) ?? 0) + 1;
    this.revalidationCounts.set(taskId, count);
    return structuredClone(this.mutateOnRevalidation?.(taskId, count, value) ?? value);
  }

  async runApprovedTask(taskId: string, lease: WriterLeaseSession): Promise<void> {
    assert.equal(lease.taskId, taskId);
    assert.equal(lease.signal.aborted, false);
    await lease.validateCurrent();
    this.started.push(taskId);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await lease.validateCurrent();
    this.active -= 1;
  }
}

const BUDGET = {
  schemaVersion: 1 as const,
  maxActiveWriters: 2,
  maxStartsPerPass: 2,
  maxActiveWritersPerWorkspace: 1 as const,
};

test("scheduler runs bounded writers concurrently only across distinct workspaces and releases leases", async () => {
  const { root, locks } = await tempLocks();
  try {
    const runner = new FakeRunner(new Map([
      [IDS.task1, binding(IDS.task1, IDS.workspace1, IDS.owner1)],
      [IDS.task2, binding(IDS.task2, IDS.workspace2, IDS.owner2)],
      [IDS.task3, binding(IDS.task3, IDS.workspace3, IDS.owner3)],
    ]));
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      BUDGET,
      runner,
      { leaseMs: 1_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([IDS.task1, IDS.task2, IDS.task3]);
    assert.deepEqual(result.reservedTaskIds, [IDS.task1, IDS.task2]);
    assert.deepEqual([...result.completedTaskIds].sort(), [IDS.task1, IDS.task2].sort());
    assert.equal(result.plan.decisions[2].reason, "global_budget_exhausted");
    assert.equal(runner.maxActive, 2);
    assert.equal(result.failures.length, 0);
    assert.equal(result.authority, "coordination_only");
    assert.equal((await locks.listActive()).length, 0);
    assert.equal(runner.revalidationCounts.get(IDS.task1), 3);
    assert.equal(runner.revalidationCounts.get(IDS.task2), 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing durable writer evidence consumes capacity and same-workspace candidates are denied", async () => {
  const { root, locks } = await tempLocks();
  try {
    const existing = await locks.acquire({
      workspaceId: IDS.workspace1,
      taskId: IDS.task3,
      ownerInstanceId: IDS.owner3,
      leaseMs: 60_000,
    });
    const runner = new FakeRunner(new Map([
      [IDS.task1, binding(IDS.task1, IDS.workspace1, IDS.owner1)],
      [IDS.task2, binding(IDS.task2, IDS.workspace2, IDS.owner2)],
    ]));
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      BUDGET,
      runner,
      { leaseMs: 1_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([IDS.task1, IDS.task2]);
    assert.equal(result.plan.decisions[0].reason, "workspace_writer_conflict");
    assert.equal(result.plan.decisions[1].reason, "admitted");
    assert.deepEqual(result.reservedTaskIds, [IDS.task2]);
    assert.deepEqual(runner.started, [IDS.task2]);
    await locks.release(existing.claim);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authority is revalidated after lock acquisition and changed binding fails closed before worker start", async () => {
  const { root, locks } = await tempLocks();
  try {
    const runner = new FakeRunner(
      new Map([[IDS.task1, binding(IDS.task1, IDS.workspace1, IDS.owner1)]]),
      (taskId, count, value) => count >= 3
        ? { ...value, workspaceId: IDS.workspace2 }
        : value,
    );
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      { ...BUDGET, maxActiveWriters: 1, maxStartsPerPass: 1 },
      runner,
      { leaseMs: 1_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([IDS.task1]);
    assert.deepEqual(result.reservedTaskIds, []);
    assert.deepEqual(runner.started, []);
    assert.deepEqual(result.failures, [{ taskId: IDS.task1, code: "lease_failed" }]);
    assert.equal((await locks.listActive()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing task authority is rejected before lock planning and grants no writer lease", async () => {
  const { root, locks } = await tempLocks();
  try {
    const runner = new FakeRunner(new Map());
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      BUDGET,
      runner,
      { leaseMs: 1_000, heartbeatMs: 500 },
    );

    const result = await scheduler.schedule([IDS.task1]);
    assert.equal(result.plan.decisions.length, 0);
    assert.deepEqual(result.failures, [{ taskId: IDS.task1, code: "authority_revalidation_failed" }]);
    assert.equal((await locks.listActive()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
