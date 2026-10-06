import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";
import {
  RemoteMutationApprovalBridge,
  RemoteMutationBridgeError,
  type RemoteMutationActionAdapter,
} from "./remote-mutation-bridge.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  task: "55555555-5555-4555-8555-555555555555",
  proposal: "66666666-6666-4666-8666-666666666666",
  audit: "77777777-7777-4777-8777-777777777777",
  request1: "88888888-8888-4888-8888-888888888881",
  request2: "88888888-8888-4888-8888-888888888882",
  request3: "88888888-8888-4888-8888-888888888883",
};

const BEARER = "rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PERMIT = "rmp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HIDDEN_M10_BINDING = "m10_confirmation_secret_must_never_be_persisted_or_returned";
const PAYLOAD = { reason: "sensitive-payload-text" };

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-mutation-"));
  let now = new Date("2026-09-27T14:00:00.000Z");
  const registrations = new RemoteRegistrationStore(root, {
    now: () => now,
    idFactory: () => IDS.registration,
  });
  await registrations.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: ["abort_task", "continue_task"],
    allowedReadOnlyCapabilities: [],
  });

  let sessionIdUsed = false;
  const sessions = new RemoteSessionGateway(registrations, root, {
    now: () => now,
    idFactory: () => {
      if (!sessionIdUsed) {
        sessionIdUsed = true;
        return IDS.session;
      }
      return IDS.audit;
    },
    tokenFactory: () => BEARER,
  });
  await sessions.issue(IDS.registration, {
    mutationActions: ["abort_task", "continue_task"],
    readOnlyCapabilities: [],
    ttlMs: 10 * 60 * 1000,
  });

  let prepareCalls = 0;
  let executeCalls = 0;
  const adapter: RemoteMutationActionAdapter = {
    async prepare() {
      prepareCalls += 1;
      return {
        actionBinding: HIDDEN_M10_BINDING,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        async execute() {
          executeCalls += 1;
          return { ok: true, source: "trusted-m10-wrapper" };
        },
      };
    },
  };
  const bridge = new RemoteMutationApprovalBridge(
    sessions,
    registrations,
    adapter,
    root,
    {
      now: () => now,
      idFactory: () => IDS.proposal,
      permitFactory: () => PERMIT,
    },
  );

  return {
    root,
    registrations,
    sessions,
    bridge,
    adapter,
    prepareCalls: () => prepareCalls,
    executeCalls: () => executeCalls,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function propose(bridge: RemoteMutationApprovalBridge) {
  return await bridge.propose({
    bearerToken: BEARER,
    requestId: IDS.request1,
    action: "abort_task",
    targetId: IDS.task,
    payload: PAYLOAD,
  });
}

test("remote mutation proposal persists only payload evidence, never bearer or plaintext payload", async () => {
  const { root, bridge } = await fixture();
  try {
    const proposal = await propose(bridge);
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.action, "abort_task");
    assert.match(proposal.payloadDigest, /^[a-f0-9]{64}$/);

    const raw = await readFile(path.join(root, "remote-control", "mutation-proposals.json"), "utf8");
    assert.equal(raw.includes(BEARER), false);
    assert.equal(raw.includes("sensitive-payload-text"), false);
    assert.equal(raw.includes(PERMIT), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local approval is distinct from remote session authority and never persists hidden M10 binding or bridge permit", async () => {
  const { root, bridge, prepareCalls } = await fixture();
  try {
    const proposal = await propose(bridge);
    const approval = await bridge.approveLocally(proposal.proposalId, proposal.revision);
    assert.equal(approval.bridgePermit, PERMIT);
    assert.equal(approval.proposal.status, "approved");
    assert.equal(prepareCalls(), 1);

    const raw = await readFile(path.join(root, "remote-control", "mutation-proposals.json"), "utf8");
    assert.equal(raw.includes(PERMIT), false);
    assert.equal(raw.includes(BEARER), false);
    assert.equal(raw.includes(HIDDEN_M10_BINDING), false);
    assert.match(approval.proposal.actionBinding ?? "", /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved bridge permit is single-use, exact-payload-bound and delegates once", async () => {
  const { root, bridge, executeCalls } = await fixture();
  try {
    const proposal = await propose(bridge);
    await bridge.approveLocally(proposal.proposalId, proposal.revision);
    const result = await bridge.executeApproved({
      bearerToken: BEARER,
      requestId: IDS.request2,
      proposalId: proposal.proposalId,
      bridgePermit: PERMIT,
      payload: { reason: "sensitive-payload-text" },
    });
    assert.equal(result.proposal.status, "executed");
    assert.deepEqual(result.result, { ok: true, source: "trusted-m10-wrapper" });
    assert.equal(executeCalls(), 1);

    await assert.rejects(
      bridge.executeApproved({
        bearerToken: BEARER,
        requestId: IDS.request3,
        proposalId: proposal.proposalId,
        bridgePermit: PERMIT,
        payload: PAYLOAD,
      }),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "permit_invalid",
    );
    assert.equal(executeCalls(), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wrong payload after permit consumption fails terminally and cannot be retried", async () => {
  const { root, bridge, executeCalls } = await fixture();
  try {
    const proposal = await propose(bridge);
    await bridge.approveLocally(proposal.proposalId, proposal.revision);
    await assert.rejects(
      bridge.executeApproved({
        bearerToken: BEARER,
        requestId: IDS.request2,
        proposalId: proposal.proposalId,
        bridgePermit: PERMIT,
        payload: { reason: "different-payload" },
      }),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_stale",
    );
    assert.equal((await bridge.proposals.get(proposal.proposalId)).status, "execution_failed");
    assert.equal(executeCalls(), 0);

    await assert.rejects(
      bridge.executeApproved({
        bearerToken: BEARER,
        requestId: IDS.request3,
        proposalId: proposal.proposalId,
        bridgePermit: PERMIT,
        payload: PAYLOAD,
      }),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "permit_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration revision drift prevents local approval before trusted action preparation", async () => {
  const { root, registrations, bridge, prepareCalls } = await fixture();
  try {
    const proposal = await propose(bridge);
    await registrations.update(IDS.registration, {
      expectedRevision: 1,
      allowedMutationActions: ["abort_task"],
      allowedReadOnlyCapabilities: [],
    });
    await assert.rejects(
      bridge.approveLocally(proposal.proposalId, proposal.revision),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_stale",
    );
    assert.equal(prepareCalls(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart loses plaintext proposal material and therefore fails closed until a new proposal is submitted", async () => {
  const { root, registrations, sessions, bridge, adapter } = await fixture();
  try {
    const proposal = await propose(bridge);
    const restarted = new RemoteMutationApprovalBridge(sessions, registrations, adapter, root, {
      now: () => new Date("2026-09-27T14:00:30.000Z"),
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      permitFactory: () => PERMIT,
    });
    await assert.rejects(
      restarted.approveLocally(proposal.proposalId, proposal.revision),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_material_unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local rejection is terminal evidence and never prepares a trusted mutation", async () => {
  const { root, bridge, prepareCalls } = await fixture();
  try {
    const proposal = await propose(bridge);
    const rejected = await bridge.rejectLocally(proposal.proposalId, proposal.revision);
    assert.equal(rejected.status, "rejected");
    assert.equal(prepareCalls(), 0);
    await assert.rejects(
      bridge.approveLocally(rejected.proposalId, rejected.revision),
      (error: unknown) => error instanceof RemoteMutationBridgeError && error.code === "proposal_conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
