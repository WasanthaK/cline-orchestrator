import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { FileGitHubDeliveryProposalStore, GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubPushResultV1 } from "./github-push-delivery.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_NAME = /^[A-Za-z0-9._\/-]+$/;
const MAX_TITLE = 160;
const MAX_BODY = 10_000;

export const GITHUB_PULL_REQUEST_DELIVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_pull_request_delivery_execution" as const,
  requiresConsumedPullRequestAuthorization: true as const,
  requiresExactPushResult: true as const,
  explicitRepositoryTargetRequired: true as const,
  onePullRequestMutationMaximum: true as const,
  mutatesGit: false as const,
  mutatesGitHub: true as const,
  createsOrUpdatesPullRequest: true as const,
  merges: false as const,
  deploys: false as const,
  usesCredentials: true as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubPullRequestTargetV1 {
  schemaVersion: 1;
  proposalId: string;
  workspaceId: string;
  repository: string;
  baseRef: string;
  headRef: string;
  expectedHeadSha: string;
  authority: "configured_pull_request_target";
  grantsReleaseAuthority: false;
}

export interface GitHubPullRequestTargetProvider {
  resolve(
    proposal: GitHubDeliveryProposalV1,
    push: GitHubPushResultV1,
  ): Promise<GitHubPullRequestTargetV1>;
}

export interface GitHubPullRequestCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  pushedCommitSha: string;
  remoteHeadSha: string;
  authority: "current_pull_request_delivery_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubPullRequestEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
    push: GitHubPushResultV1,
    target: GitHubPullRequestTargetV1,
  ): Promise<GitHubPullRequestCurrentEvidenceV1>;
}

export interface GitHubPullRequestMutationResult {
  number: number;
  url: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  created: boolean;
}

export interface GitHubPullRequestDriver {
  createOrUpdate(input: {
    repository: string;
    baseRef: string;
    headRef: string;
    title: string;
    body: string;
    expectedHeadSha: string;
  }): Promise<GitHubPullRequestMutationResult>;
}

export interface GitHubPullRequestDeliveryResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  mutatedAt: string;
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  created: boolean;
  authority: "github_pull_request_delivery_result";
  mutatesGit: false;
  mutatesGitHub: true;
  createsOrUpdatesPullRequest: true;
  merges: false;
  deploys: false;
  usesCredentials: true;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface GitHubPullRequestDeliveryOptions {
  now?: () => Date;
}

export class GitHubPullRequestDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authorization_invalid"
      | "proposal_invalid"
      | "push_invalid"
      | "target_invalid"
      | "evidence_stale"
      | "content_invalid"
      | "authorization_replayed"
      | "pull_request_failed"
      | "pull_request_verification_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubPullRequestDeliveryError";
  }
}

function assertAuthorization(
  proposal: GitHubDeliveryProposalV1,
  receipt: GitHubDeliveryActionAuthorizationReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "single_delivery_action_authorization_consumed"
    || receipt.action !== "pull_request"
    || receipt.proposalId !== proposal.proposalId
    || receipt.taskId !== proposal.taskId
    || receipt.workspaceId !== proposal.workspaceId
    || receipt.grantsReleaseAuthority !== false
    || !UUID.test(receipt.permitId)
  ) {
    throw new GitHubPullRequestDeliveryError(
      "pull-request mutation requires an exact consumed M15B pull_request authorization",
      "authorization_invalid",
    );
  }
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || !proposal.requestedActions.includes("pull_request")
  ) {
    throw new GitHubPullRequestDeliveryError(
      "delivery proposal is invalid for pull-request mutation",
      "proposal_invalid",
    );
  }
}

function assertPush(
  proposal: GitHubDeliveryProposalV1,
  push: GitHubPushResultV1,
): void {
  if (
    push.schemaVersion !== 1
    || push.authority !== "github_push_delivery_result"
    || push.proposalId !== proposal.proposalId
    || push.taskId !== proposal.taskId
    || push.workspaceId !== proposal.workspaceId
    || push.pushesRemote !== true
    || push.createsPullRequest !== false
    || push.merges !== false
    || push.deploys !== false
    || push.grantsReleaseAuthority !== false
    || !/^[0-9a-f]{40,64}$/i.test(push.commitSha)
  ) {
    throw new GitHubPullRequestDeliveryError(
      "pull-request mutation requires the exact verified M15D1 push result",
      "push_invalid",
    );
  }
}

function assertTarget(
  proposal: GitHubDeliveryProposalV1,
  push: GitHubPushResultV1,
  target: GitHubPullRequestTargetV1,
): void {
  if (
    target.schemaVersion !== 1
    || target.authority !== "configured_pull_request_target"
    || target.proposalId !== proposal.proposalId
    || target.workspaceId !== proposal.workspaceId
    || !OWNER_REPO.test(target.repository)
    || !REF_NAME.test(target.baseRef)
    || !REF_NAME.test(target.headRef)
    || target.baseRef === target.headRef
    || target.expectedHeadSha !== push.commitSha
    || target.grantsReleaseAuthority !== false
  ) {
    throw new GitHubPullRequestDeliveryError(
      "configured pull-request target is invalid or cross-bound",
      "target_invalid",
    );
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > MAX_TITLE || title.includes("\0") || /[\r\n]/.test(title)) {
    throw new GitHubPullRequestDeliveryError(
      "pull-request title must be one line and within bounds",
      "content_invalid",
    );
  }
  return title;
}

