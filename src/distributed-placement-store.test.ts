import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDistributedPlacementCurrent,
  DistributedControlContractError,
  type DistributedMachineRegistrationV1,
} from "./distributed-control-contract.js";
import {
  DistributedPlacementStore,
  DistributedPlacementStoreError,
  type DistributedMachineRegistrationLookup,
} from "./distributed-placement-store.js";

const IDS = {
  placementA: "11111111-1111-4111-8111-111111111111",
  placementB: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  otherWorkspace: "44444444-4444-4444-8444-444444444444",
  registrationA: "55555555-5555-4555-8555-555555555555",
  registrationB: "66666666-6666-4666-8666-666666666666",
  machineA: "77777777-7777-4777-8777-777777777777",
  machineB: "88888888-8888-4888-8888-888888888888",
};

function registration(
  registrationId = IDS.registrationA,
  machineId = IDS.machineA,
  revision = 1,
  overrides: Partial<DistributedMachineRegistrationV1> = {},
): DistributedMachineRegistrationV1 {
  return {
    schemaVersion: 1,
    registrationId,
    machineId,
    revision,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: revision === 1 ? "2026-09-29T00:00:00.000Z" : "2026-09-29T00:10:00.000Z",
    allowedCapabilities: ["report_status", "accept_writer_candidates"],
    authority: "identity_only",
    ...overrides,
  };
}

class Lookup implements DistributedMachineRegistrationLookup {
  readonly values = new Map<string, DistributedMachineRegistrationV1>();

  set(value: DistributedMachineRegistrationV1): void {
    this.values.set(value.registrationId, structuredClone(value));
  }

