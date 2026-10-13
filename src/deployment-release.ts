import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubDeliveryActionAuthorizationReceiptV1 } from "./github-delivery-authority-admission.js";
import type { FileGitHubDeliveryProposalStore, GitHubDeliveryProposalV1 } from "./github-delivery-proposal.js";
import type { GitHubMergeDeliveryResultV1 } from "./github-merge-delivery.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET = /^[A-Za-z0-9._\/-]+$/;

export const DEPLOYMENT_RELEASE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "deployment_release_execution" as const,
  requiresConsumedDeployAuthorization: true as const,
  requiresExactMergeResult: true as const,
  explicitDeploymentTargetRequired: true as const,
  requiresFreshEnvironmentPolicyEvidence: true as const,
  oneDeploymentMaximum: true as const,
  mutatesGit: false as const,
  mutatesGitHub: false as const,
  deploys: true as const,
  usesCredentials: true as const,
  grantsReleaseAuthority: false as const,
});

export interface DeploymentTargetV1 {
  schemaVersion: 1;
  proposalId: string;
  workspaceId: string;
  provider: string;
  application: string;
  environment: string;
  targetId: string;
  expectedRevision: string;
  authority: "configured_deployment_target";
  grantsReleaseAuthority: false;
}

export interface DeploymentTargetProvider {
  resolve(
    proposal: GitHubDeliveryProposalV1,
    merge: GitHubMergeDeliveryResultV1,
  ): Promise<DeploymentTargetV1>;
}

export interface DeploymentCurrentEvidenceV1 {
  schemaVersion: 1;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  provider: string;
  application: string;
  environment: string;
  targetId: string;
  expectedRevision: string;
  environmentReady: boolean;
  policyAllowsDeployment: boolean;
  changeWindowAllowsDeployment: boolean;
  authority: "current_deployment_policy_evidence";
  grantsReleaseAuthority: false;
}

export interface DeploymentEvidenceProvider {
  revalidateCurrent(
    proposal: GitHubDeliveryProposalV1,
    merge: GitHubMergeDeliveryResultV1,
    target: DeploymentTargetV1,
  ): Promise<DeploymentCurrentEvidenceV1>;
}

export interface DeploymentMutationResult {
  deploymentId: string;
  provider: string;
  application: string;
  environment: string;
  targetId: string;
  requestedRevision: string;
  deployedRevision: string;
  succeeded: boolean;
}

export interface DeploymentDriver {
  deploy(input: {
    provider: string;
    application: string;
    environment: string;
    targetId: string;
    expectedRevision: string;
  }): Promise<DeploymentMutationResult>;
}

export interface DeploymentReleaseResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  workspaceId: string;
  deployedAt: string;
  deploymentId: string;
  provider: string;
  application: string;
  environment: string;
  targetId: string;
  revision: string;
  authority: "deployment_release_result";
  mutatesGit: false;
  mutatesGitHub: false;
  deploys: true;
  usesCredentials: true;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface DeploymentReleaseOptions {
  now?: () => Date;
}

export class DeploymentReleaseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authorization_invalid"
      | "proposal_invalid"
      | "merge_invalid"
      | "target_invalid"
      | "evidence_stale"
      | "authorization_replayed"
      | "deployment_failed"
      | "deployment_verification_failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeploymentReleaseError";
  }
}

function assertAuthorization(
  proposal: GitHubDeliveryProposalV1,
  receipt: GitHubDeliveryActionAuthorizationReceiptV1,
): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "single_delivery_action_authorization_consumed"
    || receipt.action !== "deploy"
    || receipt.proposalId !== proposal.proposalId
    || receipt.taskId !== proposal.taskId
    || receipt.workspaceId !== proposal.workspaceId
    || receipt.grantsReleaseAuthority !== false
    || !UUID.test(receipt.permitId)
  ) {
    throw new DeploymentReleaseError(
      "deployment requires an exact consumed M15B deploy authorization",
      "authorization_invalid",
    );
  }
  if (
    proposal.schemaVersion !== 1
    || proposal.authority !== "github_delivery_proposal_evidence_only"
    || !proposal.requestedActions.includes("deploy")
  ) {
    throw new DeploymentReleaseError(
      "delivery proposal is invalid for deployment",
      "proposal_invalid",
    );
  }
}

function assertMerge(
  proposal: GitHubDeliveryProposalV1,
  merge: GitHubMergeDeliveryResultV1,
): void {
  if (
    merge.schemaVersion !== 1
    || merge.authority !== "github_merge_delivery_result"
    || merge.proposalId !== proposal.proposalId
    || merge.taskId !== proposal.taskId
    || merge.workspaceId !== proposal.workspaceId
    || merge.merges !== true
    || merge.deploys !== false
    || merge.grantsReleaseAuthority !== false
    || !/^[0-9a-f]{40,64}$/i.test(merge.mergeCommitSha)
  ) {
    throw new DeploymentReleaseError(
      "deployment requires the exact verified M15E merge result",
      "merge_invalid",
    );
  }
}

function assertTarget(
  proposal: GitHubDeliveryProposalV1,
  merge: GitHubMergeDeliveryResultV1,
  target: DeploymentTargetV1,
): void {
  if (
    target.schemaVersion !== 1
    || target.authority !== "configured_deployment_target"
    || target.proposalId !== proposal.proposalId
    || target.workspaceId !== proposal.workspaceId
    || !TARGET.test(target.provider)
    || !TARGET.test(target.application)
    || !TARGET.test(target.environment)
    || !TARGET.test(target.targetId)
    || target.expectedRevision !== merge.mergeCommitSha
    || target.grantsReleaseAuthority !== false
  ) {
    throw new DeploymentReleaseError(
      "configured deployment target is invalid or cross-bound",
      "target_invalid",
    );
  }
}

