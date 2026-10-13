import crypto from "node:crypto";
import type {
  FileGitHubDeliveryProposalStore,
  GitHubDeliveryAction,
  GitHubDeliveryProposalV1,
} from "./github-delivery-proposal.js";

const CONFIRMATION_LIFETIME_MS = 60_000;
const ACTION_PERMIT_LIFETIME_MS = 60_000;
const MAX_PENDING = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GITHUB_DELIVERY_AUTHORITY_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_delivery_action_authority_admission" as const,
  explicitHumanConfirmationRequired: true as const,
  oneProposal: true as const,
  oneAction: true as const,
  shortLived: true as const,
  singleUse: true as const,
  mutatesGit: false as const,
  mutatesGitHub: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubDeliveryAuthorityCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  observedRunCount: number;
  terminalGitFingerprintDigest: string;
  terminalGitHead: string;
  terminalGitBranch?: string;
  authority: "current_delivery_authority_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubDeliveryAuthorityEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
  ): Promise<GitHubDeliveryAuthorityCurrentEvidenceV1>;
}

export interface GitHubDeliveryAuthorizationPreviewV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  action: GitHubDeliveryAction;
  confirmationText: string;
  expiresAt: string;
  confirmationToken: string;
  authority: "delivery_authorization_preview_only";
  mutatesGit: false;
  mutatesGitHub: false;
  usesCredentials: false;
  grantsReleaseAuthority: false;
}

export interface GitHubDeliveryActionPermitV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  action: GitHubDeliveryAction;
  evidenceFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  authority: "single_delivery_action_permit";
  mutatesGit: false;
  mutatesGitHub: false;
  usesCredentials: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface GitHubDeliveryActionAuthorizationReceiptV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  action: GitHubDeliveryAction;
  evidenceFingerprint: string;
  consumedAt: string;
  authority: "single_delivery_action_authorization_consumed";
  mutatesGit: false;
  mutatesGitHub: false;
  usesCredentials: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

interface PendingConfirmation {
  proposalId: string;
  action: GitHubDeliveryAction;
  evidenceFingerprint: string;
  expiresAtMs: number;
}

interface PendingPermit {
  permit: GitHubDeliveryActionPermitV1;
  token: string;
  expiresAtMs: number;
}

export interface GitHubDeliveryAuthorityAdmissionOptions {
  now?: () => number;
  idFactory?: () => string;
  tokenFactory?: () => string;
}

export class GitHubDeliveryAuthorityAdmissionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "proposal_invalid"
      | "action_invalid"
      | "confirmation_invalid"
      | "confirmation_expired"
      | "authority_stale"
      | "permit_invalid"
      | "permit_expired"
      | "capacity_exceeded",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubDeliveryAuthorityAdmissionError";
  }
}

function evidenceFingerprint(
  proposal: GitHubDeliveryProposalV1,
  evidence: GitHubDeliveryAuthorityCurrentEvidenceV1,
): string {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "current_delivery_authority_evidence"
    || evidence.proposalId !== proposal.proposalId
    || evidence.taskId !== proposal.taskId
    || evidence.workspaceId !== proposal.workspaceId
    || evidence.workspaceRegistryRevision !== proposal.workspaceRegistryRevision
    || evidence.safetyPlanId !== proposal.safetyPlanId
    || evidence.safetyProfileId !== proposal.safetyProfileId
    || evidence.safetyProfileRevision !== proposal.safetyProfileRevision
    || evidence.observedRunCount !== proposal.observedRunCount
    || evidence.terminalGitFingerprintDigest !== proposal.terminalGit.fingerprintDigest
    || evidence.terminalGitHead !== proposal.terminalGit.head
    || (evidence.terminalGitBranch ?? undefined) !== (proposal.terminalGit.branch ?? undefined)
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new GitHubDeliveryAuthorityAdmissionError(
      "current task/Safety/Git evidence no longer matches delivery proposal",
      "authority_stale",
    );
  }

  return crypto.createHash("sha256").update(JSON.stringify({
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
    terminalGitBranch: proposal.terminalGit.branch ?? null,
  })).digest("hex");
}

function assertProposalAction(
  proposal: GitHubDeliveryProposalV1,
  action: GitHubDeliveryAction,
): void {
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || proposal.grantsReleaseAuthority !== false
    || proposal.mutatesGit !== false
    || proposal.mutatesGitHub !== false
    || proposal.usesCredentials !== false
  ) {
    throw new GitHubDeliveryAuthorityAdmissionError(
      "delivery proposal is invalid or widened",
      "proposal_invalid",
    );
  }
  if (!proposal.requestedActions.includes(action)) {
    throw new GitHubDeliveryAuthorityAdmissionError(
      `delivery action ${action} was not requested by this proposal`,
      "action_invalid",
    );
  }
}

function confirmationText(action: GitHubDeliveryAction): string {
  switch (action) {
    case "commit":
      return "Authorize only one local Git commit for this exact delivery proposal; no push, PR, merge or deploy";
    case "push":
      return "Authorize only one Git push for this exact delivery proposal; no PR creation, merge or deploy";
    case "pull_request":
      return "Authorize only one pull-request create/update action for this exact delivery proposal; no merge or deploy";
    case "merge":
      return "Authorize only one merge action for this exact delivery proposal; no deploy";
    case "deploy":
      return "Authorize only one deployment action for this exact delivery proposal";
  }
}

export class GitHubDeliveryAuthorityAdmissionService {
  private readonly confirmations = new Map<string, PendingConfirmation>();
  private readonly permits = new Map<string, PendingPermit>();