  async get(registrationId: string): Promise<DistributedMachineRegistrationV1> {
    const value = this.values.get(registrationId);
    if (!value) throw new Error("registration not found");
    return structuredClone(value);
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-distributed-placement-"));
  let now = new Date("2026-09-29T00:20:00.000Z");
  const ids = [IDS.placementA, IDS.placementB];
  const lookup = new Lookup();
  lookup.set(registration());
  const store = new DistributedPlacementStore(root, lookup, {
    now: () => now,
    idFactory: () => ids.shift() ?? IDS.placementB,
  });
  return {
    root,
    store,
    lookup,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function createDefault(store: DistributedPlacementStore) {
  return await store.create({
    workspaceId: IDS.workspace,
    machineRegistrationId: IDS.registrationA,
    expectedMachineRegistrationRevision: 1,
  });
}

test("workspace placement persists routing-only state with restrictive file mode", async () => {
  const { root, store } = await fixture();
  try {
    const created = await createDefault(store);
    assert.deepEqual(created, {
      schemaVersion: 1,
      placementId: IDS.placementA,
      workspaceId: IDS.workspace,
      machineId: IDS.machineA,
      machineRegistrationId: IDS.registrationA,
      machineRegistrationRevision: 1,
      revision: 1,
      createdAt: "2026-09-29T00:20:00.000Z",
      updatedAt: "2026-09-29T00:20:00.000Z",
      authority: "routing_only",
    });

    assert.deepEqual(await store.get(IDS.placementA), created);
    assert.deepEqual(await store.list(), [created]);

    const file = path.join(root, "distributed-control", "workspace-placements.json");
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
      "writerLease",
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

test("placement creation requires one current non-revoked exact registration revision", async () => {
  const { root, store, lookup } = await fixture();
  try {
    await assert.rejects(
      store.create({
        workspaceId: IDS.workspace,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 2,
      }),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "registration_not_current",
    );

    lookup.set(registration(IDS.registrationA, IDS.machineA, 1, {
      revokedAt: "2026-09-29T00:15:00.000Z",
      updatedAt: "2026-09-29T00:15:00.000Z",
    }));
    await assert.rejects(
      createDefault(store),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "registration_not_current",
    );
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("placement update is revision checked and can rebind stale routing to a new registration revision", async () => {
  const { root, store, lookup, setNow } = await fixture();
  try {
    await createDefault(store);
    lookup.set(registration(IDS.registrationA, IDS.machineA, 2));
    setNow("2026-09-29T00:30:00.000Z");

    const updated = await store.update(IDS.placementA, {
      expectedRevision: 1,
      machineRegistrationId: IDS.registrationA,
      expectedMachineRegistrationRevision: 2,
    });
    assert.equal(updated.revision, 2);
    assert.equal(updated.machineRegistrationRevision, 2);
    assert.equal(updated.updatedAt, "2026-09-29T00:30:00.000Z");
    assert.doesNotThrow(() => assertDistributedPlacementCurrent(
      updated,
      registration(IDS.registrationA, IDS.machineA, 2),
    ));

    await assert.rejects(
      store.update(IDS.placementA, {
        expectedRevision: 1,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 2,
      }),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "placement_conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("placement may move to another current machine registration but derives machine identity from registration state", async () => {
  const { root, store, lookup, setNow } = await fixture();
  try {
    await createDefault(store);
    lookup.set(registration(IDS.registrationB, IDS.machineB, 1));
    setNow("2026-09-29T00:31:00.000Z");

    const moved = await store.update(IDS.placementA, {
      expectedRevision: 1,
      machineRegistrationId: IDS.registrationB,
      expectedMachineRegistrationRevision: 1,
    });
    assert.equal(moved.machineId, IDS.machineB);
    assert.equal(moved.machineRegistrationId, IDS.registrationB);
    assert.equal(moved.machineRegistrationRevision, 1);
    assert.equal(moved.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disable is exact-revision checked, terminal, and permits a later distinct active placement", async () => {
  const { root, store, setNow } = await fixture();
  try {
    await createDefault(store);
    setNow("2026-09-29T00:40:00.000Z");
    const disabled = await store.disable(IDS.placementA, { expectedRevision: 1 });
    assert.equal(disabled.revision, 2);
    assert.equal(disabled.disabledAt, "2026-09-29T00:40:00.000Z");
    assert.equal(disabled.updatedAt, disabled.disabledAt);

    await assert.rejects(
      store.disable(IDS.placementA, { expectedRevision: 2 }),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "placement_disabled",
    );
    await assert.rejects(
      store.update(IDS.placementA, {
        expectedRevision: 2,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 1,
      }),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "placement_disabled",
    );

    setNow("2026-09-29T00:41:00.000Z");
    const replacement = await store.create({
      workspaceId: IDS.workspace,
      machineRegistrationId: IDS.registrationA,
      expectedMachineRegistrationRevision: 1,
    });
    assert.equal(replacement.placementId, IDS.placementB);
    assert.equal(replacement.revision, 1);
    assert.equal((await store.list()).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serialized concurrent updates cannot both win one placement revision", async () => {
  const { root, store, lookup, setNow } = await fixture();
  try {
    await createDefault(store);
    lookup.set(registration(IDS.registrationB, IDS.machineB, 1));
    setNow("2026-09-29T00:30:00.000Z");
    const results = await Promise.allSettled([
      store.update(IDS.placementA, {
        expectedRevision: 1,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 1,
      }),
      store.update(IDS.placementA, {
        expectedRevision: 1,
        machineRegistrationId: IDS.registrationB,
        expectedMachineRegistrationRevision: 1,
      }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof DistributedPlacementStoreError);
    assert.equal(rejected.reason.code, "placement_conflict");
    assert.equal((await store.get(IDS.placementA)).revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate active workspace and authority-widening request fields fail closed", async () => {
  const { root, store } = await fixture();
  try {
    await createDefault(store);
    await assert.rejects(
      store.create({
        workspaceId: IDS.workspace,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 1,
      }),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "placement_conflict",
    );
    await assert.rejects(
      store.create({
        workspaceId: IDS.otherWorkspace,
        machineRegistrationId: IDS.registrationA,
        expectedMachineRegistrationRevision: 1,
        endpoint: "https://example.invalid",
      } as never),
      (error: unknown) => error instanceof DistributedControlContractError
        && error.code === "placement_invalid",
    );
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed, duplicate, ambiguous, or authority-widened durable placement state fails closed", async () => {
  const { root, store } = await fixture();
  try {
    const created = await createDefault(store);
    const file = path.join(root, "distributed-control", "workspace-placements.json");

    await writeFile(file, "{not-json", "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({ schemaVersion: 1, placements: [created, created] }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      placements: [created, { ...created, placementId: IDS.placementB }],
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      placements: [{ ...created, endpoint: "https://example.invalid" }],
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "store_corrupt",
    );

    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      placements: [created],
      writerExecutionEnabled: true,
    }), "utf8");
    await assert.rejects(
      store.list(),
      (error: unknown) => error instanceof DistributedPlacementStoreError
        && error.code === "store_corrupt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
