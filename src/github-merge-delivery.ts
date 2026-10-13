import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { FileGitHubDeliveryProposalStore, GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubPullRequestDeliveryResultV1 } from "./github-pull-request-delivery.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GitHubMergeMethod = "merge" | "squash" | "rebase";

export const GITHUB_MERGE_DELIVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_merge_delivery_execution" as const,
  requiresConsumedMergeAuthorization: true as const,
  requiresExactPullRequestResult: true as const,
  requiresFreshOpenHeadBaseChecksPolicy: true as const,
  oneMergeMaximum: true as const,
  mutatesGit: false as const,
  mutatesGitHub: true as const,
  merges: true as const,
  deploys: false as const,
  usesCredentials: true as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubMergeTargetV1 {
  schemaVersion: 1;
  proposalId: string;
  workspaceId: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
  expectedBaseRef: string;
  mergeMethod: GitHubMergeMethod;
  authority: "configured_merge_target";
  grantsReleaseAuthority: false;
}

export interface GitHubMergeTargetProvider {
  resolve(
    proposal: GitHubDeliveryProposalV1,
    pullRequest: GitHubPullRequestDeliveryResultV1,
  ): Promise<GitHubMergeTargetV1>;
}

export interface GitHubMergeCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  repository: string;
  pullRequestNumber: number;
  open: boolean;
  headSha: string;
  baseRef: string;
  mergeable: boolean;
  requiredChecksPassing: boolean;
  policyAllowsMerge: boolean;
  authority: "current_merge_delivery_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubMergeEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
    pullRequest: GitHubPullRequestDeliveryResultV1,
    target: GitHubMergeTargetV1,
  ): Promise<GitHubMergeCurrentEvidenceV1>;
}

export interface GitHubMergeMutationResult {
  merged: boolean;
  mergeCommitSha: string;
  pullRequestNumber: number;
  headSha: string;
  baseRef: string;
}

export interface GitHubMergeDriver {
  merge(input: {
    repository: string;
    pullRequestNumber: number;
    expectedHeadSha: string;
    mergeMethod: GitHubMergeMethod;
  }): Promise<GitHubMergeMutationResult>;
}

export interface GitHubMergeDeliveryResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  mergedAt: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  baseRef: string;
  mergeMethod: GitHubMergeMethod;
  mergeCommitSha: string;
  authority: "github_merge_delivery_result";
  mutatesGit: false;
  mutatesGitHub: true;
  merges: true;
  deploys: false;
  usesCredentials: true;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface GitHubMergeDeliveryOptions {
  now?: () => Date;
}

export class GitHubMergeDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authorization_invalid"
      | "proposal_invalid"
      | "pull_request_invalid"
      | "target_invalid"
      | "evidence_stale"
      | "authorization_replayed"
      | "merge_failed"
      | "merge_verification_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubMergeDeliveryError";
  }
}

function assertAuthorization(
  proposal: GitHubDeliveryProposalV1,
  receipt: GitHubDeliveryActionAuthorizationReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "single_delivery_action_authorization_consumed"
    || receipt.action !== "merge"
    || receipt.proposalId !== proposal.proposalId
    || receipt.taskId !== proposal.taskId
    || receipt.workspaceId !== proposal.workspaceId
    || receipt.grantsReleaseAuthority !== false
    || !UUID.test(receipt.permitId)
  ) {
    throw new GitHubMergeDeliveryError(
      "merge requires an exact consumed M15B merge authorization",
      "authorization_invalid",
    );
  }
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || !proposal.requestedActions.includes("merge")
  ) {
    throw new GitHubMergeDeliveryError(
      "delivery proposal is invalid for merge",
      "proposal_invalid",
    );
  }
}

function assertPullRequest(
  proposal: GitHubDeliveryProposalV1,
  pullRequest: GitHubPullRequestDeliveryResultV1,
): void {
  if (
    pullRequest.schemaVersion !== 1
    || pullRequest.authority !== "github_pull_request_delivery_result"
    || pullRequest.proposalId !== proposal.proposalId
    || pullRequest.taskId !== proposal.taskId
    || pullRequest.workspaceId !== proposal.workspaceId
    || pullRequest.createsOrUpdatesPullRequest !== true
    || pullRequest.merges !== false
    || pullRequest.deploys !== false
    || pullRequest.grantsReleaseAuthority !== false
    || !/^[0-9a-f]{40,64}$/i.test(pullRequest.headSha)
  ) {
    throw new GitHubMergeDeliveryError(
      "merge requires the exact verified M15D2 pull-request result",
      "pull_request_invalid",
    );
  }
}

function assertTarget(
  proposal: GitHubDeliveryProposalV1,
  pullRequest: GitHubPullRequestDeliveryResultV1,
  target: GitHubMergeTargetV1,
): void {
  if (
    target.schemaVersion !== 1
    || target.authority !== "configured_merge_target"
    || target.proposalId !== proposal.proposalId
    || target.workspaceId !== proposal.workspaceId
    || target.repository !== pullRequest.repository
    || target.pullRequestNumber !== pullRequest.pullRequestNumber
    || target.expectedHeadSha !== pullRequest.headSha
    || target.expectedBaseRef !== pullRequest.baseRef
    || !["merge", "squash", "rebase"].includes(target.mergeMethod)
    || target.grantsReleaseAuthority !== false
  ) {
    throw new GitHubMergeDeliveryError(
      "configured merge target is invalid or cross-bound",
      "target_invalid",
    );
  }
}

