import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { FileGitHubDeliveryProposalStore, GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubLocalCommitResultV1 } from "./github-local-commit.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/;

export const GITHUB_PUSH_DELIVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_push_delivery_execution" as const,
  requiresConsumedPushAuthorization: true as const,
  requiresExactLocalCommitResult: true as const,
  explicitRemoteTargetRequired: true as const,
  onePushMaximum: true as const,
  mutatesGit: false as const,
  mutatesGitHub: true as const,
  pushesRemote: true as const,
  createsPullRequest: false as const,
  merges: false as const,
  deploys: false as const,
  usesCredentials: true as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubPushTargetV1 {
  schemaVersion: 1;
  proposalId: string;
  workspaceId: string;
  remoteName: string;
  remoteUrlFingerprint: string;
  sourceCommitSha: string;
  destinationRef: string;
  authority: "configured_push_target";
  grantsReleaseAuthority: false;
}

export interface GitHubPushTargetProvider {
  resolve(proposal: GitHubDeliveryProposalV1): Promise<GitHubPushTargetV1>;
}

export interface GitHubPushCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  localHead: string;
  localBranch?: string;
  workspaceRoot: string;
  authority: "current_push_delivery_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubPushEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
    commit: GitHubLocalCommitResultV1,
  ): Promise<GitHubPushCurrentEvidenceV1>;
}

export interface GitHubPushDriver {
  remoteUrlFingerprint(workspaceRoot: string, remoteName: string): Promise<string>;
  push(
    workspaceRoot: string,
    remoteName: string,
    sourceCommitSha: string,
    destinationRef: string,
  ): Promise<void>;
  remoteRefHead(
    workspaceRoot: string,
    remoteName: string,
    destinationRef: string,
  ): Promise<string>;
}

export interface GitHubPushResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  pushedAt: string;
  remoteName: string;
  remoteUrlFingerprint: string;
  destinationRef: string;
  commitSha: string;
  authority: "github_push_delivery_result";
  mutatesGit: false;
  mutatesGitHub: true;
  pushesRemote: true;
  createsPullRequest: false;
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

export interface GitHubPushDeliveryOptions {
  now?: () => Date;
}

export class GitHubPushDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authorization_invalid"
      | "proposal_invalid"
      | "commit_invalid"
      | "target_invalid"
      | "evidence_stale"
      | "authorization_replayed"
      | "push_failed"
      | "push_verification_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubPushDeliveryError";
  }
}

function assertAuthorization(
  proposal: GitHubDeliveryProposalV1,
  receipt: GitHubDeliveryActionAuthorizationReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "single_delivery_action_authorization_consumed"
    || receipt.action !== "push"
    || receipt.proposalId !== proposal.proposalId
    || receipt.taskId !== proposal.taskId
    || receipt.workspaceId !== proposal.workspaceId
    || receipt.grantsReleaseAuthority !== false
    || !UUID.test(receipt.permitId)
  ) {
    throw new GitHubPushDeliveryError(
      "push requires an exact consumed M15B push authorization",
      "authorization_invalid",
    );
  }
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || !proposal.requestedActions.includes("push")
  ) {
    throw new GitHubPushDeliveryError(
      "delivery proposal is invalid for push",
      "proposal_invalid",
    );
  }
}

function assertCommit(
  proposal: GitHubDeliveryProposalV1,
  commit: GitHubLocalCommitResultV1,
): void {
  if (
    commit.schemaVersion !== 1
    || commit.authority !== "github_local_commit_result"
    || commit.proposalId !== proposal.proposalId
    || commit.taskId !== proposal.taskId
    || commit.workspaceId !== proposal.workspaceId
    || commit.pushesRemote !== false
    || commit.createsPullRequest !== false
    || commit.merges !== false
    || commit.deploys !== false
    || commit.grantsReleaseAuthority !== false
    || !/^[0-9a-f]{40,64}$/i.test(commit.commitSha)
  ) {
    throw new GitHubPushDeliveryError(
      "push requires the exact verified M15C local commit result",
      "commit_invalid",
    );
  }
}

function assertTarget(
  proposal: GitHubDeliveryProposalV1,
  commit: GitHubLocalCommitResultV1,
  target: GitHubPushTargetV1,
): void {
  if (
    target.schemaVersion !== 1
    || target.authority !== "configured_push_target"
    || target.proposalId !== proposal.proposalId
    || target.workspaceId !== proposal.workspaceId
    || target.sourceCommitSha !== commit.commitSha
    || !target.remoteName.trim()
    || target.remoteName.includes("\0")
    || target.remoteName.startsWith("-")
    || !/^[A-Za-z0-9._-]+$/.test(target.remoteName)
    || !/^[0-9a-f]{64}$/i.test(target.remoteUrlFingerprint)
    || !REF.test(target.destinationRef)
    || target.destinationRef.includes("..")
    || target.destinationRef.endsWith("/")
    || target.grantsReleaseAuthority !== false
  ) {
    throw new GitHubPushDeliveryError(
      "configured push target is invalid or cross-bound",
      "target_invalid",
    );
  }
}

function assertEvidence(
  proposal: GitHubDeliveryProposalV1,
  commit: GitHubLocalCommitResultV1,
  evidence: GitHubPushCurrentEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "current_push_delivery_evidence"
    || evidence.proposalId !== proposal.proposalId
    || evidence.taskId !== proposal.taskId
    || evidence.workspaceId !== proposal.workspaceId
    || evidence.localHead !== commit.commitSha
    || !evidence.workspaceRoot.trim()
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new GitHubPushDeliveryError(
      "current local Git evidence no longer matches the authorized commit",
      "evidence_stale",
    );
  }
}

