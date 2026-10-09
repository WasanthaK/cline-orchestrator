import { readFile } from "node:fs/promises";
import path from "node:path";

export type DeliveryRecoveryAction =
  | "commit"
  | "push"
  | "pull_request"
  | "merge"
  | "deploy";

export type DeliveryRecoveryClassification =
  | "confirmed_applied"
  | "confirmed_not_applied"
  | "ambiguous";

export const DELIVERY_RECOVERY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "delivery_recovery_observation_only" as const,
  observesOnly: true as const,
  replaysMutation: false as const,
  reusesConsumedPermit: false as const,
  mintsRetryAuthority: false as const,
  mutatesGit: false as const,
  mutatesGitHub: false as const,
  deploys: false as const,
  usesCredentials: false as const,
  grantsReleaseAuthority: false as const,
});

export interface DeliveryConsumedIntentV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  action: DeliveryRecoveryAction;
  burnedAt: string;
  commitSha?: string;
  remoteName?: string;
  destinationRef?: string;
  repository?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  pullRequestNumber?: number;
  expectedHeadSha?: string;
  mergeMethod?: string;
  provider?: string;
  application?: string;
  environment?: string;
  targetId?: string;
  expectedRevision?: string;
  authority: "consumed_delivery_intent";
  grantsReleaseAuthority: false;
}

export interface DeliveryRecoveryObservationV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  action: DeliveryRecoveryAction;
  classification: DeliveryRecoveryClassification;
  observedAt: string;
  summary: string;
  authority: "delivery_recovery_observation";
  mutatesGit: false;
  mutatesGitHub: false;
  deploys: false;
  usesCredentials: false;
  grantsReleaseAuthority: false;
}

export interface DeliveryRecoveryObserver {
  observe(intent: DeliveryConsumedIntentV1): Promise<DeliveryRecoveryObservationV1>;
}

export interface DeliveryRecoveryResultV1 {
  schemaVersion: 1;
  permitId: string;
  proposalId: string;
  taskId: string;
  action: DeliveryRecoveryAction;
  classification: DeliveryRecoveryClassification;
  observedAt: string;
  summary: string;
  retryRequiresNewExplicitAuthorization: true;
  consumedPermitReusable: false;
  authority: "delivery_recovery_observation_only";
  mutatesGit: false;
  mutatesGitHub: false;
  deploys: false;
  usesCredentials: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class DeliveryRecoveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "permit_invalid"
      | "intent_missing"
      | "intent_invalid"
      | "observation_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliveryRecoveryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTION_DIRECTORIES: Readonly<Record<DeliveryRecoveryAction, string>> = Object.freeze({
  commit: "github-local-commit-consumed",
  push: "github-push-consumed",
  pull_request: "github-pr-consumed",
  merge: "github-merge-consumed",
  deploy: "deployment-consumed",
});

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function parseIntent(
  raw: unknown,
  expectedAction: DeliveryRecoveryAction,
  expectedPermitId: string,
): DeliveryConsumedIntentV1 {
  const value = raw as Record<string, unknown>;
  if (
    !value
    || value.schemaVersion !== 1
    || value.permitId !== expectedPermitId
    || value.action !== expectedAction
    || !requiredString(value.proposalId)
    || !requiredString(value.taskId)
    || !requiredString(value.burnedAt)
    || !Number.isFinite(Date.parse(value.burnedAt as string))
  ) {
    throw new DeliveryRecoveryError(
      "consumed delivery intent is malformed or cross-bound",
      "intent_invalid",
    );
  }

  const base: DeliveryConsumedIntentV1 = {
    schemaVersion: 1,
    permitId: expectedPermitId,
    proposalId: value.proposalId as string,
    taskId: value.taskId as string,
    action: expectedAction,
    burnedAt: value.burnedAt as string,
    authority: "consumed_delivery_intent",
    grantsReleaseAuthority: false,
  };

  if (expectedAction === "push") {
    if (
      !requiredString(value.commitSha)
      || !requiredString(value.remoteName)
      || !requiredString(value.destinationRef)
    ) {
      throw new DeliveryRecoveryError("push recovery intent is incomplete", "intent_invalid");
    }
    Object.assign(base, {
      commitSha: value.commitSha,
      remoteName: value.remoteName,
      destinationRef: value.destinationRef,
    });
  } else if (expectedAction === "pull_request") {
    if (
      !requiredString(value.repository)
      || !requiredString(value.baseRef)
      || !requiredString(value.headRef)
      || !requiredString(value.headSha)
    ) {
      throw new DeliveryRecoveryError("pull-request recovery intent is incomplete", "intent_invalid");
    }
    Object.assign(base, {
      repository: value.repository,
      baseRef: value.baseRef,
      headRef: value.headRef,
      headSha: value.headSha,
    });
  } else if (expectedAction === "merge") {
    if (
      !requiredString(value.repository)
      || !Number.isSafeInteger(value.pullRequestNumber)
      || (value.pullRequestNumber as number) < 1
      || !requiredString(value.expectedHeadSha)
      || !requiredString(value.baseRef)
      || !requiredString(value.mergeMethod)
    ) {
      throw new DeliveryRecoveryError("merge recovery intent is incomplete", "intent_invalid");
    }
    Object.assign(base, {
      repository: value.repository,
      pullRequestNumber: value.pullRequestNumber,
      expectedHeadSha: value.expectedHeadSha,
      baseRef: value.baseRef,
      mergeMethod: value.mergeMethod,
    });
  } else if (expectedAction === "deploy") {
    if (
      !requiredString(value.provider)
      || !requiredString(value.application)
      || !requiredString(value.environment)
      || !requiredString(value.targetId)
      || !requiredString(value.expectedRevision)
    ) {
      throw new DeliveryRecoveryError("deployment recovery intent is incomplete", "intent_invalid");
    }
    Object.assign(base, {
      provider: value.provider,
      application: value.application,
      environment: value.environment,
      targetId: value.targetId,
      expectedRevision: value.expectedRevision,
    });
  }

  return Object.freeze(base);
}

