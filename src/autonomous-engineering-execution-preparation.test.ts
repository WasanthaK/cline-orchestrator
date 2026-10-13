import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAutonomousEngineeringLoop,
  FileAutonomousEngineeringLoopStore,
  transitionAutonomousEngineeringLoop,
} from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringExecutionAdmissionReceiptV1 } from "./autonomous-engineering-execution-admission.js";
import type { AutonomousEngineeringExecutionIntentV1 } from "./autonomous-engineering-execution-intent.js";
import {
  AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT,
  AutonomousEngineeringExecutionPreparationError,
  AutonomousEngineeringExecutionPreparationService,
  FileAutonomousEngineeringExecutionPreparationStore,
} from "./autonomous-engineering-execution-preparation.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T11:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement bounded goal.",
  acceptanceCriteria: ["Tests pass."],
  trustedValidationCommands: ["npm test"],
  authority: {
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 3,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 4,
    workerProfileId: "default",
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: [".env*", ".git/**"],
  },
  constraints: {
    scopeExpansion: "stop_and_escalate",
    repositoryInstructionsGrantAuthority: false,
    modelShellAllowed: false,
    modelNetworkAllowed: false,
    modelMcpAllowed: false,
    modelPluginsAllowed: false,
    subagentsAllowed: false,
    agentTeamsAllowed: false,
    validationRunsExternally: true,
    completionRequiresOrchestratorValidation: true,
    completionRequiresDiffSafety: true,
  },
};

function intent(kind: "initial_implementation" | "bounded_repair" = "initial_implementation"): AutonomousEngineeringExecutionIntentV1 {
  return {
    schemaVersion: 1,
    intentId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-10-07T11:02:00.000Z",
    loopId: "99999999-9999-4999-8999-999999999999",
    loopRevision: 2,
    appliedAdmissionId: "88888888-8888-4888-8888-888888888888",
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyPolicyVersion: supervisor.authority.safetyPolicyVersion,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workerProfileId: supervisor.authority.workerProfileId,
    allowedPathPatterns: [...supervisor.authority.allowedPathPatterns],
    protectedPathPatterns: [...supervisor.authority.protectedPathPatterns],
    kind,
    objective: supervisor.objective,
    acceptanceCriteria: [...supervisor.acceptanceCriteria],
    trustedValidationCommands: [...supervisor.trustedValidationCommands],
    ...(kind === "bounded_repair"
      ? {
          repairInstruction: "Correct the approved implementation only.",
          reviewerDecisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }
      : {}),
    authority: "autonomous_engineering_execution_intent_only",
    executable: false,
    mutatesTaskState: false,
    mutatesLoopState: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function receipt(i = intent()): AutonomousEngineeringExecutionAdmissionReceiptV1 {
  return {
    schemaVersion: 1,
    permitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    intentId: i.intentId,
    loopId: i.loopId,
    loopRevision: i.loopRevision,
    taskId: i.taskId,
    workspaceId: i.workspaceId,
    kind: i.kind,
    consumedAt: "2026-10-07T11:03:00.000Z",
    authority: "autonomous_engineering_execution_admission_consumed_evidence_only",
    startsExecution: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function current() {
  return {
    schemaVersion: 1 as const,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyPolicyVersion: supervisor.authority.safetyPolicyVersion,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workerProfileId: supervisor.authority.workerProfileId,
    allowedPathPatterns: [...supervisor.authority.allowedPathPatterns],
    protectedPathPatterns: [...supervisor.authority.protectedPathPatterns],
    status: "created" as const,
    runCount: 0,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding" as const,
  };
}

async function rootWithLoop() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14f-"));
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T11:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T11:01:00.000Z",
  });
  await new FileAutonomousEngineeringLoopStore(root).create(loop);
  return { root, loop };
}

test("M14F contract is durable preparation only", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.durable, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.onePreparationPerIntent, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.mutatesTaskState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT.grantsReleaseAuthority, false);
});

test("M14F persists exactly one preparation preserving intent provenance", async () => {
  const { root } = await rootWithLoop();
  try {
    const i = intent();
    const service = new AutonomousEngineeringExecutionPreparationService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        idFactory: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        now: () => new Date("2026-10-07T11:04:00.000Z"),
      },
    );
    const prepared = await service.prepare(i, receipt(i));

    assert.equal(prepared.intentId, i.intentId);
    assert.equal(prepared.loopRevision, i.loopRevision);
    assert.equal(prepared.objective, i.objective);
    assert.deepEqual(prepared.trustedValidationCommands, i.trustedValidationCommands);
    assert.deepEqual(prepared.allowedPathPatterns, i.allowedPathPatterns);
    assert.equal(prepared.executable, false);
    assert.equal(prepared.grantsReleaseAuthority, false);

    const durable = await new FileAutonomousEngineeringExecutionPreparationStore(root).load(i.intentId);
    assert.deepEqual(durable, prepared);

    await assert.rejects(
      () => service.prepare(i, receipt(i)),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionPreparationError
        && error.code === "preparation_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14F preserves trusted bounded repair provenance", async () => {
  const { root } = await rootWithLoop();
  try {
    const i = intent("bounded_repair");
    const prepared = await new AutonomousEngineeringExecutionPreparationService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        idFactory: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        now: () => new Date("2026-10-07T11:04:00.000Z"),
      },
    ).prepare(i, receipt(i));

    assert.equal(prepared.kind, "bounded_repair");
    assert.equal(prepared.repairInstruction, i.repairInstruction);
    assert.equal(prepared.reviewerDecisionId, i.reviewerDecisionId);
    assert.deepEqual(prepared.protectedPathPatterns, i.protectedPathPatterns);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14F fails closed on receipt mismatch, stale loop or Safety drift", async () => {
  const { root, loop } = await rootWithLoop();
  try {
    const i = intent();
    const wrongReceipt = receipt(i);
    wrongReceipt.taskId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    await assert.rejects(
      () => new AutonomousEngineeringExecutionPreparationService(
        root,
        { async revalidateCurrent() { return current(); } },
      ).prepare(i, wrongReceipt),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionPreparationError
        && error.code === "binding_mismatch",
    );

    const advanced = transitionAutonomousEngineeringLoop(loop, {
      type: "completion_evidence_captured",
      at: "2026-10-07T11:05:00.000Z",
    });
    await new FileAutonomousEngineeringLoopStore(root).replaceExact(loop.revision, advanced);
    await assert.rejects(
      () => new AutonomousEngineeringExecutionPreparationService(
        root,
        { async revalidateCurrent() { return current(); } },
      ).prepare(i, receipt(i)),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionPreparationError
        && error.code === "loop_stale",
    );

    const drifted = current();
    drifted.safetyProfileRevision += 1;
    const freshRoot = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14f-drift-"));
    try {
      let freshLoop = createAutonomousEngineeringLoop(supervisor, {
        idFactory: () => "99999999-9999-4999-8999-999999999999",
        now: () => new Date("2026-10-07T11:00:00.000Z"),
      });
      freshLoop = transitionAutonomousEngineeringLoop(freshLoop, {
        type: "implementation_started",
        at: "2026-10-07T11:01:00.000Z",
      });
      await new FileAutonomousEngineeringLoopStore(freshRoot).create(freshLoop);

      await assert.rejects(
        () => new AutonomousEngineeringExecutionPreparationService(
          freshRoot,
          { async revalidateCurrent() { return drifted; } },
        ).prepare(i, receipt(i)),
        (error: unknown) =>
          error instanceof AutonomousEngineeringExecutionPreparationError
          && error.code === "binding_stale",
      );
    } finally {
      await rm(freshRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
