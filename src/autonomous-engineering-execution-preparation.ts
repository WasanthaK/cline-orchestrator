import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FileAutonomousEngineeringLoopStore,
  type AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringExecutionAdmissionReceiptV1,
} from "./autonomous-engineering-execution-admission.js";
import type { AutonomousEngineeringExecutionIntentV1 } from "./autonomous-engineering-execution-intent.js";
import type {
  AutonomousEngineeringLoopCurrentTaskBindingV1,
  AutonomousEngineeringLoopTaskBindingProvider,
} from "./autonomous-engineering-loop-transition-admission.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUTONOMOUS_ENGINEERING_EXECUTION_PREPARATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_execution_preparation_only" as const,
  durable: true as const,
  onePreparationPerIntent: true as const,
  requiresConsumedAdmissionReceipt: true as const,
  requiresExactLoopRevision: true as const,
  requiresFreshTaskSafetyBinding: true as const,
  executable: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  mutatesTaskState: false as const,
  mutatesLoopState: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDistributedDispatch: false as const,
  performsGitDelivery: false as const,
  usesCredentials: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface AutonomousEngineeringExecutionPreparationV1 {
  schemaVersion: 1;
  preparationId: string;
  preparedAt: string;
  permitId: string;
  admissionConsumedAt: string;
  intentId: string;
  loopId: string;
  loopRevision: number;
  taskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  kind: AutonomousEngineeringExecutionIntentV1["kind"];
  objective: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  repairInstruction?: string;
  reviewerDecisionId?: string;
  authority: "autonomous_engineering_execution_preparation_only";
  executable: false;
  requiresFreshTaskSafetyBindingAtExecution: true;
  requiresFreshWriterLease: true;
  requiresFreshDistributedFenceWhenDistributed: true;
  mutatesTaskState: false;
  mutatesLoopState: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringExecutionPreparationOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class AutonomousEngineeringExecutionPreparationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "intent_invalid"
      | "receipt_invalid"
      | "binding_mismatch"
      | "loop_stale"
      | "binding_stale"
      | "preparation_invalid"
      | "preparation_replayed"
      | "store_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringExecutionPreparationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertIntent(intent: AutonomousEngineeringExecutionIntentV1): void {
  if (
    intent.schemaVersion !== 1
    || intent.authority !== "autonomous_engineering_execution_intent_only"
    || intent.executable !== false
    || !UUID.test(intent.intentId)
    || !UUID.test(intent.loopId)
    || !UUID.test(intent.taskId)
    || !UUID.test(intent.projectId)
    || !UUID.test(intent.workspaceId)
    || !UUID.test(intent.safetyPlanId)
    || !UUID.test(intent.safetyProfileId)
    || !Number.isSafeInteger(intent.loopRevision)
    || intent.loopRevision < 1
    || !Number.isSafeInteger(intent.workspaceRegistryRevision)
    || intent.workspaceRegistryRevision < 1
    || !Number.isSafeInteger(intent.safetyProfileRevision)
    || intent.safetyProfileRevision < 1
    || !["initial_implementation", "bounded_repair"].includes(intent.kind)
    || !intent.objective.trim()
    || intent.allowedPathPatterns.length === 0
    || intent.grantsTaskAuthority !== false
    || intent.grantsFilesystemAuthority !== false
    || intent.grantsSafetyPlanAuthority !== false
    || intent.grantsWriterLeaseAuthority !== false
    || intent.grantsCredentialAuthority !== false
    || intent.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "execution intent is invalid or widened",
      "intent_invalid",
    );
  }
  if (intent.kind === "bounded_repair" && (!intent.repairInstruction?.trim() || !intent.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "bounded repair intent is missing trusted repair provenance",
      "intent_invalid",
    );
  }
  if (intent.kind === "initial_implementation" && (intent.repairInstruction || intent.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "initial implementation intent contains repair provenance",
      "intent_invalid",
    );
  }
}

function assertReceipt(receipt: AutonomousEngineeringExecutionAdmissionReceiptV1): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "autonomous_engineering_execution_admission_consumed_evidence_only"
    || receipt.startsExecution !== false
    || !UUID.test(receipt.permitId)
    || !UUID.test(receipt.intentId)
    || !UUID.test(receipt.loopId)
    || !UUID.test(receipt.taskId)
    || !UUID.test(receipt.workspaceId)
    || !Number.isSafeInteger(receipt.loopRevision)
    || receipt.loopRevision < 1
    || !["initial_implementation", "bounded_repair"].includes(receipt.kind)
    || !Number.isFinite(Date.parse(receipt.consumedAt))
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "consumed execution admission receipt is invalid or widened",
      "receipt_invalid",
    );
  }
}

