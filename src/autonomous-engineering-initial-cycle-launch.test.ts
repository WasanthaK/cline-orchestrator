import assert from "node:assert/strict";
import test from "node:test";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import {
  AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT,
  AutonomousEngineeringInitialCycleLaunchError,
  AutonomousEngineeringInitialCycleLaunchService,
} from "./autonomous-engineering-initial-cycle-launch.js";
import type { AutonomousEngineeringExecutionIntentV1 } from "./autonomous-engineering-execution-intent.js";
import type { AutonomousEngineeringExecutionPreparationV1 } from "./autonomous-engineering-execution-preparation.js";
import type { AutonomousEngineeringExecutionActivationContext } from "./autonomous-engineering-execution-activation.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T19:00:00.000Z",
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

const loop: AutonomousEngineeringLoopStateV1 = {
  schemaVersion: 1,
  loopId: "99999999-9999-4999-8999-999999999999",
  createdAt: "2026-10-07T19:00:00.000Z",
  updatedAt: "2026-10-07T19:00:00.000Z",
  revision: 1,
  phase: "ready",
  authorityBinding: {
    supervisorTaskId: supervisor.supervisorTaskId,
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
  },
  budget: { maxImplementationIterations: 4, maxRepairAttempts: 2 },
  counters: { implementationIterationsStarted: 0, repairAttemptsStarted: 0 },
  authority: "autonomous_engineering_loop_state_only",
  executable: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function lease(): WriterLeaseSession {
  const aborter = new AbortController();
  return {
    taskId: supervisor.taskId,
    workspaceId: supervisor.authority.workspaceId,
    ownerInstanceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    signal: aborter.signal,
    currentClaim() {
      return {
        schemaVersion: 1,
        workspaceId: supervisor.authority.workspaceId,
        stateRevision: 1,
        leaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        fenceToken: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        taskId: supervisor.taskId,
        ownerInstanceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        expiresAt: "2026-10-07T19:30:00.000Z",
        authority: "coordination_only",
      };
    },
    async validateCurrent() {},
    async release() {},
  } as WriterLeaseSession;
}

class Harness {
  runtimeCalls = 0;

  admission = {
    admit: async (
      state: AutonomousEngineeringLoopStateV1,
      _supervisor: SupervisorTaskV1,
      event: { type: "implementation_started"; at: string },
    ) => ({
      schemaVersion: 1 as const,
      admissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      admittedAt: event.at,
      expiresAt: "2026-10-07T19:30:00.000Z",
      loopId: state.loopId,
      expectedLoopRevision: state.revision,
      event,
      taskId: supervisor.taskId,
      observedTaskStatus: "created" as const,
      observedRunCount: 0,
      authority: "autonomous_loop_transition_admission_only" as const,
      executable: false as const,
      mutatesLoopState: false as const,
      mutatesTaskState: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };

  apply = {
    apply: async (admission: any) => ({
      state: {
        ...structuredClone(loop),
        revision: 2,
        phase: "implementation_in_progress" as const,
        counters: {
          implementationIterationsStarted: 1,
          repairAttemptsStarted: 0,
        },
      },
      receipt: {
        schemaVersion: 1 as const,
        admissionId: admission.admissionId,
        loopId: admission.loopId,
        priorRevision: 1,
        resultingRevision: 2,
        appliedAt: admission.admittedAt,
        authority: "autonomous_loop_transition_apply_state_only" as const,
        mutatesTaskState: false as const,
        startsWorker: false as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsWriterLeaseAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      },
    }),
  };

  intent = {
    create: async (
      state: AutonomousEngineeringLoopStateV1,
      _supervisor: SupervisorTaskV1,
      admission: any,
    ): Promise<AutonomousEngineeringExecutionIntentV1> => ({
      schemaVersion: 1,
      intentId: "12121212-1212-4121-8121-121212121212",
      createdAt: "2026-10-07T19:01:00.000Z",
      loopId: state.loopId,
      loopRevision: state.revision,
      appliedAdmissionId: admission.admissionId,
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
    }),
  };

  executionAdmission = {
    issue: async (_intent: AutonomousEngineeringExecutionIntentV1) => ({
      permit: {} as any,
      token: "m14n_abcdefghijklmnopqrstuvwxyz0123456789",
    }),
    consume: async (_token: string, intent: AutonomousEngineeringExecutionIntentV1) => ({
      schemaVersion: 1 as const,
      permitId: "34343434-3434-4343-8343-343434343434",
      intentId: intent.intentId,
      loopId: intent.loopId,
      loopRevision: intent.loopRevision,
      taskId: intent.taskId,
      workspaceId: intent.workspaceId,
      kind: intent.kind,
      consumedAt: "2026-10-07T19:02:00.000Z",
      authority: "autonomous_engineering_execution_admission_consumed_evidence_only" as const,
      startsExecution: false as const,
      grantsTaskAuthority: false as const,
      grantsFilesystemAuthority: false as const,
      grantsSafetyPlanAuthority: false as const,
      grantsWriterLeaseAuthority: false as const,
      grantsCredentialAuthority: false as const,
      grantsReleaseAuthority: false as const,
    }),
  };

  preparation = {
    prepare: async (intent: AutonomousEngineeringExecutionIntentV1, receipt: any): Promise<AutonomousEngineeringExecutionPreparationV1> => ({
      schemaVersion: 1,
      preparationId: "56565656-5656-4565-8565-565656565656",
      preparedAt: "2026-10-07T19:03:00.000Z",
      permitId: receipt.permitId,
      admissionConsumedAt: receipt.consumedAt,
      intentId: intent.intentId,
      loopId: intent.loopId,
      loopRevision: intent.loopRevision,
      taskId: intent.taskId,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      workspaceRegistryRevision: intent.workspaceRegistryRevision,
      safetyPlanId: intent.safetyPlanId,
      safetyPolicyVersion: intent.safetyPolicyVersion,
      safetyProfileId: intent.safetyProfileId,
      safetyProfileRevision: intent.safetyProfileRevision,
      workerProfileId: intent.workerProfileId,
      allowedPathPatterns: [...intent.allowedPathPatterns],
      protectedPathPatterns: [...intent.protectedPathPatterns],
      kind: intent.kind,
      objective: intent.objective,
      acceptanceCriteria: [...intent.acceptanceCriteria],
      trustedValidationCommands: [...intent.trustedValidationCommands],
      authority: "autonomous_engineering_execution_preparation_only",
      executable: false,
      requiresFreshTaskSafetyBindingAtExecution: true,
      requiresFreshWriterLease: true,
      requiresFreshDistributedFenceWhenDistributed: true,
      mutatesTaskState: false,
      mutatesLoopState: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    }),
  };

  activation = {
    activate: async (preparation: AutonomousEngineeringExecutionPreparationV1, suppliedLease: WriterLeaseSession): Promise<AutonomousEngineeringExecutionActivationContext> => ({
      evidence: {
        schemaVersion: 1,
        preparationId: preparation.preparationId,
        intentId: preparation.intentId,
        loopId: preparation.loopId,
        loopRevision: preparation.loopRevision,
        taskId: preparation.taskId,
        workspaceId: preparation.workspaceId,
        leaseId: suppliedLease.currentClaim().leaseId,
        fenceToken: suppliedLease.currentClaim().fenceToken,
        ownerInstanceId: suppliedLease.ownerInstanceId,
        activatedAt: "2026-10-07T19:04:00.000Z",
        authority: "autonomous_engineering_execution_activation_evidence_only",
        runtimeStartAuthorized: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      },
      runtimeInput: {
        schemaVersion: 1,
        preparationId: preparation.preparationId,
        intentId: preparation.intentId,
        loopId: preparation.loopId,
        loopRevision: preparation.loopRevision,
        taskId: preparation.taskId,
        projectId: preparation.projectId,
        workspaceId: preparation.workspaceId,
        workspaceRegistryRevision: preparation.workspaceRegistryRevision,
        safetyPlanId: preparation.safetyPlanId,
        safetyPolicyVersion: preparation.safetyPolicyVersion,
        safetyProfileId: preparation.safetyProfileId,
        safetyProfileRevision: preparation.safetyProfileRevision,
        workerProfileId: preparation.workerProfileId,
        allowedPathPatterns: [...preparation.allowedPathPatterns],
        protectedPathPatterns: [...preparation.protectedPathPatterns],
        kind: "initial_implementation",
        objective: preparation.objective,
        acceptanceCriteria: [...preparation.acceptanceCriteria],
        trustedValidationCommands: [...preparation.trustedValidationCommands],
        authority: "autonomous_engineering_runtime_input_only",
        runtimeStartAuthorized: false,
        grantsTaskAuthority: false,
        grantsFilesystemAuthority: false,
        grantsSafetyPlanAuthority: false,
        grantsWriterLeaseAuthority: false,
        grantsCredentialAuthority: false,
        grantsReleaseAuthority: false,
      },
      lease: suppliedLease,
    }),
  };

  runtime = {
    start: async (ctx: AutonomousEngineeringExecutionActivationContext) => {
      this.runtimeCalls += 1;
      return {
        schemaVersion: 1 as const,
        taskId: ctx.runtimeInput.taskId,
        workspaceId: ctx.runtimeInput.workspaceId,
        loopId: ctx.runtimeInput.loopId,
        loopRevision: ctx.runtimeInput.loopRevision,
        preparationId: ctx.runtimeInput.preparationId,
        intentId: ctx.runtimeInput.intentId,
        started: true as const,
        authority: "autonomous_engineering_initial_runtime_start_bridge" as const,
        grantsTaskAuthority: false as const,
        grantsFilesystemAuthority: false as const,
        grantsSafetyPlanAuthority: false as const,
        grantsWriterLeaseAuthority: false as const,
        grantsCredentialAuthority: false as const,
        grantsReleaseAuthority: false as const,
      };
    },
  };
}

test("M14N contract composes only initial gates and acquires no lease", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT.readyLoopOnly, true);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT.initialImplementationOnly, true);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT.grantsReleaseAuthority, false);
});

