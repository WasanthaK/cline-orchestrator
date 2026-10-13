import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";
import type { TaskCompletionPacketV1 } from "./task-completion-packet.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WorkspaceFingerprint } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GitHubDeliveryAction =
  | "commit"
  | "push"
  | "pull_request"
  | "merge"
  | "deploy";

export const GITHUB_DELIVERY_PROPOSAL_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "github_delivery_proposal_evidence_only" as const,
  mutatesGit: false as const,
  mutatesGitHub: false as const,
  usesCredentials: false as const,
  commitAuthorized: false as const,
  pushAuthorized: false as const,
  pullRequestAuthorized: false as const,
  mergeAuthorized: false as const,
  deployAuthorized: false as const,
  grantsReleaseAuthority: false as const,
});

export interface GitHubDeliveryTerminalGitEvidenceV1 {
  schemaVersion: 1;
  taskId: string;
  workspaceId: string;
  capturedAt: string;
  available: true;
  fingerprintDigest: string;
  branch?: string;
  head: string;
  authority: "current_terminal_git_evidence";
  grantsReleaseAuthority: false;
}

export interface GitHubDeliveryProposalV1 {
  schemaVersion: 1;
  proposalId: string;
  createdAt: string;
  loopId: string;
  loopRevision: number;
  supervisorTaskId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  observedRunCount: number;
  completionCapturedAt: string;
  terminalGit: GitHubDeliveryTerminalGitEvidenceV1;
  requestedActions: GitHubDeliveryAction[];
  authority: "github_delivery_proposal_evidence_only";
  mutatesGit: false;
  mutatesGitHub: false;
  usesCredentials: false;
  commitAuthorized: false;
  pushAuthorized: false;
  pullRequestAuthorized: false;
  mergeAuthorized: false;
  deployAuthorized: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface GitHubDeliveryProposalOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export interface GitHubDeliveryTerminalGitEvidenceProvider {
  captureCurrent(taskId: string): Promise<WorkspaceFingerprint>;
}

export class GitHubDeliveryProposalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "loop_invalid"
      | "binding_stale"
      | "completion_invalid"
      | "git_evidence_invalid"
      | "actions_invalid"
      | "proposal_invalid"
      | "store_invalid"
      | "proposal_replayed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubDeliveryProposalError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeActions(actionsInput: GitHubDeliveryAction[]): GitHubDeliveryAction[] {
  const allowed = new Set<GitHubDeliveryAction>([
    "commit",
    "push",
    "pull_request",
    "merge",
    "deploy",
  ]);
  if (!Array.isArray(actionsInput) || actionsInput.length < 1 || actionsInput.length > 5) {
    throw new GitHubDeliveryProposalError(
      "delivery proposal must request between one and five actions",
      "actions_invalid",
    );
  }
  const result: GitHubDeliveryAction[] = [];
  for (const action of actionsInput) {
    if (!allowed.has(action)) {
      throw new GitHubDeliveryProposalError(
        `unsupported delivery action ${String(action)}`,
        "actions_invalid",
      );
    }
    if (!result.includes(action)) result.push(action);
  }
  if (result.length !== actionsInput.length) {
    throw new GitHubDeliveryProposalError(
      "delivery proposal actions must not contain duplicates",
      "actions_invalid",
    );
  }
  const remote = result.some((action) =>
    ["push", "pull_request", "merge", "deploy"].includes(action),
  );
  if (remote && !result.includes("commit")) {
    throw new GitHubDeliveryProposalError(
      "remote delivery proposal must include commit as the local delivery root",
      "actions_invalid",
    );
  }
  return result;
}

function assertLoopAndSupervisor(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
): void {
  const binding = loop.authorityBinding;
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.phase !== "succeeded"
    || loop.stopReason !== "acceptance_criteria_satisfied"
    || binding.supervisorTaskId !== supervisor.supervisorTaskId
    || binding.taskId !== supervisor.taskId
    || binding.projectId !== supervisor.authority.projectId
    || binding.workspaceId !== supervisor.authority.workspaceId
    || binding.workspaceRegistryRevision !== supervisor.authority.workspaceRegistryRevision
    || binding.safetyPlanId !== supervisor.authority.safetyPlanId
    || binding.safetyPolicyVersion !== supervisor.authority.safetyPolicyVersion
    || binding.safetyProfileId !== supervisor.authority.safetyProfileId
    || binding.safetyProfileRevision !== supervisor.authority.safetyProfileRevision
    || binding.workerProfileId !== supervisor.authority.workerProfileId
    || !sameStrings(binding.allowedPathPatterns, supervisor.authority.allowedPathPatterns)
    || !sameStrings(binding.protectedPathPatterns, supervisor.authority.protectedPathPatterns)
  ) {
    throw new GitHubDeliveryProposalError(
      "delivery proposal requires an exact succeeded M14 loop/supervisor binding",
      "loop_invalid",
    );
  }
}

