import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_PUSH_DELIVERY_CONTRACT,
  GitHubPushDeliveryError,
  GitHubPushDeliveryExecutor,
  type GitHubPushDriver,
} from "./github-push-delivery.js";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubLocalCommitResultV1 } from "./github-local-commit.js";

const proposal: GitHubDeliveryProposalV1 = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-08T01:00:00.000Z",
  loopId: "22222222-2222-4222-8222-222222222222",
  loopRevision: 6,
  supervisorTaskId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  workspaceId: "66666666-6666-4666-8666-666666666666",
  workspaceRegistryRevision: 7,
  safetyPlanId: "77777777-7777-4777-8777-777777777777",
  safetyPolicyVersion: "policy-v1",
  safetyProfileId: "88888888-8888-4888-8888-888888888888",
  safetyProfileRevision: 9,
  workerProfileId: "default",
  observedRunCount: 2,
  completionCapturedAt: "2026-10-08T01:00:00.000Z",
  terminalGit: {
    schemaVersion: 1,
    taskId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "66666666-6666-4666-8666-666666666666",
    capturedAt: "2026-10-08T01:00:00.000Z",
    available: true,
    fingerprintDigest: "a".repeat(64),
    branch: "feature/test",
    head: "0123456789abcdef0123456789abcdef01234567",
    authority: "current_terminal_git_evidence",
    grantsReleaseAuthority: false,
  },
  requestedActions: ["commit", "push"],
  authority: "github_delivery_proposal_evidence_only",
  mutatesGit: false,
  mutatesGitHub: false,
  usesCredentials: false,
  commitAuthorized: false,
  pushAuthorized: false,
  pullRequestAuthorized: false,
  mergeAuthorized: false,
  deployAuthorized: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const receipt: GitHubDeliveryActionAuthorizationReceiptV1 = {
  schemaVersion: 1,
  permitId: "99999999-9999-4999-8999-999999999999",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  action: "push",
  evidenceFingerprint: "b".repeat(64),
  consumedAt: "2026-10-08T01:01:00.000Z",
  authority: "single_delivery_action_authorization_consumed",
  mutatesGit: false,
  mutatesGitHub: false,
  usesCredentials: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

const commit: GitHubLocalCommitResultV1 = {
  schemaVersion: 1,
  permitId: "12121212-1212-4121-8121-121212121212",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  committedAt: "2026-10-08T01:00:30.000Z",
  commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  message: "Implement bounded change",
  changedPaths: ["src/a.ts"],
  authority: "github_local_commit_result",
  mutatesGit: true,
  mutatesGitHub: false,
  pushesRemote: false,
  createsPullRequest: false,
  merges: false,
  deploys: false,
  usesCredentials: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
};

class FakeDriver implements GitHubPushDriver {
  pushCalls = 0;
  fingerprint = "c".repeat(64);
  remoteHead = commit.commitSha;

  async remoteUrlFingerprint() { return this.fingerprint; }
  async push() { this.pushCalls += 1; }
  async remoteRefHead() { return this.remoteHead; }
}

function executor(root: string, driver: FakeDriver) {
  return new GitHubPushDeliveryExecutor(
    root,
    { async load() { return structuredClone(proposal); } },
    {
      async resolve() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          workspaceId: proposal.workspaceId,
          remoteName: "origin",
          remoteUrlFingerprint: "c".repeat(64),
          sourceCommitSha: commit.commitSha,
          destinationRef: "refs/heads/feature/test",
          authority: "configured_push_target",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      async revalidateCurrent() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          taskId: proposal.taskId,
          workspaceId: proposal.workspaceId,
          localHead: commit.commitSha,
          localBranch: "feature/test",
          workspaceRoot: "/workspace",
          authority: "current_push_delivery_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    driver,
    { now: () => new Date("2026-10-08T01:02:00.000Z") },
  );
}

test("M15D1 contract is push-only and excludes PR/merge/deploy", () => {
  assert.equal(GITHUB_PUSH_DELIVERY_CONTRACT.pushesRemote, true);
  assert.equal(GITHUB_PUSH_DELIVERY_CONTRACT.createsPullRequest, false);
  assert.equal(GITHUB_PUSH_DELIVERY_CONTRACT.merges, false);
  assert.equal(GITHUB_PUSH_DELIVERY_CONTRACT.deploys, false);
  assert.equal(GITHUB_PUSH_DELIVERY_CONTRACT.grantsReleaseAuthority, false);
});

test("M15D1 pushes exact M15C commit to configured ref and verifies remote head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d1-"));
  try {
    const driver = new FakeDriver();
    const result = await executor(root, driver).execute(receipt, commit);

    assert.equal(driver.pushCalls, 1);
    assert.equal(result.commitSha, commit.commitSha);
    assert.equal(result.remoteName, "origin");
    assert.equal(result.destinationRef, "refs/heads/feature/test");
    assert.equal(result.createsPullRequest, false);
    assert.equal(result.merges, false);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D1 rejects changed remote identity before push", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d1-remote-"));
  try {
    const driver = new FakeDriver();
    driver.fingerprint = "d".repeat(64);
    await assert.rejects(
      () => executor(root, driver).execute(receipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "target_invalid",
    );
    assert.equal(driver.pushCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D1 rejects stale local HEAD before push", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d1-head-"));
  try {
    const driver = new FakeDriver();
    const subject = new GitHubPushDeliveryExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      {
        async resolve() {
          return {
            schemaVersion: 1,
            proposalId: proposal.proposalId,
            workspaceId: proposal.workspaceId,
            remoteName: "origin",
            remoteUrlFingerprint: "c".repeat(64),
            sourceCommitSha: commit.commitSha,
            destinationRef: "refs/heads/feature/test",
            authority: "configured_push_target",
            grantsReleaseAuthority: false,
          };
        },
      },
      {
        async revalidateCurrent() {
          return {
            schemaVersion: 1,
            proposalId: proposal.proposalId,
            taskId: proposal.taskId,
            workspaceId: proposal.workspaceId,
            localHead: "ffffffffffffffffffffffffffffffffffffffff",
            localBranch: "feature/test",
            workspaceRoot: "/workspace",
            authority: "current_push_delivery_evidence",
            grantsReleaseAuthority: false,
          };
        },
      },
      driver,
    );
    await assert.rejects(
      () => subject.execute(receipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "evidence_stale",
    );
    assert.equal(driver.pushCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D1 burns push authorization before remote mutation and rejects replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d1-replay-"));
  try {
    const driver = new FakeDriver();
    driver.push = async () => {
      driver.pushCalls += 1;
      throw new Error("network failure");
    };
    const subject = executor(root, driver);
    await assert.rejects(
      () => subject.execute(receipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "push_failed",
    );
    await assert.rejects(
      () => subject.execute(receipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "authorization_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D1 rejects remote verification mismatch after push", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d1-verify-"));
  try {
    const driver = new FakeDriver();
    driver.remoteHead = "ffffffffffffffffffffffffffffffffffffffff";
    await assert.rejects(
      () => executor(root, driver).execute(receipt, commit),
      (error: unknown) =>
        error instanceof GitHubPushDeliveryError
        && error.code === "push_verification_failed",
    );
    assert.equal(driver.pushCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
