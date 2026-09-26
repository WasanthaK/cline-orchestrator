import {
  planWriterConcurrency,
  type ActiveWriterEvidenceV1,
  type WriterConcurrencyBudgetV1,
  type WriterConcurrencyPlanV1,
  type WriterStartCandidateV1,
} from "./concurrency-budget.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import type { WorkspaceWriterClaimV1 } from "./workspace-lock.js";

export interface ApprovedWriterBindingV1 {
  taskId: string;
  workspaceId: string;
  ownerInstanceId: string;
}

/**
 * Trusted adapter boundary. Implementations must derive this binding from current
 * durable approved task/Safety Plan/registry evidence; candidate IDs and scheduler
 * admission never grant authority.
 */
export interface WriterAuthorityRunner {
  revalidateApprovedTask(taskId: string): Promise<ApprovedWriterBindingV1>;
  runApprovedTask(taskId: string, lease: WriterLeaseSession): Promise<void>;
}

export interface WriterLeaseSession {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly ownerInstanceId: string;
  readonly signal: AbortSignal;
  currentClaim(): WorkspaceWriterClaimV1;
  validateCurrent(): Promise<void>;
}

export interface WriterScheduleResultV1 {
  schemaVersion: 1;
  plan: WriterConcurrencyPlanV1;
  reservedTaskIds: string[];
  completedTaskIds: string[];
  failures: Array<{ taskId: string; code: "authority_revalidation_failed" | "lease_failed" | "worker_failed" }>;
  authority: "coordination_only";
}

export interface WriterConcurrencySchedulerOptions {
  leaseMs: number;
  heartbeatMs?: number;
  now?: () => Date;
}

type Reservation = {
  binding: ApprovedWriterBindingV1;
  session: ManagedWriterLeaseSession;
};

function activeEvidence(states: Awaited<ReturnType<WorkspaceLockStore["listActive"]>>): ActiveWriterEvidenceV1[] {
  return states.map((state) => {
    const writer = state.activeWriter!;
    return {
      workspaceId: state.workspaceId,
      taskId: writer.taskId,
      ownerInstanceId: writer.ownerInstanceId,
      leaseId: writer.leaseId,
      fenceToken: writer.fenceToken,
      expiresAt: writer.expiresAt,
    };
  });
}

function sameBinding(left: ApprovedWriterBindingV1, right: ApprovedWriterBindingV1): boolean {
  return left.taskId === right.taskId
    && left.workspaceId === right.workspaceId
    && left.ownerInstanceId === right.ownerInstanceId;
}

class ManagedWriterLeaseSession implements WriterLeaseSession {
  private claimValue: WorkspaceWriterClaimV1;
  private readonly abortController = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private heartbeatFailure: unknown;
  private operationTail: Promise<void> = Promise.resolve();
  private renewalQueued = false;
  private closed = false;

  constructor(
    private readonly store: WorkspaceLockStore,
    claim: WorkspaceWriterClaimV1,
    private readonly leaseMs: number,
    private readonly heartbeatMs: number,
  ) {
    this.claimValue = structuredClone(claim);
  }

  get taskId(): string { return this.claimValue.taskId; }
  get workspaceId(): string { return this.claimValue.workspaceId; }
  get ownerInstanceId(): string { return this.claimValue.ownerInstanceId; }
  get signal(): AbortSignal { return this.abortController.signal; }

  currentClaim(): WorkspaceWriterClaimV1 {
    return structuredClone(this.claimValue);
  }

