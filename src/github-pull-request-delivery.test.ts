import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_PULL_REQUEST_DELIVERY_CONTRACT,
  GitHubPullRequestDeliveryError,
  GitHubPullRequestDeliveryExecutor,
} from "./github-pull-request-delivery.js";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubPushResultV1 } from "./github-push-delivery.js";

const proposal = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  requestedActions: ["commit", "push", "pull_request"],
  authority: "github_delivery_proposal_evidence_only",
  grantsReleaseAuthority: false,
} as GitHubDeliveryProposalV1;

const push = {
  schemaVersion: 1,
  permitId: "44444444-4444-4444-8444-444444444444",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  pushedAt: "2026-10-08T02:00:00.000Z",
  remoteName: "origin",
  remoteUrlFingerprint: "a".repeat(64),
  destinationRef: "refs/heads/feature/test",
  commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  authority: "github_push_delivery_result",
  mutatesGit: false,
  mutatesGitHub: true,
  pushesRemote: true,
  createsPullRequest: false,
  merges: false,
  deploys: false,
  usesCredentials: true,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
} as GitHubPushResultV1;

const receipt = {
  schemaVersion: 1,
  permitId: "55555555-5555-4555-8555-555555555555",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  action: "pull_request",
  evidenceFingerprint: "b".repeat(64),
  consumedAt: "2026-10-08T02:01:00.000Z",
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
} as GitHubDeliveryActionAuthorizationReceiptV1;

function executor(root: string, overrides: Record<string, unknown> = {}) {
  return new GitHubPullRequestDeliveryExecutor(
    root,
    { async load() { return structuredClone(proposal); } },
    {
      async resolve() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          workspaceId: proposal.workspaceId,
          repository: "WasanthaK/example",
          baseRef: "main",
          headRef: "feature/test",
          expectedHeadSha: push.commitSha,
          authority: "configured_pull_request_target",
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
          pushedCommitSha: push.commitSha,
          remoteHeadSha: (overrides.remoteHeadSha as string | undefined) ?? push.commitSha,
          authority: "current_pull_request_delivery_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      async createOrUpdate() {
        if (overrides.fail) throw new Error("api failed");
        return {
          number: 42,
          url: "https://github.com/WasanthaK/example/pull/42",
          headSha: (overrides.resultHeadSha as string | undefined) ?? push.commitSha,
          baseRef: "main",
          headRef: "feature/test",
          created: true,
        };
      },
    },
    { now: () => new Date("2026-10-08T02:02:00.000Z") },
  );
}

test("M15D2 contract is PR-only and excludes merge/deploy", () => {
  assert.equal(GITHUB_PULL_REQUEST_DELIVERY_CONTRACT.createsOrUpdatesPullRequest, true);
  assert.equal(GITHUB_PULL_REQUEST_DELIVERY_CONTRACT.merges, false);
  assert.equal(GITHUB_PULL_REQUEST_DELIVERY_CONTRACT.deploys, false);
  assert.equal(GITHUB_PULL_REQUEST_DELIVERY_CONTRACT.grantsReleaseAuthority, false);
});

test("M15D2 creates or updates exactly one PR for the verified pushed head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d2-"));
  try {
    const result = await executor(root).execute(
      receipt,
      push,
      "Bounded change",
      "Validated bounded implementation.",
    );
    assert.equal(result.pullRequestNumber, 42);
    assert.equal(result.headSha, push.commitSha);
    assert.equal(result.baseRef, "main");
    assert.equal(result.headRef, "feature/test");
    assert.equal(result.merges, false);
    assert.equal(result.deploys, false);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D2 rejects stale pushed remote head before PR mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d2-stale-"));
  try {
    await assert.rejects(
      () => executor(root, {
        remoteHeadSha: "ffffffffffffffffffffffffffffffffffffffff",
      }).execute(receipt, push, "Bounded change", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "evidence_stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D2 burns authorization before API mutation and rejects replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d2-replay-"));
  try {
    const subject = executor(root, { fail: true });
    await assert.rejects(
      () => subject.execute(receipt, push, "Bounded change", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "pull_request_failed",
    );
    await assert.rejects(
      () => subject.execute(receipt, push, "Bounded change", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "authorization_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D2 rejects mutation result whose head differs from authorized pushed commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d2-head-"));
  try {
    await assert.rejects(
      () => executor(root, {
        resultHeadSha: "ffffffffffffffffffffffffffffffffffffffff",
      }).execute(receipt, push, "Bounded change", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "pull_request_verification_failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15D2 rejects multiline title before API mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15d2-title-"));
  try {
    await assert.rejects(
      () => executor(root).execute(receipt, push, "line one\nline two", ""),
      (error: unknown) =>
        error instanceof GitHubPullRequestDeliveryError
        && error.code === "content_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