function assertCurrent(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
): void {
  const binding = loop.authorityBinding;
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_autonomous_loop_task_binding"
    || current.taskId !== binding.taskId
    || current.projectId !== binding.projectId
    || current.workspaceId !== binding.workspaceId
    || current.workspaceRegistryRevision !== binding.workspaceRegistryRevision
    || current.safetyPlanId !== binding.safetyPlanId
    || current.safetyPolicyVersion !== binding.safetyPolicyVersion
    || current.safetyProfileId !== binding.safetyProfileId
    || current.safetyProfileRevision !== binding.safetyProfileRevision
    || current.workerProfileId !== binding.workerProfileId
    || !sameStrings(current.allowedPathPatterns, binding.allowedPathPatterns)
    || !sameStrings(current.protectedPathPatterns, binding.protectedPathPatterns)
    || current.status !== "completed"
    || current.runCount < 1
    || current.hasPendingEscalation
  ) {
    throw new GitHubDeliveryProposalError(
      "current task/Safety binding is not eligible for delivery proposal",
      "binding_stale",
    );
  }
}

function assertCompletion(
  loop: AutonomousEngineeringLoopStateV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
  packet: TaskCompletionPacketV1,
): void {
  const validation = packet.independentEvidence.validation;
  const diff = packet.independentEvidence.diffSafety;
  const checkpoint = packet.independentEvidence.checkpoint;
  const after = packet.independentEvidence.git.after;
  if (
    packet.schemaVersion !== 1
    || packet.taskId !== loop.authorityBinding.taskId
    || packet.projectId !== loop.authorityBinding.projectId
    || packet.workspaceId !== loop.authorityBinding.workspaceId
    || packet.status !== "completed"
    || packet.reviewState !== "ready_for_supervisor_review"
    || packet.completionSignal.terminal !== true
    || packet.independentEvidence.recovery.runCount !== current.runCount
    || validation.available !== true
    || validation.passed !== true
    || diff.available !== true
    || diff.passed !== true
    || checkpoint.available !== true
    || checkpoint.restored !== false
    || checkpoint.runCount !== current.runCount
    || !after
    || after.available !== true
    || !after.head
  ) {
    throw new GitHubDeliveryProposalError(
      "successful current completion evidence is insufficient for delivery proposal",
      "completion_invalid",
    );
  }
}

function terminalGitEvidence(
  taskId: string,
  workspaceId: string,
  packet: TaskCompletionPacketV1,
  fingerprint: WorkspaceFingerprint,
): GitHubDeliveryTerminalGitEvidenceV1 {
  const after = packet.independentEvidence.git.after!;
  if (
    fingerprint.available !== true
    || !fingerprint.digest
    || !fingerprint.head
    || fingerprint.head !== after.head
    || (fingerprint.branch ?? undefined) !== (after.branch ?? undefined)
    || !Number.isFinite(Date.parse(fingerprint.capturedAt))
  ) {
    throw new GitHubDeliveryProposalError(
      "current Git fingerprint no longer matches terminal completion Git identity",
      "git_evidence_invalid",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    taskId,
    workspaceId,
    capturedAt: fingerprint.capturedAt,
    available: true,
    fingerprintDigest: fingerprint.digest,
    ...(fingerprint.branch !== undefined ? { branch: fingerprint.branch } : {}),
    head: fingerprint.head,
    authority: "current_terminal_git_evidence",
    grantsReleaseAuthority: false,
  });
}

function assertProposal(value: GitHubDeliveryProposalV1): void {
  if (
    value.schemaVersion !== 1
    || !UUID.test(value.proposalId)
    || !Number.isFinite(Date.parse(value.createdAt))
    || value.authority !== "github_delivery_proposal_evidence_only"
    || value.requestedActions.length < 1
    || value.mutatesGit !== false
    || value.mutatesGitHub !== false
    || value.usesCredentials !== false
    || value.commitAuthorized !== false
    || value.pushAuthorized !== false
    || value.pullRequestAuthorized !== false
    || value.mergeAuthorized !== false
    || value.deployAuthorized !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
    || value.terminalGit.authority !== "current_terminal_git_evidence"
    || value.terminalGit.grantsReleaseAuthority !== false
  ) {
    throw new GitHubDeliveryProposalError(
      "delivery proposal record is invalid or widened",
      "proposal_invalid",
    );
  }
}

export class FileGitHubDeliveryProposalStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "github-delivery-proposals");
  }

  private file(proposalId: string): string {
    if (!UUID.test(proposalId)) {
      throw new GitHubDeliveryProposalError(
        "proposalId must be an opaque UUID",
        "store_invalid",
      );
    }
    return path.join(this.dir(), `${proposalId}.json`);
  }

  async create(value: GitHubDeliveryProposalV1): Promise<void> {
    assertProposal(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.proposalId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new GitHubDeliveryProposalError(
          "delivery proposal identity already exists",
          "proposal_replayed",
        );
      }
      throw new GitHubDeliveryProposalError(
        "delivery proposal could not be persisted",
        "store_invalid",
        { cause: error },
      );
    }
  }

  async load(proposalId: string): Promise<GitHubDeliveryProposalV1> {
    try {
      const value = JSON.parse(await readFile(this.file(proposalId), "utf8")) as GitHubDeliveryProposalV1;
      assertProposal(value);
      if (value.proposalId !== proposalId) {
        throw new GitHubDeliveryProposalError(
          "delivery proposal file identity mismatch",
          "store_invalid",
        );
      }
      return structuredClone(value);
    } catch (error) {
      if (error instanceof GitHubDeliveryProposalError) throw error;
      throw new GitHubDeliveryProposalError(
        "delivery proposal could not be read",
        "store_invalid",
        { cause: error },
      );
    }
  }
}

export class GitHubDeliveryProposalService {
  private readonly store: FileGitHubDeliveryProposalStore;

  constructor(
    stateRoot: string,
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly gitEvidence: GitHubDeliveryTerminalGitEvidenceProvider,
    private readonly options: GitHubDeliveryProposalOptions = {},
  ) {
    this.store = new FileGitHubDeliveryProposalStore(stateRoot);
  }

  async create(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    packetInput: TaskCompletionPacketV1,
    requestedActionsInput: GitHubDeliveryAction[],
  ): Promise<GitHubDeliveryProposalV1> {
    const loop = structuredClone(loopInput);
    const packet = structuredClone(packetInput);
    assertLoopAndSupervisor(loop, supervisor);
    const requestedActions = normalizeActions(requestedActionsInput);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(supervisor.taskId);
    } catch (error) {
      throw new GitHubDeliveryProposalError(
        "current task/Safety binding could not be revalidated for delivery proposal",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(loop, current);
    assertCompletion(loop, current, packet);

    let fingerprint: WorkspaceFingerprint;
    try {
      fingerprint = await this.gitEvidence.captureCurrent(supervisor.taskId);
    } catch (error) {
      throw new GitHubDeliveryProposalError(
        "current terminal Git evidence could not be captured",
        "git_evidence_invalid",
        { cause: error },
      );
    }
    const terminalGit = terminalGitEvidence(
      supervisor.taskId,
      supervisor.authority.workspaceId,
      packet,
      fingerprint,
    );

    const now = (this.options.now ?? (() => new Date()))();
    const proposalId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (
      !(now instanceof Date)
      || !Number.isFinite(now.getTime())
      || !UUID.test(proposalId)
    ) {
      throw new GitHubDeliveryProposalError(
        "delivery proposal identity/clock is invalid",
        "proposal_invalid",
      );
    }

    const proposal: GitHubDeliveryProposalV1 = {
      schemaVersion: 1,
      proposalId,
      createdAt: now.toISOString(),
      loopId: loop.loopId,
      loopRevision: loop.revision,
      supervisorTaskId: supervisor.supervisorTaskId,
      taskId: supervisor.taskId,
      projectId: supervisor.authority.projectId,
      workspaceId: supervisor.authority.workspaceId,
      workspaceRegistryRevision: supervisor.authority.workspaceRegistryRevision,
      safetyPlanId: supervisor.authority.safetyPlanId,
      safetyPolicyVersion: supervisor.authority.safetyPolicyVersion,
      safetyProfileId: supervisor.authority.safetyProfileId,
      safetyProfileRevision: supervisor.authority.safetyProfileRevision,
      workerProfileId: supervisor.authority.workerProfileId,
      observedRunCount: current.runCount,
      completionCapturedAt: packet.capturedAt,
      terminalGit,
      requestedActions,
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
    assertProposal(proposal);
    await this.store.create(proposal);
    return Object.freeze(structuredClone(proposal));
  }
}