function assertEvidence(
  proposal: GitHubDeliveryProposalV1,
  merge: GitHubMergeDeliveryResultV1,
  target: DeploymentTargetV1,
  evidence: DeploymentCurrentEvidenceV1,
): void {
  if (
    evidence.schemaVersion !== 1
    || evidence.authority !== "current_deployment_policy_evidence"
    || evidence.proposalId !== proposal.proposalId
    || evidence.taskId !== proposal.taskId
    || evidence.workspaceId !== proposal.workspaceId
    || evidence.provider !== target.provider
    || evidence.application !== target.application
    || evidence.environment !== target.environment
    || evidence.targetId !== target.targetId
    || evidence.expectedRevision !== merge.mergeCommitSha
    || evidence.environmentReady !== true
    || evidence.policyAllowsDeployment !== true
    || evidence.changeWindowAllowsDeployment !== true
    || evidence.grantsReleaseAuthority !== false
  ) {
    throw new DeploymentReleaseError(
      "deployment target/readiness/policy evidence changed before deployment",
      "evidence_stale",
    );
  }
}

export class DeploymentReleaseExecutor {
  constructor(
    private readonly stateRoot: string,
    private readonly proposals: Pick<FileGitHubDeliveryProposalStore, "load">,
    private readonly targets: DeploymentTargetProvider,
    private readonly evidence: DeploymentEvidenceProvider,
    private readonly driver: DeploymentDriver,
    private readonly options: DeploymentReleaseOptions = {},
  ) {}

  private consumptionFile(permitId: string): string {
    if (!UUID.test(permitId)) {
      throw new DeploymentReleaseError(
        "deployment authorization permitId is invalid",
        "authorization_invalid",
      );
    }
    return path.join(this.stateRoot, "deployment-consumed", `${permitId}.json`);
  }

  private async burnAuthorization(
    receipt: GitHubDeliveryActionAuthorizationReceiptV1,
    target: DeploymentTargetV1,
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
          action: "deploy",
          provider: target.provider,
          application: target.application,
          environment: target.environment,
          targetId: target.targetId,
          expectedRevision: target.expectedRevision,
          burnedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new DeploymentReleaseError(
          "deployment authorization was already consumed",
          "authorization_replayed",
        );
      }
      throw error;
    }
  }

  async execute(
    receiptInput: GitHubDeliveryActionAuthorizationReceiptV1,
    mergeInput: GitHubMergeDeliveryResultV1,
  ): Promise<DeploymentReleaseResultV1> {
    const receipt = structuredClone(receiptInput);
    const merge = structuredClone(mergeInput);

    let proposal: GitHubDeliveryProposalV1;
    try {
      proposal = await this.proposals.load(receipt.proposalId);
    } catch (error) {
      throw new DeploymentReleaseError(
        "delivery proposal could not be loaded for deployment",
        "proposal_invalid",
        { cause: error },
      );
    }
    assertAuthorization(proposal, receipt);
    assertMerge(proposal, merge);

    let target: DeploymentTargetV1;
    try {
      target = await this.targets.resolve(proposal, merge);
    } catch (error) {
      throw new DeploymentReleaseError(
        "configured deployment target could not be resolved",
        "target_invalid",
        { cause: error },
      );
    }
    assertTarget(proposal, merge, target);

    let current: DeploymentCurrentEvidenceV1;
    try {
      current = await this.evidence.revalidateCurrent(proposal, merge, target);
    } catch (error) {
      throw new DeploymentReleaseError(
        "current deployment readiness/policy evidence could not be revalidated",
        "evidence_stale",
        { cause: error },
      );
    }
    assertEvidence(proposal, merge, target, current);

    // Burn before external deployment mutation.
    await this.burnAuthorization(receipt, target);

    let mutation: DeploymentMutationResult;
    try {
      mutation = await this.driver.deploy({
        provider: target.provider,
        application: target.application,
        environment: target.environment,
        targetId: target.targetId,
        expectedRevision: target.expectedRevision,
      });
    } catch (error) {
      throw new DeploymentReleaseError(
        "deployment failed after authorization was consumed",
        "deployment_failed",
        { cause: error },
      );
    }

    if (
      mutation.succeeded !== true
      || !mutation.deploymentId.trim()
      || mutation.provider !== target.provider
      || mutation.application !== target.application
      || mutation.environment !== target.environment
      || mutation.targetId !== target.targetId
      || mutation.requestedRevision !== target.expectedRevision
      || mutation.deployedRevision !== target.expectedRevision
    ) {
      throw new DeploymentReleaseError(
        "deployment result does not match authorized target/revision",
        "deployment_verification_failed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new DeploymentReleaseError(
        "deployment result clock is invalid",
        "deployment_verification_failed",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      permitId: receipt.permitId,
      proposalId: proposal.proposalId,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      deployedAt: now.toISOString(),
      deploymentId: mutation.deploymentId,
      provider: target.provider,
      application: target.application,
      environment: target.environment,
      targetId: target.targetId,
      revision: target.expectedRevision,
      authority: "deployment_release_result",
      mutatesGit: false,
      mutatesGitHub: false,
      deploys: true,
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
