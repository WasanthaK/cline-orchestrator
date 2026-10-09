import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MultiAgentChildExecutionAdmissionReceiptV1,
} from "./multi-agent-child-execution-admission.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MULTI_AGENT_CHILD_EXECUTION_PREPARATION_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "child_execution_preparation_only" as const,
  durable: true as const,
  executableTask: false as const,
  persistsIntoTaskStore: false as const,
  onePreparationPerChild: true as const,
  requiresConsumedAdmissionReceipt: true as const,
  requiresFreshParentBinding: true as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  createsDistributedDispatch: false as const,
  invokesDistributedAdmission: false as const,
  allowsSubdelegation: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsWriterLeaseAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentParentExecutionBindingV1 {
  schemaVersion: 1;
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
  trustedValidationCommands: string[];
  status:
    | "created"
    | "running"
    | "waiting"
    | "waiting_for_human"
    | "stalled"
    | "validating"
    | "repairing"
    | "safety_checking"
    | "completed"
    | "validation_failed"
    | "failed"
    | "aborted"
    | "rolled_back";
  hasPendingEscalation: boolean;
  authority: "current_parent_execution_binding";
}

export interface MultiAgentParentExecutionBindingProvider {
  revalidateCurrent(parentTaskId: string): Promise<MultiAgentParentExecutionBindingV1>;
}

export interface MultiAgentChildExecutionPreparationV1 {
  schemaVersion: 1;
  preparationId: string;
  preparedAt: string;
  admissionPermitId: string;
  admissionConsumedAt: string;
  childTaskId: string;
  delegationSetId: string;
  delegationId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
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
  acceptanceCriteria: string[];
  trustedValidationCommands: string[];
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  state: "prepared";
  executable: false;
  requiresFreshParentBindingAtExecution: true;
  requiresFreshWriterLease: true;
  requiresFreshDistributedFenceWhenDistributed: true;
  authority: "child_execution_preparation_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface MultiAgentChildExecutionPreparationOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class MultiAgentChildExecutionPreparationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "child_invalid"
      | "set_invalid"
      | "receipt_invalid"
      | "binding_mismatch"
      | "parent_not_current"
      | "parent_not_executable"
      | "preparation_invalid"
      | "preparation_replayed"
      | "store_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentChildExecutionPreparationError";
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertChild(child: MultiAgentChildTaskDescriptorV1): void {
  if (
    child.schemaVersion !== 1
    || child.authority !== "child_task_materialization_only"
    || child.executable !== false
    || !UUID.test(child.childTaskId)
    || !UUID.test(child.delegationSetId)
    || !UUID.test(child.delegationId)
    || !UUID.test(child.parentTaskId)
    || child.grantsTaskAuthority !== false
    || child.grantsFilesystemAuthority !== false
    || child.grantsSafetyPlanAuthority !== false
    || child.grantsWriterLeaseAuthority !== false
    || child.grantsCredentialAuthority !== false
    || child.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "child task descriptor is invalid or widened",
      "child_invalid",
    );
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !UUID.test(set.delegationSetId)
    || !set.delegationIds.every((id) => UUID.test(id))
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsWriterLeaseAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertReceipt(receipt: MultiAgentChildExecutionAdmissionReceiptV1): void {
  if (
    receipt.schemaVersion !== 1
    || receipt.authority !== "child_execution_admission_consumed_evidence_only"
    || !UUID.test(receipt.permitId)
    || !UUID.test(receipt.childTaskId)
    || !UUID.test(receipt.delegationSetId)
    || !UUID.test(receipt.delegationId)
    || !UUID.test(receipt.parentTaskId)
    || !UUID.test(receipt.workspaceId)
    || !Number.isFinite(Date.parse(receipt.consumedAt))
    || receipt.grantsTaskAuthority !== false
    || receipt.grantsFilesystemAuthority !== false
    || receipt.grantsSafetyPlanAuthority !== false
    || receipt.grantsWriterLeaseAuthority !== false
    || receipt.grantsCredentialAuthority !== false
    || receipt.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "consumed child admission receipt is invalid or widened",
      "receipt_invalid",
    );
  }
}

function assertChildSetReceiptBinding(
  child: MultiAgentChildTaskDescriptorV1,
  set: MultiAgentDelegationSetV1,
  receipt: MultiAgentChildExecutionAdmissionReceiptV1,
): void {
  if (
    child.delegationSetId !== set.delegationSetId
    || !set.delegationIds.includes(child.delegationId)
    || child.coordinationMode !== set.coordinationMode
    || child.parentSupervisorTaskId !== set.parentSupervisorTaskId
    || child.parentTaskId !== set.taskId
    || child.projectId !== set.projectId
    || child.workspaceId !== set.workspaceId
    || child.workspaceRegistryRevision !== set.workspaceRegistryRevision
    || child.safetyPlanId !== set.safetyPlanId
    || child.safetyProfileId !== set.safetyProfileId
    || child.safetyProfileRevision !== set.safetyProfileRevision
    || child.workerProfileId !== set.workerProfileId
    || receipt.childTaskId !== child.childTaskId
    || receipt.delegationSetId !== child.delegationSetId
    || receipt.delegationId !== child.delegationId
    || receipt.parentTaskId !== child.parentTaskId
    || receipt.workspaceId !== child.workspaceId
    || receipt.coordinationMode !== child.coordinationMode
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "child/set/consumed-admission binding mismatch",
      "binding_mismatch",
    );
  }
}

