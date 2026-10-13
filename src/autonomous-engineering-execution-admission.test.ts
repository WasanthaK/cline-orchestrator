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
import {
  AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT,
  AutonomousEngineeringExecutionAdmissionError,
  AutonomousEngineeringExecutionAdmissionService,
} from "./autonomous-engineering-execution-admission.js";
import type { AutonomousEngineeringExecutionIntentV1 } from "./autonomous-engineering-execution-intent.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T10:00:00.000Z",
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

function intent(): AutonomousEngineeringExecutionIntentV1 {
  return {
    schemaVersion: 1,
    intentId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-10-07T10:02:00.000Z",
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
    kind: "initial_implementation",
    objective: supervisor.objective,
    acceptanceCriteria: [...supervisor.acceptanceCriteria],
    trustedValidationCommands: [...supervisor.trustedValidationCommands],
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

async function createRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14e-"));
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T10:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T10:01:00.000Z",
  });
  await new FileAutonomousEngineeringLoopStore(root).create(loop);
  return { root, loop };
}

test("M14E contract is one-shot and non-executing", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.shortLived, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.singleUse, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.mutatesTaskState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ADMISSION_CONTRACT.grantsReleaseAuthority, false);
});

test("M14E issues and consumes exactly one permit against exact current loop/task binding", async () => {
  const { root } = await createRoot();
  try {
    const service = new AutonomousEngineeringExecutionAdmissionService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        idFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tokenFactory: () => "m14e_abcdefghijklmnopqrstuvwxyz0123456789",
        now: () => new Date("2026-10-07T10:03:00.000Z"),
      },
    );

    const ticket = await service.issue(intent());
    assert.equal(ticket.permit.loopRevision, 2);
    assert.equal(ticket.permit.executable, false);

    const receipt = await service.consume(ticket.token, intent());
    assert.equal(receipt.permitId, ticket.permit.permitId);
    assert.equal(receipt.startsExecution, false);
    assert.equal(receipt.grantsFilesystemAuthority, false);

    await assert.rejects(
      () => service.consume(ticket.token, intent()),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionAdmissionError
        && error.code === "permit_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14E fails closed when loop revision changes after intent creation", async () => {
  const { root, loop } = await createRoot();
  try {
    const changed = transitionAutonomousEngineeringLoop(loop, {
      type: "completion_evidence_captured",
      at: "2026-10-07T10:04:00.000Z",
    });
    await new FileAutonomousEngineeringLoopStore(root).replaceExact(loop.revision, changed);

    await assert.rejects(
      () => new AutonomousEngineeringExecutionAdmissionService(
        root,
        { async revalidateCurrent() { return current(); } },
      ).issue(intent()),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionAdmissionError
        && error.code === "loop_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14E revalidates Safety binding again at consumption", async () => {
  const { root } = await createRoot();
  try {
    let drift = false;
    const service = new AutonomousEngineeringExecutionAdmissionService(
      root,
      {
        async revalidateCurrent() {
          const value = current();
          if (drift) value.safetyProfileRevision += 1;
          return value;
        },
      },
      {
        idFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tokenFactory: () => "m14e_abcdefghijklmnopqrstuvwxyz0123456789",
        now: () => new Date("2026-10-07T10:03:00.000Z"),
      },
    );

    const ticket = await service.issue(intent());
    drift = true;
    await assert.rejects(
      () => service.consume(ticket.token, intent()),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionAdmissionError
        && error.code === "binding_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