function assertIntentReceiptBinding(
  intent: AutonomousEngineeringExecutionIntentV1,
  receipt: AutonomousEngineeringExecutionAdmissionReceiptV1,
): void {
  if (
    receipt.intentId !== intent.intentId
    || receipt.loopId !== intent.loopId
    || receipt.loopRevision !== intent.loopRevision
    || receipt.taskId !== intent.taskId
    || receipt.workspaceId !== intent.workspaceId
    || receipt.kind !== intent.kind
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "execution intent and consumed admission receipt do not match",
      "binding_mismatch",
    );
  }
}

function assertLoop(intent: AutonomousEngineeringExecutionIntentV1, loop: AutonomousEngineeringLoopStateV1): void {
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.executable !== false
    || loop.loopId !== intent.loopId
    || loop.revision !== intent.loopRevision
    || loop.phase !== "implementation_in_progress"
    || loop.authorityBinding.taskId !== intent.taskId
    || loop.authorityBinding.projectId !== intent.projectId
    || loop.authorityBinding.workspaceId !== intent.workspaceId
    || loop.authorityBinding.workspaceRegistryRevision !== intent.workspaceRegistryRevision
    || loop.authorityBinding.safetyPlanId !== intent.safetyPlanId
    || loop.authorityBinding.safetyPolicyVersion !== intent.safetyPolicyVersion
    || loop.authorityBinding.safetyProfileId !== intent.safetyProfileId
    || loop.authorityBinding.safetyProfileRevision !== intent.safetyProfileRevision
    || loop.authorityBinding.workerProfileId !== intent.workerProfileId
    || !sameStrings(loop.authorityBinding.allowedPathPatterns, intent.allowedPathPatterns)
    || !sameStrings(loop.authorityBinding.protectedPathPatterns, intent.protectedPathPatterns)
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "durable loop no longer matches execution intent",
      "loop_stale",
    );
  }
}

function assertCurrent(
  intent: AutonomousEngineeringExecutionIntentV1,
  current: AutonomousEngineeringLoopCurrentTaskBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_autonomous_loop_task_binding"
    || current.taskId !== intent.taskId
    || current.projectId !== intent.projectId
    || current.workspaceId !== intent.workspaceId
    || current.workspaceRegistryRevision !== intent.workspaceRegistryRevision
    || current.safetyPlanId !== intent.safetyPlanId
    || current.safetyPolicyVersion !== intent.safetyPolicyVersion
    || current.safetyProfileId !== intent.safetyProfileId
    || current.safetyProfileRevision !== intent.safetyProfileRevision
    || current.workerProfileId !== intent.workerProfileId
    || !sameStrings(current.allowedPathPatterns, intent.allowedPathPatterns)
    || !sameStrings(current.protectedPathPatterns, intent.protectedPathPatterns)
    || current.hasPendingEscalation
    || ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "current task/Safety binding no longer permits execution preparation",
      "binding_stale",
    );
  }
}

function assertPreparation(value: AutonomousEngineeringExecutionPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "autonomous_engineering_execution_preparation_only"
    || value.executable !== false
    || !UUID.test(value.preparationId)
    || !UUID.test(value.permitId)
    || !UUID.test(value.intentId)
    || !UUID.test(value.loopId)
    || !UUID.test(value.taskId)
    || !UUID.test(value.projectId)
    || !UUID.test(value.workspaceId)
    || !UUID.test(value.safetyPlanId)
    || !UUID.test(value.safetyProfileId)
    || !Number.isSafeInteger(value.loopRevision)
    || value.loopRevision < 1
    || !Number.isFinite(Date.parse(value.preparedAt))
    || !Number.isFinite(Date.parse(value.admissionConsumedAt))
    || value.allowedPathPatterns.length === 0
    || !["initial_implementation", "bounded_repair"].includes(value.kind)
    || value.requiresFreshTaskSafetyBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.requiresFreshDistributedFenceWhenDistributed !== true
    || value.mutatesTaskState !== false
    || value.mutatesLoopState !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "durable execution preparation is invalid or widened",
      "preparation_invalid",
    );
  }
  if (value.kind === "bounded_repair" && (!value.repairInstruction?.trim() || !value.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "bounded repair preparation is missing trusted repair provenance",
      "preparation_invalid",
    );
  }
  if (value.kind === "initial_implementation" && (value.repairInstruction || value.reviewerDecisionId)) {
    throw new AutonomousEngineeringExecutionPreparationError(
      "initial implementation preparation contains repair provenance",
      "preparation_invalid",
    );
  }
}

