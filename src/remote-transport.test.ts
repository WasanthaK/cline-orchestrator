import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";
import {
  createLoopbackRemoteTransportServer,
  listenLoopbackRemoteTransport,
  MachineRemoteTaskValidationReader,
  type RemoteActiveWriterStatusV1,
  type RemoteSupervisorDecisionSummaryV1,
  type RemoteTaskValidationStatusV1,
  type RemoteTransportReadService,
} from "./remote-transport.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  task: "55555555-5555-4555-8555-555555555555",
  workspace: "66666666-6666-4666-8666-666666666666",
  audit: "77777777-7777-4777-8777-777777777777",
  request1: "88888888-8888-4888-8888-888888888881",
  request2: "88888888-8888-4888-8888-888888888882",
  request3: "88888888-8888-4888-8888-888888888883",
};

const TOKEN = "rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function visualization(): OperatorVisualizationV1 {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-27T13:00:00.000Z",
    readOnly: true,
    actions: [],
    header: {
      health: "healthy",
      activeTasks: 0,
      activeWorkflows: 0,
      openIncidents: 0,
      waitingForHuman: 0,
      activeWriters: 0,
      staleSources: 0,
      unavailableSources: 0,
    },
    sourceNotices: [],
    attention: [],
    taskBoard: [],
    workflows: [],
    incidents: [],
    specialistTimeline: [],
    activeWriters: [],
    truncation: {
      handoffs: false,
      writers: false,
      attention: false,
      sourceNotices: false,
    },
  };
}

