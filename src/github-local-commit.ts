import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  GitHubDeliveryActionAuthorizationReceiptV1,
} from "./github-delivery-authority-admission.js";
import type {
  FileGitHubDeliveryProposalStore,
  GitHubDeliveryProposalV1,
} from "./github-delivery-proposal.js";
import type { DiffChangedPath, WorkspaceFingerprint } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_MESSAGE_MAX_CHARS = 120;

export const GITHUB_LOCAL_COMMIT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_local_commit_execution" as const,
  requiresConsumedCommitAuthorization: true as const,
  cleanPreRunWorkspaceOnly: true as const,
  exactTerminalFingerprintRequired: true as const,
  stagesOnlyProvenTaskPaths: true as const,
  oneLocalCommitMaximum: true as const,
  mutatesGit: true as const,
  mutatesGitHub: false as const,
  pushesRemote: false as const,
  createsPullRequest: false as const,
  merges: false as const,
  deploys: false as const,
  usesCredentials: false as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubLocalCommitCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  observedRunCount: number;
  taskStatus: "completed";
  preRunGitClean: true;
  diffSafetyPassed: true;
  changedPaths: DiffChangedPath[];
  currentFingerprint: WorkspaceFingerprint;
  workspaceRoot: string;
  authority: "current_local_commit_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubLocalCommitEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
  ): Promise<GitHubLocalCommitCurrentEvidenceV1>;
}

export interface GitHubLocalCommitDriver {
  stagePaths(workspaceRoot: string, paths: string[]): Promise<void>;
  commit(workspaceRoot: string, message: string): Promise<string>;
  committedPaths(workspaceRoot: string, commitSha: string): Promise<string[]>;
}

export interface GitHubLocalCommitResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  committedAt: string;
  commitSha: string;
  message: string;
  changedPaths: string[];
  authority: "github_local_commit_result";
  mutatesGit: true;
  mutatesGitHub: false;
  pushesRemote: false;
  createsPullRequest: false;
  merges: false;
  deploys: false;
  usesCredentials: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface GitHubLocalCommitOptions {
  now?: () => Date;
}

export class GitHubLocalCommitError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authorization_invalid"
      | "proposal_invalid"
      | "evidence_stale"
      | "dirty_baseline_unsupported"
      | "diff_invalid"
      | "message_invalid"
      | "authorization_replayed"
      | "git_failed"
      | "commit_verification_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubLocalCommitError";
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function exactTaskPaths(changedPaths: DiffChangedPath[]): string[] {
  const paths: string[] = [];
  for (const changed of changedPaths) {
    const candidates = [
      ...(changed.previousPath ? [changed.previousPath] : []),
      changed.path,
    ];
    for (const candidate of candidates) {
      const normalized = normalizePath(candidate);
      if (
        !normalized
        || normalized === ".orchestrator"
        || normalized.startsWith(".orchestrator/")
        || normalized.startsWith("../")
        || path.posix.isAbsolute(normalized)
      ) {
        throw new GitHubLocalCommitError(
          `diff-safety path is invalid for commit staging: ${candidate}`,
          "diff_invalid",
        );
      }
      if (!paths.includes(normalized)) paths.push(normalized);
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

function normalizeMessage(value: string): string {
  const message = value.trim();
  if (
    !message
    || message.length > COMMIT_MESSAGE_MAX_CHARS
    || message.includes("\0")
    || /[\r\n]/.test(message)
  ) {
    throw new GitHubLocalCommitError(
      `commit message must be one line and at most ${COMMIT_MESSAGE_MAX_CHARS} characters`,
      "message_invalid",
    );
  }
  return message;
}

function assertAuthorization(
  proposal: GitHubDeliveryProposalV1,
  receipt: GitHubDeliveryActionAuthorizationReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "single_delivery_action_authorization_consumed"
    || receipt.action !== "commit"
    || receipt.proposalId !== proposal.proposalId
    || receipt.taskId !== proposal.taskId
    || receipt.workspaceId !== proposal.workspaceId
    || receipt.mutatesGit !== false
    || receipt.mutatesGitHub !== false
    || receipt.usesCredentials !== false
    || receipt.grantsReleaseAuthority !== false
    || !UUID.test(receipt.permitId)
  ) {
    throw new GitHubLocalCommitError(
      "local commit requires an exact consumed M15B commit authorization",
      "authorization_invalid",
    );
  }
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || !proposal.requestedActions.includes("commit")
    || proposal.grantsReleaseAuthority !== false
  ) {
    throw new GitHubLocalCommitError(
      "delivery proposal is invalid for local commit",
      "proposal_invalid",
    );
  }
}

function assertCurrent(
  proposal: GitHubDeliveryProposalV1,
  evidence: GitHubLocalCommitCurrentEvidenceV1,
): string[] {
  const fp = evidence.currentFingerprint;
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "current_local_commit_evidence"
    || evidence.proposalId !== proposal.proposalId
    || evidence.taskId !== proposal.taskId
    || evidence.workspaceId !== proposal.workspaceId
    || evidence.observedRunCount !== proposal.observedRunCount
    || evidence.taskStatus !== "completed"
    || evidence.diffSafetyPassed !== true
    || evidence.grantsReleaseAuthority !== false
    || !evidence.workspaceRoot.trim()
  ) {
    throw new GitHubLocalCommitError(
      "current task evidence no longer matches delivery proposal",
      "evidence_stale",
    );
  }
  if (evidence.preRunGitClean !== true) {
    throw new GitHubLocalCommitError(
      "M15C intentionally refuses a dirty pre-run workspace to preserve pre-existing user work",
      "dirty_baseline_unsupported",
    );
  }
  if (
    fp.available !== true
    || !fp.digest
    || fp.digest !== proposal.terminalGit.fingerprintDigest
    || !fp.head
    || fp.head !== proposal.terminalGit.head
    || (fp.branch ?? undefined) !== (proposal.terminalGit.branch ?? undefined)
  ) {
    throw new GitHubLocalCommitError(
      "current Git fingerprint no longer matches the proposal terminal identity",
      "evidence_stale",
    );
  }
  const paths = exactTaskPaths(evidence.changedPaths);
  if (paths.length < 1) {
    throw new GitHubLocalCommitError(
      "there are no proven task-delta paths to commit",
      "diff_invalid",
    );
  }
  return paths;
}