function assertEvidence(
  proposal: GitHubDeliveryProposalV1,
  pullRequest: GitHubPullRequestDeliveryResultV1,
  target: GitHubMergeTargetV1,
  evidence: GitHubMergeCurrentEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "current_merge_delivery_evidence"
    || evidence.proposalId !== proposal.proposalId
    || evidence.taskId !== proposal.taskId
    || evidence.workspaceId !== proposal.workspaceId
    || evidence.repository !== target.repository
    || evidence.pullRequestNumber !== target.pullRequestNumber
    || evidence.open !== true
    || evidence.headSha !== pullRequest.headSha
    || evidence.baseRef !== pullRequest.baseRef
    || evidence.mergeable !== true
    || evidence.requiredChecksPassing !== true
    || evidence.policyAllowsMerge !== true
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new GitHubMergeDeliveryError(
      "pull request state/checks/policy changed before merge",
      "evidence_stale",
    );
  }
}

export class GitHubMergeDeliveryExecutor {
  constructor(
    private readonly stateRoot: string,
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly targets: GitHubMergeTargetProvider,
    private readonly evidence: GitHubMergeEvidenceProvider,
    private readonly driver: GitHubMergeDriver,
    private readonly options: GitHubMergeDeliveryOptions = {},
  ) {}

  private consumptionFile(permitId: string): string {
    if (!UUID.test(permitId)) {
      throw new GitHubMergeDeliveryError(
        "merge authorization permitId is invalid",
        "authorization_invalid",
      );
    }
    return path.join(this.stateRoot, "github-merge-consumed", `${permitId}.json`);
  }

  private async burnAuthorization(
    receipt: GitHubDeliveryActionAuthorizationReceiptV1,
    target: GitHubMergeTargetV1,
  ): Promise<void> {
    const file = this.consumptionFile(receipt.permitId);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(
        file,
        `${JSON.stringify({
          schemaVersion: 1,
          permitId: receipt.permitId,
          proposalId: receipt.proposalId,
          taskId: receipt.taskId,
          action: "merge",
          repository: target.repository,
          pullRequestNumber: target.pullRequestNumber,
          expectedHeadSha: target.expectedHeadSha,
          baseRef: target.expectedBaseRef,
          mergeMethod: target.mergeMethod,
          burnedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new GitHubMergeDeliveryError(
          "merge authorization was already consumed",
          "authorization_replayed",
        );
      }
      throw error;
    }
  }

  async execute(
    receiptInput: GitHubDeliveryActionAuthorizationReceiptV1,
    pullRequestInput: GitHubPullRequestDeliveryResultV1,
  ): Promise<GitHubMergeDeliveryResultV1> {
    const receipt = structuredClone(receiptInput);
    const pullRequest = structuredClone(pullRequestInput);

    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(receipt.proposalId);
    } catch (error) {
      throw new GitHubMergeDeliveryError(
        "delivery proposal could not be loaded for merge",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertAuthorization(proposal, receipt);
    assertPullRequest(proposal, pullRequest);

    let target: GitHubMergeTargetV1;
    try {
      target = await this.targets.resolve(proposal, pullRequest);
    } catch (error) {
      throw new GitHubMergeDeliveryError(
        "configured merge target could not be resolved",
        "target_invalid",
        { cause: error },
      );
    }
    assertTarget(proposal, pullRequest, target);

    let current: GitHubMergeCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal, pullRequest, target);
    } catch (error) {
      throw new GitHubMergeDeliveryError(
        "current merge evidence could not be revalidated",
        "evidence_stale",
        { cause: error },
      );
    }
    assertEvidence(proposal, pullRequest, target, current);

    await this.burnAuthorization(receipt, target);

    let mutation: GitHubMergeMutationResult;
    try {
      mutation = await this.driver.merge({
        repository: target.repository,
        pullRequestNumber: target.pullRequestNumber,
        expectedHeadSha: target.expectedHeadSha,
        mergeMethod: target.mergeMethod,
      });
    } catch (error) {
      throw new GitHubMergeDeliveryError(
        "merge failed after authorization was consumed",
        "merge_failed",
        { cause: error },
      );
    }

    if (
      mutation.merged !== true
      || mutation.pullRequestNumber !== target.pullRequestNumber
      || mutation.headSha !== target.expectedHeadSha
      || mutation.baseRef !== target.expectedBaseRef
      || !/^[0-9a-f]{40,64}$/i.test(mutation.mergeCommitSha)
    ) {
      throw new GitHubMergeDeliveryError(
        "merge result does not match authorized pull request/head/base",
        "merge_verification_failed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new GitHubMergeDeliveryError(
        "merge result clock is invalid",
        "merge_verification_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: receipt.permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      mergedAt: now.toISOString(),
      repository: target.repository,
      pullRequestNumber: target.pullRequestNumber,
      headSha: target.expectedHeadSha,
      baseRef: target.expectedBaseRef,
      mergeMethod: target.mergeMethod,
      mergeCommitSha: mutation.mergeCommitSha,
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
    });
  }
}
