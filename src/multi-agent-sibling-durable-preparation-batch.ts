import type {
  MultiAgentChildExecutionAdmissionReceiptV1,
  MultiAgentChildExecutionAdmissionService,
} from "./multi-agent-child-execution-admission.js";
import type {
  MultiAgentChildExecutionPreparationService,
  MultiAgentChildExecutionPreparationV1,
} from "./multi-agent-child-execution-preparation.js";
import type { MultiAgentChildTaskDescriptorV1 } from "./multi-agent-child-task.js";
import type { MultiAgentDelegationSetV1 } from "./multi-agent-delegation-set.js";
import type { MultiAgentSiblingExecutionAdmissionBatchV1 } from "./multi-agent-sibling-execution-admission-batch.js";

export const MULTI_AGENT_SIBLING_DURABLE_PREPARATION_BATCH_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "sibling_durable_preparation_batch_only" as const,
  reusesM13DConsumption: true as const,
  reusesM13EDurablePreparation: true as const,
  preparesOnlyTicketedChildren: true as const,
  blockedSiblingPreparationAllowed: false as const,
  terminalSiblingPreparationAllowed: false as const,
  acquiresWriterLease: false as const,
  acquiresDistributedFence: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
  distributedExecutionAllowed: false as const,
  recursiveDelegationAllowed: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsSafetyPlanAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface MultiAgentSiblingDurablePreparationBatchV1 {
  schemaVersion: 1;
  delegationSetId: string;
  coordinationMode: MultiAgentDelegationSetV1["coordinationMode"];
  receipts: MultiAgentChildExecutionAdmissionReceiptV1[];
  preparations: MultiAgentChildExecutionPreparationV1[];
  blockedChildTaskIds: string[];
  terminalChildTaskIds: string[];
  authority: "sibling_durable_preparation_batch_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export class MultiAgentSiblingDurablePreparationBatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "set_invalid"
      | "admission_batch_invalid"
      | "child_invalid"
      | "binding_mismatch"
      | "non_ticketed_child",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MultiAgentSiblingDurablePreparationBatchError";
  }
}

function assertSet(set: MultiAgentDelegationSetV1): void {
  if (
    set.schemaVersion !== 1
    || set.authority !== "delegation_set_evidence_only"
    || !["parallel_disjoint", "serialized"].includes(set.coordinationMode)
    || set.grantsTaskAuthority !== false
    || set.grantsFilesystemAuthority !== false
    || set.grantsSafetyPlanAuthority !== false
    || set.grantsCredentialAuthority !== false
    || set.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingDurablePreparationBatchError(
      "delegation set evidence is invalid or widened",
      "set_invalid",
    );
  }
}

function assertAdmissionBatch(
  set: MultiAgentDelegationSetV1,
  batch: MultiAgentSiblingExecutionAdmissionBatchV1,
): void {
  if (
    batch.schemaVersion !== 1
    || batch.authority !== "sibling_execution_admission_batch_only"
    || batch.delegationSetId !== set.delegationSetId
    || batch.coordinationMode !== set.coordinationMode
    || batch.grantsTaskAuthority !== false
    || batch.grantsFilesystemAuthority !== false
    || batch.grantsSafetyPlanAuthority !== false
    || batch.grantsCredentialAuthority !== false
    || batch.grantsReleaseAuthority !== false
  ) {
    throw new MultiAgentSiblingDurablePreparationBatchError(
      "M13S admission batch is invalid or cross-bound",
      "admission_batch_invalid",
    );
  }

  const ticketIds = batch.tickets.map((ticket) => ticket.permit.childTaskId);
  const all = [
    ...ticketIds,
    ...batch.blockedChildTaskIds,
    ...batch.terminalChildTaskIds,
  ];
  if (new Set(all).size !== all.length) {
    throw new MultiAgentSiblingDurablePreparationBatchError(
      "M13S admission batch contains duplicate child identities",
      "admission_batch_invalid",
    );
  }
  if (set.coordinationMode === "serialized" && batch.tickets.length > 1) {
    throw new MultiAgentSiblingDurablePreparationBatchError(
      "serialized sibling batch cannot prepare more than one child",
      "admission_batch_invalid",
    );
  }
}

