import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type { AutonomousEngineeringLoopCurrentTaskBindingV1 } from "./autonomous-engineering-loop-transition-admission.js";
import {
  GitHubDeliveryAuthorityAdmissionService,
  type GitHubDeliveryActionAuthorizationReceiptV1,
} from "./github-delivery-authority-admission.js";
import {
  FileGitHubDeliveryProposalStore,
  GitHubDeliveryProposalService,
  type GitHubDeliveryAction,
  type GitHubDeliveryProposalV1,
} from "./github-delivery-proposal.js";
import {
  GitHubLocalCommitError,
  GitHubLocalCommitExecutor,
  type GitHubLocalCommitDriver,
} from "./github-local-commit.js";
import {
  GitHubPushDeliveryError,
  GitHubPushDeliveryExecutor,
  type GitHubPushDriver,
} from "./github-push-delivery.js";
import {
  GitHubPullRequestDeliveryError,
  GitHubPullRequestDeliveryExecutor,
} from "./github-pull-request-delivery.js";
import { GitHubMergeDeliveryExecutor } from "./github-merge-delivery.js";
import { DeploymentReleaseExecutor } from "./deployment-release.js";
import {
  DeliveryRecoveryService,
  FileDeliveryConsumedIntentStore,
} from "./delivery-recovery.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";

const BASE_HEAD = "0123456789abcdef0123456789abcdef01234567";
const COMMIT_SHA = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const MERGE_SHA = "9999999999999999999999999999999999999999";
const REMOTE_FINGERPRINT = "c".repeat(64);

const supervisor: SupervisorTaskV1 = {
  schemaVersion: 1,
  supervisorTaskId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-08T05:00:00.000Z",
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
  loopId: "77777777-7777-4777-8777-777777777777",
  createdAt: "2026-10-08T05:00:00.000Z",
  updatedAt: "2026-10-08T05:20:00.000Z",
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

function currentBinding(
  overrides: Partial<AutonomousEngineeringLoopCurrentTaskBindingV1> = {},
): AutonomousEngineeringLoopCurrentTaskBindingV1 {
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
    runCount: 2,
    hasPendingEscalation: false,
    authority: "current_autonomous_loop_task_binding",
    ...overrides,
  };
}

