import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MultiAgentParentExecutionBindingProvider,
  MultiAgentParentExecutionBindingV1,
} from "./multi-agent-child-execution-preparation.js";
import type {
  MultiAgentPriorChildStateProvider,
  MultiAgentPriorChildStateV1,
  MultiAgentRepairChildExecutionAdmissionReceiptV1,
} from "./multi-agent-repair-child-execution-admission.js";
import type { MultiAgentRepairChildDescriptorV1 } from "./multi-agent-repair-child.js";
import type { TaskStatus } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set<TaskStatus>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

export const MULTI_AGENT_REPAIR_CHILD_PREPARATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "repair_child_preparation_only" as const,
  durable: true as const,
  executableTask: false as const,
  persistsIntoTaskStore: false as const,
  onePreparationPerRepairChild: true as const,
  requiresConsumedM13LReceipt: true as const,
  requiresFreshParentBinding: true as const,
  requiresPriorChildStillTerminal: true as const,
  carriesPriorRuntimeState: false as const,
  carriesPriorCheckpointState: false as const,
  carriesPriorSessionState: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentRepairChildPreparationV1 {
  schemaVersion: 1;
  preparationId: string;
  preparedAt: string;
  executionAdmissionPermitId: string;
  executionAdmissionConsumedAt: string;
  repairChildTaskId: string;
  priorChildTaskId: string;
  repairAttempt: number;
  delegationSetId: string;
  delegationId: string;
  coordinationMode: "parallel_disjoint" | "serialized";
  parentSupervisorTaskId: string;
  parentTaskId: string;
  projectId: string;
  workspaceId: string;
  workspaceRegistryRevision: number;
  safetyPlanId: string;
  safetyPolicyVersion: string;
  safetyProfileId: string;
  safetyProfileRevision: number;
  workerProfileId: string;
  objective: string;
  repairInstruction: string;
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  state: "prepared";
  executable: false;
  requiresFreshParentBindingAtExecution: true;
  requiresFreshWriterLease: true;
  requiresFreshDistributedFenceWhenDistributed: true;
  priorChildResumeAllowed: false;
  priorChildMutationAllowed: false;
  authority: "repair_child_preparation_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentRepairChildPreparationOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentRepairChildPreparationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "repair_child_invalid"
      | "receipt_invalid"
      | "binding_mismatch"
      | "parent_not_current"
      | "parent_not_executable"
      | "prior_child_not_terminal"
      | "preparation_invalid"
      | "preparation_replayed"
      | "store_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentRepairChildPreparationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertRepairChild(value: MultiAgentRepairChildDescriptorV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_materialization_only"
    || value.executable !== false
    || value.requiresFreshExecutionAdmission !== true
    || value.requiresFreshParentBindingRevalidation !== true
    || value.requiresFreshWriterLease !== true
    || value.priorChildResumeAllowed !== false
    || value.priorChildMutationAllowed !== false
    || value.allowsSubdelegation !== false
    || !UUID.test(value.repairChildTaskId)
    || !UUID.test(value.priorChildTaskId)
    || value.repairChildTaskId === value.priorChildTaskId
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "repair-child descriptor is invalid or widened",
      "repair_child_invalid",
    );
  }
}

function assertReceipt(value: MultiAgentRepairChildExecutionAdmissionReceiptV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_execution_admission_consumed_evidence_only"
    || !UUID.test(value.permitId)
    || !UUID.test(value.repairChildTaskId)
    || !UUID.test(value.priorChildTaskId)
    || !UUID.test(value.delegationSetId)
    || !UUID.test(value.delegationId)
    || !UUID.test(value.parentTaskId)
    || !UUID.test(value.workspaceId)
    || !Number.isFinite(Date.parse(value.consumedAt))
    || value.startsChild !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "consumed repair-child execution admission receipt is invalid or widened",
      "receipt_invalid",
    );
  }
}