  constructor(
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly evidence: GitHubDeliveryAuthorityEvidenceProvider,
    private readonly options: GitHubDeliveryAuthorityAdmissionOptions = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private token(): string {
    return (this.options.tokenFactory ?? (() => crypto.randomBytes(32).toString("hex")))();
  }

  private id(): string {
    return (this.options.idFactory ?? (() => crypto.randomUUID()))();
  }

  private prune(now: number): void {
    for (const [token, entry] of this.confirmations) {
      if (entry.expiresAtMs <= now) this.confirmations.delete(token);
    }
    for (const [token, entry] of this.permits) {
      if (entry.expiresAtMs <= now) this.permits.delete(token);
    }
    if (this.confirmations.size + this.permits.size >= MAX_PENDING) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "too many pending delivery authority items",
        "capacity_exceeded",
      );
    }
  }

  private async current(
    proposalId: string,
    action: GitHubDeliveryAction,
  ): Promise<{ proposal: GitHubDeliveryProposalV1; fingerprint: string }> {
    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(proposalId);
    } catch (error) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery proposal could not be loaded",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertProposalAction(proposal, action);

    let current: GitHubDeliveryAuthorityCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal);
    } catch (error) {
      if (error instanceof GitHubDeliveryAuthorityAdmissionError) throw error;
      throw new GitHubDeliveryAuthorityAdmissionError(
        "current delivery authority evidence could not be revalidated",
        "authority_stale",
        { cause: error },
      );
    }
    return { proposal, fingerprint: evidenceFingerprint(proposal, current) };
  }

  async preview(
    proposalId: string,
    action: GitHubDeliveryAction,
  ): Promise<GitHubDeliveryAuthorizationPreviewV1> {
    const { proposal, fingerprint } = await this.current(proposalId, action);
    const now = this.now();
    this.prune(now);
    const token = this.token();
    if (typeof token !== "string" || token.length < 32 || token.includes("\0")) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "confirmation token factory returned invalid token",
        "confirmation_invalid",
      );
    }
    const expiresAtMs = now + CONFIRMATION_LIFETIME_MS;
    this.confirmations.set(token, {
      proposalId: proposal.proposalId,
      action,
      evidenceFingerprint: fingerprint,
      expiresAtMs,
    });
    return {
      schemaVersion: 1,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      action,
      confirmationText: confirmationText(action),
      expiresAt: new Date(expiresAtMs).toISOString(),
      confirmationToken: token,
      authority: "delivery_authorization_preview_only",
      mutatesGit: false,
      mutatesGitHub: false,
      usesCredentials: false,
      grantsReleaseAuthority: false,
    };
  }

  async confirm(input: {
    proposalId: string;
    action: GitHubDeliveryAction;
    confirmationToken: string;
    confirmed: true;
  }): Promise<{ permit: GitHubDeliveryActionPermitV1; permitToken: string }> {
    if (input.confirmed !== true) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "explicit human confirmation is required",
        "confirmation_invalid",
      );
    }
    const entry = this.confirmations.get(input.confirmationToken);
    if (
      !entry
      || entry.proposalId !== input.proposalId
      || entry.action !== input.action
    ) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery confirmation is invalid or already used",
        "confirmation_invalid",
      );
    }

    // Burn confirmation before first await to prevent concurrent/replayed confirmation.
    this.confirmations.delete(input.confirmationToken);
    const now = this.now();
    if (now >= entry.expiresAtMs) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery confirmation expired",
        "confirmation_expired",
      );
    }

    const { proposal, fingerprint } = await this.current(entry.proposalId, entry.action);
    if (fingerprint !== entry.evidenceFingerprint) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery proposal authority changed after preview",
        "authority_stale",
      );
    }

    this.prune(now);
    const permitToken = this.token();
    const permitId = this.id();
    if (
      typeof permitToken !== "string"
      || permitToken.length < 32
      || permitToken.includes("\0")
      || !UUID.test(permitId)
    ) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery action permit identity is invalid",
        "permit_invalid",
      );
    }
    const expiresAtMs = now + ACTION_PERMIT_LIFETIME_MS;
    const permit: GitHubDeliveryActionPermitV1 = Object.freeze({
      schemaVersion: 1,
      permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      action: entry.action,
      evidenceFingerprint: fingerprint,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      authority: "single_delivery_action_permit",
      mutatesGit: false,
      mutatesGitHub: false,
      usesCredentials: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
    this.permits.set(permitToken, { permit, token: permitToken, expiresAtMs });
    return { permit, permitToken };
  }

  async consumePermit(
    permitToken: string,
    proposalId: string,
    action: GitHubDeliveryAction,
  ): Promise<GitHubDeliveryActionAuthorizationReceiptV1> {
    const entry = this.permits.get(permitToken);
    if (
      !entry
      || entry.permit.proposalId !== proposalId
      || entry.permit.action !== action
    ) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery action permit is invalid or already used",
        "permit_invalid",
      );
    }

    // Burn before first await so only one delivery executor can receive authority evidence.
    this.permits.delete(permitToken);
    const now = this.now();
    if (now >= entry.expiresAtMs) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery action permit expired",
        "permit_expired",
      );
    }

    const { fingerprint } = await this.current(proposalId, action);
    if (fingerprint !== entry.permit.evidenceFingerprint) {
      throw new GitHubDeliveryAuthorityAdmissionError(
        "delivery authority changed after explicit confirmation",
        "authority_stale",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: entry.permit.permitId,
      proposalId,
      taskId: entry.permit.taskId,
      workspaceId: entry.permit.workspaceId,
      action,
      evidenceFingerprint: entry.permit.evidenceFingerprint,
      consumedAt: new Date(now).toISOString(),
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
    });
  }
}
