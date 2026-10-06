import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DistributedControlContractError } from "./distributed-control-contract.js";
import {
  DistributedRegistrationStore,
  DistributedRegistrationStoreError,
} from "./distributed-registration-store.js";

const IDS = {
  registrationA: "11111111-1111-4111-8111-111111111111",
  registrationB: "22222222-2222-4222-8222-222222222222",
  machine: "33333333-3333-4333-8333-333333333333",
  otherMachine: "44444444-4444-4444-8444-444444444444",
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-distributed-registration-"));
  let now = new Date("2026-09-28T10:30:00.000Z");
  const ids = [IDS.registrationA, IDS.registrationB];
  const store = new DistributedRegistrationStore(root, {
    now: () => now,
    idFactory: () => ids.shift() ?? IDS.registrationB,
  });
  return {
    root,
    store,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function createDefault(store: DistributedRegistrationStore) {
  return await store.create({
    machineId: IDS.machine,
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
  });
}

test("machine registration persists only identity-only M12 state with restrictive file mode", async () => {
  const { root, store } = await fixture();
  try {
    const created = await createDefault(store);
    assert.deepEqual(created, {
      schemaVersion: 1,
      registrationId: IDS.registrationA,
      machineId: IDS.machine,
      revision: 1,
      createdAt: "2026-09-28T10:30:00.000Z",
      updatedAt: "2026-09-28T10:30:00.000Z",
      allowedCapabilities: ["report_status", "accept_writer_candidates"],
      authority: "identity_only",
    });

    const reloaded = new DistributedRegistrationStore(root);
    assert.deepEqual(await reloaded.get(IDS.registrationA), created);
    assert.deepEqual(await reloaded.list(), [created]);

    const file = path.join(root, "distributed-control", "machine-registrations.json");
    const raw = await readFile(file, "utf8");
    for (const forbidden of [
      "workspacePath",
      "canonicalRoot",
      "endpoint",
      "command",
      "safetyPlan",
      "credential",
      "hubToken",
      "releaseAuthority",
    ]) {
      assert.equal(raw.includes(forbidden), false, forbidden);
    }
    if (process.platform !== "win32") {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update is exact-revision checked and monotonic", async () => {
  const { root, store, setNow } = await fixture();
  try {
    await createDefault(store);
    setNow("2026-09-28T10:31:00.000Z");
    const updated = await store.update(IDS.registrationA, {
      expectedRevision: 1,
      allowedCapabilities: ["report_status"],
    });
    assert.equal(updated.revision, 2);
    assert.equal(updated.updatedAt, "2026-09-28T10:31:00.000Z");
    assert.deepEqual(updated.allowedCapabilities, ["report_status"]);

    await assert.rejects(
      store.update(IDS.registrationA, {
        expectedRevision: 1,
        allowedCapabilities: ["accept_writer_candidates"],
      }),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "registration_conflict",
    );
    assert.equal((await store.get(IDS.registrationA)).revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation increments revision and is terminal", async () => {
  const { root, store, setNow } = await fixture();
  try {
    await createDefault(store);
    setNow("2026-09-28T10:32:00.000Z");
    const revoked = await store.revoke(IDS.registrationA, { expectedRevision: 1 });
    assert.equal(revoked.revision, 2);
    assert.equal(revoked.revokedAt, "2026-09-28T10:32:00.000Z");
    assert.equal(revoked.updatedAt, revoked.revokedAt);

    await assert.rejects(
      store.update(IDS.registrationA, {
        expectedRevision: 2,
        allowedCapabilities: [],
      }),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "registration_revoked",
    );
    await assert.rejects(
      store.revoke(IDS.registrationA, { expectedRevision: 2 }),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "registration_revoked",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serialized concurrent updates cannot both win one expected revision", async () => {
  const { root, store, setNow } = await fixture();
  try {
    await createDefault(store);
    setNow("2026-09-28T10:31:00.000Z");
    const results = await Promise.allSettled([
      store.update(IDS.registrationA, {
        expectedRevision: 1,
        allowedCapabilities: ["report_status"],
      }),
      store.update(IDS.registrationA, {
        expectedRevision: 1,
        allowedCapabilities: ["accept_writer_candidates"],
      }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof DistributedRegistrationStoreError);
    assert.equal(rejected.reason.code, "registration_conflict");
    assert.equal((await store.get(IDS.registrationA)).revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active duplicate machine registration and unsupported capabilities fail closed", async () => {
  const { root, store } = await fixture();
  try {
    await createDefault(store);
    await assert.rejects(
      store.create({ machineId: IDS.machine, allowedCapabilities: ["report_status"] }),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "registration_conflict",
    );
    await assert.rejects(
      store.create({
        machineId: IDS.otherMachine,
        allowedCapabilities: ["raw_shell" as never],
      }),
      (error: unknown) => error instanceof DistributedControlContractError
        && error.code === "registration_invalid",
    );
    await assert.rejects(
      store.create({
        machineId: IDS.otherMachine,
        allowedCapabilities: ["report_status"],
        endpoint: "https://example.invalid",
      } as never),
      (error: unknown) => error instanceof DistributedControlContractError
        && error.code === "registration_invalid",
    );
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed, duplicate, ambiguous, or authority-widened durable state fails closed", async () => {
  const { root, store } = await fixture();
  try {
    const created = await createDefault(store);
    const file = path.join(root, "distributed-control", "machine-registrations.json");

    await writeFile(file, "{not-json", "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      registrations: [created, created],
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      registrations: [
        created,
        { ...created, registrationId: IDS.registrationB },
      ],
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      registrations: [{ ...created, endpoint: "https://example.invalid" }],
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      registrations: [created],
      writerExecutionEnabled: true,
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedRegistrationStoreError
        && error.code === "store_corrupt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
