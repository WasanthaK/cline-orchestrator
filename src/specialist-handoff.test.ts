import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSpecialistHandoff,
  SpecialistHandoffError,
  SpecialistHandoffStore,
} from "./specialist-handoff.js";
import { createSupervisorTask } from "./supervisor-task.js";
import type { OrchestratorTask } from "./types.js";

const IDS = {
  supervisor: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  safetyPlan: "55555555-5555-4555-8555-555555555555",
  safetyProfile: "66666666-6666-4666-8666-666666666666",
  handoff1: "77777777-7777-4777-8777-777777777777",
  handoff2: "88888888-8888-4888-8888-888888888888",
  handoff3: "99999999-9999-4999-8999-999999999999",
  evidence1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  evidence2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  evidence3: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function approvedTask(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "PRIVATE_GOAL_SHOULD_NOT_TRAVEL_IN_HANDOFF",
    workspace: "C:\\private\\workspace\\root",
    status: "created",
    createdAt: "2026-09-25T08:00:00.000Z",
    updatedAt: "2026-09-25T08:00:00.000Z",
    acceptanceCriteria: ["PRIVATE_ACCEPTANCE_TEXT"],
    validationCommands: ["PRIVATE_VALIDATION_COMMAND"],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 3,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v3",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["PRIVATE/allowed/**"],
    approvedProtectedPathPatterns: ["PRIVATE/protected/**"],
    workerProfileId: "pilot-safe",
    clineSessionId: "PRIVATE_HUB_SESSION",
    lastOutput: "PRIVATE_MODEL_OUTPUT",
    ...overrides,
  } as OrchestratorTask;
}

function supervisor(overrides: Record<string, unknown> = {}) {
  return createSupervisorTask(approvedTask(overrides), {
    idFactory: () => IDS.supervisor,
    now: () => new Date("2026-09-25T08:01:00.000Z"),
  });
}

function firstHandoff() {
  return createSpecialistHandoff(
    supervisor(),
    {
      fromRole: "planner",
      toRole: "implementation",
      evidence: [{
        kind: "supervisor_decision",
        evidenceId: IDS.evidence1,
        capturedAt: "2026-09-25T08:02:00.000Z",
      }],
    },
    undefined,
    {
      idFactory: () => IDS.handoff1,
      now: () => new Date("2026-09-25T08:03:00.000Z"),
    },
  );
}

test("specialist handoff carries provenance but grants no machine authority", () => {
  const handoff = firstHandoff();

  assert.equal(handoff.sequence, 1);
  assert.equal(handoff.fromRole, "planner");
  assert.equal(handoff.toRole, "implementation");
  assert.equal(handoff.taskId, IDS.task);
  assert.equal(handoff.authority.safetyPlanId, IDS.safetyPlan);
  assert.deepEqual(handoff.constraints, {
    executionMode: "sequential_only",
    authoritySource: "approved_task_only",
    machineAuthorityGranted: false,
    writeAuthorityGranted: false,
    concurrentWorkspaceWritesAllowed: false,
  });

  const serialized = JSON.stringify(handoff);
  for (const forbidden of [
    "PRIVATE_GOAL_SHOULD_NOT_TRAVEL_IN_HANDOFF",
    "C:\\private\\workspace\\root",
    "PRIVATE_ACCEPTANCE_TEXT",
    "PRIVATE_VALIDATION_COMMAND",
    "PRIVATE/allowed/**",
    "PRIVATE/protected/**",
    "PRIVATE_HUB_SESSION",
    "PRIVATE_MODEL_OUTPUT",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("specialist handoff chain permits only sequential planner/implementation/reviewer transitions", () => {
  const task = supervisor();
  const first = firstHandoff();
  const second = createSpecialistHandoff(
    task,
    {
      fromRole: "implementation",
      toRole: "reviewer",
      evidence: [{
        kind: "task_event",
        evidenceId: IDS.evidence2,
        capturedAt: "2026-09-25T08:04:00.000Z",
      }],
    },
    first,
    {
      idFactory: () => IDS.handoff2,
      now: () => new Date("2026-09-25T08:05:00.000Z"),
    },
  );
  const third = createSpecialistHandoff(
    task,
    {
      fromRole: "reviewer",
      toRole: "implementation",
      evidence: [{
        kind: "supervisor_decision",
        evidenceId: IDS.evidence3,
        capturedAt: "2026-09-25T08:06:00.000Z",
      }],
    },
    second,
    {
      idFactory: () => IDS.handoff3,
      now: () => new Date("2026-09-25T08:07:00.000Z"),
    },
  );

  assert.equal(second.sequence, 2);
  assert.equal(second.previousHandoffId, first.handoffId);
  assert.equal(third.sequence, 3);
  assert.equal(third.previousHandoffId, second.handoffId);

  assert.throws(
    () => createSpecialistHandoff(task, {
      fromRole: "planner",
      toRole: "reviewer",
      evidence: [{
        kind: "supervisor_decision",
        evidenceId: IDS.evidence1,
        capturedAt: "2026-09-25T08:08:00.000Z",
      }],
    }),
    (error: unknown) => error instanceof SpecialistHandoffError && error.code === "transition_invalid",
  );

  assert.throws(
    () => createSpecialistHandoff(task, {
      fromRole: "planner",
      toRole: "implementation",
      evidence: [{
        kind: "supervisor_decision",
        evidenceId: IDS.evidence1,
        capturedAt: "2026-09-25T08:08:00.000Z",
      }],
    }, first),
    (error: unknown) => error instanceof SpecialistHandoffError && error.code === "chain_invalid",
  );
});

test("specialist handoff rejects cross-task authority binding and duplicate/invalid evidence", () => {
  const first = firstHandoff();
  const other = createSupervisorTask(approvedTask({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    safetyPlanId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  }), {
    idFactory: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });

  assert.throws(
    () => createSpecialistHandoff(other, {
      fromRole: "implementation",
      toRole: "reviewer",
      evidence: [{
        kind: "task_event",
        evidenceId: IDS.evidence2,
        capturedAt: "2026-09-25T08:04:00.000Z",
      }],
    }, first),
    (error: unknown) => error instanceof SpecialistHandoffError && error.code === "binding_mismatch",
  );

  assert.throws(
    () => createSpecialistHandoff(supervisor(), {
      fromRole: "planner",
      toRole: "implementation",
      evidence: [
        {
          kind: "supervisor_decision",
          evidenceId: IDS.evidence1,
          capturedAt: "2026-09-25T08:02:00.000Z",
        },
        {
          kind: "supervisor_decision",
          evidenceId: IDS.evidence1,
          capturedAt: "2026-09-25T08:02:00.000Z",
        },
      ],
    }),
    (error: unknown) => error instanceof SpecialistHandoffError && error.code === "handoff_invalid",
  );
});

test("durable specialist handoff journal preserves and validates exact sequential provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-specialist-handoff-"));
  try {
    const store = new SpecialistHandoffStore(root);
    const task = supervisor();
    const first = firstHandoff();
    const second = createSpecialistHandoff(
      task,
      {
        fromRole: "implementation",
        toRole: "reviewer",
        evidence: [{
          kind: "task_event",
          evidenceId: IDS.evidence2,
          capturedAt: "2026-09-25T08:04:00.000Z",
        }],
      },
      first,
      {
        idFactory: () => IDS.handoff2,
        now: () => new Date("2026-09-25T08:05:00.000Z"),
      },
    );
    const third = createSpecialistHandoff(
      task,
      {
        fromRole: "reviewer",
        toRole: "implementation",
        evidence: [{
          kind: "supervisor_decision",
          evidenceId: IDS.evidence3,
          capturedAt: "2026-09-25T08:06:00.000Z",
        }],
      },
      second,
      {
        idFactory: () => IDS.handoff3,
        now: () => new Date("2026-09-25T08:07:00.000Z"),
      },
    );

    await store.append(first);
    await store.append(second);
    await store.append(third);

    const reloaded = await store.list(IDS.task);
    assert.equal(reloaded.length, 3);
    assert.deepEqual(reloaded.map((item) => item.handoffId), [
      IDS.handoff1,
      IDS.handoff2,
      IDS.handoff3,
    ]);

    const staleThird = createSpecialistHandoff(
      task,
      {
        fromRole: "reviewer",
        toRole: "implementation",
        evidence: [{
          kind: "supervisor_decision",
          evidenceId: "abababab-abab-4bab-8bab-abababababab",
          capturedAt: "2026-09-25T08:06:30.000Z",
        }],
      },
      second,
      {
        idFactory: () => "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
        now: () => new Date("2026-09-25T08:07:30.000Z"),
      },
    );
    await assert.rejects(
      () => store.append(staleThird),
      (error: unknown) => error instanceof SpecialistHandoffError && error.code === "chain_invalid",
    );

    assert.throws(
      () => store.list("../outside") as unknown,
      (error: unknown) => error instanceof SpecialistHandoffError && error.code === "handoff_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable specialist journal fails closed on tampered stored handoff records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-specialist-handoff-tamper-"));
  try {
    const store = new SpecialistHandoffStore(root);
    const first = firstHandoff();
    await store.append(first);

    const file = path.join(root, ".orchestrator", "specialist-handoffs", `${IDS.task}.jsonl`);
    await appendFile(file, `${JSON.stringify({ ...first, sequence: 9, unexpectedAuthority: true })}\n`, "utf8");

    await assert.rejects(
      () => store.list(IDS.task),
      (error: unknown) => error instanceof SpecialistHandoffError && error.code === "handoff_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
