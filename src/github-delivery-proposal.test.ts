import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_DELIVERY_PROPOSAL_CONTRACT,
  FileGitHubDeliveryProposalStore,
  GitHubDeliveryProposalError,
  GitHubDeliveryProposalService,
} from "./github-delivery-proposal.js";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringLoopCurrentTaskBindingV1 } from "./autonomous-engineering-loop-transition-admission.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T22:00:00.000Z",
  taskId: "22222222-2222-4222-8222-222222222222",
  objective: "Implement bounded goal.",
  acceptanceCriteria: ["Tests pass."],
  trustedValidationCommands: ["npm test"],
  authority: {
    projectId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceRegistryRevision: 7,
    safetyPlanId: "55555555-5555-4555-8555-555555555555",
    safetyPolicyVersion: "policy-v1",
    safetyProfileId: "66666666-6666-4666-8666-666666666666",
    safetyProfileRevision: 9,
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
  createdAt: "2026-10-07T22:00:00.000Z",
  updatedAt: "2026-10-07T22:20:00.000Z",
  revision: 6,
  phase: "succeeded",
  stopReason: "acceptance_criteria_satisfied",
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
  budget: { maxImplementationIterations: 3, maxRepairAttempts: 1 },
  counters: { implementationIterationsStarted: 2, repairAttemptsStarted: 1 },
  authority: "autonomous_engineering_loop_state_only",
  executable: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

function current(runCount = 2): AutonomousEngineeringLoopCurrentTaskBindingV1 {
  return {
    schemaVersion: 1,
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
    status: "completed",
    runCount,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding",
  };
}

function packet(runCount = 2): TaskCompletionPacketV1 {
  return {
    schemaVersion: 1,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    capturedAt: "2026-10-07T22:20:00.000Z",
    status: "completed",
    reviewState: "ready_for_supervisor_review",
    completionSignal: {
      terminal: true,
      finishReason: "completed",
      workerReportAvailable: false,
    },
    independentEvidence: {
      validation: {
        available: true,
        passed: true,
        commandsRequested: 1,
        commandsRun: 1,
        source: "orchestrator_validation",
      },
      diffSafety: {
        available: true,
        passed: true,
        changedFiles: 2,
        warningCount: 0,
        failureCount: 0,
        source: "orchestrator_diff_safety",
      },
      git: {
        after: {
          capturedAt: "2026-10-07T22:19:00.000Z",
          available: true,
          branch: "feature/test",
          head: "0123456789abcdef0123456789abcdef01234567",
          dirty: true,
          changedFiles: 2,
        },
        source: "orchestrator_git_snapshot",
      },
      checkpoint: {
        available: true,
        createdAt: "2026-10-07T22:02:00.000Z",
        runCount,
        restored: false,
        source: "orchestrator_checkpoint",
      },
      recovery: {
        runCount,
        sessionGeneration: 2,
        recoveryCount: 0,
        contextRotationCount: 0,
        contextHandoffCount: 0,
        retryCount: 0,
        stallCount: 0,
        source: "orchestrator_runtime_state",
      },
    },
  };
}

test("M15A contract grants no delivery or release authority", () => {
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.mutatesGit, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.mutatesGitHub, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.commitAuthorized, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.pushAuthorized, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.mergeAuthorized, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.deployAuthorized, false);
  assert.equal(GITHUB_DELIVERY_PROPOSAL_CONTRACT.grantsReleaseAuthority, false);
});

test("M15A persists exact successful delivery proposal with sanitized terminal Git identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15a-"));
  try {
    const service = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            root: "/must/not/be/persisted",
            branch: "feature/test",
            head: "0123456789abcdef0123456789abcdef01234567",
            stagedHash: "b".repeat(64),
            unstagedHash: "c".repeat(64),
            untrackedHash: "d".repeat(64),
          };
        },
      },
      {
        idFactory: () => "77777777-7777-4777-8777-777777777777",
        now: () => new Date("2026-10-07T22:22:00.000Z"),
      },
    );

    const proposal = await service.create(
      loop,
      supervisor,
      packet(),
      ["commit", "push", "pull_request"],
    );

    assert.deepEqual(proposal.requestedActions, ["commit", "push", "pull_request"]);
    assert.equal(proposal.terminalGit.fingerprintDigest, "a".repeat(64));
    assert.equal(proposal.terminalGit.head, "0123456789abcdef0123456789abcdef01234567");
    assert.equal("root" in proposal.terminalGit, false);
    assert.equal(proposal.commitAuthorized, false);
    assert.equal(proposal.pushAuthorized, false);
    assert.equal(proposal.pullRequestAuthorized, false);
    assert.equal(proposal.grantsReleaseAuthority, false);

    const reloaded = await new FileGitHubDeliveryProposalStore(root).load(proposal.proposalId);
    assert.deepEqual(reloaded, proposal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15A rejects remote delivery proposal without commit root action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15a-actions-"));
  try {
    const service = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            branch: "feature/test",
            head: "0123456789abcdef0123456789abcdef01234567",
          };
        },
      },
    );
    await assert.rejects(
      () => service.create(loop, supervisor, packet(), ["push"]),
      (error: unknown) =>
        error instanceof GitHubDeliveryProposalError
        && error.code === "actions_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15A rejects stale Safety binding, run count and Git identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15a-stale-"));
  try {
    const drifted = current();
    drifted.safetyProfileRevision += 1;
    const staleBinding = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return drifted; } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            branch: "feature/test",
            head: "0123456789abcdef0123456789abcdef01234567",
          };
        },
      },
    );
    await assert.rejects(
      () => staleBinding.create(loop, supervisor, packet(), ["commit"]),
      (error: unknown) =>
        error instanceof GitHubDeliveryProposalError
        && error.code === "binding_stale",
    );

    const staleRun = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return current(3); } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            branch: "feature/test",
            head: "0123456789abcdef0123456789abcdef01234567",
          };
        },
      },
    );
    await assert.rejects(
      () => staleRun.create(loop, supervisor, packet(2), ["commit"]),
      (error: unknown) =>
        error instanceof GitHubDeliveryProposalError
        && error.code === "completion_invalid",
    );

    const staleGit = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            branch: "feature/test",
            head: "ffffffffffffffffffffffffffffffffffffffff",
          };
        },
      },
    );
    await assert.rejects(
      () => staleGit.create(loop, supervisor, packet(), ["commit"]),
      (error: unknown) =>
        error instanceof GitHubDeliveryProposalError
        && error.code === "git_evidence_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15A rejects non-succeeded autonomous loop", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15a-loop-"));
  try {
    const notDone = { ...structuredClone(loop), phase: "waiting_for_human" as const, stopReason: "human_required" };
    const service = new GitHubDeliveryProposalService(
      root,
      { async revalidateCurrent() { return current(); } },
      {
        async captureCurrent() {
          return {
            capturedAt: "2026-10-07T22:21:00.000Z",
            available: true,
            digest: "a".repeat(64),
            branch: "feature/test",
            head: "0123456789abcdef0123456789abcdef01234567",
          };
        },
      },
    );
    await assert.rejects(
      () => service.create(notDone, supervisor, packet(), ["commit"]),
      (error: unknown) =>
        error instanceof GitHubDeliveryProposalError
        && error.code === "loop_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
