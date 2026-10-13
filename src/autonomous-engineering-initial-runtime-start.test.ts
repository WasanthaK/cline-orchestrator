import assert from "node:assert/strict";
import test from "node:test";
import type { AutonomousEngineeringExecutionActivationContext } from "./autonomous-engineering-execution-activation.js";
import {
  AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT,
  AutonomousEngineeringInitialRuntimeStartBridge,
  AutonomousEngineeringInitialRuntimeStartError,
} from "./autonomous-engineering-initial-runtime-start.js";
import type {
  ApprovedWriterBindingV1,
  WriterAuthorityRunner,
  WriterLeaseSession,
} from "./writer-concurrency-scheduler.js";

function context(kind: "initial_implementation" | "bounded_repair" = "initial_implementation"): AutonomousEngineeringExecutionActivationContext {
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
        workspaceId: "44444444-4444-4444-8444-444444444444",
        stateRevision: changed ? 3 : 2,
        leaseId: changed
          ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
          : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fenceToken: changed
          ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
          : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        taskId: "22222222-2222-4222-8222-222222222222",
        ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expiresAt: "2026-10-07T13:20:00.000Z",
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
      loopRevision: 2,
      taskId: lease.taskId,
      workspaceId: lease.workspaceId,
      leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fenceToken: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      ownerInstanceId: lease.ownerInstanceId,
      activatedAt: "2026-10-07T13:00:00.000Z",
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
      loopRevision: 2,
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

class FakeRunner implements WriterAuthorityRunner {
  revalidateCount = 0;
  runCount = 0;
  bindingOverride?: Partial<ApprovedWriterBindingV1>;
  failRun = false;

  async revalidateApprovedTask(taskId: string): Promise<ApprovedWriterBindingV1> {
    this.revalidateCount += 1;
    return {
      taskId,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      ownerInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ...this.bindingOverride,
    };
  }

  async runApprovedTask(_taskId: string, _lease: WriterLeaseSession): Promise<void> {
    this.runCount += 1;
    if (this.failRun) throw new Error("runtime failed");
  }
}

test("M14H contract reuses scheduled lease-aware runner and grants no new authority", () => {
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT.initialImplementationOnly, true);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT.reusesScheduledLeaseAwareRunner, true);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT.acquiresWriterLease, false);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT.grantsFilesystemAuthority, false);
  assert.equal(AUTONOMOUS_ENGINEERING_INITIAL_RUNTIME_START_CONTRACT.grantsReleaseAuthority, false);
});

test("M14H hands exact initial activation to existing scheduled runner", async () => {
  const runner = new FakeRunner();
  const result = await new AutonomousEngineeringInitialRuntimeStartBridge(runner).start(context());

  assert.equal(runner.revalidateCount, 1);
  assert.equal(runner.runCount, 1);
  assert.equal(result.started, true);
  assert.equal(result.taskId, "22222222-2222-4222-8222-222222222222");
  assert.equal(result.grantsFilesystemAuthority, false);
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M14H rejects bounded repair rather than weakening fresh-task runtime invariant", async () => {
  const runner = new FakeRunner();
  await assert.rejects(
    () => new AutonomousEngineeringInitialRuntimeStartBridge(runner).start(context("bounded_repair")),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialRuntimeStartError
      && error.code === "repair_not_supported",
  );
  assert.equal(runner.runCount, 0);
});

test("M14H fails closed on runner binding drift before handoff", async () => {
  const runner = new FakeRunner();
  runner.bindingOverride = {
    workspaceId: "56565656-5656-4565-8565-565656565656",
  };
  await assert.rejects(
    () => new AutonomousEngineeringInitialRuntimeStartBridge(runner).start(context()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialRuntimeStartError
      && error.code === "runner_binding_stale",
  );
  assert.equal(runner.runCount, 0);
});

test("M14H rechecks live lease identity immediately before scheduled runtime handoff", async () => {
  const ctx = context();
  const lease = ctx.lease as WriterLeaseSession & { setChanged(): void };
  const originalValidate = lease.validateCurrent.bind(lease);
  lease.validateCurrent = async () => {
    await originalValidate();
    lease.setChanged();
  };

  await assert.rejects(
    () => new AutonomousEngineeringInitialRuntimeStartBridge(new FakeRunner()).start(ctx),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialRuntimeStartError
      && error.code === "context_invalid",
  );
});

test("M14H wraps scheduled runtime failure without minting retry authority", async () => {
  const runner = new FakeRunner();
  runner.failRun = true;
  await assert.rejects(
    () => new AutonomousEngineeringInitialRuntimeStartBridge(runner).start(context()),
    (error: unknown) =>
      error instanceof AutonomousEngineeringInitialRuntimeStartError
      && error.code === "runtime_failed",
  );
  assert.equal(runner.runCount, 1);
});