export class ExecFileGitHubLocalCommitDriver implements GitHubLocalCommitDriver {
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

  async stagePaths(workspaceRoot: string, paths: string[]): Promise<void> {
    await this.git(workspaceRoot, ["add", "--", ...paths]);
  }

  async commit(workspaceRoot: string, message: string): Promise<string> {
    await this.git(workspaceRoot, ["commit", "--no-verify", "-m", message]);
    return (await this.git(workspaceRoot, ["rev-parse", "--verify", "HEAD"])).trim();
  }

  async committedPaths(workspaceRoot: string, commitSha: string): Promise<string[]> {
    const output = await this.git(workspaceRoot, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      commitSha,
    ]);
    return output.split("\0").filter(Boolean).map(normalizePath).sort((a, b) => a.localeCompare(b));
  }
}

export class GitHubLocalCommitExecutor {
  constructor(
    private readonly stateRoot: string,
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly evidence: GitHubLocalCommitEvidenceProvider,
    private readonly driver: GitHubLocalCommitDriver = new ExecFileGitHubLocalCommitDriver(),
    private readonly options: GitHubLocalCommitOptions = {},
  ) {}

  private consumptionFile(permitId: string): string {
    if (!UUID.test(permitId)) {
      throw new GitHubLocalCommitError(
        "commit authorization permitId is invalid",
        "authorization_invalid",
      );
    }
    return path.join(this.stateRoot, "github-local-commit-consumed", `${permitId}.json`);
  }

  private async burnAuthorization(
    receipt: GitHubDeliveryActionAuthorizationReceiptV1,
    proposal: GitHubDeliveryProposalV1,
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
          action: "commit",
          burnedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new GitHubLocalCommitError(
          "commit authorization was already consumed by the local commit executor",
          "authorization_replayed",
        );
      }
      throw error;
    }
  }

  async execute(
    receiptInput: GitHubDeliveryActionAuthorizationReceiptV1,
    messageInput: string,
  ): Promise<GitHubLocalCommitResultV1> {
    const receipt = structuredClone(receiptInput);
    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(receipt.proposalId);
    } catch (error) {
      throw new GitHubLocalCommitError(
        "delivery proposal could not be loaded for commit",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertAuthorization(proposal, receipt);
    const message = normalizeMessage(messageInput);

    let current: GitHubLocalCommitCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal);
    } catch (error) {
      if (error instanceof GitHubLocalCommitError) throw error;
      throw new GitHubLocalCommitError(
        "current local-commit evidence could not be revalidated",
        "evidence_stale",
        { cause: error },
      );
    }
    const expectedPaths = assertCurrent(proposal, current);

    // Durable burn before first Git mutation. A crash after this point fails closed;
    // ambiguous outcome recovery is a later M15G concern.
    await this.burnAuthorization(receipt, proposal);

    let commitSha: string;
    try {
      await this.driver.stagePaths(current.workspaceRoot, expectedPaths);
      commitSha = (await this.driver.commit(current.workspaceRoot, message)).trim();
    } catch (error) {
      throw new GitHubLocalCommitError(
        "local Git commit failed after authorization was consumed",
        "git_failed",
        { cause: error },
      );
    }
    if (!/^[0-9a-f]{40,64}$/i.test(commitSha) || commitSha === proposal.terminalGit.head) {
      throw new GitHubLocalCommitError(
        "local commit did not produce a new valid Git commit identity",
        "commit_verification_failed",
      );
    }

    let actualPaths: string[];
    try {
      actualPaths = await this.driver.committedPaths(current.workspaceRoot, commitSha);
    } catch (error) {
      throw new GitHubLocalCommitError(
        "new local commit paths could not be verified",
        "commit_verification_failed",
        { cause: error },
      );
    }
    const normalizedActual = [...new Set(actualPaths.map(normalizePath))].sort((a, b) => a.localeCompare(b));
    if (
      normalizedActual.length !== expectedPaths.length
      || normalizedActual.some((value, index) => value !== expectedPaths[index])
    ) {
      throw new GitHubLocalCommitError(
        "new local commit contains paths outside the proven task delta",
        "commit_verification_failed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new GitHubLocalCommitError(
        "local commit result clock is invalid",
        "commit_verification_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: receipt.permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      committedAt: now.toISOString(),
      commitSha,
      message,
      changedPaths: expectedPaths,
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
    });
  }
}
