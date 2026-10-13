import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_MERGE_DELIVERY_CONTRACT,
  GitHubMergeDeliveryError,
  GitHubMergeDeliveryExecutor,
} from "./github-merge-delivery.js";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubPullRequestDeliveryResultV1 } from "./github-pull-request-delivery.js";

const proposal = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  requestedActions: ["commit", "push", "pull_request", "merge"],
  authority: "github_delivery_proposal_evidence_only",
  grantsReleaseAuthority: false,
} as GitHubDeliveryProposalV1;

const pr = {
  schemaVersion: 1,
  permitId: "44444444-4444-4444-8444-444444444444",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  mutatedAt: "2026-10-08T03:00:00.000Z",
  repository: "WasanthaK/example",
  pullRequestNumber: 42,
  pullRequestUrl: "https://github.com/WasanthaK/example/pull/42",
  baseRef: "main",
  headRef: "feature/test",
  headSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  created: true,
  authority: "github_pull_request_delivery_result",
  mutatesGit: false,
  mutatesGitHub: true,
  createsOrUpdatesPullRequest: true,
  merges: false,
  deploys: false,
  usesCredentials: true,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
} as GitHubPullRequestDeliveryResultV1;

const receipt = {
  schemaVersion: 1,
  permitId: "55555555-5555-4555-8555-555555555555",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  action: "merge",
  evidenceFingerprint: "a".repeat(64),
  consumedAt: "2026-10-08T03:01:00.000Z",
  authority: "single_delivery_action_authorization_consumed",
  grantsReleaseAuthority: false,
} as GitHubDeliveryActionAuthorizationReceiptV1;

function executor(root: string, overrides: Record<string, unknown> = {}) {
  return new GitHubMergeDeliveryExecutor(
    root,
    { async load() { return structuredClone(proposal); } },
    {
      async resolve() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          workspaceId: proposal.workspaceId,
          repository: pr.repository,
          pullRequestNumber: pr.pullRequestNumber,
          expectedHeadSha: pr.headSha,
          expectedBaseRef: pr.baseRef,
          mergeMethod: "squash",
          authority: "configured_merge_target",
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
          repository: pr.repository,
          pullRequestNumber: pr.pullRequestNumber,
          open: true,
          headSha: (overrides.headSha as string | undefined) ?? pr.headSha,
          baseRef: pr.baseRef,
          mergeable: (overrides.mergeable as boolean | undefined) ?? true,
          requiredChecksPassing: (overrides.requiredChecksPassing as boolean | undefined) ?? true,
          policyAllowsMerge: (overrides.policyAllowsMerge as boolean | undefined) ?? true,
          authority: "current_merge_delivery_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      async merge() {
        if (overrides.fail) throw new Error("merge API failed");
        return {
          merged: true,
          mergeCommitSha: "9999999999999999999999999999999999999999",
          pullRequestNumber: pr.pullRequestNumber,
          headSha: pr.headSha,
          baseRef: pr.baseRef,
        };
      },
    },
    { now: () => new Date("2026-10-08T03:02:00.000Z") },
  );
}

test("M15E contract is merge-only and excludes deploy", () => {
  assert.equal(GITHUB_MERGE_DELIVERY_CONTRACT.merges, true);
  assert.equal(GITHUB_MERGE_DELIVERY_CONTRACT.deploys, false);
  assert.equal(GITHUB_MERGE_DELIVERY_CONTRACT.grantsReleaseAuthority, false);
});

test("M15E merges exact PR only after fresh checks/policy evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15e-"));
  try {
    const result = await executor(root).execute(receipt, pr);
    assert.equal(result.pullRequestNumber, 42);
    assert.equal(result.headSha, pr.headSha);
    assert.equal(result.baseRef, "main");
    assert.equal(result.mergeMethod, "squash");
    assert.equal(result.deploys, false);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, overrides] of [
  ["head drift", { headSha: "ffffffffffffffffffffffffffffffffffffffff" }],
  ["not mergeable", { mergeable: false }],
  ["checks failing", { requiredChecksPassing: false }],
  ["policy denied", { policyAllowsMerge: false }],
] as const) {
  test(`M15E rejects ${name} before merge mutation`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15e-stale-"));
    try {
      await assert.rejects(
        () => executor(root, overrides).execute(receipt, pr),
        (error: unknown) =>
          error instanceof GitHubMergeDeliveryError
          && error.code === "evidence_stale",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("M15E burns merge authorization before mutation and rejects replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15e-replay-"));
  try {
    const subject = executor(root, { fail: true });
    await assert.rejects(
      () => subject.execute(receipt, pr),
      (error: unknown) =>
        error instanceof GitHubMergeDeliveryError
        && error.code === "merge_failed",
    );
    await assert.rejects(
      () => subject.execute(receipt, pr),
      (error: unknown) =>
        error instanceof GitHubMergeDeliveryError
        && error.code === "authorization_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