export class FileAutonomousEngineeringExecutionPreparationStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "autonomous-engineering-execution-preparations");
  }

  private file(intentId: string): string {
    if (!UUID.test(intentId)) {
      throw new AutonomousEngineeringExecutionPreparationError(
        "intentId must be an opaque UUID",
        "store_invalid",
      );
    }
    return path.join(this.dir(), `${intentId}.json`);
  }

  async create(value: AutonomousEngineeringExecutionPreparationV1): Promise<void> {
    assertPreparation(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.intentId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AutonomousEngineeringExecutionPreparationError(
          "execution preparation already exists for intent",
          "preparation_replayed",
        );
      }
      throw error;
    }
  }

  async load(intentId: string): Promise<AutonomousEngineeringExecutionPreparationV1> {
    let parsed: AutonomousEngineeringExecutionPreparationV1;
    try {
      parsed = JSON.parse(await readFile(this.file(intentId), "utf8")) as AutonomousEngineeringExecutionPreparationV1;
    } catch (error) {
      throw new AutonomousEngineeringExecutionPreparationError(
        `execution preparation cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
    assertPreparation(parsed);
    if (parsed.intentId !== intentId) {
      throw new AutonomousEngineeringExecutionPreparationError(
        "execution preparation file identity mismatch",
        "store_invalid",
      );
    }
    return structuredClone(parsed);
  }
}

export class AutonomousEngineeringExecutionPreparationService {
  private readonly loops: FileAutonomousEngineeringLoopStore;
  private readonly store: FileAutonomousEngineeringExecutionPreparationStore;

  constructor(
    stateRoot: string,
    private readonly taskBinding: AutonomousEngineeringLoopTaskBindingProvider,
    private readonly options: AutonomousEngineeringExecutionPreparationOptions = {},
  ) {
    this.loops = new FileAutonomousEngineeringLoopStore(stateRoot);
    this.store = new FileAutonomousEngineeringExecutionPreparationStore(stateRoot);
  }

  async prepare(
    intentInput: AutonomousEngineeringExecutionIntentV1,
    receiptInput: AutonomousEngineeringExecutionAdmissionReceiptV1,
  ): Promise<AutonomousEngineeringExecutionPreparationV1> {
    assertIntent(intentInput);
    assertReceipt(receiptInput);
    const intent = structuredClone(intentInput);
    const receipt = structuredClone(receiptInput);
    assertIntentReceiptBinding(intent, receipt);

    const loop = await this.loops.load(intent.loopId);
    assertLoop(intent, loop);

    let current: AutonomousEngineeringLoopCurrentTaskBindingV1;
    try {
      current = await this.taskBinding.revalidateCurrent(intent.taskId);
    } catch (error) {
      throw new AutonomousEngineeringExecutionPreparationError(
        "current task/Safety binding could not be revalidated",
        "binding_stale",
        { cause: error },
      );
    }
    assertCurrent(intent, current);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringExecutionPreparationError(
        "execution preparation clock is invalid",
        "preparation_invalid",
      );
    }
    const preparationId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(preparationId)) {
      throw new AutonomousEngineeringExecutionPreparationError(
        "preparationId must be an opaque UUID",
        "preparation_invalid",
      );
    }

    const preparation: AutonomousEngineeringExecutionPreparationV1 = {
      schemaVersion: 1,
      preparationId,
      preparedAt: now.toISOString(),
      permitId: receipt.permitId,
      admissionConsumedAt: receipt.consumedAt,
      intentId: intent.intentId,
      loopId: intent.loopId,
      loopRevision: intent.loopRevision,
      taskId: intent.taskId,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      workspaceRegistryRevision: intent.workspaceRegistryRevision,
      safetyPlanId: intent.safetyPlanId,
      safetyPolicyVersion: intent.safetyPolicyVersion,
      safetyProfileId: intent.safetyProfileId,
      safetyProfileRevision: intent.safetyProfileRevision,
      workerProfileId: intent.workerProfileId,
      allowedPathPatterns: [...intent.allowedPathPatterns],
      protectedPathPatterns: [...intent.protectedPathPatterns],
      kind: intent.kind,
      objective: intent.objective,
      acceptanceCriteria: [...intent.acceptanceCriteria],
      trustedValidationCommands: [...intent.trustedValidationCommands],
      ...(intent.repairInstruction !== undefined ? { repairInstruction: intent.repairInstruction } : {}),
      ...(intent.reviewerDecisionId !== undefined ? { reviewerDecisionId: intent.reviewerDecisionId } : {}),
      authority: "autonomous_engineering_execution_preparation_only",
      executable: false,
      requiresFreshTaskSafetyBindingAtExecution: true,
      requiresFreshWriterLease: true,
      requiresFreshDistributedFenceWhenDistributed: true,
      mutatesTaskState: false,
      mutatesLoopState: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertPreparation(preparation);
    await this.store.create(preparation);
    return Object.freeze(structuredClone(preparation));
  }
}
