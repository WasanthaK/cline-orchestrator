import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutonomousEngineeringLoop,
  transitionAutonomousEngineeringLoop,
} from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringLoopTransitionAdmissionV1 } from "./autonomous-engineering-loop-transition-admission.js";
import type { AutonomousEngineeringLoopTransitionApplyReceiptV1 } from "./autonomous-engineering-loop-transition-apply.js";
import {
  AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT,
  AutonomousEngineeringExecutionIntentError,
  AutonomousEngineeringExecutionIntentService,
} from "./autonomous-engineering-execution-intent.js";
import type { SupervisorDecisionV1 } from "./supervisor-decision.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T09:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement the bounded objective.",
  acceptanceCriteria: ["Independent validation passes."],
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

function current(status: "created" | "waiting" | "repairing" = "created") {
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
    status,
    runCount: 0,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding" as const,
  };
}

function admission(
  event: "implementation_started" | "repair_started",
  expectedRevision: number,
  decisionId?: string,
): AutonomousEngineeringLoopTransitionAdmissionV1 {
  return {
    schemaVersion: 1,
    admissionId: event === "implementation_started"
      ? "77777777-7777-4777-8777-777777777777"
      : "88888888-8888-4888-8888-888888888888",
    admittedAt: "2026-10-07T09:01:00.000Z",
    expiresAt: "2026-10-07T09:10:00.000Z",
    loopId: "99999999-9999-4999-8999-999999999999",
    expectedLoopRevision: expectedRevision,
    event: { type: event, at: "2026-10-07T09:02:00.000Z" },
    taskId: supervisor.taskId,
    observedTaskStatus: event === "implementation_started" ? "created" : "waiting",
    observedRunCount: 0,
    ...(decisionId ? { decisionId } : {}),
    authority: "autonomous_loop_transition_admission_only",
    executable: false,
    mutatesLoopState: false,
    mutatesTaskState: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function receipt(
  admissionId: string,
  priorRevision: number,
  resultingRevision: number,
): AutonomousEngineeringLoopTransitionApplyReceiptV1 {
  return {
    schemaVersion: 1,
    admissionId,
    loopId: "99999999-9999-4999-8999-999999999999",
    priorRevision,
    resultingRevision,
    appliedAt: "2026-10-07T09:03:00.000Z",
    authority: "autonomous_loop_transition_apply_state_only",
    mutatesTaskState: false,
    startsWorker: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

function repairDecision(): SupervisorDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-10-07T09:00:30.000Z",
    supervisorTaskId: supervisor.supervisorTaskId,
    taskId: supervisor.taskId,
    safetyPlanId: supervisor.authority.safetyPlanId,
    safetyProfileId: supervisor.authority.safetyProfileId,
    safetyProfileRevision: supervisor.authority.safetyProfileRevision,
    workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
    kind: "review_repair",
    provenance: "reviewer",
    summary: "bounded repair",
    repairInstruction: "Correct the approved implementation without widening scope.",
  };
}

function service(status: "created" | "waiting" | "repairing" = "created") {
  return new AutonomousEngineeringExecutionIntentService(
    { async revalidateCurrent() { return current(status); } },
    {
      idFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      now: () => new Date("2026-10-07T09:04:00.000Z"),
    },
  );
}

test("M14D contract is non-executing and grants no filesystem/release authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.evidenceOnly, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.mutatesTaskState, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_INTENT_CONTRACT.grantsReleaseAuthority, false);
});

test("M14D derives initial implementation intent only from exact applied transition", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T09:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T09:02:00.000Z",
  });
  const a = admission("implementation_started", 1);
  const intent = await service().create(loop, supervisor, a, receipt(a.admissionId, 1, 2));

  assert.equal(intent.kind, "initial_implementation");
  assert.equal(intent.objective, supervisor.objective);
  assert.deepEqual(intent.allowedPathPatterns, supervisor.authority.allowedPathPatterns);
  assert.equal(intent.repairInstruction, undefined);
  assert.equal(intent.executable, false);
  assert.equal(intent.grantsFilesystemAuthority, false);
});

test("M14D bounded repair intent requires exact trusted reviewer decision provenance", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T09:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "implementation_started", at: "2026-10-07T09:00:10.000Z" });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "completion_evidence_captured", at: "2026-10-07T09:00:20.000Z" });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "review_repair", at: "2026-10-07T09:00:40.000Z" });
  loop = transitionAutonomousEngineeringLoop(loop, { type: "repair_started", at: "2026-10-07T09:02:00.000Z" });

  const decision = repairDecision();
  const a = admission("repair_started", 4, decision.decisionId);
  const intent = await service("waiting").create(
    loop,
    supervisor,
    a,
    receipt(a.admissionId, 4, 5),
    decision,
  );

  assert.equal(intent.kind, "bounded_repair");
  assert.equal(intent.reviewerDecisionId, decision.decisionId);
  assert.equal(intent.repairInstruction, decision.repairInstruction);
  assert.deepEqual(intent.protectedPathPatterns, supervisor.authority.protectedPathPatterns);
  assert.equal(intent.grantsReleaseAuthority, false);

  const wrong = { ...decision, decisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  await assert.rejects(
    () => service("waiting").create(loop, supervisor, a, receipt(a.admissionId, 4, 5), wrong),
    (error: unknown) =>
      error instanceof AutonomousEngineeringExecutionIntentError
      && error.code === "decision_invalid",
  );
});

test("M14D fails closed on stale receipt revision or current Safety drift", async () => {
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T09:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T09:02:00.000Z",
  });
  const a = admission("implementation_started", 1);

  await assert.rejects(
    () => service().create(loop, supervisor, a, receipt(a.admissionId, 1, 3)),
    (error: unknown) =>
      error instanceof AutonomousEngineeringExecutionIntentError
      && error.code === "transition_invalid",
  );

  const drifted = current();
  drifted.safetyProfileRevision += 1;
  const driftService = new AutonomousEngineeringExecutionIntentService(
    { async revalidateCurrent() { return drifted; } },
  );
  await assert.rejects(
    () => driftService.create(loop, supervisor, a, receipt(a.admissionId, 1, 2)),
    (error: unknown) =>
      error instanceof AutonomousEngineeringExecutionIntentError
      && error.code === "binding_stale",
  );
});
