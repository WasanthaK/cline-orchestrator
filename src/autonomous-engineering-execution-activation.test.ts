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
  AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT,
  AutonomousEngineeringExecutionActivationCoordinator,
  AutonomousEngineeringExecutionActivationError,
} from "./autonomous-engineering-execution-activation.js";
import type { AutonomousEngineeringExecutionPreparationV1 } from "./autonomous-engineering-execution-preparation.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T12:00:00.000Z",
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

function preparation(): AutonomousEngineeringExecutionPreparationV1 {
  return {
    schemaVersion: 1,
    preparationId: "77777777-7777-4777-8777-777777777777",
    preparedAt: "2026-10-07T12:02:00.000Z",
    permitId: "88888888-8888-4888-8888-888888888888",
    admissionConsumedAt: "2026-10-07T12:01:30.000Z",
    intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    loopId: "99999999-9999-4999-8999-999999999999",
    loopRevision: 2,
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

function lease(overrides: Partial<{
  taskId: string;
  workspaceId: string;
  aborted: boolean;
  changed: boolean;
}> = {}): WriterLeaseSession {
  let changed = false;
  const aborter = new AbortController();
  if (overrides.aborted) aborter.abort();
  return {
    taskId: overrides.taskId ?? supervisor.taskId,
    workspaceId: overrides.workspaceId ?? supervisor.authority.workspaceId,
    ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    signal: aborter.signal,
    currentClaim() {
      return {
        schemaVersion: 1,
        workspaceId: overrides.workspaceId ?? supervisor.authority.workspaceId,
        stateRevision: changed ? 3 : 2,
        leaseId: changed
          ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
          : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fenceToken: changed
          ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
          : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        taskId: overrides.taskId ?? supervisor.taskId,
        ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expiresAt: "2026-10-07T12:20:00.000Z",
        authority: "coordination_only",
      };
    },
    async validateCurrent() {
      if (overrides.changed) changed = true;
    },
    async release() {},
  } as WriterLeaseSession;
}

async function rootWithLoop() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m14g-"));
  let loop = createAutonomousEngineeringLoop(supervisor, {
    idFactory: () => "99999999-9999-4999-8999-999999999999",
    now: () => new Date("2026-10-07T12:00:00.000Z"),
  });
  loop = transitionAutonomousEngineeringLoop(loop, {
    type: "implementation_started",
    at: "2026-10-07T12:01:00.000Z",
  });
  await new FileAutonomousEngineeringLoopStore(root).create(loop);
  return { root, loop };
}

test("M14G contract is activation evidence only", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT.requiresFreshSchedulerOwnedLease, true);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT.startsCline, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_EXECUTION_ACTIVATION_CONTRACT.grantsReleaseAuthority, false);
});

test("M14G activates exact preparation with current binding and writer lease", async () => {
  const { root } = await rootWithLoop();
  try {
    const result = await new AutonomousEngineeringExecutionActivationCoordinator(
      root,
      { async revalidateCurrent() { return current(); } },
      { now: () => new Date("2026-10-07T12:03:00.000Z") },
    ).activate(preparation(), lease());

    assert.equal(result.runtimeInput.runtimeStartAuthorized, false);
    assert.equal(result.runtimeInput.taskId, supervisor.taskId);
    assert.deepEqual(result.runtimeInput.allowedPathPatterns, supervisor.authority.allowedPathPatterns);
    assert.equal(result.evidence.runtimeStartAuthorized, false);
    assert.equal(result.evidence.grantsFilesystemAuthority, false);
    assert.equal(result.evidence.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14G rejects wrong task lease and Safety drift", async () => {
  const { root } = await rootWithLoop();
  try {
    const coordinator = new AutonomousEngineeringExecutionActivationCoordinator(
      root,
      { async revalidateCurrent() { return current(); } },
    );
    await assert.rejects(
      () => coordinator.activate(
        preparation(),
        lease({ taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
      ),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionActivationError
        && error.code === "lease_invalid",
    );

    const drifted = current();
    drifted.safetyProfileRevision += 1;
    await assert.rejects(
      () => new AutonomousEngineeringExecutionActivationCoordinator(
        root,
        { async revalidateCurrent() { return drifted; } },
      ).activate(preparation(), lease()),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionActivationError
        && error.code === "binding_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M14G rejects stale loop revision and changed lease identity", async () => {
  const { root, loop } = await rootWithLoop();
  try {
    const advanced = transitionAutonomousEngineeringLoop(loop, {
      type: "completion_evidence_captured",
      at: "2026-10-07T12:04:00.000Z",
    });
    await new FileAutonomousEngineeringLoopStore(root).replaceExact(loop.revision, advanced);
    await assert.rejects(
      () => new AutonomousEngineeringExecutionActivationCoordinator(
        root,
        { async revalidateCurrent() { return current(); } },
      ).activate(preparation(), lease()),
      (error: unknown) =>
        error instanceof AutonomousEngineeringExecutionActivationError
        && error.code === "loop_stale",
    );

    const fresh = await rootWithLoop();
    try {
      await assert.rejects(
        () => new AutonomousEngineeringExecutionActivationCoordinator(
          fresh.root,
          { async revalidateCurrent() { return current(); } },
        ).activate(preparation(), lease({ changed: true })),
        (error: unknown) =>
          error instanceof AutonomousEngineeringExecutionActivationError
          && error.code === "lease_identity_changed",
      );
    } finally {
      await rm(fresh.root, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
