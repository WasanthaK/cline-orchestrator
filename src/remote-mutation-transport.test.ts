import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";
import {
  RemoteMutationApprovalBridge,
  type RemoteMutationActionAdapter,
} from "./remote-mutation-bridge.js";
import {
  createLoopbackRemoteMutationServer,
  listenLoopbackRemoteMutationServer,
} from "./remote-mutation-transport.js";

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
const HIDDEN_BINDING = "hidden-m10-confirmation-material";
const RAW_RESULT = "sensitive-m10-result-must-not-be-returned";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-mutation-transport-"));
  const now = new Date("2026-09-27T16:00:00.000Z");
  const registrations = new RemoteRegistrationStore(root, {
    now: () => now,
    idFactory: () => IDS.registration,
  });
  await registrations.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: ["abort_task"],
    allowedReadOnlyCapabilities: [],
  });

  let sessionIssued = false;
  const sessions = new RemoteSessionGateway(registrations, root, {
    now: () => now,
    idFactory: () => {
      if (!sessionIssued) {
        sessionIssued = true;
        return IDS.session;
      }
      return IDS.audit;
    },
    tokenFactory: () => BEARER,
  });
  await sessions.issue(IDS.registration, {
    mutationActions: ["abort_task"],
    readOnlyCapabilities: [],
    ttlMs: 10 * 60 * 1000,
  });

  let prepared = 0;
  let executed = 0;
  const adapter: RemoteMutationActionAdapter = {
    async prepare() {
      prepared += 1;
      return {
        actionBinding: HIDDEN_BINDING,
        expiresAt: "2026-09-27T16:01:00.000Z",
        async execute() {
          executed += 1;
          return { raw: RAW_RESULT };
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
  const server = createLoopbackRemoteMutationServer(bridge, { host: "127.0.0.1", port: 0 });
  const address = await listenLoopbackRemoteMutationServer(server, { host: "127.0.0.1", port: 0 });
  return {
    root,
    bridge,
    server,
    baseUrl: `http://127.0.0.1:${address.port}/remote/v1`,
    prepared: () => prepared,
    executed: () => executed,
  };
}

async function post(baseUrl: string, route: string, requestId: string, body: unknown) {
  return await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
      "x-orchestrator-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

async function close(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("remote mutation propose route creates pending proposal but cannot perform local approval", async () => {
  const { root, bridge, server, baseUrl, prepared, executed } = await fixture();
  try {
    const response = await post(baseUrl, "/mutation/propose", IDS.request1, {
      action: "abort_task",
      targetId: IDS.task,
      payload: {},
    });
    assert.equal(response.status, 202);
    const body = await response.json() as {
      proposal: { proposalId: string; status: string };
      localApprovalRequired: boolean;
    };
    assert.equal(body.proposal.proposalId, IDS.proposal);
    assert.equal(body.proposal.status, "pending");
    assert.equal(body.localApprovalRequired, true);
    assert.equal(prepared(), 0);
    assert.equal(executed(), 0);

    const approvalRoute = await post(baseUrl, "/mutation/approve", IDS.request2, {
      proposalId: IDS.proposal,
    });
    assert.equal(approvalRoute.status, 404);
    assert.equal((await bridge.proposals.get(IDS.proposal)).status, "pending");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("execution route requires distinct local approval permit and suppresses raw M10 result", async () => {
  const { root, bridge, server, baseUrl, prepared, executed } = await fixture();
  try {
    const proposed = await post(baseUrl, "/mutation/propose", IDS.request1, {
      action: "abort_task",
      targetId: IDS.task,
      payload: {},
    });
    assert.equal(proposed.status, 202);

    const pendingExecution = await post(baseUrl, "/mutation/execute", IDS.request2, {
      proposalId: IDS.proposal,
      bridgePermit: "not-a-human-approved-permit-but-long-enough-1234567890",
      payload: {},
    });
    assert.equal(pendingExecution.status, 403);
    assert.equal(executed(), 0);

    const proposal = await bridge.proposals.get(IDS.proposal);
    const approval = await bridge.approveLocally(proposal.proposalId, proposal.revision);
    assert.equal(approval.bridgePermit, PERMIT);
    assert.equal(prepared(), 1);

    const response = await post(baseUrl, "/mutation/execute", IDS.request3, {
      proposalId: IDS.proposal,
      bridgePermit: PERMIT,
      payload: {},
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.equal(raw.includes(RAW_RESULT), false);
    assert.equal(raw.includes(HIDDEN_BINDING), false);
    assert.equal(raw.includes(PERMIT), false);
    const body = JSON.parse(raw) as { executed: boolean; proposal: { status: string } };
    assert.equal(body.executed, true);
    assert.equal(body.proposal.status, "executed");
    assert.equal(executed(), 1);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("proposal request id is replay protected by the shared 11C session boundary", async () => {
  const { root, server, baseUrl } = await fixture();
  try {
    const first = await post(baseUrl, "/mutation/propose", IDS.request1, {
      action: "abort_task",
      targetId: IDS.task,
      payload: {},
    });
    assert.equal(first.status, 202);
    const replay = await post(baseUrl, "/mutation/propose", IDS.request1, {
      action: "abort_task",
      targetId: IDS.task,
      payload: {},
    });
    assert.equal(replay.status, 403);
    const body = await replay.json() as { code: string };
    assert.equal(body.code, "request_replayed");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported mutation action is rejected before bridge proposal creation", async () => {
  const { root, server, baseUrl } = await fixture();
  try {
    const response = await post(baseUrl, "/mutation/propose", IDS.request1, {
      action: "raw_hub_control",
      targetId: IDS.task,
      payload: {},
    });
    assert.equal(response.status, 400);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("remote mutation server refuses non-loopback bind", () => {
  assert.throws(
    () => createLoopbackRemoteMutationServer({} as RemoteMutationApprovalBridge, {
      host: "0.0.0.0" as never,
      port: 4321,
    }),
    /loopback/,
  );
});
