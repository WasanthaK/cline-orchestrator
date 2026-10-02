import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertRemoteControlSessionCurrent,
  createRemoteControlSessionClaims,
  RemoteControlContractError,
} from "./remote-control-contract.js";
import {
  RemoteRegistrationStore,
  RemoteRegistrationStoreError,
} from "./remote-registration-store.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-registration-"));
  let now = new Date("2026-09-27T11:00:00.000Z");
  const store = new RemoteRegistrationStore(root, {
    now: () => now,
    idFactory: () => IDS.registration,
  });
  return {
    root,
    store,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function createDefault(store: RemoteRegistrationStore) {
  return await store.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: ["continue_task", "abort_task", "continue_task"],
    allowedReadOnlyCapabilities: ["task_validation_status", "passive_visualization"],
  });
}

test("registration create persists normalized M10 capability subset and exposes sanitized public view", async () => {
  const { root, store } = await fixture();
  try {
    const created = await createDefault(store);
    assert.equal(created.registrationId, IDS.registration);
    assert.equal(created.revision, 1);
    assert.equal(created.status, "active");
    assert.deepEqual(created.allowedMutationActions, ["abort_task", "continue_task"]);
    assert.deepEqual(created.allowedReadOnlyCapabilities, ["passive_visualization", "task_validation_status"]);

    const reloaded = new RemoteRegistrationStore(root);
    assert.deepEqual(await reloaded.get(IDS.registration), created);
    assert.deepEqual(await reloaded.list(), [created]);

    const raw = await readFile(path.join(root, "remote-control", "registrations.json"), "utf8");
    assert.equal(raw.includes("bearer"), false);
    assert.equal(raw.includes("token"), false);
    assert.equal(raw.includes("credential"), false);
    assert.equal(raw.includes("workspace"), false);
    assert.equal(raw.includes("safetyPlan"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration store rejects capabilities outside the M10 operator manifest", async () => {
  const { root, store } = await fixture();
  try {
    await assert.rejects(
      store.create({
        machineId: IDS.machine,
        remotePrincipalId: IDS.principal,
        allowedMutationActions: ["raw_hub_control" as never],
        allowedReadOnlyCapabilities: [],
      }),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "registration_invalid",
    );
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update is revision-checked, monotonic and invalidates a previously issued session", async () => {
  const { root, store } = await fixture();
  try {
    await createDefault(store);
    const current = await store.getRegistration(IDS.registration);
    const claims = createRemoteControlSessionClaims(
      current,
      {
        mutationActions: ["continue_task"],
        readOnlyCapabilities: ["task_validation_status"],
        ttlMs: 10 * 60 * 1000,
      },
      {
        now: new Date("2026-09-27T11:00:30.000Z"),
        idFactory: () => IDS.session,
      },
    );

    const updated = await store.update(IDS.registration, {
      expectedRevision: 1,
      allowedMutationActions: ["abort_task"],
      allowedReadOnlyCapabilities: ["passive_visualization"],
    });
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.allowedMutationActions, ["abort_task"]);

    await assert.rejects(
      store.update(IDS.registration, {
        expectedRevision: 1,
        allowedMutationActions: [],
        allowedReadOnlyCapabilities: [],
      }),
      (error: unknown) => error instanceof RemoteRegistrationStoreError && error.code === "registration_conflict",
    );

    const latest = await store.getRegistration(IDS.registration);
    assert.throws(
      () => assertRemoteControlSessionCurrent(
        claims,
        latest,
        new Date("2026-09-27T11:01:00.000Z"),
      ),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation increments revision, is terminal and invalidates prior session claims", async () => {
  const { root, store, setNow } = await fixture();
  try {
    await createDefault(store);
    const before = await store.getRegistration(IDS.registration);
    const claims = createRemoteControlSessionClaims(
      before,
      { mutationActions: ["abort_task"], readOnlyCapabilities: [], ttlMs: 10 * 60 * 1000 },
      { now: new Date("2026-09-27T11:00:30.000Z"), idFactory: () => IDS.session },
    );

    setNow("2026-09-27T11:02:00.000Z");
    const revoked = await store.revoke(IDS.registration, { expectedRevision: 1 });
    assert.equal(revoked.revision, 2);
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.revokedAt, "2026-09-27T11:02:00.000Z");

    const latest = await store.getRegistration(IDS.registration);
    assert.throws(
      () => assertRemoteControlSessionCurrent(
        claims,
        latest,
        new Date("2026-09-27T11:03:00.000Z"),
      ),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "registration_revoked",
    );

    await assert.rejects(
      store.revoke(IDS.registration, { expectedRevision: 2 }),
      (error: unknown) => error instanceof RemoteRegistrationStoreError && error.code === "registration_revoked",
    );
    await assert.rejects(
      store.update(IDS.registration, {
        expectedRevision: 2,
        allowedMutationActions: [],
        allowedReadOnlyCapabilities: [],
      }),
      (error: unknown) => error instanceof RemoteRegistrationStoreError && error.code === "registration_revoked",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serialized concurrent updates cannot both win the same expected revision", async () => {
  const { root, store } = await fixture();
  try {
    await createDefault(store);
    const results = await Promise.allSettled([
      store.update(IDS.registration, {
        expectedRevision: 1,
        allowedMutationActions: ["abort_task"],
        allowedReadOnlyCapabilities: [],
      }),
      store.update(IDS.registration, {
        expectedRevision: 1,
        allowedMutationActions: ["rollback_task"],
        allowedReadOnlyCapabilities: [],
      }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof RemoteRegistrationStoreError);
    assert.equal(rejected.reason.code, "registration_conflict");
    assert.equal((await store.get(IDS.registration)).revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt or duplicate durable registration state fails closed", async () => {
  const { root, store } = await fixture();
  try {
    await createDefault(store);
    const file = path.join(root, "remote-control", "registrations.json");
    await writeFile(file, "{not-json", "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof RemoteRegistrationStoreError && error.code === "store_corrupt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown registration lookup fails without creating state", async () => {
  const { root, store } = await fixture();
  try {
    await assert.rejects(
      store.get(IDS.registration),
      (error: unknown) => error instanceof RemoteRegistrationStoreError && error.code === "registration_not_found",
    );
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