function assertChildMatchesTicket(
  child: MultiAgentChildTaskDescriptorV1,
  set: MultiAgentDelegationSetV1,
  ticketChildTaskId: string,
): void {
  if (
    child.schemaVersion !== 1
    || child.authority !== "child_task_materialization_only"
    || child.executable !== false
    || child.childTaskId !== ticketChildTaskId
    || child.delegationSetId !== set.delegationSetId
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
  ) {
    throw new MultiAgentSiblingDurablePreparationBatchError(
      "ticketed sibling no longer matches its exact M13C descriptor/set binding",
      "child_invalid",
    );
  }
}

export class MultiAgentSiblingDurablePreparationBatchService {
  constructor(
    private readonly childAdmission: MultiAgentChildExecutionAdmissionService,
    private readonly childPreparation: MultiAgentChildExecutionPreparationService,
  ) {}

  async prepare(
    setInput: MultiAgentDelegationSetV1,
    batchInput: MultiAgentSiblingExecutionAdmissionBatchV1,
    childrenInput: MultiAgentChildTaskDescriptorV1[],
  ): Promise<MultiAgentSiblingDurablePreparationBatchV1> {
    assertSet(setInput);
    const set = structuredClone(setInput);
    const batch = structuredClone(batchInput);
    const children = childrenInput.map((child) => structuredClone(child));
    assertAdmissionBatch(set, batch);

    const byTask = new Map(children.map((child) => [child.childTaskId, child]));
    if (byTask.size !== children.length) {
      throw new MultiAgentSiblingDurablePreparationBatchError(
        "materialized child descriptors contain duplicate task identities",
        "binding_mismatch",
      );
    }

    for (const id of [...batch.blockedChildTaskIds, ...batch.terminalChildTaskIds]) {
      if (!byTask.has(id)) {
        throw new MultiAgentSiblingDurablePreparationBatchError(
          "blocked/terminal sibling is not part of the exact materialized child set",
          "binding_mismatch",
        );
      }
    }

    const receipts: MultiAgentChildExecutionAdmissionReceiptV1[] = [];
    const preparations: MultiAgentChildExecutionPreparationV1[] = [];

    for (const ticket of batch.tickets) {
      const child = byTask.get(ticket.permit.childTaskId);
      if (!child) {
        throw new MultiAgentSiblingDurablePreparationBatchError(
          "ticketed sibling is missing its materialized descriptor",
          "binding_mismatch",
        );
      }
      assertChildMatchesTicket(child, set, ticket.permit.childTaskId);

      const receipt = this.childAdmission.consumeForPreparation(
        ticket.token,
        child,
        set,
      );
      receipts.push(receipt);

      const preparation = await this.childPreparation.prepare(
        child,
        set,
        receipt,
      );
      preparations.push(preparation);
    }

    return Object.freeze({
      schemaVersion: 1,
      delegationSetId: set.delegationSetId,
      coordinationMode: set.coordinationMode,
      receipts,
      preparations,
      blockedChildTaskIds: [...batch.blockedChildTaskIds],
      terminalChildTaskIds: [...batch.terminalChildTaskIds],
      authority: "sibling_durable_preparation_batch_only",
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }

  async prepareChild(
    set: MultiAgentDelegationSetV1,
    batch: MultiAgentSiblingExecutionAdmissionBatchV1,
    children: MultiAgentChildTaskDescriptorV1[],
    childTaskId: string,
  ): Promise<MultiAgentChildExecutionPreparationV1> {
    const ticket = batch.tickets.find((item) => item.permit.childTaskId === childTaskId);
    if (!ticket) {
      throw new MultiAgentSiblingDurablePreparationBatchError(
        "blocked or terminal sibling cannot produce durable preparation",
        "non_ticketed_child",
      );
    }
    const child = children.find((item) => item.childTaskId === childTaskId);
    if (!child) {
      throw new MultiAgentSiblingDurablePreparationBatchError(
        "ticketed sibling is missing its materialized descriptor",
        "binding_mismatch",
      );
    }
    assertSet(set);
    assertAdmissionBatch(set, batch);
    assertChildMatchesTicket(child, set, childTaskId);
    const receipt = this.childAdmission.consumeForPreparation(ticket.token, child, set);
    return this.childPreparation.prepare(child, set, receipt);
  }
}
