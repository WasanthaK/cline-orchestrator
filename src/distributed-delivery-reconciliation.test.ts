import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISTRIBUTED_DELIVERY_RECONCILIATION_CONTRACT,
  DistributedDeliveryReconciliationError,
  FileDistributedDeliveryStateStore,
  createDistributedDeliveryAdmissionAcknowledgement,
  createDistributedDeliveryStateRecord,
} from "./distributed-delivery-reconciliation.js";
import type { DistributedExecutionAdmissionReceiptV1 } from "./distributed-execution-admission.js";

const ids = {
  delivery: "11111111-1111-4111-8111-111111111111",
  dispatch: "22222222-2222-4222-8222-222222222222",
  task: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  machine: "55555555-5555-4555-8555-555555555555",
  registration: "66666666-6666-4666-8666-666666666666",
  acknowledgement: "77777777-7777-4777-8777-777777777777",
  otherAcknowledgement: "88888888-8888-4888-8888-888888888888",
};

const t0 = new Date("2026-10-05T02:00:00.000Z");
const t1 = new Date("2026-10-05T02:00:01.000Z");
const t2 = new Date("2026-10-05T02:00:02.000Z");
const t3 = new Date("2026-10-05T02:00:03.000Z");

function record() {
  return createDistributedDeliveryStateRecord({
    deliveryId: ids.delivery,
    dispatchId: ids.dispatch,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    machineRegistrationId: ids.registration,
    machineRegistrationRevision: 1,
  }, { now: () => t0 });
}

function admission(): DistributedExecutionAdmissionReceiptV1 {
  return {
    schemaVersion: 1,
    dispatchId: ids.dispatch,
    taskId: ids.task,
    workspaceId: ids.workspace,
    machineId: ids.machine,
    fenceGeneration: 9,
    admittedAt: t2.toISOString(),
    authority: "admission_evidence_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

async function expectCode(promise: Promise<unknown>, code: DistributedDeliveryReconciliationError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DistributedDeliveryReconciliationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M12Y-A contract is durable acknowledgement state only and grants no execution authority", () => {
  assert.deepEqual(DISTRIBUTED_DELIVERY_RECONCILIATION_CONTRACT, {
    schemaVersion: 1,
    acknowledgementMeansDurableM12GAdmissionOnly: true,
    controllerStateIsDurable: true,
    ambiguousOutcomeRemainsUnconfirmed: true,
    automaticRetryAllowed: false,
    automaticRequeueAllowed: false,
    acknowledgementGrantsExecutionAuthority: false,
    networkRouteIncluded: false,
    listenerIncluded: false,
    targetRuntimeIncluded: false,
    writerExecutionIncluded: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
  const value = record();
  assert.equal(value.state, "pending");
  assert.equal(value.authority, "delivery_reconciliation_state_only");
  assert.equal(value.grantsTaskAuthority, false);
  assert.equal(value.grantsWriterLeaseAuthority, false);
  assert.equal("bearerToken" in value, false);
  assert.equal("prompt" in value, false);
  assert.equal("command" in value, false);
});

test("M12Y-A durable state advances only pending -> claimed -> delivered_unconfirmed and survives restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m12y-state-"));
  const file = path.join(dir, "distributed-delivery-state.json");
  try {
    const store = new FileDistributedDeliveryStateStore(file);
    await store.create(record());
    const claimed = await store.advance(ids.delivery, "pending", "claimed", { now: () => t1 });
    assert.equal(claimed.state, "claimed");
    const unconfirmed = await store.advance(ids.delivery, "claimed", "delivered_unconfirmed", { now: () => t2 });
    assert.equal(unconfirmed.state, "delivered_unconfirmed");

    const restarted = new FileDistributedDeliveryStateStore(file);
    const afterRestart = await restarted.get(ids.delivery);
    assert.equal(afterRestart.state, "delivered_unconfirmed");
    assert.equal(afterRestart.dispatchId, ids.dispatch);

    await expectCode(
      restarted.advance(ids.delivery, "delivered_unconfirmed", "claimed", { now: () => t3 }),
      "state_conflict",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("M12Y-A acknowledgement is derived from exact M12G admission and is idempotent only when identical", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m12y-ack-"));
  const file = path.join(dir, "distributed-delivery-state.json");
  try {
    const store = new FileDistributedDeliveryStateStore(file);
    const initial = await store.create(record());
    await store.advance(ids.delivery, "pending", "claimed", { now: () => t1 });
    const unconfirmed = await store.advance(ids.delivery, "claimed", "delivered_unconfirmed", { now: () => t2 });

    const ack = createDistributedDeliveryAdmissionAcknowledgement(
      unconfirmed,
      admission(),
      { now: () => t3, idFactory: () => ids.acknowledgement },
    );
    assert.equal(ack.dispatchId, ids.dispatch);
    assert.equal(ack.authority, "delivery_admission_evidence_only");
    assert.equal(ack.grantsTaskAuthority, false);

    const acknowledged = await store.acknowledge(ids.delivery, ack);
    assert.equal(acknowledged.state, "admission_acknowledged");
    assert.deepEqual(acknowledged.acknowledgement, ack);

    const duplicate = await store.acknowledge(ids.delivery, ack);
    assert.deepEqual(duplicate, acknowledged);

    const conflicting = {
      ...ack,
      acknowledgementId: ids.otherAcknowledgement,
    };
    await expectCode(store.acknowledge(ids.delivery, conflicting), "state_conflict");

    assert.equal(initial.state, "pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("M12Y-A rejects acknowledgement before delivered_unconfirmed and rejects cross-bound admission evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m12y-order-"));
  const file = path.join(dir, "distributed-delivery-state.json");
  try {
    const store = new FileDistributedDeliveryStateStore(file);
    const initial = await store.create(record());
    const earlyAck = createDistributedDeliveryAdmissionAcknowledgement(
      initial,
      admission(),
      { now: () => t3, idFactory: () => ids.acknowledgement },
    );
    await expectCode(store.acknowledge(ids.delivery, earlyAck), "state_conflict");

    const wrongAdmission = {
      ...admission(),
      taskId: "99999999-9999-4999-8999-999999999999",
    };
    assert.throws(
      () => createDistributedDeliveryAdmissionAcknowledgement(
        initial,
        wrongAdmission,
        { now: () => t3, idFactory: () => ids.acknowledgement },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DistributedDeliveryReconciliationError);
        assert.equal(error.code, "binding_mismatch");
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("M12Y-A store fails closed on corrupt durable state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "m12y-corrupt-"));
  const file = path.join(dir, "distributed-delivery-state.json");
  try {
    await writeFile(file, "{not-json", "utf8");
    const store = new FileDistributedDeliveryStateStore(file);
    await expectCode(store.list(), "store_corrupt");

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      records: [
        record(),
        { ...record(), deliveryId: "99999999-9999-4999-8999-999999999999" },
      ],
    }), "utf8");
    await expectCode(store.list(), "store_corrupt");

    const raw = await readFile(file, "utf8");
    assert.ok(raw.includes(ids.dispatch));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