  private serializeLeaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation, operation);
    this.operationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async validateCurrent(): Promise<void> {
    await this.serializeLeaseOperation(async () => {
      if (this.heartbeatFailure) throw this.heartbeatFailure;
      if (this.closed) throw new Error("Writer lease session is closed");
      await this.store.validate(this.claimValue);
    });
  }

  startHeartbeat(): void {
    this.timer = setInterval(() => {
      if (this.renewalQueued || this.closed) return;
      this.renewalQueued = true;
      void this.serializeLeaseOperation(async () => {
        if (this.closed || this.heartbeatFailure) return;
        try {
          const renewed = await this.store.renew(this.claimValue, this.leaseMs);
          this.claimValue = renewed.claim;
        } catch (error) {
          this.heartbeatFailure = error;
          this.abortController.abort(error);
          if (this.timer) clearInterval(this.timer);
          this.timer = undefined;
        }
      }).finally(() => { this.renewalQueued = false; });
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.closed = true;
    await this.serializeLeaseOperation(async () => {
      await this.store.release(this.claimValue);
    });
  }
}

/**
 * Single-gateway writer scheduler. Admission is serialized so concurrent scheduling
 * calls cannot race the global writer count. It may reserve writers only across
 * distinct workspaces; the existing workflow coordinator remains responsible for
 * contributing at most one budget-approved task per workflow accounting pass.
 *
 * Safety sequence for every admitted task:
 * 1) independently revalidate current durable task authority;
 * 2) account from current durable live locks;
 * 3) acquire the exclusive fenced workspace lease;
 * 4) revalidate task authority again after acquisition (TOCTOU guard);
 * 5) validate the fenced claim, then run through the trusted authority adapter;
 * 6) keep the lease renewed for the entire worker lifecycle and release afterward.
 *
 * The runner must honor `lease.signal` and call `lease.validateCurrent()` immediately
 * before every write-capable side effect. The scheduler/lease remains coordination
 * only and does not replace Safety Plan or executor authorization.
 */
export class WriterConcurrencyScheduler {
  private admissionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly locks: WorkspaceLockStore,
    private readonly budget: WriterConcurrencyBudgetV1,
    private readonly runner: WriterAuthorityRunner,
    private readonly options: WriterConcurrencySchedulerOptions,
  ) {}

  private serializeAdmission<T>(job: () => Promise<T>): Promise<T> {
    const next = this.admissionTail.then(job, job);
    this.admissionTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async schedule(taskIds: string[]): Promise<WriterScheduleResultV1> {
    const failures: WriterScheduleResultV1["failures"] = [];
    const { plan, reservations } = await this.serializeAdmission(async () => {
      const bindings: ApprovedWriterBindingV1[] = [];
      for (const taskId of taskIds) {
        try {
          bindings.push(await this.runner.revalidateApprovedTask(taskId));
        } catch {
          failures.push({ taskId, code: "authority_revalidation_failed" });
        }
      }

      const now = (this.options.now ?? (() => new Date()))();
      const states = await this.locks.listActive(now);
      const candidates: WriterStartCandidateV1[] = bindings.map((binding) => ({
        workspaceId: binding.workspaceId,
        taskId: binding.taskId,
      }));
      const plan = planWriterConcurrency(this.budget, activeEvidence(states), candidates, now);
      const allowed = new Set(
        plan.decisions.filter((decision) => decision.allowed).map((decision) => decision.taskId),
      );
      const reservations: Reservation[] = [];

      for (const binding of bindings) {
        if (!allowed.has(binding.taskId)) continue;
        try {
          const current = await this.runner.revalidateApprovedTask(binding.taskId);
          if (!sameBinding(binding, current)) throw new Error("approved writer binding changed before acquisition");

          const acquired = await this.locks.acquire({
            workspaceId: binding.workspaceId,
            taskId: binding.taskId,
            ownerInstanceId: binding.ownerInstanceId,
            leaseMs: this.options.leaseMs,
          });

          try {
            const afterAcquire = await this.runner.revalidateApprovedTask(binding.taskId);
            if (!sameBinding(binding, afterAcquire)) {
              await this.locks.release(acquired.claim);
              throw new Error("approved writer binding changed after acquisition");
            }
            await this.locks.validate(acquired.claim);
            const heartbeatMs = this.options.heartbeatMs
              ?? Math.max(250, Math.floor(this.options.leaseMs / 3));
            reservations.push({
              binding,
              session: new ManagedWriterLeaseSession(
                this.locks,
                acquired.claim,
                this.options.leaseMs,
                heartbeatMs,
              ),
            });
          } catch (error) {
            try { await this.locks.release(acquired.claim); } catch { /* preserve original failure */ }
            throw error;
          }
        } catch {
          failures.push({ taskId: binding.taskId, code: "lease_failed" });
        }
      }
      return { plan, reservations };
    });

    const completedTaskIds: string[] = [];
    await Promise.all(reservations.map(async ({ binding, session }) => {
      session.startHeartbeat();
      try {
        await session.validateCurrent();
        await this.runner.runApprovedTask(binding.taskId, session);
        await session.validateCurrent();
        completedTaskIds.push(binding.taskId);
      } catch {
        failures.push({ taskId: binding.taskId, code: "worker_failed" });
      } finally {
        try { await session.close(); } catch {
          failures.push({ taskId: binding.taskId, code: "lease_failed" });
        }
      }
    }));

    return {
      schemaVersion: 1,
      plan,
      reservedTaskIds: reservations.map((item) => item.binding.taskId),
      completedTaskIds,
      failures,
      authority: "coordination_only",
    };
  }
}
