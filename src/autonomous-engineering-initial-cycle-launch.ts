import type { AutonomousEngineeringLoopStateV1 } from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopTransitionAdmissionService,
  AutonomousEngineeringLoopTransitionAdmissionV1,
} from "./autonomous-engineering-loop-transition-admission.js";
import type {
  AutonomousEngineeringLoopTransitionApplyReceiptV1,
  AutonomousEngineeringLoopTransitionApplyService,
} from "./autonomous-engineering-loop-transition-apply.js";
import type {
  AutonomousEngineeringExecutionIntentService,
  AutonomousEngineeringExecutionIntentV1,
} from "./autonomous-engineering-execution-intent.js";
import type {
  AutonomousEngineeringExecutionAdmissionReceiptV1,
  AutonomousEngineeringExecutionAdmissionService,
} from "./autonomous-engineering-execution-admission.js";
import type {
  AutonomousEngineeringExecutionPreparationService,
  AutonomousEngineeringExecutionPreparationV1,
} from "./autonomous-engineering-execution-preparation.js";
import type {
  AutonomousEngineeringExecutionActivationContext,
  AutonomousEngineeringExecutionActivationCoordinator,
} from "./autonomous-engineering-execution-activation.js";
import type {
  AutonomousEngineeringInitialRuntimeStartBridge,
  AutonomousEngineeringInitialRuntimeStartResultV1,
} from "./autonomous-engineering-initial-runtime-start.js";
import type { SupervisorTaskV1 } from "./supervisor-task.js";
import type { WriterLeaseSession } from "./writer-concurrency-scheduler.js";

export const AUTONOMOUS_ENGINEERING_INITIAL_CYCLE_LAUNCH_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_engineering_initial_cycle_launch_composition" as const,
  readyLoopOnly: true as const,
  initialImplementationOnly: true as const,
  composesTransitionAdmission: true as const,
  composesDurableTransitionApply: true as const,
  composesExecutionIntent: true as const,
  composesOneShotExecutionAdmission: true as const,
  composesDurablePreparation: true as const,
  composesLeaseBoundActivation: true as const,
  composesInitialRuntimeStart: true as const,
  acquiresWriterLease: false as const,
  directLoopMutation: false as const,
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

export interface AutonomousEngineeringInitialCycleLaunchResultV1 {
  schemaVersion: 1;
  loopId: string;
  startingRevision: number;
  executionRevision: number;
  implementationStartAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
  implementationStartApplyReceipt: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  intent: AutonomousEngineeringExecutionIntentV1;
  executionAdmissionReceipt: AutonomousEngineeringExecutionAdmissionReceiptV1;
  preparation: AutonomousEngineeringExecutionPreparationV1;
  activation: AutonomousEngineeringExecutionActivationContext["evidence"];
  runtimeResult: AutonomousEngineeringInitialRuntimeStartResultV1;
  authority: "autonomous_engineering_initial_cycle_launch_composition";
  acquiresWriterLease: false;
  directLoopMutation: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

export interface AutonomousEngineeringInitialCycleLaunchOptions {
  now?: () => Date;
}

export class AutonomousEngineeringInitialCycleLaunchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "input_invalid"
      | "implementation_start_failed"
      | "intent_failed"
      | "execution_admission_failed"
      | "preparation_failed"
      | "activation_failed"
      | "runtime_failed"
      | "result_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringInitialCycleLaunchError";
  }
}

type TransitionAdmissionPort = Pick<AutonomousEngineeringLoopTransitionAdmissionService, "admit">;
type TransitionApplyPort = Pick<AutonomousEngineeringLoopTransitionApplyService, "apply">;
type IntentPort = Pick<AutonomousEngineeringExecutionIntentService, "create">;
type ExecutionAdmissionPort = Pick<AutonomousEngineeringExecutionAdmissionService, "issue" | "consume">;
type PreparationPort = Pick<AutonomousEngineeringExecutionPreparationService, "prepare">;
type ActivationPort = Pick<AutonomousEngineeringExecutionActivationCoordinator, "activate">;
type InitialRuntimePort = Pick<AutonomousEngineeringInitialRuntimeStartBridge, "start">;

function assertInput(
  loop: AutonomousEngineeringLoopStateV1,
  supervisor: SupervisorTaskV1,
): void {
  if (
    loop.schemaVersion !== 1
    || loop.authority !== "autonomous_engineering_loop_state_only"
    || loop.phase !== "ready"
    || loop.authorityBinding.supervisorTaskId !== supervisor.supervisorTaskId
    || loop.authorityBinding.taskId !== supervisor.taskId
    || loop.authorityBinding.projectId !== supervisor.authority.projectId
    || loop.authorityBinding.workspaceId !== supervisor.authority.workspaceId
    || loop.authorityBinding.workspaceRegistryRevision !== supervisor.authority.workspaceRegistryRevision
    || loop.authorityBinding.safetyPlanId !== supervisor.authority.safetyPlanId
    || loop.authorityBinding.safetyPolicyVersion !== supervisor.authority.safetyPolicyVersion
    || loop.authorityBinding.safetyProfileId !== supervisor.authority.safetyProfileId
    || loop.authorityBinding.safetyProfileRevision !== supervisor.authority.safetyProfileRevision
    || loop.authorityBinding.workerProfileId !== supervisor.authority.workerProfileId
    || loop.counters.implementationIterationsStarted !== 0
    || loop.counters.repairAttemptsStarted !== 0
  ) {
    throw new AutonomousEngineeringInitialCycleLaunchError(
      "M14N requires the exact untouched ready loop bound to the approved supervisor task",
      "input_invalid",
    );
  }
}