function assertReceiptBinding(
  child: MultiAgentRepairChildDescriptorV1,
  receipt: MultiAgentRepairChildExecutionAdmissionReceiptV1,
): void {
  if (
    receipt.repairChildTaskId !== child.repairChildTaskId
    || receipt.priorChildTaskId !== child.priorChildTaskId
    || receipt.delegationSetId !== child.delegationSetId
    || receipt.delegationId !== child.delegationId
    || receipt.parentTaskId !== child.parentTaskId
    || receipt.workspaceId !== child.workspaceId
    || receipt.repairAttempt !== child.repairAttempt
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "repair-child descriptor and consumed M13L receipt are cross-bound",
      "binding_mismatch",
    );
  }
}

function assertParent(
  child: MultiAgentRepairChildDescriptorV1,
  current: MultiAgentParentExecutionBindingV1,
): void {
  if (
    current.schemaVersion !== 1
    || current.authority !== "current_parent_execution_binding"
    || current.taskId !== child.parentTaskId
    || current.projectId !== child.projectId
    || current.workspaceId !== child.workspaceId
    || current.workspaceRegistryRevision !== child.workspaceRegistryRevision
    || current.safetyPlanId !== child.safetyPlanId
    || current.safetyPolicyVersion !== child.safetyPolicyVersion
    || current.safetyProfileId !== child.safetyProfileId
    || current.safetyProfileRevision !== child.safetyProfileRevision
    || current.workerProfileId !== child.workerProfileId
    || !sameStrings(current.trustedValidationCommands, child.trustedValidationCommands)
    || !child.allowedPathPatterns.every((pattern) => current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, child.protectedPathPatterns)
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "current parent task/Safety binding no longer matches repair-child preparation",
      "parent_not_current",
    );
  }
  if (
    TERMINAL.has(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "current parent state does not permit repair-child preparation",
      "parent_not_executable",
    );
  }
}

function assertPrior(
  child: MultiAgentRepairChildDescriptorV1,
  prior: MultiAgentPriorChildStateV1,
): void {
  if (
    prior.schemaVersion !== 1
    || prior.authority !== "prior_child_state_evidence_only"
    || prior.childTaskId !== child.priorChildTaskId
    || prior.projectId !== child.projectId
    || prior.workspaceId !== child.workspaceId
    || !TERMINAL.has(prior.status)
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "prior child is no longer the exact terminal child required by repair preparation",
      "prior_child_not_terminal",
    );
  }
}

function assertPreparation(value: MultiAgentRepairChildPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "repair_child_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || !UUID.test(value.preparationId)
    || !UUID.test(value.executionAdmissionPermitId)
    || !UUID.test(value.repairChildTaskId)
    || !UUID.test(value.priorChildTaskId)
    || value.repairChildTaskId === value.priorChildTaskId
    || !Number.isFinite(Date.parse(value.preparedAt))
    || !Number.isFinite(Date.parse(value.executionAdmissionConsumedAt))
    || value.requiresFreshParentBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.requiresFreshDistributedFenceWhenDistributed !== true
    || value.priorChildResumeAllowed !== false
    || value.priorChildMutationAllowed !== false
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentRepairChildPreparationError(
      "durable repair-child preparation is invalid",
      "preparation_invalid",
    );
  }
}

export class FileMultiAgentRepairChildPreparationStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "multi-agent-repair-child-preparations");
  }

  private file(repairChildTaskId: string): string {
    if (!UUID.test(repairChildTaskId)) {
      throw new MultiAgentRepairChildPreparationError(
        "repairChildTaskId must be an opaque UUID",
        "store_invalid",
      );
    }
    return path.join(this.dir(), `${repairChildTaskId}.json`);
  }

  async create(value: MultiAgentRepairChildPreparationV1): Promise<void> {
    assertPreparation(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.repairChildTaskId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new MultiAgentRepairChildPreparationError(
          "repair-child preparation already exists",
          "preparation_replayed",
        );
      }
      throw error;
    }
  }

  async load(repairChildTaskId: string): Promise<MultiAgentRepairChildPreparationV1> {
    let parsed: MultiAgentRepairChildPreparationV1;
    try {
      parsed = JSON.parse(
        await readFile(this.file(repairChildTaskId), "utf8"),
      ) as MultiAgentRepairChildPreparationV1;
    } catch (error) {
      throw new MultiAgentRepairChildPreparationError(
        `repair-child preparation cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
    assertPreparation(parsed);
    if (parsed.repairChildTaskId !== repairChildTaskId) {
      throw new MultiAgentRepairChildPreparationError(
        "repair-child preparation file identity mismatch",
        "store_invalid",
      );
    }
    return structuredClone(parsed);
  }
}

export class MultiAgentRepairChildPreparationService {
  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly priorChildState: MultiAgentPriorChildStateProvider,
    private readonly store: FileMultiAgentRepairChildPreparationStore,
    private readonly options: MultiAgentRepairChildPreparationOptions = {},
  ) {}

  async prepare(
    childInput: MultiAgentRepairChildDescriptorV1,
    receiptInput: MultiAgentRepairChildExecutionAdmissionReceiptV1,
  ): Promise<MultiAgentRepairChildPreparationV1> {
    assertRepairChild(childInput);
    assertReceipt(receiptInput);
    const child = structuredClone(childInput);
    const receipt = structuredClone(receiptInput);
    assertReceiptBinding(child, receipt);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(child.parentTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildPreparationError(
        "current parent execution binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertParent(child, current);

    let prior: MultiAgentPriorChildStateV1;
    try {
      prior = await this.priorChildState.loadCurrent(child.priorChildTaskId);
    } catch (error) {
      throw new MultiAgentRepairChildPreparationError(
        "prior child state could not be revalidated",
        "prior_child_not_terminal",
        { cause: error },
      );
    }
    assertPrior(child, prior);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new MultiAgentRepairChildPreparationError(
        "repair-child preparation clock is invalid",
        "preparation_invalid",
      );
    }
    const preparationId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(preparationId)) {
      throw new MultiAgentRepairChildPreparationError(
        "preparationId must be an opaque UUID",
        "preparation_invalid",
      );
    }

    const prepared: MultiAgentRepairChildPreparationV1 = {
      schemaVersion: 1,
      preparationId,
      preparedAt: now.toISOString(),
      executionAdmissionPermitId: receipt.permitId,
      executionAdmissionConsumedAt: receipt.consumedAt,
      repairChildTaskId: child.repairChildTaskId,
      priorChildTaskId: child.priorChildTaskId,
      repairAttempt: child.repairAttempt,
      delegationSetId: child.delegationSetId,
      delegationId: child.delegationId,
      coordinationMode: child.coordinationMode,
      parentSupervisorTaskId: child.parentSupervisorTaskId,
      parentTaskId: child.parentTaskId,
      projectId: child.projectId,
      workspaceId: child.workspaceId,
      workspaceRegistryRevision: child.workspaceRegistryRevision,
      safetyPlanId: child.safetyPlanId,
      safetyPolicyVersion: child.safetyPolicyVersion,
      safetyProfileId: child.safetyProfileId,
      safetyProfileRevision: child.safetyProfileRevision,
      workerProfileId: child.workerProfileId,
      objective: child.objective,
      repairInstruction: child.repairInstruction,
      acceptanceCriteria: [...child.acceptanceCriteria],
      trustedValidationCommands: [...child.trustedValidationCommands],
      allowedPathPatterns: [...child.allowedPathPatterns],
      protectedPathPatterns: [...child.protectedPathPatterns],
      state: "prepared",
      executable: false,
      requiresFreshParentBindingAtExecution: true,
      requiresFreshWriterLease: true,
      requiresFreshDistributedFenceWhenDistributed: true,
      priorChildResumeAllowed: false,
      priorChildMutationAllowed: false,
      authority: "repair_child_preparation_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };
    assertPreparation(prepared);
    await this.store.create(prepared);
    return Object.freeze(structuredClone(prepared));
  }
}