async function fixture(readCapabilities: Array<
  "passive_visualization" | "task_validation_status" | "supervisor_decision_summary" | "active_writer_status"
> = ["passive_visualization", "task_validation_status", "supervisor_decision_summary", "active_writer_status"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-transport-"));
  let idCounter = 0;
  const ids = [IDS.registration, IDS.session, IDS.audit, IDS.audit, IDS.audit, IDS.audit];
  const registrations = new RemoteRegistrationStore(root, {
    now: () => new Date("2026-09-27T13:00:00.000Z"),
    idFactory: () => ids[idCounter++] ?? IDS.audit,
  });
  await registrations.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: [],
    allowedReadOnlyCapabilities: readCapabilities,
  });

  // Registration creation consumed the first ID. The gateway consumes one ID for
  // the session and one per audit record.
  const sessions = new RemoteSessionGateway(registrations, root, {
    now: () => new Date("2026-09-27T13:00:30.000Z"),
    idFactory: () => ids[idCounter++] ?? IDS.audit,
    tokenFactory: () => TOKEN,
  });
  await sessions.issue(IDS.registration, {
    mutationActions: [],
    readOnlyCapabilities: readCapabilities,
    ttlMs: 5 * 60 * 1000,
  });

  let visualizationCalls = 0;
  let validationCalls = 0;
  const reads: RemoteTransportReadService = {
    async getPassiveVisualization() {
      visualizationCalls += 1;
      return visualization();
    },
    async getTaskValidationStatus(taskId: string): Promise<RemoteTaskValidationStatusV1> {
      validationCalls += 1;
      return {
        schemaVersion: 1,
        taskId,
        workspaceId: IDS.workspace,
        status: "completed",
        updatedAt: "2026-09-27T12:59:00.000Z",
        runCount: 1,
        validation: {
          configuredCommands: 1,
          runCount: 1,
          repairCount: 0,
          lastPassed: true,
          lastCompletedAt: "2026-09-27T12:58:00.000Z",
        },
        diffSafety: {
          checkedAt: "2026-09-27T12:58:30.000Z",
          passed: true,
          changedFiles: 2,
          warningCount: 0,
          failureCount: 0,
        },
        waitingForHuman: false,
      };
    },
    async getSupervisorDecisionSummary(): Promise<RemoteSupervisorDecisionSummaryV1> {
      return {
        schemaVersion: 1,
        plannerProposals: 1,
        reviewerPasses: 1,
        reviewerRepairs: 0,
        reviewerEscalations: 0,
        pendingHumanEscalations: 0,
      };
    },
    async getActiveWriterStatus(): Promise<RemoteActiveWriterStatusV1> {
      return { schemaVersion: 1, writers: [] };
    },
  };

  const server = createLoopbackRemoteTransportServer(sessions, reads, {
    host: "127.0.0.1",
    port: 0,
  });
  const address = await listenLoopbackRemoteTransport(server, { host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}/remote/v1`;
  return {
    root,
    server,
    baseUrl,
    calls: {
      visualization: () => visualizationCalls,
      validation: () => validationCalls,
    },
  };
}

async function post(baseUrl: string, route: string, requestId: string, body: unknown, token = TOKEN) {
  return await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-orchestrator-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

async function close(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("loopback transport serves only authorized sanitized visualization reads", async () => {
  const { root, server, baseUrl, calls } = await fixture();
  try {
    const response = await post(baseUrl, "/read/visualization", IDS.request1, {});
    assert.equal(response.status, 200);
    const body = await response.json() as OperatorVisualizationV1;
    assert.equal(body.readOnly, true);
    assert.deepEqual(body.actions, []);
    assert.equal(calls.visualization(), 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("task validation route requires capability and returns only bounded validation/diff status", async () => {
  const { root, server, baseUrl, calls } = await fixture();
  try {
    const response = await post(baseUrl, "/read/task-validation", IDS.request1, { taskId: IDS.task });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.taskId, IDS.task);
    assert.equal("goal" in body, false);
    assert.equal("safety" in body, false);
    assert.equal("checkpoint" in body, false);
    assert.equal("error" in body, false);
    assert.equal(calls.validation(), 1);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("transport rejects replay before invoking read service twice", async () => {
  const { root, server, baseUrl, calls } = await fixture();
  try {
    const first = await post(baseUrl, "/read/visualization", IDS.request1, {});
    assert.equal(first.status, 200);
    const replay = await post(baseUrl, "/read/visualization", IDS.request1, {});
    assert.equal(replay.status, 403);
    const body = await replay.json() as { code: string };
    assert.equal(body.code, "request_replayed");
    assert.equal(calls.visualization(), 1);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("missing bearer, external browser origin and unexpected request fields fail before read execution", async () => {
  const { root, server, baseUrl, calls } = await fixture();
  try {
    const missingBearer = await fetch(`${baseUrl}/read/visualization`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orchestrator-request-id": IDS.request1,
      },
      body: "{}",
    });
    assert.equal(missingBearer.status, 401);

    const externalOrigin = await fetch(`${baseUrl}/read/visualization`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-orchestrator-request-id": IDS.request2,
        origin: "https://example.com",
      },
      body: "{}",
    });
    assert.equal(externalOrigin.status, 403);

    const unexpected = await post(baseUrl, "/read/task-validation", IDS.request3, {
      taskId: IDS.task,
      command: "do-not-run",
    });
    assert.equal(unexpected.status, 400);
    assert.equal(calls.visualization(), 0);
    assert.equal(calls.validation(), 0);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("registration without a read capability cannot access its route", async () => {
  const { root, server, baseUrl, calls } = await fixture(["task_validation_status"]);
  try {
    const response = await post(baseUrl, "/read/visualization", IDS.request1, {});
    assert.equal(response.status, 403);
    const body = await response.json() as { code: string };
    assert.equal(body.code, "capability_not_allowed");
    assert.equal(calls.visualization(), 0);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("transport has no mutation, session issuance or registration management routes", async () => {
  const { root, server, baseUrl } = await fixture();
  try {
    for (const [index, route] of [
      "/mutation/abort-task",
      "/sessions/issue",
      "/registrations",
      "/hub/send",
      "/process/restart",
    ].entries()) {
      const requestId = [IDS.request1, IDS.request2, IDS.request3][index % 3]!;
      const response = await post(baseUrl, route, requestId, {});
      assert.equal(response.status, 404, route);
    }
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("server factory refuses a non-loopback bind", () => {
  const fakeSessions = {} as RemoteSessionGateway;
  const fakeReads = {} as RemoteTransportReadService;
  assert.throws(
    () => createLoopbackRemoteTransportServer(fakeSessions, fakeReads, {
      host: "0.0.0.0" as never,
      port: 4320,
    }),
    /loopback/,
  );
});

test("machine validation reader strips goal, safety scope, checkpoint and error text", async () => {
  const reader = new MachineRemoteTaskValidationReader({
    async getTask() {
      return {
        taskId: IDS.task,
        projectId: "99999999-9999-4999-8999-999999999999",
        workspaceId: IDS.workspace,
        goal: "sensitive goal text",
        status: "validation_failed",
        createdAt: "2026-09-27T12:00:00.000Z",
        updatedAt: "2026-09-27T13:00:00.000Z",
        runCount: 2,
        sessionGeneration: 1,
        recoveryCount: 0,
        contextRotationCount: 0,
        validation: {
          configuredCommands: 2,
          runCount: 2,
          repairCount: 1,
          lastPassed: false,
          lastCompletedAt: "2026-09-27T12:59:00.000Z",
        },
        safety: {
          safetyPlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          policyVersion: "policy-v1",
          workerProfileId: "worker-secret-name",
          allowedPathPatterns: ["src/**"],
          protectedPathPatterns: [".env*"],
        },
        checkpoint: {
          checkpointId: "opaque-checkpoint",
          runCount: 2,
          createdAt: "2026-09-27T12:30:00.000Z",
          available: true,
        },
        diffSafety: {
          checkedAt: "2026-09-27T12:59:30.000Z",
          passed: false,
          finalDiffSummary: "sensitive diff summary",
          changedFiles: 3,
          warningCount: 1,
          failureCount: 1,
        },
        error: "sensitive validation stderr",
      };
    },
  });
  const view = await reader.getTaskValidationStatus(IDS.task);
  assert.equal(view.taskId, IDS.task);
  assert.equal(view.validation.lastPassed, false);
  assert.equal(view.diffSafety?.failureCount, 1);
  assert.equal("goal" in view, false);
  assert.equal("safety" in view, false);
  assert.equal("checkpoint" in view, false);
  assert.equal("error" in view, false);
  assert.equal("finalDiffSummary" in (view.diffSafety ?? {}), false);
});
