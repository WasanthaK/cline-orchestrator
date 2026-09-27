import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OperatorActionError } from "./operator-action.js";
import {
  OperatorWorkerRecoveryActionService,
  OperatorWorkerRecoveryAuditStore,
  type OperatorWorkerRecoveryService,
} from "./operator-worker-recovery-action.js";
import type {
  ScheduledHubTargetRecoveryPreviewV1,
  ScheduledHubTargetRecoveryResultV1,
} from "./scheduled-hub-recovery.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function preview(overrides: Partial<ScheduledHubTargetRecoveryPreviewV1> = {}): ScheduledHubTargetRecoveryPreviewV1 {
  return {
    schemaVersion: 1,
    taskId: TASK_ID,
    workspaceId: WORKSPACE_ID,
    runCount: 3,
    sessionGeneration: 2,
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

function result(): ScheduledHubTargetRecoveryResultV1 {
  return {
    schemaVersion: 1,
    taskId: TASK_ID,
    workspaceId: WORKSPACE_ID,
    schedule: {
      schemaVersion: 1,
      plan: {
        schemaVersion: 1,
        activeWriterCount: 0,
        admittedCount: 1,
        decisions: [
          {
            schemaVersion: 1,
            workspaceId: WORKSPACE_ID,
            taskId: TASK_ID,
            allowed: true,
            reason: "admitted",
            authority: "coordination_only",
          },
        ],
        authority: "coordination_only",
      },
      reservedTaskIds: [TASK_ID],
      completedTaskIds: [TASK_ID],
      failures: [],
      authority: "coordination_only",
    },
  };
}

function mockService(initial = preview()) {
  let current = initial;
  const recoveries: Array<{ taskId: string; fingerprint: string }> = [];
  const service: OperatorWorkerRecoveryService = {
    previewInterruptedTaskRecovery: async () => current,
    recoverInterruptedTask: async (taskId, fingerprint) => {
      recoveries.push({ taskId, fingerprint });
      return result();
    },
  };
  return {
    service,
    recoveries,
    setCurrent(value: ScheduledHubTargetRecoveryPreviewV1) {
      current = value;
    },
  };
}

async function withAuditStore<T>(fn: (store: OperatorWorkerRecoveryAuditStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-operator-worker-audit-"));
  try {
    return await fn(new OperatorWorkerRecoveryAuditStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("operator recovers exactly the previewed scheduled writer, audits once, and rejects replay", async () => {
  await withAuditStore(async (auditStore) => {
    const mock = mockService();
    const actions = new OperatorWorkerRecoveryActionService(mock.service, auditStore);

    const pending = await actions.previewScheduledWriterRecovery(TASK_ID);
    assert.equal(pending.action, "recover_scheduled_writer");
    assert.equal(pending.taskId, TASK_ID);
    assert.equal(pending.workspaceId, WORKSPACE_ID);
    assert.equal(pending.runCount, 3);
    assert.equal(pending.sessionGeneration, 2);
    assert.equal("fingerprint" in pending, false);

    const recovered = await actions.recoverScheduledWriter({
      taskId: TASK_ID,
      confirmationToken: pending.confirmationToken,
      confirmed: true,
    });
    assert.equal(recovered.taskId, TASK_ID);
    assert.deepEqual(mock.recoveries, [{ taskId: TASK_ID, fingerprint: "a".repeat(64) }]);

    const audit = await auditStore.list(TASK_ID);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.kind, "scheduled_writer_recovery_confirmed");
    assert.equal(audit[0]?.taskId, TASK_ID);
    assert.equal(audit[0]?.workspaceId, WORKSPACE_ID);
    assert.equal(JSON.stringify(audit).includes(pending.confirmationToken), false);

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    assert.equal(mock.recoveries.length, 1);
    assert.equal((await auditStore.list(TASK_ID)).length, 1);
  });
});

test("expired scheduled writer recovery confirmation is consumed before audit or execution", async () => {
  await withAuditStore(async (auditStore) => {
    let now = Date.parse("2026-09-27T00:00:00.000Z");
    const mock = mockService();
    const actions = new OperatorWorkerRecoveryActionService(mock.service, auditStore, () => now);
    const pending = await actions.previewScheduledWriterRecovery(TASK_ID);
    now += 60_000;

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
    );
    assert.equal(mock.recoveries.length, 0);
    assert.equal((await auditStore.list(TASK_ID)).length, 0);
  });
});

test("scheduled writer state or authority drift burns the token before audit or recovery", async () => {
  await withAuditStore(async (auditStore) => {
    const mock = mockService();
    const actions = new OperatorWorkerRecoveryActionService(mock.service, auditStore);
    const pending = await actions.previewScheduledWriterRecovery(TASK_ID);
    mock.setCurrent(preview({ fingerprint: "b".repeat(64), sessionGeneration: 3 }));

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    assert.equal(mock.recoveries.length, 0);
    assert.equal((await auditStore.list(TASK_ID)).length, 0);

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
  });
});

test("a recovery that becomes ineligible after preview fails stale without durable confirmation", async () => {
  await withAuditStore(async (auditStore) => {
    let eligible = true;
    let recoveries = 0;
    const service: OperatorWorkerRecoveryService = {
      previewInterruptedTaskRecovery: async () => {
        if (!eligible) throw new Error("live lease appeared");
        return preview();
      },
      recoverInterruptedTask: async () => {
        recoveries += 1;
        return result();
      },
    };
    const actions = new OperatorWorkerRecoveryActionService(service, auditStore);
    const pending = await actions.previewScheduledWriterRecovery(TASK_ID);
    eligible = false;

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    assert.equal(recoveries, 0);
    assert.equal((await auditStore.list(TASK_ID)).length, 0);
  });
});

test("trusted recovery failure propagates after one durable confirmation and cannot replay", async () => {
  await withAuditStore(async (auditStore) => {
    const failure = Object.assign(new Error("authority changed after final recheck"), {
      code: "task_binding_stale",
    });
    let recoveries = 0;
    const service: OperatorWorkerRecoveryService = {
      previewInterruptedTaskRecovery: async () => preview(),
      recoverInterruptedTask: async () => {
        recoveries += 1;
        throw failure;
      },
    };
    const actions = new OperatorWorkerRecoveryActionService(service, auditStore);
    const pending = await actions.previewScheduledWriterRecovery(TASK_ID);

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(recoveries, 1);
    assert.equal((await auditStore.list(TASK_ID)).length, 1);

    await assert.rejects(
      actions.recoverScheduledWriter({
        taskId: TASK_ID,
        confirmationToken: pending.confirmationToken,
        confirmed: true,
      }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    assert.equal(recoveries, 1);
  });
});