export class AutonomousEngineeringInitialCycleLaunchService {
  constructor(
    private readonly transitionAdmission: TransitionAdmissionPort,
    private readonly transitionApply: TransitionApplyPort,
    private readonly intentService: IntentPort,
    private readonly executionAdmission: ExecutionAdmissionPort,
    private readonly preparationService: PreparationPort,
    private readonly activationCoordinator: ActivationPort,
    private readonly initialRuntime: InitialRuntimePort,
    private readonly options: AutonomousEngineeringInitialCycleLaunchOptions = {},
  ) {}

  async launch(
    loopInput: AutonomousEngineeringLoopStateV1,
    supervisor: SupervisorTaskV1,
    lease: WriterLeaseSession,
  ): Promise<AutonomousEngineeringInitialCycleLaunchResultV1> {
    const loop = structuredClone(loopInput);
    assertInput(loop, supervisor);

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "M14N initial launch clock is invalid",
        "input_invalid",
      );
    }

    let implementationStartAdmission: AutonomousEngineeringLoopTransitionAdmissionV1;
    try {
      implementationStartAdmission = await this.transitionAdmission.admit(
        loop,
        supervisor,
        { type: "implementation_started", at: now.toISOString() },
      );
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial implementation could not be admitted",
        "implementation_start_failed",
        { cause: error },
      );
    }

    let applied;
    try {
      applied = await this.transitionApply.apply(implementationStartAdmission);
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial implementation start could not be durably applied",
        "implementation_start_failed",
        { cause: error },
      );
    }
    if (
      applied.state.phase !== "implementation_in_progress"
      || applied.state.revision !== loop.revision + 1
      || applied.state.counters.implementationIterationsStarted !== 1
      || applied.state.counters.repairAttemptsStarted !== 0
    ) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial implementation transition produced an unexpected loop state",
        "result_invalid",
      );
    }

    let intent: AutonomousEngineeringExecutionIntentV1;
    try {
      intent = await this.intentService.create(
        applied.state,
        supervisor,
        implementationStartAdmission,
        applied.receipt,
      );
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial execution intent could not be derived",
        "intent_failed",
        { cause: error },
      );
    }
    if (
      intent.kind !== "initial_implementation"
      || intent.repairInstruction !== undefined
      || intent.reviewerDecisionId !== undefined
      || intent.loopRevision !== applied.state.revision
    ) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial execution intent contains repair provenance or stale loop binding",
        "result_invalid",
      );
    }

    let ticket;
    let executionAdmissionReceipt: AutonomousEngineeringExecutionAdmissionReceiptV1;
    try {
      ticket = await this.executionAdmission.issue(intent);
      executionAdmissionReceipt = await this.executionAdmission.consume(ticket.token, intent);
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial one-shot execution admission failed",
        "execution_admission_failed",
        { cause: error },
      );
    }

    let preparation: AutonomousEngineeringExecutionPreparationV1;
    try {
      preparation = await this.preparationService.prepare(intent, executionAdmissionReceipt);
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial durable execution preparation failed",
        "preparation_failed",
        { cause: error },
      );
    }
    if (
      preparation.kind !== "initial_implementation"
      || preparation.repairInstruction !== undefined
      || preparation.reviewerDecisionId !== undefined
      || preparation.loopRevision !== applied.state.revision
    ) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial durable preparation contains repair provenance or stale loop binding",
        "result_invalid",
      );
    }

    let activation: AutonomousEngineeringExecutionActivationContext;
    try {
      activation = await this.activationCoordinator.activate(preparation, lease);
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial execution activation failed",
        "activation_failed",
        { cause: error },
      );
    }
    if (
      activation.runtimeInput.kind !== "initial_implementation"
      || activation.runtimeInput.repairInstruction !== undefined
      || activation.runtimeInput.reviewerDecisionId !== undefined
      || activation.runtimeInput.loopRevision !== applied.state.revision
      || activation.lease !== lease
    ) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial activation lost exact loop/lease binding or gained repair provenance",
        "result_invalid",
      );
    }

    let runtimeResult: AutonomousEngineeringInitialRuntimeStartResultV1;
    try {
      runtimeResult = await this.initialRuntime.start(activation);
    } catch (error) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial local runtime start failed closed",
        "runtime_failed",
        { cause: error },
      );
    }
    if (
      runtimeResult.started !== true
      || runtimeResult.loopRevision !== applied.state.revision
      || runtimeResult.taskId !== supervisor.taskId
    ) {
      throw new AutonomousEngineeringInitialCycleLaunchError(
        "initial runtime result does not match the admitted implementation iteration",
        "result_invalid",
      );
    }

    return Object.freeze({
      schemaVersion: 1,
      loopId: loop.loopId,
      startingRevision: loop.revision,
      executionRevision: applied.state.revision,
      implementationStartAdmission,
      implementationStartApplyReceipt: applied.receipt,
      intent,
      executionAdmissionReceipt,
      preparation,
      activation: activation.evidence,
      runtimeResult,
      authority: "autonomous_engineering_initial_cycle_launch_composition",
      acquiresWriterLease: false,
      directLoopMutation: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    });
  }
}