export class ExecFileGitHubPushDriver implements GitHubPushDriver {
  private async git(workspaceRoot: string, args: string[]): Promise<string> {
    const result = await execFile("git", ["-C", workspaceRoot, ...args], {
      windowsHide: true,
      maxBuffer: MAX_GIT_BUFFER,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return result.stdout;
  }

  async remoteUrlFingerprint(workspaceRoot: string, remoteName: string): Promise<string> {
    const crypto = await import("node:crypto");
    const url = (await this.git(workspaceRoot, ["remote", "get-url", remoteName])).trim();
    return crypto.createHash("sha256").update(url).digest("hex");
  }

  async push(
    workspaceRoot: string,
    remoteName: string,
    sourceCommitSha: string,
    destinationRef: string,
  ): Promise<void> {
    await this.git(workspaceRoot, [
      "push",
      "--porcelain",
      remoteName,
      `${sourceCommitSha}:${destinationRef}`,
    ]);
  }

  async remoteRefHead(
    workspaceRoot: string,
    remoteName: string,
    destinationRef: string,
  ): Promise<string> {
    const output = await this.git(workspaceRoot, [
      "ls-remote",
      "--exit-code",
      remoteName,
      destinationRef,
    ]);
    return output.trim().split(/\s+/)[0] ?? "";
  }
}

export class GitHubPushDeliveryExecutor {
  constructor(
    private readonly stateRoot: string,
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly targets: GitHubPushTargetProvider,
    private readonly evidence: GitHubPushEvidenceProvider,
    private readonly driver: GitHubPushDriver = new ExecFileGitHubPushDriver(),
    private readonly options: GitHubPushDeliveryOptions = {},
  ) {}

  private consumptionFile(permitId: string): string {
    if (!UUID.test(permitId)) {
      throw new GitHubPushDeliveryError(
        "push authorization permitId is invalid",
        "authorization_invalid",
      );
    }
    return path.join(this.stateRoot, "github-push-consumed", `${permitId}.json`);
  }

  private async burnAuthorization(
    receipt: GitHubDeliveryActionAuthorizationReceiptV1,
    proposal: GitHubDeliveryProposalV1,
    commit: GitHubLocalCommitResultV1,
    target: GitHubPushTargetV1,
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
          action: "push",
          commitSha: commit.commitSha,
          remoteName: target.remoteName,
          destinationRef: target.destinationRef,
          burnedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new GitHubPushDeliveryError(
          "push authorization was already consumed by the push executor",
          "authorization_replayed",
        );
      }
      throw error;
    }
  }

  async execute(
    receiptInput: GitHubDeliveryActionAuthorizationReceiptV1,
    commitInput: GitHubLocalCommitResultV1,
  ): Promise<GitHubPushResultV1> {
    const receipt = structuredClone(receiptInput);
    const commit = structuredClone(commitInput);

    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(receipt.proposalId);
    } catch (error) {
      throw new GitHubPushDeliveryError(
        "delivery proposal could not be loaded for push",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertAuthorization(proposal, receipt);
    assertCommit(proposal, commit);

    let target: GitHubPushTargetV1;
    try {
      target = await this.targets.resolve(proposal);
    } catch (error) {
      throw new GitHubPushDeliveryError(
        "configured push target could not be resolved",
        "target_invalid",
        { cause: error },
      );
    }
    assertTarget(proposal, commit, target);

    let current: GitHubPushCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal, commit);
    } catch (error) {
      if (error instanceof GitHubPushDeliveryError) throw error;
      throw new GitHubPushDeliveryError(
        "current push evidence could not be revalidated",
        "evidence_stale",
        { cause: error },
      );
    }
    assertEvidence(proposal, commit, current);

    let remoteFingerprint: string;
    try {
      remoteFingerprint = await this.driver.remoteUrlFingerprint(
        current.workspaceRoot,
        target.remoteName,
      );
    } catch (error) {
      throw new GitHubPushDeliveryError(
        "configured Git remote identity could not be verified",
        "target_invalid",
        { cause: error },
      );
    }
    if (remoteFingerprint !== target.remoteUrlFingerprint) {
      throw new GitHubPushDeliveryError(
        "configured Git remote changed before push",
        "target_invalid",
      );
    }

    // Durable burn before first remote mutation.
    await this.burnAuthorization(receipt, proposal, commit, target);

    try {
      await this.driver.push(
        current.workspaceRoot,
        target.remoteName,
        commit.commitSha,
        target.destinationRef,
      );
    } catch (error) {
      throw new GitHubPushDeliveryError(
        "Git push failed after authorization was consumed",
        "push_failed",
        { cause: error },
      );
    }

    let remoteHead: string;
    try {
      remoteHead = (await this.driver.remoteRefHead(
        current.workspaceRoot,
        target.remoteName,
        target.destinationRef,
      )).trim();
    } catch (error) {
      throw new GitHubPushDeliveryError(
        "pushed remote ref could not be verified",
        "push_verification_failed",
        { cause: error },
      );
    }
    if (remoteHead !== commit.commitSha) {
      throw new GitHubPushDeliveryError(
        "remote ref does not point to the authorized local commit",
        "push_verification_failed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new GitHubPushDeliveryError(
        "push result clock is invalid",
        "push_verification_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: receipt.permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      pushedAt: now.toISOString(),
      remoteName: target.remoteName,
      remoteUrlFingerprint: target.remoteUrlFingerprint,
      destinationRef: target.destinationRef,
      commitSha: commit.commitSha,
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
    });
  }
}
