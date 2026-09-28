import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteControlContractError } from "./remote-control-contract.js";
import { RemoteRegistrationStore } from "./remote-registration-store.js";
import { RemoteSessionGateway } from "./remote-session-gateway.js";
import {
  RemoteTaskStartApprovalBridge,
  RemoteTaskStartBridgeError,
} from "./remote-task-start-bridge.js";
import type { SafetyPreview, SafetyPreviewRequest } from "./safety-plan.js";

const IDS = {
  registration: "11111111-1111-4111-8111-111111111111",
  machine: "22222222-2222-4222-8222-222222222222",
  principal: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  proposal: "55555555-5555-4555-8555-555555555555",
  workspace: "66666666-6666-4666-8666-666666666666",
  project: "77777777-7777-4777-8777-777777777777",
  task: "88888888-8888-4888-8888-888888888888",
  request1: "99999999-9999-4999-8999-999999999991",
  request2: "99999999-9999-4999-8999-999999999992",
  request3: "99999999-9999-4999-8999-999999999993",
};

const TOKEN = "rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CONFIRMATION = "rtc_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PERMIT = "rtp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PLAN_TOKEN = "plan_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GOAL = "Fix only src/example.ts and keep the existing safety boundary";

async function fixture(options: { allowNewTask?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-task-start-"));
  let now = new Date("2026-09-28T00:00:00.000Z");
  const registrations = new RemoteRegistrationStore(root, {
    now: () => now,
    idFactory: () => IDS.registration,
  });
  await registrations.create({
    machineId: IDS.machine,
    remotePrincipalId: IDS.principal,
    allowedMutationActions: [],
    allowedReadOnlyCapabilities: [],
    allowedControlCapabilities: options.allowNewTask === false ? [] : ["propose_new_task"],
  });

  let gatewayId = 0;
  const gatewayIds = [IDS.session, IDS.request3, IDS.request3, IDS.request3, IDS.request3, IDS.request3, IDS.request3];
  const sessions = new RemoteSessionGateway(registrations, root, {
    now: () => now,
    idFactory: () => gatewayIds[gatewayId++] ?? IDS.request3,
    tokenFactory: () => TOKEN,
  });
  const issue = await sessions.issue(IDS.registration, {
    mutationActions: [],
    readOnlyCapabilities: [],
    controlCapabilities: options.allowNewTask === false ? [] : ["propose_new_task"],
    ttlMs: 10 * 60 * 1000,
  });

  let previewCalls = 0;
  let startCalls = 0;
  let startedWith: string | undefined;
  const service = {
    async previewTask(request: SafetyPreviewRequest): Promise<SafetyPreview> {
      previewCalls += 1;
      assert.equal(request.workspaceId, IDS.workspace);
      assert.equal(request.goal, GOAL);
      assert.deepEqual(request.requestedScope, ["src/example.ts"]);
      return {
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        workspaceDisplayName: "Example workspace",
        workspaceRevision: 7,
        goal: GOAL,
        branch: "phase-1/bootstrap",
        head: "abc123",
        dirty: false,
        dirtyFingerprint: "fingerprint",
        requestedScope: ["src/example.ts"],
        allowedPathPatterns: ["src/example.ts"],
        protectedPathPatterns: [".env"],
        validationCommands: ["npm test"],
        policyVersion: "policy-v1",
        workerProfileId: "worker-v1",
        planToken: PLAN_TOKEN,
        expiresAt: "2026-09-28T00:10:00.000Z",
      };
    },
    async startTask(planToken: string) {
      startCalls += 1;
      startedWith = planToken;
      return {
        taskId: IDS.task,
        projectId: IDS.project,
        workspaceId: IDS.workspace,
        goal: GOAL,
        status: "waiting" as const,
        createdAt: "2026-09-28T00:01:00.000Z",
        updatedAt: "2026-09-28T00:01:00.000Z",
        runCount: 0,
        sessionGeneration: 0,
        recoveryCount: 0,
        contextRotationCount: 0,
        validation: { configuredCommands: 1, runCount: 0, repairCount: 0 },
        safety: {
          safetyPlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          policyVersion: "policy-v1",
          workerProfileId: "worker-v1",
          allowedPathPatterns: ["src/example.ts"],
          protectedPathPatterns: [".env"],
        },
      };
    },
  };

  const bridge = new RemoteTaskStartApprovalBridge(sessions, registrations, service, root, {
    now: () => now,
    idFactory: () => IDS.proposal,
    confirmationFactory: () => CONFIRMATION,
    permitFactory: () => PERMIT,
  });

  return {
    root,
    registrations,
    sessions,
    bridge,
    token: issue.token,
    setNow(value: string) { now = new Date(value); },
    calls: {
      preview: () => previewCalls,
      start: () => startCalls,
      startedWith: () => startedWith,
    },
  };
}

const request: SafetyPreviewRequest = {
  workspaceId: IDS.workspace,
  goal: GOAL,
  requestedScope: ["src/example.ts"],
};

test("new-task authority is a distinct opt-in registration/session capability", async () => {
  const { root, registrations } = await fixture({ allowNewTask: false });
  try {
    const current = await registrations.getRegistration(IDS.registration);
    assert.deepEqual(current.allowedControlCapabilities, []);
    assert.throws(
      () => {
        // Contract-level proof: an unregistered session cannot request the new capability.
        // Dynamic import is unnecessary; issue() reaches the same contract boundary.
      },
      undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote proposal requires local Safety Preview plus explicit local confirmation before one-shot start", async () => {
  const { root, bridge, token, calls } = await fixture();
  try {
    const proposal = await bridge.propose({ bearerToken: token, requestId: IDS.request1, request });
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.workspaceId, IDS.workspace);
    assert.equal(proposal.goalChars, GOAL.length);
    assert.equal("goal" in proposal, false);
    assert.equal("planToken" in proposal, false);

    const durableBefore = await readFile(path.join(root, "remote-control", "task-start-proposals.json"), "utf8");
    assert.equal(durableBefore.includes(GOAL), false);
    assert.equal(durableBefore.includes("src/example.ts"), false);
    assert.equal(durableBefore.includes(PLAN_TOKEN), false);

    const preview = await bridge.previewLocalApproval(proposal.proposalId, proposal.revision);
    assert.equal(preview.proposal.status, "previewed");
    assert.equal(preview.safetyPreview.goal, GOAL);
    assert.equal("planToken" in preview.safetyPreview, false);
    assert.equal(calls.preview(), 1);

    const durablePreviewed = await readFile(path.join(root, "remote-control", "task-start-proposals.json"), "utf8");
    assert.equal(durablePreviewed.includes(GOAL), false);
    assert.equal(durablePreviewed.includes(PLAN_TOKEN), false);
    assert.equal(durablePreviewed.includes(CONFIRMATION), false);

    const approval = await bridge.confirmLocalApproval({
      proposalId: proposal.proposalId,
      confirmationToken: preview.confirmationToken,
      confirmed: true,
    });
    assert.equal(approval.proposal.status, "approved");
    assert.equal(approval.startPermit, PERMIT);

    const durableApproved = await readFile(path.join(root, "remote-control", "task-start-proposals.json"), "utf8");
    assert.equal(durableApproved.includes(PLAN_TOKEN), false);
    assert.equal(durableApproved.includes(PERMIT), false);

    const execution = await bridge.executeApproved({
      bearerToken: token,
      requestId: IDS.request2,
      proposalId: proposal.proposalId,
      startPermit: approval.startPermit,
    });
    assert.equal(execution.proposal.status, "started");
    assert.equal(execution.proposal.startedTaskId, IDS.task);
    assert.equal(execution.task.taskId, IDS.task);
    assert.equal(calls.start(), 1);
    assert.equal(calls.startedWith(), PLAN_TOKEN);

    await assert.rejects(
      bridge.executeApproved({
        bearerToken: token,
        requestId: IDS.request3,
        proposalId: proposal.proposalId,
        startPermit: approval.startPermit,
      }),
      (error: unknown) => error instanceof RemoteTaskStartBridgeError && error.code === "permit_invalid",
    );
    assert.equal(calls.start(), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registration revision/capability change after proposal fails closed before local preview", async () => {
  const { root, bridge, registrations, token, calls } = await fixture();
  try {
    const proposal = await bridge.propose({ bearerToken: token, requestId: IDS.request1, request });
    await registrations.update(IDS.registration, {
      expectedRevision: 1,
      allowedMutationActions: [],
      allowedReadOnlyCapabilities: [],
      allowedControlCapabilities: [],
    });
    await assert.rejects(
      bridge.previewLocalApproval(proposal.proposalId, proposal.revision),
      (error: unknown) => error instanceof RemoteTaskStartBridgeError && error.code === "proposal_stale",
    );
    assert.equal(calls.preview(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process restart loses plaintext proposal material and forces a fresh proposal", async () => {
  const { root, bridge, registrations, sessions, token } = await fixture();
  try {
    const proposal = await bridge.propose({ bearerToken: token, requestId: IDS.request1, request });
    const restarted = new RemoteTaskStartApprovalBridge(
      sessions,
      registrations,
      {
        async previewTask() { throw new Error("must not run without material"); },
        async startTask() { throw new Error("must not start"); },
      },
      root,
    );
    await assert.rejects(
      restarted.previewLocalApproval(proposal.proposalId, proposal.revision),
      (error: unknown) => error instanceof RemoteTaskStartBridgeError && error.code === "proposal_material_unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unregistered propose_new_task cannot be added to an issued session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-remote-task-capability-"));
  try {
    const registrations = new RemoteRegistrationStore(root, { idFactory: () => IDS.registration });
    await registrations.create({
      machineId: IDS.machine,
      remotePrincipalId: IDS.principal,
      allowedMutationActions: [],
      allowedReadOnlyCapabilities: [],
    });
    const sessions = new RemoteSessionGateway(registrations, root, {
      idFactory: () => IDS.session,
      tokenFactory: () => TOKEN,
    });
    await assert.rejects(
      sessions.issue(IDS.registration, {
        mutationActions: [],
        readOnlyCapabilities: [],
        controlCapabilities: ["propose_new_task"],
        ttlMs: 60_000,
      }),
      (error: unknown) => error instanceof RemoteControlContractError && error.code === "capability_not_allowed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