test("M14N launches exactly one initial implementation with supplied lease and no repair provenance", async () => {
  const harness = new Harness();
  const l = lease();
  const result = await new AutonomousEngineeringInitialCycleLaunchService(
    harness.admission,
    harness.apply,
    harness.intent,
    harness.executionAdmission,
    harness.preparation,
    harness.activation,
    harness.runtime,
    { now: () => new Date("2026-10-07T19:00:30.000Z") },
  ).launch(loop, supervisor, l);

  assert.equal(harness.runtimeCalls, 1);
  assert.equal(result.startingRevision, 1);
  assert.equal(result.executionRevision, 2);
  assert.equal(result.intent.kind, "initial_implementation");
  assert.equal(result.intent.repairInstruction, undefined);
  assert.equal(result.preparation.reviewerDecisionId, undefined);
  assert.equal(result.activation.ownerInstanceId, l.ownerInstanceId);
  assert.equal(result.acquiresWriterLease, false);
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M14N rejects non-ready or previously-started loop before any runtime action", async () => {
  const harness = new Harness();
  const bad: AutonomousEngineeringLoopStateV1 = {
    ...structuredClone(loop),
    phase: "implementation_in_progress",
    counters: { implementationIterationsStarted: 1, repairAttemptsStarted: 0 },
  };

  await assert.rejects(
    () => new AutonomousEngineeringInitialCycleLaunchService(
      harness.admission,
      harness.apply,
      harness.intent,
      harness.executionAdmission,
      harness.preparation,
      harness.activation,
      harness.runtime,
    ).launch(bad, supervisor, lease()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialCycleLaunchError
      && error.code === "input_invalid",
  );
  assert.equal(harness.runtimeCalls, 0);
});

test("M14N fails closed before runtime if one-shot execution admission fails", async () => {
  const harness = new Harness();
  const brokenAdmission = {
    ...harness.executionAdmission,
    issue: async () => {
      throw new Error("permit unavailable");
    },
  };

  await assert.rejects(
    () => new AutonomousEngineeringInitialCycleLaunchService(
      harness.admission,
      harness.apply,
      harness.intent,
      brokenAdmission,
      harness.preparation,
      harness.activation,
      harness.runtime,
    ).launch(loop, supervisor, lease()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialCycleLaunchError
      && error.code === "execution_admission_failed",
  );
  assert.equal(harness.runtimeCalls, 0);
});