function assertCurrentParent(
  child: MultiAgentChildTaskDescriptorV1,
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
    || current.safetyProfileId !== child.safetyProfileId
    || current.safetyProfileRevision !== child.safetyProfileRevision
    || current.workerProfileId !== child.workerProfileId
    || !current.safetyPolicyVersion.trim()
    || !child.allowedPathPatterns.every((pattern) => current.allowedPathPatterns.includes(pattern))
    || !sameStrings(current.protectedPathPatterns, child.protectedPathPatterns)
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "current parent task/Safety binding no longer matches child preparation",
      "parent_not_current",
    );
  }
  if (
    ["completed", "validation_failed", "failed", "aborted", "rolled_back"].includes(current.status)
    || current.hasPendingEscalation
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "current parent state does not permit child execution preparation",
      "parent_not_executable",
    );
  }
}

function assertPreparation(value: MultiAgentChildExecutionPreparationV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "child_execution_preparation_only"
    || value.state !== "prepared"
    || value.executable !== false
    || !UUID.test(value.preparationId)
    || !UUID.test(value.admissionPermitId)
    || !UUID.test(value.childTaskId)
    || !UUID.test(value.delegationSetId)
    || !UUID.test(value.delegationId)
    || !UUID.test(value.parentTaskId)
    || !UUID.test(value.workspaceId)
    || !Number.isFinite(Date.parse(value.preparedAt))
    || !Number.isFinite(Date.parse(value.admissionConsumedAt))
    || !value.safetyPolicyVersion.trim()
    || value.requiresFreshParentBindingAtExecution !== true
    || value.requiresFreshWriterLease !== true
    || value.requiresFreshDistributedFenceWhenDistributed !== true
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentChildExecutionPreparationError(
      "durable child execution preparation is invalid",
      "preparation_invalid",
    );
  }
}

export class FileMultiAgentChildExecutionPreparationStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "multi-agent-child-execution-preparations");
  }

  private file(childTaskId: string): string {
    if (!UUID.test(childTaskId)) {
      throw new MultiAgentChildExecutionPreparationError(
        "childTaskId must be an opaque UUID",
        "store_invalid",
      );
    }
    return path.join(this.dir(), `${childTaskId}.json`);
  }

  async create(value: MultiAgentChildExecutionPreparationV1): Promise<void> {
    assertPreparation(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.childTaskId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new MultiAgentChildExecutionPreparationError(
          "child execution preparation already exists",
          "preparation_replayed",
        );
      }
      throw error;
    }
  }

  async load(childTaskId: string): Promise<MultiAgentChildExecutionPreparationV1> {
    let parsed: MultiAgentChildExecutionPreparationV1;
    try {
      parsed = JSON.parse(
        await readFile(this.file(childTaskId), "utf8"),
      ) as MultiAgentChildExecutionPreparationV1;
    } catch (error) {
      throw new MultiAgentChildExecutionPreparationError(
        `child execution preparation cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
    assertPreparation(parsed);
    if (parsed.childTaskId !== childTaskId) {
      throw new MultiAgentChildExecutionPreparationError(
        "child execution preparation file identity mismatch",
        "store_invalid",
      );
    }
    return structuredClone(parsed);
  }
}

export class MultiAgentChildExecutionPreparationService {
  constructor(
    private readonly parentBinding: MultiAgentParentExecutionBindingProvider,
    private readonly store: FileMultiAgentChildExecutionPreparationStore,
    private readonly options: MultiAgentChildExecutionPreparationOptions = {},
  ) {}

  async prepare(
    childInput: MultiAgentChildTaskDescriptorV1,
    setInput: MultiAgentDelegationSetV1,
    receiptInput: MultiAgentChildExecutionAdmissionReceiptV1,
  ): Promise<MultiAgentChildExecutionPreparationV1> {
    assertChild(childInput);
    assertSet(setInput);
    assertReceipt(receiptInput);
    const child = structuredClone(childInput);
    const set = structuredClone(setInput);
    const receipt = structuredClone(receiptInput);
    assertChildSetReceiptBinding(child, set, receipt);

    let current: MultiAgentParentExecutionBindingV1;
    try {
      current = await this.parentBinding.revalidateCurrent(child.parentTaskId);
    } catch (error) {
      throw new MultiAgentChildExecutionPreparationError(
        "current parent execution binding could not be revalidated",
        "parent_not_current",
        { cause: error },
      );
    }
    assertCurrentParent(child, current);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new MultiAgentChildExecutionPreparationError(
        "child execution preparation clock is invalid",
        "preparation_invalid",
      );
    }
    const preparationId = (this.options.idFactory ?? (() => crypto.randomUUID()))();
    if (!UUID.test(preparationId)) {
      throw new MultiAgentChildExecutionPreparationError(
        "preparationId must be an opaque UUID",
        "preparation_invalid",
      );
    }

    const preparation: MultiAgentChildExecutionPreparationV1 = {
      schemaVersion: 1,
      preparationId,
      preparedAt: now.toISOString(),
      admissionPermitId: receipt.permitId,
      admissionConsumedAt: receipt.consumedAt,
      childTaskId: child.childTaskId,
      delegationSetId: child.delegationSetId,
      delegationId: child.delegationId,
      coordinationMode: child.coordinationMode,
      parentSupervisorTaskId: child.parentSupervisorTaskId,
      parentTaskId: child.parentTaskId,
      projectId: child.projectId,
      workspaceId: child.workspaceId,
      workspaceRegistryRevision: child.workspaceRegistryRevision,
      safetyPlanId: child.safetyPlanId,
      safetyPolicyVersion: current.safetyPolicyVersion,
      safetyProfileId: child.safetyProfileId,
      safetyProfileRevision: child.safetyProfileRevision,
      workerProfileId: child.workerProfileId,
      objective: child.objective,
      acceptanceCriteria: [...child.acceptanceCriteria],
      trustedValidationCommands: [...current.trustedValidationCommands],
      allowedPathPatterns: [...child.allowedPathPatterns],
      protectedPathPatterns: [...child.protectedPathPatterns],
      state: "prepared",
      executable: false,
      requiresFreshParentBindingAtExecution: true,
      requiresFreshWriterLease: true,
      requiresFreshDistributedFenceWhenDistributed: true,
      authority: "child_execution_preparation_only",
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