function validateObservation(
  intent: DeliveryConsumedIntentV1,
  observation: DeliveryRecoveryObservationV1,
): void {
  if (
    observation.schemaVersion !== 1
    || observation.authority !== "delivery_recovery_observation"
    || observation.permitId !== intent.permitId
    || observation.proposalId !== intent.proposalId
    || observation.taskId !== intent.taskId
    || observation.action !== intent.action
    || !["confirmed_applied", "confirmed_not_applied", "ambiguous"].includes(observation.classification)
    || !Number.isFinite(Date.parse(observation.observedAt))
    || !requiredString(observation.summary)
    || observation.mutatesGit !== false
    || observation.mutatesGitHub !== false
    || observation.deploys !== false
    || observation.usesCredentials !== false
    || observation.grantsReleaseAuthority !== false
  ) {
    throw new DeliveryRecoveryError(
      "delivery recovery observation is invalid or widened",
      "observation_invalid",
    );
  }
}

export class FileDeliveryConsumedIntentStore {
  constructor(private readonly stateRoot: string) {}

  async load(
    action: DeliveryRecoveryAction,
    permitId: string,
  ): Promise<DeliveryConsumedIntentV1> {
    if (!UUID.test(permitId)) {
      throw new DeliveryRecoveryError("permitId must be an opaque UUID", "permit_invalid");
    }
    const file = path.join(
      this.stateRoot,
      ACTION_DIRECTORIES[action],
      `${permitId}.json`,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new DeliveryRecoveryError(
        "consumed delivery intent could not be read",
        "intent_missing",
        { cause: error },
      );
    }
    return parseIntent(raw, action, permitId);
  }
}

export class DeliveryRecoveryService {
  constructor(
    private readonly intents: Pick<FileDeliveryConsumedIntentStore, "load">,
    private readonly observer: DeliveryRecoveryObserver,
  ) {}

  async recover(
    action: DeliveryRecoveryAction,
    permitId: string,
  ): Promise<DeliveryRecoveryResultV1> {
    const intent = await this.intents.load(action, permitId);

    let observation: DeliveryRecoveryObservationV1;
    try {
      observation = await this.observer.observe(intent);
    } catch (error) {
      throw new DeliveryRecoveryError(
        "delivery outcome could not be safely observed",
        "observation_invalid",
        { cause: error },
      );
    }
    validateObservation(intent, observation);

    return Object.freeze({
      schemaVersion: 1,
      permitId: intent.permitId,
      proposalId: intent.proposalId,
      taskId: intent.taskId,
      action: intent.action,
      classification: observation.classification,
      observedAt: observation.observedAt,
      summary: observation.summary,
      retryRequiresNewExplicitAuthorization: true,
      consumedPermitReusable: false,
      authority: "delivery_recovery_observation_only",
      mutatesGit: false,
      mutatesGitHub: false,
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
