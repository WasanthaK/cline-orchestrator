import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AutonomousEngineeringLoopStateV1,
} from "./autonomous-engineering-loop.js";
import {
  transitionAutonomousEngineeringLoop,
  FileAutonomousEngineeringLoopStore,
} from "./autonomous-engineering-loop.js";
import type {
  AutonomousEngineeringLoopTransitionAdmissionV1,
} from "./autonomous-engineering-loop-transition-admission.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUTONOMOUS_ENGINEERING_LOOP_TRANSITION_APPLY_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "autonomous_loop_transition_apply_state_only" as const,
  consumesAdmissionEvidence: true as const,
  replaySafeAcrossRestart: true as const,
  exactLoopRevisionRequired: true as const,
  mutatesLoopState: true as const,
  mutatesTaskState: false as const,
  startsWorker: false as const,
  startsCline: false as const,
  invokesRuntime: false as const,
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

export interface AutonomousEngineeringLoopTransitionApplyReceiptV1 {
  schemaVersion: 1;
  admissionId: string;
  loopId: string;
  priorRevision: number;
  resultingRevision: number;
  appliedAt: string;
  authority: "autonomous_loop_transition_apply_state_only";
  mutatesTaskState: false;
  startsWorker: false;
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}

interface ConsumedAdmissionRecordV1 {
  schemaVersion: 1;
  admissionId: string;
  loopId: string;
  expectedLoopRevision: number;
  consumedAt: string;
  authority: "autonomous_loop_transition_admission_consumed";
}

export interface AutonomousEngineeringLoopTransitionApplyOptions {
  now?: () => Date;
}

export class AutonomousEngineeringLoopTransitionApplyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "admission_invalid"
      | "admission_expired"
      | "admission_replayed"
      | "loop_mismatch"
      | "revision_conflict"
      | "store_invalid",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutonomousEngineeringLoopTransitionApplyError";
  }
}

function assertAdmission(value: AutonomousEngineeringLoopTransitionAdmissionV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "autonomous_loop_transition_admission_only"
    || value.executable !== false
    || value.mutatesLoopState !== false
    || value.mutatesTaskState !== false
    || !UUID.test(value.admissionId)
    || !UUID.test(value.loopId)
    || !Number.isSafeInteger(value.expectedLoopRevision)
    || value.expectedLoopRevision < 1
    || !Number.isFinite(Date.parse(value.admittedAt))
    || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.admittedAt)
    || value.grantsTaskAuthority !== false
    || value.grantsFilesystemAuthority !== false
    || value.grantsSafetyPlanAuthority !== false
    || value.grantsWriterLeaseAuthority !== false
    || value.grantsCredentialAuthority !== false
    || value.grantsReleaseAuthority !== false
  ) {
    throw new AutonomousEngineeringLoopTransitionApplyError(
      "transition admission is invalid or widened",
      "admission_invalid",
    );
  }
}

function assertReceipt(value: ConsumedAdmissionRecordV1): void {
  if (
    value.schemaVersion !== 1
    || value.authority !== "autonomous_loop_transition_admission_consumed"
    || !UUID.test(value.admissionId)
    || !UUID.test(value.loopId)
    || !Number.isSafeInteger(value.expectedLoopRevision)
    || value.expectedLoopRevision < 1
    || !Number.isFinite(Date.parse(value.consumedAt))
  ) {
    throw new AutonomousEngineeringLoopTransitionApplyError(
      "consumed admission record is invalid",
      "store_invalid",
    );
  }
}

class FileAutonomousEngineeringLoopConsumedAdmissionStore {
  constructor(private readonly stateRoot: string) {}

  private dir(): string {
    return path.join(this.stateRoot, "autonomous-engineering-loop-transition-consumption");
  }

