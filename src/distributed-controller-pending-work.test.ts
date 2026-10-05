import assert from "node:assert/strict";
import test from "node:test";
import type {
  DistributedMachineRegistrationV1,
  DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";
import {
  DISTRIBUTED_CONTROLLER_PENDING_WORK_CONTRACT,
  DistributedControllerPendingWorkError,
  DistributedControllerPendingWorkSelector,
  ReferenceControllerPendingWorkQueue,
  createDistributedControllerPendingWorkItem,
} from "./distributed-controller-pending-work.js";
import type { DistributedExecutionDispatchV1 } from "./distributed-execution-admission.js";
import {
  DistributedExecutionPullDeliveryController,
  assertDistributedExecutionDeliveryBundle,
} from "./distributed-execution-delivery.js";
import type { DistributedFenceClaimV1 } from "./distributed-fencing.js";
import type {
  DistributedDeliveryStateRecordV1,
  DistributedDeliveryStateV1,
} from "./distributed-delivery-reconciliation.js";
import { DistributedMachineTransportGateway } from "./distributed-machine-transport.js";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const MACHINE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_MACHINE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SESSION_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const REQUEST_ID_2 = "88888888-8888-4888-8888-888888888888";
const DELIVERY_ID = "99999999-9999-4999-8999-999999999999";
const DELIVERY_ID_2 = "aaaaaaaa-9999-4999-8999-999999999999";
const TOKEN = `dmt_${"x".repeat(48)}`;
const OTHER_TOKEN = `dmt_${"y".repeat(48)}`;

function registration(
  registrationId = REGISTRATION_ID,
  machineId = MACHINE_ID,
): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId,
    machineId,
    revision: 1,
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    updatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    allowedCapabilities: ["accept_writer_candidates"],
    authority: "identity_only",
  };
}

