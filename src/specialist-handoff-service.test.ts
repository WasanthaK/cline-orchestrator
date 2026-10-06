import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SpecialistHandoffService,
} from "./specialist-handoff-service.js";
import { SpecialistHandoffError } from "./specialist-handoff.js";
import { TaskStore } from "./state.js";
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
  evidence1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  evidence2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function approvedTask(overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id: IDS.task,
    goal: "Implement only inside approved scope.",
    workspace: "/private/workspace",
    status: "created",
    createdAt: "2026-09-25T08:00:00.000Z",
    updatedAt: "2026-09-25T08:00:00.000Z",
    acceptanceCriteria: [],
    validationCommands: [],
    projectId: IDS.project,
    workspaceId: IDS.workspace,
    workspaceRegistryRevision: 3,
    safetyPlanId: IDS.safetyPlan,
    safetyPolicyVersion: "policy-v3",
    safetyProfileId: IDS.safetyProfile,
    safetyProfileRevision: 4,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: [".env*", ".git/**"],
    workerProfileId: "pilot-safe",
    ...overrides,
  } as OrchestratorTask;
}

function supervisor(task: OrchestratorTask) {
  return createSupervisorTask(task, {
    idFactory: () => IDS.supervisor,
    now: () => new Date("2026-09-25T08:01:00.000Z"),
  });
}

test("specialist service records a sequential chain only while durable task authority remains current", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-specialist-service-"));
  try {
    const tasks = new TaskStore(root);
    const task = approvedTask();
    await tasks.save(task);
    const packet = supervisor(task);
    const ids = [IDS.handoff1, IDS.handoff2];
    const times = [
      new Date("2026-09-25T08:03:00.000Z"),
      new Date("2026-09-25T08:05:00.000Z"),
    ];
    const service = new SpecialistHandoffService(root, {
      idFactory: () => ids.shift()!,
      now: () => times.shift()!,
    });

    const first = await service.record(packet, {
      fromRole: "planner",
      toRole: "implementation",
      evidence: [{
        kind: "supervisor_decision",
        evidenceId: IDS.evidence1,
        capturedAt: "2026-09-25T08:02:00.000Z",
      }],
    });
    const second = await service.record(packet, {
      fromRole: "implementation",
      toRole: "reviewer",
      evidence: [{
        kind: "task_event",
        evidenceId: IDS.evidence2,
        capturedAt: "2026-09-25T08:04:00.000Z",
      }],
    });

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.previousHandoffId, first.handoffId);
    assert.equal(second.constraints.machineAuthorityGranted, false);
    assert.equal(second.constraints.concurrentWorkspaceWritesAllowed, false);

    const after = await tasks.load(IDS.task);
    assert.equal(after.status, "created");
    assert.deepEqual((after as OrchestratorTask & { approvedAllowedPathPatterns?: string[] }).approvedAllowedPathPatterns, ["src/**"]);
    assert.equal(after.updatedAt, task.updatedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("specialist service fails closed when Safety Plan, worker, registry, policy, or path authority becomes stale", async () => {
  const mutations: Array<[string, Record<string, unknown>]> = [
    ["safety plan", { safetyPlanId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
    ["worker", { workerProfileId: "different-worker" }],
    ["registry", { workspaceRegistryRevision: 99 }],
    ["policy", { safetyPolicyVersion: "policy-v99" }],
    ["allowed scope", { approvedAllowedPathPatterns: ["src/**", "outside/**"] }],
    ["protected scope", { approvedProtectedPathPatterns: [".env*"] }],
  ];

  for (const [name, mutation] of mutations) {
    const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-specialist-stale-"));
    try {
      const tasks = new TaskStore(root);
      const original = approvedTask();
      await tasks.save(original);
      const packet = supervisor(original);
      await tasks.save(approvedTask(mutation));
      const service = new SpecialistHandoffService(root, {
        idFactory: () => IDS.handoff1,
        now: () => new Date("2026-09-25T08:03:00.000Z"),
      });

      await assert.rejects(
        () => service.record(packet, {
          fromRole: "planner",
          toRole: "implementation",
          evidence: [{
            kind: "supervisor_decision",
            evidenceId: IDS.evidence1,
            capturedAt: "2026-09-25T08:02:00.000Z",
          }],
        }),
        (error: unknown) => error instanceof SpecialistHandoffError && error.code === "binding_mismatch",
        name,
      );
      assert.deepEqual(await service.list(IDS.task), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("specialist service cannot cross-bind a supervisor packet to another durable task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-specialist-cross-bind-"));
  try {
    const tasks = new TaskStore(root);
    const original = approvedTask();
    const packet = supervisor(original);
    await tasks.save(approvedTask({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }));
    const service = new SpecialistHandoffService(root);

    await assert.rejects(
      () => service.record(packet, {
        fromRole: "planner",
        toRole: "implementation",
        evidence: [{
          kind: "supervisor_decision",
          evidenceId: IDS.evidence1,
          capturedAt: "2026-09-25T08:02:00.000Z",
        }],
      }),
      /was not found/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
