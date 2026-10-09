import assert from "node:assert/strict";
import test from "node:test";
import type { AutonomousEngineeringExecutionActivationContext } from "./autonomous-engineering-execution-activation.js";
import {
  AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT,
  AutonomousEngineeringRepairRuntimeContinuationBridge,
  AutonomousEngineeringRepairRuntimeContinuationError,
  type AutonomousEngineeringRepairRunner,
} from "./autonomous-engineering-repair-runtime-continuation.js";
import type {
  ApprovedWriterBindingV1,
  WriterLeaseSession,
} from "./writer-concurrency-scheduler.js";

function context(kind: "bounded_repair" | "initial_implementation" = "bounded_repair"): AutonomousEngineeringExecutionActivationContext {
  const aborter = new AbortController();
  let changed = false;
  const lease = {
    taskId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    signal: aborter.signal,
    currentClaim() {
      return {
        schemaVersion: 1,
        workspaceId: lease.workspaceId,
        stateRevision: changed ? 3 : 2,
        leaseId: changed
          ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
          : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fenceToken: changed
          ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
          : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        taskId: lease.taskId,
        ownerInstanceId: lease.ownerInstanceId,
        expiresAt: "2026-10-07T14:20:00.000Z",
        authority: "coordination_only",
      };
    },
    async validateCurrent() {},
    setChanged() { changed = true; },
  } as WriterLeaseSession & { setChanged(): void };

  return {
    evidence: {
      schemaVersion: 1,
      preparationId: "77777777-7777-4777-8777-777777777777",
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      loopId: "99999999-9999-4999-8999-999999999999",
      loopRevision: 5,
      taskId: lease.taskId,
      workspaceId: lease.workspaceId,
      leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fenceToken: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      ownerInstanceId: lease.ownerInstanceId,
      activatedAt: "2026-10-07T14:00:00.000Z",
      authority: "autonomous_engineering_execution_activation_evidence_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    runtimeInput: {
      schemaVersion: 1,
      preparationId: "77777777-7777-4777-8777-777777777777",
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      loopId: "99999999-9999-4999-8999-999999999999",
      loopRevision: 5,
      taskId: lease.taskId,
      projectId: "33333333-3333-4333-8333-333333333333",
      workspaceId: lease.workspaceId,
      workspaceRegistryRevision: 3,
      safetyPlanId: "55555555-5555-4555-8555-555555555555",
      safetyPolicyVersion: "policy-v1",
      safetyProfileId: "66666666-6666-4666-8666-666666666666",
      safetyProfileRevision: 4,
      workerProfileId: "default",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*", ".git/**"],
      kind,
      objective: "Implement bounded goal.",
      acceptanceCriteria: ["Tests pass."],
      trustedValidationCommands: ["npm test"],
      ...(kind === "bounded_repair"
        ? {
            repairInstruction: "Correct only the approved implementation.",
            reviewerDecisionId: "12121212-1212-4121-8121-121212121212",
          }
        : {}),
      authority: "autonomous_engineering_runtime_input_only",
      runtimeStartAuthorized: false,
      grantsTaskAuthority: false,
      grantsFilesystemAuthority: false,
      grantsSafetyPlanAuthority: false,
      grantsWriterLeaseAuthority: false,
      grantsCredentialAuthority: false,
      grantsReleaseAuthority: false,
    },
    lease,
  };
}

class FakeRepairRunner implements AutonomousEngineeringRepairRunner {
  revalidateCount = 0;
  runCount = 0;
  lastInstruction?: string;
  bindingOverride?: Partial<ApprovedWriterBindingV1>;
  failRun = false;

  async revalidateApprovedRepair(
    taskId: string,
    instruction: string,
  ): Promise<ApprovedWriterBindingV1> {
    this.revalidateCount += 1;
    this.lastInstruction = instruction;
    return {
      taskId,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ...this.bindingOverride,
    };
  }

  async runApprovedRepair(
    _taskId: string,
    instruction: string,
    _lease: WriterLeaseSession,
  ): Promise<void> {
    this.runCount += 1;
    this.lastInstruction = instruction;
    if (this.failRun) throw new Error("repair runtime failed");
  }
}

test("M14I contract is bounded repair only and adds no release authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT.boundedRepairOnly, true);
  assert.equal(AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT.reusesLeaseAwareScheduledRunner, true);
  assert.equal(AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_REPAIR_RUNTIME_CONTINUATION_CONTRACT.grantsReleaseAuthority, false);
});

test("M14I passes exact trusted repair instruction to scheduled repair runner", async () => {
  const runner = new FakeRepairRunner();
  const result = await new AutonomousEngineeringRepairRuntimeContinuationBridge(runner).continue(context());

  assert.equal(runner.revalidateCount, 1);
  assert.equal(runner.runCount, 1);
  assert.equal(runner.lastInstruction, "Correct only the approved implementation.");
  assert.equal(result.continued, true);
  assert.equal(result.reviewerDecisionId, "12121212-1212-4121-8121-121212121212");
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M14I rejects initial implementation instead of routing through repair continuation", async () => {
  const runner = new FakeRepairRunner();
  await assert.rejects(
    () => new AutonomousEngineeringRepairRuntimeContinuationBridge(runner).continue(context("initial_implementation")),
    (error: unknown) =>
      error instanceof AutonomousEngineeringRepairRuntimeContinuationError
      && error.code === "initial_not_supported",
  );
  assert.equal(runner.runCount, 0);
});

test("M14I fails closed on runner binding drift", async () => {
  const runner = new FakeRepairRunner();
  runner.bindingOverride = { ownerInstanceId: "34343434-3434-4343-8343-343434343434" };
  await assert.rejects(
    () => new AutonomousEngineeringRepairRuntimeContinuationBridge(runner).continue(context()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringRepairRuntimeContinuationError
      && error.code === "runner_binding_stale",
  );
  assert.equal(runner.runCount, 0);
});

test("M14I rechecks lease identity immediately before repair handoff", async () => {
  const ctx = context();
  const lease = ctx.lease as WriterLeaseSession & { setChanged(): void };
  lease.validateCurrent = async () => {
    lease.setChanged();
  };

  await assert.rejects(
    () => new AutonomousEngineeringRepairRuntimeContinuationBridge(new FakeRepairRunner()).continue(ctx),
    (error: unknown) =>
      error instanceof AutonomousEngineeringRepairRuntimeContinuationError
      && error.code === "context_invalid",
  );
});

test("M14I wraps repair runtime failure without minting retry authority", async () => {
  const runner = new FakeRepairRunner();
  runner.failRun = true;
  await assert.rejects(
    () => new AutonomousEngineeringRepairRuntimeContinuationBridge(runner).continue(context()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringRepairRuntimeContinuationError
      && error.code === "runtime_failed",
  );
  assert.equal(runner.runCount, 1);
});
