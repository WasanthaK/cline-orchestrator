import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_LOCAL_COMMIT_CONTRACT,
  GitHubLocalCommitError,
  GitHubLocalCommitExecutor,
  type GitHubLocalCommitDriver,
} from "./github-local-commit.js";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";

const proposal: GitHubDeliveryProposalV1 = {
  schemaVersion: 1,
  proposalId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-08T00:00:00.000Z",
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
  completionCapturedAt: "2026-10-08T00:00:00.000Z",
  terminalGit: {
    schemaVersion: 1,
    taskId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "66666666-6666-4666-8666-666666666666",
    capturedAt: "2026-10-08T00:00:00.000Z",
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
  action: "commit",
  evidenceFingerprint: "b".repeat(64),
  consumedAt: "2026-10-08T00:01:00.000Z",
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

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    observedRunCount: proposal.observedRunCount,
    taskStatus: "completed" as const,
    preRunGitClean: true as const,
    diffSafetyPassed: true as const,
    changedPaths: [
      { path: "src/a.ts", status: "modified" as const, source: "tracked" as const },
      { path: "src/new.ts", status: "added" as const, source: "untracked" as const },
    ],
    currentFingerprint: {
      capturedAt: "2026-10-08T00:01:30.000Z",
      available: true,
      digest: proposal.terminalGit.fingerprintDigest,
      branch: proposal.terminalGit.branch,
      head: proposal.terminalGit.head,
    },
    workspaceRoot: "/workspace",
    authority: "current_local_commit_evidence" as const,
    grantsReleaseAuthority: false as const,
    ...overrides,
  };
}

class FakeDriver implements GitHubLocalCommitDriver {
  staged: string[] = [];
  commitCalls = 0;
  actualPaths = ["src/a.ts", "src/new.ts"];

  async stagePaths(_root: string, paths: string[]) {
    this.staged = [...paths];
  }
  async commit(_root: string, _message: string) {
    this.commitCalls += 1;
    return "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
  }
  async committedPaths() {
    return [...this.actualPaths];
  }
}

test("M15C contract is local commit only", () => {
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.mutatesGit, true);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.mutatesGitHub, false);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.pushesRemote, false);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.merges, false);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.deploys, false);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.usesCredentials, false);
  assert.equal(GITHUB_LOCAL_COMMIT_CONTRACT.grantsReleaseAuthority, false);
});

test("M15C stages only proven task paths and creates one verified local commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-"));
  try {
    const driver = new FakeDriver();
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      { async revalidateCurrent() { return evidence(); } },
      driver,
      { now: () => new Date("2026-10-08T00:02:00.000Z") },
    );

    const result = await executor.execute(receipt, "Implement bounded change");
    assert.deepEqual(driver.staged, ["src/a.ts", "src/new.ts"]);
    assert.equal(driver.commitCalls, 1);
    assert.equal(result.commitSha, "abcdefabcdefabcdefabcdefabcdefabcdefabcd");
    assert.equal(result.pushesRemote, false);
    assert.equal(result.grantsReleaseAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15C rejects dirty pre-run workspace before any Git mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-dirty-"));
  try {
    const driver = new FakeDriver();
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      { async revalidateCurrent() { return evidence({ preRunGitClean: false }); } },
      driver,
    );
    await assert.rejects(
      () => executor.execute(receipt, "Implement bounded change"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "dirty_baseline_unsupported",
    );
    assert.equal(driver.commitCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15C rejects stale terminal fingerprint before Git mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-stale-"));
  try {
    const driver = new FakeDriver();
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      {
        async revalidateCurrent() {
          return evidence({
            currentFingerprint: {
              capturedAt: "2026-10-08T00:01:30.000Z",
              available: true,
              digest: "f".repeat(64),
              branch: proposal.terminalGit.branch,
              head: proposal.terminalGit.head,
            },
          });
        },
      },
      driver,
    );
    await assert.rejects(
      () => executor.execute(receipt, "Implement bounded change"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "evidence_stale",
    );
    assert.equal(driver.commitCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15C burns authorization durably before Git mutation and rejects replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-replay-"));
  try {
    const failing = new FakeDriver();
    failing.commit = async () => {
      failing.commitCalls += 1;
      throw new Error("commit failed");
    };
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      { async revalidateCurrent() { return evidence(); } },
      failing,
    );
    await assert.rejects(
      () => executor.execute(receipt, "Implement bounded change"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "git_failed",
    );

    await assert.rejects(
      () => executor.execute(receipt, "Implement bounded change"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "authorization_replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15C rejects commit containing paths outside proven task delta", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-paths-"));
  try {
    const driver = new FakeDriver();
    driver.actualPaths = ["src/a.ts", "src/new.ts", "secret.txt"];
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      { async revalidateCurrent() { return evidence(); } },
      driver,
    );
    await assert.rejects(
      () => executor.execute(receipt, "Implement bounded change"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "commit_verification_failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M15C rejects multiline or oversized commit message", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m15c-message-"));
  try {
    const driver = new FakeDriver();
    const executor = new GitHubLocalCommitExecutor(
      root,
      { async load() { return structuredClone(proposal); } },
      { async revalidateCurrent() { return evidence(); } },
      driver,
    );
    await assert.rejects(
      () => executor.execute(receipt, "line one\nline two"),
      (error: unknown) =>
        error instanceof GitHubLocalCommitError
        && error.code === "message_invalid",
    );
    assert.equal(driver.commitCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
