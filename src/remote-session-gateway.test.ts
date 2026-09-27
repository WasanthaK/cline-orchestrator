import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteControlContractError } from "./remote-control-contract.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import {
  RemoteSessionGateway,
  RemoteSessionGatewayError,
} from "./remote-session-gateway.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  audit1: "55555555-5555-4555-8555-555555555551",
  audit2: "55555555-5555-4555-8555-555555555552",
  audit3: "55555555-5555-4555-8555-555555555553",
  audit4: "55555555-5555-4555-8555-555555555554",
  request1: "66666666-6666-4666-8666-666666666661",
  request2: "66666666-6666-4666-8666-666666666662",
  request3: "66666666-6666-4666-8666-666666666663",
};

const TOKEN = "rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function fixture(limits?: {
  sessionRequestsPerMinute?: number;
  registrationRequestsPerMinute?: number;
  maxActiveSessions?: number;
  maxReplayEntries?: number;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-session-"));
  let now = new Date("2026-09-27T12:00:00.000Z");
  const registrationStore = new RemoteRegistrationStore(root, {
    now: () => now,
    idFactory: () => IDS.registration,
  });
  await registrationStore.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: ["abort_task", "continue_task"],
    allowedReadOnlyCapabilities: ["passive_visualization", "task_validation_status"],
  });

  const generatedIds = [IDS.session, IDS.audit1, IDS.audit2, IDS.audit3, IDS.audit4];
  let idIndex = 0;
  const gateway = new RemoteSessionGateway(registrationStore, root, {
    now: () => now,
    idFactory: () => generatedIds[idIndex++] ?? "77777777-7777-4777-8777-777777777777",
    tokenFactory: () => TOKEN,
    limits,
  });
  return {
    root,
    registrationStore,
    gateway,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function issueDefault(gateway: RemoteSessionGateway) {
  return await gateway.issue(IDS.registration, {
    mutationActions: ["abort_task"],
    readOnlyCapabilities: ["passive_visualization"],
    ttlMs: 5 * 60 * 1000,
  });
}

test("local session issuance uses current durable registration and never persists bearer token", async () => {
  const { root, gateway } = await fixture();
  try {
    const issued = await issueDefault(gateway);
    assert.equal(issued.token, TOKEN);
    assert.equal(issued.claims.registrationId, IDS.registration);
    assert.equal(issued.claims.registrationRevision, 1);
    assert.deepEqual(issued.claims.mutationActions, ["abort_task"]);
    assert.equal(issued.claims.humanConfirmationAuthority, "none");
    assert.equal(issued.claims.safetyPlanAuthority, "none");

    const registrationRaw = await readFile(path.join(root, "remote-control", "registrations.json"), "utf8");
    const auditRaw = await readFile(path.join(root, "remote-control", "audit.jsonl"), "utf8");
    assert.equal(registrationRaw.includes(TOKEN), false);
    assert.equal(auditRaw.includes(TOKEN), false);
    assert.equal(auditRaw.includes("session_issued"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authorization revalidates registration, enforces capability and returns no token", async () => {
  const { root, gateway } = await fixture();
  try {
    await issueDefault(gateway);
    const authorized = await gateway.authorize(
      TOKEN,
      IDS.request1,
      { kind: "read", capability: "passive_visualization" },
    );
    assert.equal(authorized.sessionId, IDS.session);
    assert.equal(authorized.registrationId, IDS.registration);
    assert.deepEqual(authorized.access, { kind: "read", capability: "passive_visualization" });
    assert.equal("token" in authorized, false);

    await assert.rejects(
      gateway.authorize(
        TOKEN,
        IDS.request2,
        { kind: "mutation", action: "continue_task" },
      ),
      (error: unknown) => error instanceof RemoteSessionGatewayError && error.code === "capability_not_allowed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-use request ids reject replay and durable audit contains only sanitized request metadata", async () => {
  const { root, gateway } = await fixture();
  try {
    await issueDefault(gateway);
    await gateway.authorize(TOKEN, IDS.request1, { kind: "mutation", action: "abort_task" });
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request1, { kind: "mutation", action: "abort_task" }),
      (error: unknown) => error instanceof RemoteSessionGatewayError && error.code === "request_replayed",
    );

    const raw = await readFile(path.join(root, "remote-control", "audit.jsonl"), "utf8");
    assert.equal(raw.includes(TOKEN), false);
    assert.equal(raw.includes("request_authorized"), true);
    assert.equal(raw.includes("request_replayed"), true);
    assert.equal(raw.includes(IDS.request1), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("per-session rate limit fails closed and records denial", async () => {
  const { root, gateway } = await fixture({
    sessionRequestsPerMinute: 1,
    registrationRequestsPerMinute: 10,
  });
  try {
    await issueDefault(gateway);
    await gateway.authorize(TOKEN, IDS.request1, { kind: "read", capability: "passive_visualization" });
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request2, { kind: "read", capability: "passive_visualization" }),
      (error: unknown) => error instanceof RemoteSessionGatewayError && error.code === "rate_limited",
    );
    const raw = await readFile(path.join(root, "remote-control", "audit.jsonl"), "utf8");
    assert.equal(raw.includes("rate_limited"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration revision change invalidates process-local session before authorization", async () => {
  const { root, registrationStore, gateway } = await fixture();
  try {
    await issueDefault(gateway);
    await registrationStore.update(IDS.registration, {
      expectedRevision: 1,
      allowedMutationActions: ["abort_task"],
      allowedReadOnlyCapabilities: [],
    });
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request1, { kind: "read", capability: "passive_visualization" }),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration revocation invalidates session before authorization", async () => {
  const { root, registrationStore, gateway, setNow } = await fixture();
  try {
    await issueDefault(gateway);
    setNow("2026-09-27T12:01:00.000Z");
    await registrationStore.revoke(IDS.registration, { expectedRevision: 1 });
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request1, { kind: "mutation", action: "abort_task" }),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "registration_revoked",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local session revocation removes bearer authority and persists only sanitized revocation evidence", async () => {
  const { root, gateway } = await fixture();
  try {
    await issueDefault(gateway);
    await gateway.revokeSession(TOKEN);
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request1, { kind: "mutation", action: "abort_task" }),
      (error: unknown) => error instanceof RemoteSessionGatewayError && error.code === "session_not_found",
    );
    const raw = await readFile(path.join(root, "remote-control", "audit.jsonl"), "utf8");
    assert.equal(raw.includes("session_revoked"), true);
    assert.equal(raw.includes(TOKEN), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired session fails before replay/rate authorization", async () => {
  const { root, gateway, setNow } = await fixture();
  try {
    await issueDefault(gateway);
    setNow("2026-09-27T12:05:00.000Z");
    await assert.rejects(
      gateway.authorize(TOKEN, IDS.request1, { kind: "mutation", action: "abort_task" }),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "session_expired",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