  private file(admissionId: string): string {
    if (!UUID.test(admissionId)) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "admissionId must be an opaque UUID",
        "store_invalid",
      );
    }
    return path.join(this.dir(), `${admissionId}.json`);
  }

  async consume(value: ConsumedAdmissionRecordV1): Promise<void> {
    assertReceipt(value);
    await mkdir(this.dir(), { recursive: true });
    try {
      await writeFile(this.file(value.admissionId), `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AutonomousEngineeringLoopTransitionApplyError(
          "transition admission was already consumed",
          "admission_replayed",
        );
      }
      throw new AutonomousEngineeringLoopTransitionApplyError(
        `transition admission consumption could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
  }

  async load(admissionId: string): Promise<ConsumedAdmissionRecordV1 | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.file(admissionId), "utf8")) as ConsumedAdmissionRecordV1;
      assertReceipt(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      if (error instanceof AutonomousEngineeringLoopTransitionApplyError) throw error;
      throw new AutonomousEngineeringLoopTransitionApplyError(
        `transition admission consumption cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "store_invalid",
        { cause: error },
      );
    }
  }
}

export class AutonomousEngineeringLoopTransitionApplyService {
  private readonly loops: FileAutonomousEngineeringLoopStore;
  private readonly consumed: FileAutonomousEngineeringLoopConsumedAdmissionStore;

  constructor(
    stateRoot: string,
    private readonly options: AutonomousEngineeringLoopTransitionApplyOptions = {},
  ) {
    this.loops = new FileAutonomousEngineeringLoopStore(stateRoot);
    this.consumed = new FileAutonomousEngineeringLoopConsumedAdmissionStore(stateRoot);
  }

  async apply(
    admissionInput: AutonomousEngineeringLoopTransitionAdmissionV1,
  ): Promise<{
    state: AutonomousEngineeringLoopStateV1;
    receipt: AutonomousEngineeringLoopTransitionApplyReceiptV1;
  }> {
    assertAdmission(admissionInput);
    const admission = structuredClone(admissionInput);

    if (await this.consumed.load(admission.admissionId)) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition admission was already consumed",
        "admission_replayed",
      );
    }

    const now = (this.options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition apply clock is invalid",
        "store_invalid",
      );
    }
    if (Date.parse(admission.expiresAt) <= now.getTime()) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition admission expired before application",
        "admission_expired",
      );
    }

    const current = await this.loops.load(admission.loopId);
    if (current.loopId !== admission.loopId) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition admission loop identity mismatch",
        "loop_mismatch",
      );
    }
    if (current.revision !== admission.expectedLoopRevision) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition admission expected loop revision is stale",
        "revision_conflict",
      );
    }

    const next = transitionAutonomousEngineeringLoop(current, admission.event);
    if (next.revision !== current.revision + 1) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        "transition did not advance exactly one loop revision",
        "revision_conflict",
      );
    }

    await this.consumed.consume({
      schemaVersion: 1,
      admissionId: admission.admissionId,
      loopId: admission.loopId,
      expectedLoopRevision: admission.expectedLoopRevision,
      consumedAt: now.toISOString(),
      authority: "autonomous_loop_transition_admission_consumed",
    });

    try {
      await this.loops.replaceExact(current.revision, next);
    } catch (error) {
      throw new AutonomousEngineeringLoopTransitionApplyError(
        `durable loop transition could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error && "code" in error && (error as { code?: string }).code === "revision_conflict"
          ? "revision_conflict"
          : "store_invalid",
        { cause: error },
      );
    }

    const receipt: AutonomousEngineeringLoopTransitionApplyReceiptV1 = {
      schemaVersion: 1,
      admissionId: admission.admissionId,
      loopId: admission.loopId,
      priorRevision: current.revision,
      resultingRevision: next.revision,
      appliedAt: now.toISOString(),
      authority: "autonomous_loop_transition_apply_state_only",
      mutatesTaskState: false,
      startsWorker: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    };

    return {
      state: Object.freeze(structuredClone(next)),
      receipt: Object.freeze(receipt),
    };
  }
}