function normalizeBody(value: string): string {
  const body = value.trim();
  if (body.length > MAX_BODY || body.includes("\0")) {
    throw new GitHubPullRequestDeliveryError(
      "pull-request body exceeds allowed bounds",
      "content_invalid",
    );
  }
  return body;
}

export class GitHubPullRequestDeliveryExecutor {
  constructor(
    private readonly stateRoot: string,
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly targets: GitHubPullRequestTargetProvider,
    private readonly evidence: GitHubPullRequestEvidenceProvider,
    private readonly driver: GitHubPullRequestDriver,
    private readonly options: GitHubPullRequestDeliveryOptions = {},
  ) {}

  private consumptionFile(permitId: string): string {
    if (!UUID.test(permitId)) {
      throw new GitHubPullRequestDeliveryError(
        "pull-request authorization permitId is invalid",
        "authorization_invalid",
      );
    }
    return path.join(this.stateRoot, "github-pr-consumed", `${permitId}.json`);
  }

  private async burnAuthorization(
    receipt: GitHubDeliveryActionAuthorizationReceiptV1,
    proposal: GitHubDeliveryProposalV1,
    push: GitHubPushResultV1,
    target: GitHubPullRequestTargetV1,
  ): Promise<void> {
    const file = this.consumptionFile(receipt.permitId);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(
        file,
        `${JSON.stringify({
          schemaVersion: 1,
          permitId: receipt.permitId,
          proposalId: proposal.proposalId,
          taskId: proposal.taskId,
          action: "pull_request",
          repository: target.repository,
          baseRef: target.baseRef,
          headRef: target.headRef,
          headSha: push.commitSha,
          burnedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new GitHubPullRequestDeliveryError(
          "pull-request authorization was already consumed",
          "authorization_replayed",
        );
      }
      throw error;
    }
  }

  async execute(
    receiptInput: GitHubDeliveryActionAuthorizationReceiptV1,
    pushInput: GitHubPushResultV1,
    titleInput: string,
    bodyInput: string,
  ): Promise<GitHubPullRequestDeliveryResultV1> {
    const receipt = structuredClone(receiptInput);
    const push = structuredClone(pushInput);

    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(receipt.proposalId);
    } catch (error) {
      throw new GitHubPullRequestDeliveryError(
        "delivery proposal could not be loaded for pull-request mutation",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertAuthorization(proposal, receipt);
    assertPush(proposal, push);

    let target: GitHubPullRequestTargetV1;
    try {
      target = await this.targets.resolve(proposal, push);
    } catch (error) {
      throw new GitHubPullRequestDeliveryError(
        "configured pull-request target could not be resolved",
        "target_invalid",
        { cause: error },
      );
    }
    assertTarget(proposal, push, target);

    let current: GitHubPullRequestCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal, push, target);
    } catch (error) {
      throw new GitHubPullRequestDeliveryError(
        "current pull-request evidence could not be revalidated",
        "evidence_stale",
        { cause: error },
      );
    }
    if (
      current.schemaVersion !== 1
      || current.authority !== "current_pull_request_delivery_evidence"
      || current.proposalId !== proposal.proposalId
      || current.taskId !== proposal.taskId
      || current.workspaceId !== proposal.workspaceId
      || current.pushedCommitSha !== push.commitSha
      || current.remoteHeadSha !== push.commitSha
      || current.grantsReleaseAuthority !== false
    ) {
      throw new GitHubPullRequestDeliveryError(
        "pushed remote head is stale relative to authorized PR target",
        "evidence_stale",
      );
    }

    const title = normalizeTitle(titleInput);
    const body = normalizeBody(bodyInput);

    await this.burnAuthorization(receipt, proposal, push, target);

    let mutation: GitHubPullRequestMutationResult;
    try {
      mutation = await this.driver.createOrUpdate({
        repository: target.repository,
        baseRef: target.baseRef,
        headRef: target.headRef,
        title,
        body,
        expectedHeadSha: target.expectedHeadSha,
      });
    } catch (error) {
      throw new GitHubPullRequestDeliveryError(
        "pull-request mutation failed after authorization was consumed",
        "pull_request_failed",
        { cause: error },
      );
    }

    if (
      !Number.isSafeInteger(mutation.number)
      || mutation.number < 1
      || !mutation.url
      || mutation.headSha !== push.commitSha
      || mutation.baseRef !== target.baseRef
      || mutation.headRef !== target.headRef
    ) {
      throw new GitHubPullRequestDeliveryError(
        "pull-request mutation result does not match authorized target",
        "pull_request_verification_failed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new GitHubPullRequestDeliveryError(
        "pull-request result clock is invalid",
        "pull_request_verification_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: receipt.permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      mutatedAt: now.toISOString(),
      repository: target.repository,
      pullRequestNumber: mutation.number,
      pullRequestUrl: mutation.url,
      baseRef: mutation.baseRef,
      headRef: mutation.headRef,
      headSha: mutation.headSha,
      created: mutation.created,
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
    });
  }
}
