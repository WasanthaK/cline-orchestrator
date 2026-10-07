import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEPLOYMENT_RELEASE_CONTRACT,
  DeploymentReleaseError,
  DeploymentReleaseExecutor,
} from "./deployment-release.js";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubMergeDeliveryResultV1 } from "./github-merge-delivery.js";

const proposal = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  requestedActions: ["commit", "push", "pull_request", "merge", "deploy"],
  authority: "github_delivery_proposal_evidence_only",
  grantsReleaseAuthority: false,
} as GitHubDeliveryProposalV1;

const merge = {
  schemaVersion: 1,
  permitId: "44444444-4444-4444-8444-444444444444",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  mergedAt: "2026-10-08T04:00:00.000Z",
  repository: "WasanthaK/example",
  pullRequestNumber: 42,
  headSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  baseRef: "main",
  mergeMethod: "squash",
  mergeCommitSha: "9999999999999999999999999999999999999999",
  authority: "github_merge_delivery_result",
  mutatesGit: false,
  mutatesGitHub: true,
  merges: true,
  deploys: false,
  usesCredentials: true,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false,
} as GitHubMergeDeliveryResultV1;

const receipt = {
  schemaVersion: 1,
  permitId: "55555555-5555-4555-8555-555555555555",
  proposalId: proposal.proposalId,
  taskId: proposal.taskId,
  workspaceId: proposal.workspaceId,
  action: "deploy",
  evidenceFingerprint: "a".repeat(64),
  consumedAt: "2026-10-08T04:01:00.000Z",
  authority: "single_delivery_action_authorization_consumed",
  grantsReleaseAuthority: false,
} as GitHubDeliveryActionAuthorizationReceiptV1;

function executor(root: string, overrides: Record<string, unknown> = {}) {
  return new DeploymentReleaseExecutor(
    root,
    { async load() { return structuredClone(proposal); } },
    {
      async resolve() {
        return {
          schemaVersion: 1,
          proposalId: proposal.proposalId,
          workspaceId: proposal.workspaceId,
          provider: "example-cloud",
          application: "example-app",
          environment: "production",
          targetId: "primary",
          expectedRevision: merge.mergeCommitSha,
          authority: "configured_deployment_target",
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
          provider: "example-cloud",
          application: "example-app",
          environment: "production",
          targetId: "primary",
          expectedRevision: merge.mergeCommitSha,
          environmentReady: (overrides.environmentReady as boolean | undefined) ?? true,
          policyAllowsDeployment: (overrides.policyAllowsDeployment as boolean | undefined) ?? true,
          changeWindowAllowsDeployment: (overrides.changeWindowAllowsDeployment as boolean | undefined) ?? true,
          authority: "current_deployment_policy_evidence",
          grantsReleaseAuthority: false,
        };
      },
    },
    {
      async deploy() {
        if (overrides.fail) throw new Error("deployment API failed");
        return {
          deploymentId: "deploy-123",
          provider: "example-cloud",
          application: "example-app",
          environment: "production",
          targetId: "primary",
          requestedRevision: merge.mergeCommitSha,
          deployedRevision: (overrides.deployedRevision as string | undefined) ?? merge.mergeCommitSha,
          succeeded: true,
        };
      },
    },
    { now: () => new Date("2026-10-08T04:02:00.000Z") },
  );
}

test("M15F contract is deployment-only and still grants no general release authority", () => {
  assert.equal(DEPLOYMENT_RELEASE_CONTRACT.deploys, true);
  assert.equal(DEPLOYMENT_RELEASE_CONTRACT.mutatesGit, false);
  assert.equal(DEPLOYMENT_RELEASE_CONTRACT.mutatesGitHub, false);
  assert.equal(DEPLOYMENT_RELEASE_CONTRACT.grantsReleaseAuthority, false);
});

test("M15F deploys exact merged revision only after fresh environment policy evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15f-"));
  try {
    const result = await executor(root).execute(receipt, merge);
    assert.equal(result.environment, "production");
    assert.equal(result.revision, merge.mergeCommitSha);
    assert.equal(result.deploymentId, "deploy-123");
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, overrides] of [
  ["environment not ready", { environmentReady: false }],
  ["policy denied", { policyAllowsDeployment: false }],
  ["change window closed", { changeWindowAllowsDeployment: false }],
] as const) {
  test(`M15F rejects ${name} before deployment mutation`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15f-stale-"));
    try {
      await assert.rejects(
        () => executor(root, overrides).execute(receipt, merge),
        (error: unknown) =>
          error instanceof DeploymentReleaseError
          && error.code === "evidence_stale",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("M15F burns deployment authorization before external mutation and rejects replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15f-replay-"));
  try {
    const subject = executor(root, { fail: true });
    await assert.rejects(
      () => subject.execute(receipt, merge),
      (error: unknown) =>
        error instanceof DeploymentReleaseError
        && error.code === "deployment_failed",
    );
    await assert.rejects(
      () => subject.execute(receipt, merge),
      (error: unknown) =>
        error instanceof DeploymentReleaseError
        && error.code === "authorization_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15F rejects deployment verification mismatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15f-verify-"));
  try {
    await assert.rejects(
      () => executor(root, {
        deployedRevision: "ffffffffffffffffffffffffffffffffffffffff",
      }).execute(receipt, merge),
      (error: unknown) =>
        error instanceof DeploymentReleaseError
        && error.code === "deployment_verification_failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