function completionPacket(): TaskCompletionPacketV1 {
  return {
    schemaVersion: 1,
    taskId: supervisor.taskId,
    projectId: supervisor.authority.projectId,
    workspaceId: supervisor.authority.workspaceId,
    capturedAt: "2026-10-08T05:20:00.000Z",
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
        before: {
          capturedAt: "2026-10-08T05:01:00.000Z",
          available: true,
          branch: "feature/test",
          head: BASE_HEAD,
          dirty: false,
          changedFiles: 0,
        },
        after: {
          capturedAt: "2026-10-08T05:19:00.000Z",
          available: true,
          branch: "feature/test",
          head: BASE_HEAD,
          dirty: true,
          changedFiles: 2,
        },
        source: "orchestrator_git_snapshot",
      },
      checkpoint: {
        available: true,
        createdAt: "2026-10-08T05:02:00.000Z",
        runCount: 2,
        restored: false,
        source: "orchestrator_checkpoint",
      },
      recovery: {
        runCount: 2,
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

async function createProposal(root: string): Promise<GitHubDeliveryProposalV1> {
  return await new GitHubDeliveryProposalService(
    root,
    { async revalidateCurrent() { return currentBinding(); } },
    {
      async captureCurrent() {
        return {
          capturedAt: "2026-10-08T05:21:00.000Z",
          available: true,
          digest: "a".repeat(64),
          branch: "feature/test",
          head: BASE_HEAD,
          stagedHash: "b".repeat(64),
          unstagedHash: "c".repeat(64),
          untrackedHash: "d".repeat(64),
        };
      },
    },
    {
      idFactory: () => "88888888-8888-4888-8888-888888888888",
      now: () => new Date("2026-10-08T05:22:00.000Z"),
    },
  ).create(
    loop,
    supervisor,
    completionPacket(),
    ["commit", "push", "pull_request", "merge", "deploy"],
  );
}

function admission(
  store: FileGitHubDeliveryProposalStore,
  proposal: GitHubDeliveryProposalV1,
) {
  let tokenCounter = 0;
  let permitCounter = 0;
  return new GitHubDeliveryAuthorityAdmissionService(
    store,
    {
      async revalidateCurrent() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          taskId: proposal.taskId,
          workspaceId: proposal.workspaceId,
          workspaceRegistryRevision: proposal.workspaceRegistryRevision,
          safetyPlanId: proposal.safetyPlanId,
          safetyProfileId: proposal.safetyProfileId,
          safetyProfileRevision: proposal.safetyProfileRevision,
          observedRunCount: proposal.observedRunCount,
          terminalGitFingerprintDigest: proposal.terminalGit.fingerprintDigest,
          terminalGitHead: proposal.terminalGit.head,
          terminalGitBranch: proposal.terminalGit.branch,
          authority: "current_delivery_authority_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      now: () => Date.parse("2026-10-08T05:23:00.000Z"),
      tokenFactory: () => `token-${++tokenCounter}-${"x".repeat(40)}`,
      idFactory: () =>
        `99999999-9999-4999-8999-${String(++permitCounter).padStart(12, "0")}`,
    },
  );
}

async function authorize(
  service: GitHubDeliveryAuthorityAdmissionService,
  proposalId: string,
  action: GitHubDeliveryAction,
): Promise<GitHubDeliveryActionAuthorizationReceiptV1> {
  const preview = await service.preview(proposalId, action);
  const confirmed = await service.confirm({
    proposalId,
    action,
    confirmationToken: preview.confirmationToken,
    confirmed: true,
  });
  return await service.consumePermit(confirmed.permitToken, proposalId, action);
}

class CommitDriver implements GitHubLocalCommitDriver {
  commitCalls = 0;
  async stagePaths(_root: string, paths: string[]) {
    assert.deepEqual(paths, ["src/a.ts", "src/new.ts"]);
  }
  async commit() {
    this.commitCalls += 1;
    return COMMIT_SHA;
  }
  async committedPaths() {
    return ["src/a.ts", "src/new.ts"];
  }
}

class PushDriver implements GitHubPushDriver {
  pushCalls = 0;
  async remoteUrlFingerprint() { return REMOTE_FINGERPRINT; }
  async push() { this.pushCalls += 1; }
  async remoteRefHead() { return COMMIT_SHA; }
}

function commitExecutor(
  root: string,
  store: FileGitHubDeliveryProposalStore,
  driver: CommitDriver,
) {
  return new GitHubLocalCommitExecutor(
    root,
    store,
    {
      async revalidateCurrent(proposal) {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          taskId: proposal.taskId,
          workspaceId: proposal.workspaceId,
          observedRunCount: proposal.observedRunCount,
          taskStatus: "completed",
          preRunGitClean: true,
          diffSafetyPassed: true,
          changedPaths: [
            { path: "src/a.ts", status: "modified", source: "tracked" },
            { path: "src/new.ts", status: "added", source: "untracked" },
          ],
          currentFingerprint: {
            capturedAt: "2026-10-08T05:23:30.000Z",
            available: true,
            digest: proposal.terminalGit.fingerprintDigest,
            branch: proposal.terminalGit.branch,
            head: proposal.terminalGit.head,
          },
          workspaceRoot: "/workspace",
          authority: "current_local_commit_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    driver,
    { now: () => new Date("2026-10-08T05:24:00.000Z") },
  );
}

function pushExecutor(
  root: string,
  store: FileGitHubDeliveryProposalStore,
  driver: PushDriver,
  staleHead = false,
) {
  return new GitHubPushDeliveryExecutor(
    root,
    store,
    {
      async resolve(proposal) {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          workspaceId: proposal.workspaceId,
          remoteName: "origin",
          remoteUrlFingerprint: REMOTE_FINGERPRINT,
          sourceCommitSha: COMMIT_SHA,
          destinationRef: "refs/heads/feature/test",
          authority: "configured_push_target",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      async revalidateCurrent(proposal) {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          taskId: proposal.taskId,
          workspaceId: proposal.workspaceId,
          localHead: staleHead ? "f".repeat(40) : COMMIT_SHA,
          localBranch: "feature/test",
          workspaceRoot: "/workspace",
          authority: "current_push_delivery_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    driver,
    { now: () => new Date("2026-10-08T05:25:00.000Z") },
  );
}

test("M15H acceptance: full delivery chain requires a distinct explicit permit for every mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15h-chain-"));
  try {
    const proposal = await createProposal(root);
    const store = new FileGitHubDeliveryProposalStore(root);
    const authority = admission(store, proposal);

    assert.equal(proposal.commitAuthorized, false);
    assert.equal(proposal.pushAuthorized, false);
    assert.equal(proposal.pullRequestAuthorized, false);
    assert.equal(proposal.mergeAuthorized, false);
    assert.equal(proposal.deployAuthorized, false);
    assert.equal(proposal.grantsReleaseAuthority, false);

    const commitReceipt = await authorize(authority, proposal.proposalId, "commit");
    const commitDriver = new CommitDriver();
    const commit = await commitExecutor(root, store, commitDriver).execute(
      commitReceipt,
      "Implement bounded change",
    );
    assert.equal(commit.commitSha, COMMIT_SHA);
    assert.equal(commit.pushesRemote, false);
    assert.equal(commit.grantsReleaseAuthority, false);

    const pushDriver = new PushDriver();
    await assert.rejects(
      () => pushExecutor(root, store, pushDriver).execute(commitReceipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "authorization_invalid",
    );
    assert.equal(pushDriver.pushCalls, 0);

    const pushReceipt = await authorize(authority, proposal.proposalId, "push");
    const push = await pushExecutor(root, store, pushDriver).execute(pushReceipt, commit);
    assert.equal(push.commitSha, COMMIT_SHA);
    assert.equal(push.createsPullRequest, false);
    assert.equal(push.grantsReleaseAuthority, false);

    const prExecutor = new GitHubPullRequestDeliveryExecutor(
      root,
      store,
      {
        async resolve(currentProposal, currentPush) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            workspaceId: currentProposal.workspaceId,
            repository: "WasanthaK/example",
            baseRef: "main",
            headRef: "feature/test",
            expectedHeadSha: currentPush.commitSha,
            authority: "configured_pull_request_target",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async revalidateCurrent(currentProposal, currentPush) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            taskId: currentProposal.taskId,
            workspaceId: currentProposal.workspaceId,
            pushedCommitSha: currentPush.commitSha,
            remoteHeadSha: currentPush.commitSha,
            authority: "current_pull_request_delivery_evidence",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async createOrUpdate(input) {
          return {
            number: 42,
            url: "https://github.com/WasanthaK/example/pull/42",
            headSha: input.expectedHeadSha,
            baseRef: input.baseRef,
            headRef: input.headRef,
            created: true,
          };
        },
      },
      { now: () => new Date("2026-10-08T05:26:00.000Z") },
    );

    await assert.rejects(
      () => prExecutor.execute(pushReceipt, push, "Bounded change", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "authorization_invalid",
    );

    const prReceipt = await authorize(authority, proposal.proposalId, "pull_request");
    const pullRequest = await prExecutor.execute(
      prReceipt,
      push,
      "Bounded change",
      "Validated bounded implementation.",
    );
    assert.equal(pullRequest.headSha, COMMIT_SHA);
    assert.equal(pullRequest.merges, false);
    assert.equal(pullRequest.grantsReleaseAuthority, false);

    const mergeReceipt = await authorize(authority, proposal.proposalId, "merge");
    const merge = await new GitHubMergeDeliveryExecutor(
      root,
      store,
      {
        async resolve(currentProposal, currentPr) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            workspaceId: currentProposal.workspaceId,
            repository: currentPr.repository,
            pullRequestNumber: currentPr.pullRequestNumber,
            expectedHeadSha: currentPr.headSha,
            expectedBaseRef: currentPr.baseRef,
            mergeMethod: "squash",
            authority: "configured_merge_target",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async revalidateCurrent(currentProposal, currentPr) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            taskId: currentProposal.taskId,
            workspaceId: currentProposal.workspaceId,
            repository: currentPr.repository,
            pullRequestNumber: currentPr.pullRequestNumber,
            open: true,
            headSha: currentPr.headSha,
            baseRef: currentPr.baseRef,
            mergeable: true,
            requiredChecksPassing: true,
            policyAllowsMerge: true,
            authority: "current_merge_delivery_evidence",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async merge(input) {
          return {
            merged: true,
            mergeCommitSha: MERGE_SHA,
            pullRequestNumber: input.pullRequestNumber,
            headSha: input.expectedHeadSha,
            baseRef: "main",
          };
        },
      },
      { now: () => new Date("2026-10-08T05:27:00.000Z") },
    ).execute(mergeReceipt, pullRequest);
    assert.equal(merge.mergeCommitSha, MERGE_SHA);
    assert.equal(merge.deploys, false);
    assert.equal(merge.grantsReleaseAuthority, false);

    const deployReceipt = await authorize(authority, proposal.proposalId, "deploy");
    const deployment = await new DeploymentReleaseExecutor(
      root,
      store,
      {
        async resolve(currentProposal, currentMerge) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            workspaceId: currentProposal.workspaceId,
            provider: "example-cloud",
            application: "example-app",
            environment: "production",
            targetId: "primary",
            expectedRevision: currentMerge.mergeCommitSha,
            authority: "configured_deployment_target",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async revalidateCurrent(currentProposal, currentMerge, target) {
          return {
            schemaVersion: 1,
            proposalId: currentProposal.proposalId,
            taskId: currentProposal.taskId,
            workspaceId: currentProposal.workspaceId,
            provider: target.provider,
            application: target.application,
            environment: target.environment,
            targetId: target.targetId,
            expectedRevision: currentMerge.mergeCommitSha,
            environmentReady: true,
            policyAllowsDeployment: true,
            changeWindowAllowsDeployment: true,
            authority: "current_deployment_policy_evidence",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async deploy(input) {
          return {
            deploymentId: "deploy-123",
            provider: input.provider,
            application: input.application,
            environment: input.environment,
            targetId: input.targetId,
            requestedRevision: input.expectedRevision,
            deployedRevision: input.expectedRevision,
            succeeded: true,
          };
        },
      },
      { now: () => new Date("2026-10-08T05:28:00.000Z") },
    ).execute(deployReceipt, merge);

    assert.equal(deployment.revision, MERGE_SHA);
    assert.equal(deployment.grantsReleaseAuthority, false);

    const permitIds = new Set([
      commitReceipt.permitId,
      pushReceipt.permitId,
      prReceipt.permitId,
      mergeReceipt.permitId,
      deployReceipt.permitId,
    ]);
    assert.equal(permitIds.size, 5);

    // Reconstruct executor after "restart": durable burn still prevents replay.
    await assert.rejects(
      () => pushExecutor(
        root,
        new FileGitHubDeliveryProposalStore(root),
        new PushDriver(),
      ).execute(pushReceipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "authorization_replayed",
    );

    const recovered = await new DeliveryRecoveryService(
      new FileDeliveryConsumedIntentStore(root),
      {
        async observe(intent) {
          return {
            schemaVersion: 1,
            permitId: intent.permitId,
            proposalId: intent.proposalId,
            taskId: intent.taskId,
            action: intent.action,
            classification: "confirmed_applied",
            observedAt: "2026-10-08T05:29:00.000Z",
            summary: "remote observation confirms the pushed commit",
            authority: "delivery_recovery_observation",
            mutatesGit: false,
            mutatesGitHub: false,
            deploys: false,
            usesCredentials: false,
            grantsReleaseAuthority: false,
          };
        },
      },
    ).recover("push", pushReceipt.permitId);

    assert.equal(recovered.classification, "confirmed_applied");
    assert.equal(recovered.consumedPermitReusable, false);
    assert.equal(recovered.retryRequiresNewExplicitAuthorization, true);
    assert.equal(recovered.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15H acceptance: stale evidence blocks mutation and cannot be converted into broader authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15h-stale-"));
  try {
    const proposal = await createProposal(root);
    const store = new FileGitHubDeliveryProposalStore(root);
    const authority = admission(store, proposal);

    const commitReceipt = await authorize(authority, proposal.proposalId, "commit");
    const commit = await commitExecutor(root, store, new CommitDriver()).execute(
      commitReceipt,
      "Implement bounded change",
    );
    const pushReceipt = await authorize(authority, proposal.proposalId, "push");
    const driver = new PushDriver();

    await assert.rejects(
      () => pushExecutor(root, store, driver, true).execute(pushReceipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "evidence_stale",
    );
    assert.equal(driver.pushCalls, 0);

    // A consumed push receipt cannot be repurposed as a commit authorization.
    await assert.rejects(
      () => commitExecutor(root, store, new CommitDriver()).execute(
        pushReceipt,
        "Second commit",
      ),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "authorization_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15H acceptance: ambiguous restart recovery never reuses permit or mints retry authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15h-recovery-"));
  try {
    const proposal = await createProposal(root);
    const store = new FileGitHubDeliveryProposalStore(root);
    const authority = admission(store, proposal);
    const commitReceipt = await authorize(authority, proposal.proposalId, "commit");
    const commit = await commitExecutor(root, store, new CommitDriver()).execute(
      commitReceipt,
      "Implement bounded change",
    );
    const pushReceipt = await authorize(authority, proposal.proposalId, "push");
    await pushExecutor(root, store, new PushDriver()).execute(pushReceipt, commit);

    const recovery = await new DeliveryRecoveryService(
      new FileDeliveryConsumedIntentStore(root),
      {
        async observe(intent) {
          return {
            schemaVersion: 1,
            permitId: intent.permitId,
            proposalId: intent.proposalId,
            taskId: intent.taskId,
            action: intent.action,
            classification: "ambiguous",
            observedAt: "2026-10-08T05:30:00.000Z",
            summary: "remote observation is inconclusive",
            authority: "delivery_recovery_observation",
            mutatesGit: false,
            mutatesGitHub: false,
            deploys: false,
            usesCredentials: false,
            grantsReleaseAuthority: false,
          };
        },
      },
    ).recover("push", pushReceipt.permitId);

    assert.equal(recovery.classification, "ambiguous");
    assert.equal(recovery.consumedPermitReusable, false);
    assert.equal(recovery.retryRequiresNewExplicitAuthorization, true);
    assert.equal(recovery.mutatesGitHub, false);
    assert.equal(recovery.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
