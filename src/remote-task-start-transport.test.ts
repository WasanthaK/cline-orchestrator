import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createLoopbackRemoteTaskStartServer,
  listenLoopbackRemoteTaskStartServer,
} from "./remote-task-start-transport.js";

const IDS = {
  proposal: "11111111-1111-4111-8111-111111111111",
  registration: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  principal: "44444444-4444-4444-8444-444444444444",
  request1: "55555555-5555-4555-8555-555555555551",
  request2: "55555555-5555-4555-8555-555555555552",
  workspace: "66666666-6666-4666-8666-666666666666",
  task: "77777777-7777-4777-8777-777777777777",
  project: "88888888-8888-4888-8888-888888888888",
};

const TOKEN = "rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PERMIT = "rtp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function proposal(status: "pending" | "started" = "pending") {
  return {
    schemaVersion: 1 as const,
    proposalId: IDS.proposal,
    registrationId: IDS.registration,
    sessionId: IDS.session,
    remotePrincipalId: IDS.principal,
    registrationRevision: 1,
    requestId: IDS.request1,
    workspaceId: IDS.workspace,
    goalDigest: "a".repeat(64),
    goalChars: 20,
    requestedScopeDigest: "b".repeat(64),
    requestedScopeCount: 1,
    revision: status === "pending" ? 1 : 4,
    status,
    createdAt: "2026-09-28T00:00:00.000Z",
    ...(status === "started" ? {
      previewedAt: "2026-09-28T00:00:10.000Z",
      previewDigest: "c".repeat(64),
      approvedAt: "2026-09-28T00:00:20.000Z",
      startedAt: "2026-09-28T00:00:30.000Z",
      startedTaskId: IDS.task,
    } : {}),
  };
}

async function fixture() {
  let proposeCalls = 0;
  let executeCalls = 0;
  const bridge = {
    async propose(input: any) {
      proposeCalls += 1;
      assert.equal(input.bearerToken, TOKEN);
      assert.equal(input.requestId, IDS.request1);
      assert.equal(input.request.workspaceId, IDS.workspace);
      assert.equal(input.request.goal, "Make the bounded change");
      assert.deepEqual(input.request.requestedScope, ["src/example.ts"]);
      return proposal("pending");
    },
    async executeApproved(input: any) {
      executeCalls += 1;
      assert.equal(input.bearerToken, TOKEN);
      assert.equal(input.requestId, IDS.request2);
      assert.equal(input.proposalId, IDS.proposal);
      assert.equal(input.startPermit, PERMIT);
      return {
        schemaVersion: 1 as const,
        proposal: proposal("started"),
        task: {
          taskId: IDS.task,
          workspaceId: IDS.workspace,
          projectId: IDS.project,
          status: "waiting",
          createdAt: "2026-09-28T00:00:30.000Z",
          updatedAt: "2026-09-28T00:00:30.000Z",
        },
      };
    },
  };
  const server = createLoopbackRemoteTaskStartServer(bridge as any, { host: "127.0.0.1", port: 0 });
  const address = await listenLoopbackRemoteTaskStartServer(server, { host: "127.0.0.1", port: 0 });
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/remote/v1`,
    calls: { propose: () => proposeCalls, execute: () => executeCalls },
  };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function post(baseUrl: string, route: string, requestId: string, body: unknown) {
  return await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-orchestrator-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

test("loopback task-start transport exposes proposal and permit execution only", async () => {
  const { server, baseUrl, calls } = await fixture();
  try {
    const proposed = await post(baseUrl, "/task-start/propose", IDS.request1, {
      workspaceId: IDS.workspace,
      goal: "Make the bounded change",
      requestedScope: ["src/example.ts"],
    });
    assert.equal(proposed.status, 202);
    const proposedBody = await proposed.json() as any;
    assert.equal(proposedBody.localSafetyPreviewRequired, true);
    assert.equal(proposedBody.proposal.status, "pending");
    assert.equal("goal" in proposedBody.proposal, false);
    assert.equal("planToken" in proposedBody.proposal, false);
    assert.equal(calls.propose(), 1);

    const executed = await post(baseUrl, "/task-start/execute", IDS.request2, {
      proposalId: IDS.proposal,
      startPermit: PERMIT,
    });
    assert.equal(executed.status, 200);
    const executedBody = await executed.json() as any;
    assert.equal(executedBody.started, true);
    assert.equal(executedBody.task.taskId, IDS.task);
    assert.equal("goal" in executedBody.task, false);
    assert.equal("safety" in executedBody.task, false);
    assert.equal(calls.execute(), 1);
  } finally {
    await close(server);
  }
});

test("Safety Preview and human approval routes do not exist remotely", async () => {
  const { server, baseUrl, calls } = await fixture();
  try {
    for (const route of ["/task-start/preview", "/task-start/approve", "/task-start/confirm"]) {
      const response = await post(baseUrl, route, IDS.request1, {});
      assert.equal(response.status, 404);
    }
    assert.equal(calls.propose(), 0);
    assert.equal(calls.execute(), 0);
  } finally {
    await close(server);
  }
});

test("unexpected task-start fields are rejected before bridge invocation", async () => {
  const { server, baseUrl, calls } = await fixture();
  try {
    const response = await post(baseUrl, "/task-start/propose", IDS.request1, {
      workspaceId: IDS.workspace,
      goal: "Make the bounded change",
      requestedScope: ["src/example.ts"],
      shell: "rm -rf /",
    });
    assert.equal(response.status, 400);
    assert.equal(calls.propose(), 0);
  } finally {
    await close(server);
  }
});

test("external browser Origin is rejected before bridge invocation", async () => {
  const { server, baseUrl, calls } = await fixture();
  try {
    const response = await fetch(`${baseUrl}/task-start/propose`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-orchestrator-request-id": IDS.request1,
        origin: "https://example.com",
      },
      body: JSON.stringify({ workspaceId: IDS.workspace, goal: "Make the bounded change" }),
    });
    assert.equal(response.status, 403);
    assert.equal(calls.propose(), 0);
  } finally {
    await close(server);
  }
});

test("non-loopback Host is rejected before bridge invocation", async () => {
  const { server, baseUrl, calls } = await fixture();
  try {
    const port = new URL(baseUrl).port;
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/remote/v1/task-start/propose",
        method: "POST",
        headers: {
          host: "evil.example",
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "x-orchestrator-request-id": IDS.request1,
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ workspaceId: IDS.workspace, goal: "Make the bounded change" }));
    });
    assert.equal(result.status, 403);
    assert.match(result.body, /host_not_allowed/);
    assert.equal(calls.propose(), 0);
  } finally {
    await close(server);
  }
});