function evidence(
  seed: string,
  target: { registrationId: string; machineId: string } = {
    registrationId: REGISTRATION_ID,
    machineId: MACHINE_ID,
  },
): {
  assignment: DistributedWriterCandidateAssignmentV1;
  fence: DistributedFenceClaimV1;
  dispatch: DistributedExecutionDispatchV1;
} {
  const ids = {
    taskId: `${seed}0000000-0000-4000-8000-000000000001`,
    workspaceId: `${seed}0000000-0000-4000-8000-000000000002`,
    placementId: `${seed}0000000-0000-4000-8000-000000000003`,
    assignmentId: `${seed}0000000-0000-4000-8000-000000000004`,
    fenceId: `${seed}0000000-0000-4000-8000-000000000005`,
    dispatchId: `${seed}0000000-0000-4000-8000-000000000006`,
  };
  const issuedAt = new Date(NOW.getTime() - 1_000).toISOString();
  const expiresAt = new Date(NOW.getTime() + 20_000).toISOString();
  const assignment: DistributedWriterCandidateAssignmentV1 = {
    schemaVersion: 1,
    assignmentId: ids.assignmentId,
    taskId: ids.taskId,
    workspaceId: ids.workspaceId,
    machineId: target.machineId,
    machineRegistrationId: target.registrationId,
    machineRegistrationRevision: 1,
    placementId: ids.placementId,
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
  const fence: DistributedFenceClaimV1 = {
    schemaVersion: 1,
    fenceId: ids.fenceId,
    workspaceId: ids.workspaceId,
    taskId: ids.taskId,
    machineId: target.machineId,
    machineRegistrationId: target.registrationId,
    machineRegistrationRevision: 1,
    placementId: ids.placementId,
    placementRevision: 1,
    candidateAssignmentId: ids.assignmentId,
    generation: 1,
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
  const dispatch: DistributedExecutionDispatchV1 = {
    schemaVersion: 1,
    dispatchId: ids.dispatchId,
    taskId: ids.taskId,
    workspaceId: ids.workspaceId,
    machineId: target.machineId,
    machineRegistrationId: target.registrationId,
    machineRegistrationRevision: 1,
    placementId: ids.placementId,
    placementRevision: 1,
    candidateAssignmentId: ids.assignmentId,
    fenceId: ids.fenceId,
    fenceGeneration: 1,
    issuedAt,
    expiresAt,
    authority: "execution_request_only",
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
  return { assignment, fence, dispatch };
}


class MemoryDeliveryStateStore {
  readonly records = new Map<string, DistributedDeliveryStateRecordV1>();
  readonly transitions: Array<{ deliveryId: string; from: DistributedDeliveryStateV1; to: DistributedDeliveryStateV1 }> = [];
  failCreate = false;

  async create(record: DistributedDeliveryStateRecordV1): Promise<DistributedDeliveryStateRecordV1> {
    if (this.failCreate) throw new Error("durable state unavailable");
    if (this.records.has(record.deliveryId)) throw new Error("duplicate delivery");
    this.records.set(record.deliveryId, structuredClone(record));
    return structuredClone(record);
  }

  async advance(
    deliveryId: string,
    expectedState: Exclude<DistributedDeliveryStateV1, "admission_acknowledged">,
    nextState: Exclude<DistributedDeliveryStateV1, "pending" | "admission_acknowledged">,
  ): Promise<DistributedDeliveryStateRecordV1> {
    const current = this.records.get(deliveryId);
    if (!current || current.state !== expectedState) throw new Error("state conflict");
    const updated = {
      ...current,
      state: nextState,
      updatedAt: NOW.toISOString(),
    } as DistributedDeliveryStateRecordV1;
    this.records.set(deliveryId, updated);
    this.transitions.push({ deliveryId, from: expectedState, to: nextState });
    return structuredClone(updated);
  }
}

async function fixture() {
  const registrations = new Map([
    [REGISTRATION_ID, registration()],
    [OTHER_REGISTRATION_ID, registration(OTHER_REGISTRATION_ID, OTHER_MACHINE_ID)],
  ]);
  let sessionCounter = 0;
  const transport = new DistributedMachineTransportGateway(
    {
      async get(registrationId: string) {
        const value = registrations.get(registrationId);
        if (!value) throw new Error("registration missing");
        return structuredClone(value);
      },
    },
    {
      now: () => new Date(NOW),
      idFactory: () => sessionCounter++ === 0 ? SESSION_ID : OTHER_SESSION_ID,
      tokenFactory: () => sessionCounter === 1 ? TOKEN : OTHER_TOKEN,
    },
  );
  const primary = await transport.issue(REGISTRATION_ID, {
    capabilities: ["accept_writer_candidates"],
    ttlMs: 60_000,
  });
  const secondary = await transport.issue(OTHER_REGISTRATION_ID, {
    capabilities: ["accept_writer_candidates"],
    ttlMs: 60_000,
  });
  const queue = new ReferenceControllerPendingWorkQueue();
  const candidateCalls: string[] = [];
  const fenceCalls: string[] = [];
  let deliveryCounter = 0;
  const delivery = new DistributedExecutionPullDeliveryController(
    transport,
    {
      now: () => new Date(NOW),
      idFactory: () => deliveryCounter++ === 0 ? DELIVERY_ID : DELIVERY_ID_2,
    },
  );
  const deliveryState = new MemoryDeliveryStateStore();
  const selector = new DistributedControllerPendingWorkSelector({
    transport,
    pendingWork: queue,
    candidates: {
      async assertCandidateCurrent(assignment) {
        candidateCalls.push(assignment.assignmentId);
      },
    },
    fences: {
      async validateCurrent(fence) {
        fenceCalls.push(fence.fenceId);
      },
    },
    delivery,
    deliveryState,
    now: () => new Date(NOW),
  });
  return {
    transport,
    queue,
    selector,
    candidateCalls,
    fenceCalls,
    deliveryState,
    token: primary.token,
    otherToken: secondary.token,
  };
}

function enqueue(
  queue: ReferenceControllerPendingWorkQueue,
  values: ReturnType<typeof evidence>,
  pendingWorkId: string,
): void {
  queue.enqueue(createDistributedControllerPendingWorkItem(values, {
    now: () => new Date(NOW),
    idFactory: () => pendingWorkId,
  }));
}

test("M12R contract keeps all work selection controller-owned and authority-free", () => {
  assert.deepEqual(DISTRIBUTED_CONTROLLER_PENDING_WORK_CONTRACT, {
    schemaVersion: 1,
    selectionOwner: "controller",
    pullInputIncludesTaskId: false,
    pullInputIncludesWorkspaceId: false,
    pullInputIncludesDispatchId: false,
    pullInputIncludesCandidateAssignmentId: false,
    pullInputIncludesFenceId: false,
    requiresAuthenticatedMachineIdentityBeforeSelection: true,
    requiresExactRegistrationRevisionBinding: true,
    requiresAtomicControllerClaim: true,
    requiresCandidateCurrentness: true,
    requiresFenceCurrentness: true,
    reusesM12JAuthorizedDeliveryBuilder: true,
    requiresDurableDeliveryStateBeforeReturn: true,
    deliveryStateFailureRequeuesWork: false,
    noWorkIsNonAuthorizing: true,
    networkIoIncluded: false,
    listenerIncluded: false,
    controllerPushEnabled: false,
    credentialProvisioningIncluded: false,
    distributedTakeoverEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  });
  assert.equal(DistributedControllerPendingWorkSelector.prototype.pullNext.length, 2);
});

test("authenticated target receives only controller-selected exact-machine work through M12J", async () => {
  const { queue, selector, token, candidateCalls, fenceCalls, deliveryState } = await fixture();
  const values = evidence("a");
  enqueue(queue, values, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");

  const result = await selector.pullNext(token, REQUEST_ID);
  assert.ok(result);
  assertDistributedExecutionDeliveryBundle(result);
  assert.equal(result.dispatch.dispatchId, values.dispatch.dispatchId);
  assert.equal(result.transportRequest.machineId, MACHINE_ID);
  assert.equal(result.transportRequest.registrationId, REGISTRATION_ID);
  assert.deepEqual(candidateCalls, [values.assignment.assignmentId]);
  assert.deepEqual(fenceCalls, [values.fence.fenceId]);
  assert.equal(queue.size, 0);
  assert.equal(deliveryState.records.get(result.deliveryId)?.state, "delivered_unconfirmed");
  assert.deepEqual(deliveryState.transitions, [
    { deliveryId: result.deliveryId, from: "pending", to: "claimed" },
    { deliveryId: result.deliveryId, from: "claimed", to: "delivered_unconfirmed" },
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("workspaceRoot"), false);
  assert.equal(serialized.includes("prompt"), false);
  assert.equal(serialized.includes("command"), false);
});

test("controller FIFO order determines work; target cannot choose a later task", async () => {
  const { queue, selector, token } = await fixture();
  const first = evidence("b");
  const second = evidence("c");
  enqueue(queue, first, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
  enqueue(queue, second, "cccccccc-cccc-4ccc-8ccc-ccccccccccc1");

  const selectedFirst = await selector.pullNext(token, REQUEST_ID);
  assert.ok(selectedFirst);
  assert.equal(selectedFirst.dispatch.dispatchId, first.dispatch.dispatchId);
  const selectedSecond = await selector.pullNext(token, REQUEST_ID_2);
  assert.ok(selectedSecond);
  assert.equal(selectedSecond.dispatch.dispatchId, second.dispatch.dispatchId);
});

test("work for another machine is never claimable by the authenticated target", async () => {
  const { queue, selector, token, otherToken } = await fixture();
  const other = evidence("d", {
    registrationId: OTHER_REGISTRATION_ID,
    machineId: OTHER_MACHINE_ID,
  });
  enqueue(queue, other, "dddddddd-dddd-4ddd-8ddd-ddddddddddd1");

  assert.equal(await selector.pullNext(token, REQUEST_ID), null);
  assert.equal(queue.size, 1);
  const selected = await selector.pullNext(otherToken, REQUEST_ID_2);
  assert.ok(selected);
  assert.equal(selected.dispatch.machineId, OTHER_MACHINE_ID);
  assert.equal(queue.size, 0);
});

test("claimed work is one-shot and a second authenticated pull returns no work", async () => {
  const { queue, selector, token } = await fixture();
  const values = evidence("e");
  enqueue(queue, values, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");

  assert.ok(await selector.pullNext(token, REQUEST_ID));
  assert.equal(await selector.pullNext(token, REQUEST_ID_2), null);
});

test("candidate loss after claim fails closed before fence or delivery", async () => {
  const base = await fixture();
  const values = evidence("f");
  enqueue(base.queue, values, "ffffffff-ffff-4fff-8fff-fffffffffff1");
  let fenceCalls = 0;
  const selector = new DistributedControllerPendingWorkSelector({
    transport: base.transport,
    pendingWork: base.queue,
    candidates: {
      async assertCandidateCurrent() {
        throw new Error("candidate stale");
      },
    },
    fences: {
      async validateCurrent() {
        fenceCalls += 1;
      },
    },
    delivery: new DistributedExecutionPullDeliveryController(base.transport, {
      now: () => new Date(NOW),
      idFactory: () => DELIVERY_ID,
    }),
    deliveryState: base.deliveryState,
    now: () => new Date(NOW),
  });

  await assert.rejects(
    () => selector.pullNext(base.token, REQUEST_ID),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "candidate_not_current",
  );
  assert.equal(fenceCalls, 0);
  assert.equal(base.queue.size, 0, "stale claimed work must not be resurrected");
});

test("fence loss after a current candidate fails closed before M12J delivery", async () => {
  const base = await fixture();
  const values = evidence("1");
  enqueue(base.queue, values, "12121212-1212-4121-8121-121212121211");
  let candidateCalls = 0;
  const selector = new DistributedControllerPendingWorkSelector({
    transport: base.transport,
    pendingWork: base.queue,
    candidates: {
      async assertCandidateCurrent() {
        candidateCalls += 1;
      },
    },
    fences: {
      async validateCurrent() {
        throw new Error("fence stale");
      },
    },
    delivery: new DistributedExecutionPullDeliveryController(base.transport, {
      now: () => new Date(NOW),
      idFactory: () => DELIVERY_ID,
    }),
    deliveryState: base.deliveryState,
    now: () => new Date(NOW),
  });

  await assert.rejects(
    () => selector.pullNext(base.token, REQUEST_ID),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "fence_not_current",
  );
  assert.equal(candidateCalls, 1);
  assert.equal(base.queue.size, 0);
});

test("invalid transport identity fails before controller queue selection", async () => {
  const { queue, selector } = await fixture();
  const values = evidence("2");
  enqueue(queue, values, "23232323-2323-4232-8232-232323232321");

  await assert.rejects(
    () => selector.pullNext("not-a-current-token", REQUEST_ID),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "transport_identity_invalid",
  );
  assert.equal(queue.size, 1);
});

test("pending work exact schema rejects authority widening and cross-bound evidence", () => {
  const values = evidence("3");
  const good = createDistributedControllerPendingWorkItem(values, {
    now: () => new Date(NOW),
    idFactory: () => "34343434-3434-4343-8343-343434343431",
  });
  const queue = new ReferenceControllerPendingWorkQueue();
  assert.throws(
    () => queue.enqueue({ ...good, grantsCredentialAuthority: true } as never),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "pending_work_invalid",
  );
  assert.throws(
    () => createDistributedControllerPendingWorkItem({
      ...values,
      dispatch: { ...values.dispatch, fenceGeneration: 2 },
    }),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "pending_work_invalid",
  );
});

test("delivery state persistence failure fails closed before bundle return and never requeues", async () => {
  const base = await fixture();
  const values = evidence("4");
  enqueue(base.queue, values, "45454545-4545-4454-8454-454545454541");
  base.deliveryState.failCreate = true;

  await assert.rejects(
    () => base.selector.pullNext(base.token, REQUEST_ID),
    (error: unknown) => error instanceof DistributedControllerPendingWorkError
      && error.code === "delivery_state_failed",
  );
  assert.equal(base.queue.size, 0, "claimed work must not be requeued after state persistence failure");
  assert.equal(base.deliveryState.records.size, 0);
});
