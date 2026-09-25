import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SdkClineRuntimeFactory,
  type ClineRuntime,
  type ClineRuntimeCreateRequest,
  type ClineRuntimeFactory,
} from "./cline-runtime.js";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  stopLiveProofHubGracefully,
} from "./live-proof-isolation.js";
import { LiveProofSendBarrier } from "./live-proof-send-barrier.js";
import { environmentWorkerProfileResolver } from "./mcp-main.js";
import { rollbackTask } from "./rollback.js";
import { SafetyPlanService } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
import { ScheduledHubWriterAuthorityRunner } from "./scheduled-hub-writer-runner.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import type { WorkspaceLockOptions, WorkspaceWriterClaimV1 } from "./workspace-lock.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";
import { WriterConcurrencyScheduler } from "./writer-concurrency-scheduler.js";

const ACTIVE_LEASE_TIMEOUT_MS = 120_000;
const PROTECTED_ENV = "PROOF_SECRET=isolated-test-value\n";
const PROTECTED_OUTSIDE = "protected baseline\n";
const BASE_DEMO = "export const value = 1;\n";

function fail(message: string): never {
  throw new Error(`Live multi-workspace proof refused: ${message}`);
}

function assertDisposableProfile(workspace: RegisteredWorkspace): void {
  assertDisposableWorkspaceRoot(workspace.canonicalRoot);
  const profile = workspace.safetyProfile;
  if (
    profile.allowedPathPatterns.length !== 1
    || profile.allowedPathPatterns[0] !== "src/demo.ts"
  ) {
    fail("proof workspace must authorize only src/demo.ts");
  }
  for (const required of [".env*", "outside.txt", ".git/**"]) {
    if (!profile.protectedPathPatterns.includes(required)) {
      fail(`proof workspace is missing protected pattern ${required}`);
    }
  }
  if (
    profile.validationCommands.length !== 1
    || profile.validationCommands[0] !== "git diff --check"
  ) {
    fail("proof workspace must use only git diff --check validation");
  }
  if (profile.maxChangedFiles !== 1) {
    fail("proof workspace must limit each task to one changed file");
  }
}

async function registerProofWorkspace(
  registry: WorkspaceRegistry,
  projectId: string,
  root: string,
  displayName: string,
): Promise<RegisteredWorkspace> {
  const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
  const workspace = await registry.registerWorkspace({
    projectId,
    displayName,
    root,
    safetyProfile: {
      policyVersion: "multi-workspace-proof-v1",
      allowedPathPatterns: ["src/demo.ts"],
      protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
      validationCommands: ["git diff --check"],
      workerProfileId,
      maxChangedFiles: 1,
    },
  });
  assertDisposableProfile(workspace);
  return workspace;
}

async function createApprovedProofTask(
  safetyPlans: SafetyPlanService,
  workspace: RegisteredWorkspace,
  replacementValue: number,
): Promise<OrchestratorTask> {
  const goal = [
    "Read src/demo.ts.",
    `Replace the exact line 'export const value = 1;' with 'export const value = ${replacementValue};'.`,
    "Do not modify any other file.",
    "Re-read src/demo.ts after the edit and report completion.",
  ].join(" ");
  const preview = await safetyPlans.preview({
    workspaceId: workspace.workspaceId,
    goal,
    requestedScope: ["src/demo.ts"],
  });
  const started = await startApprovedTask(safetyPlans, preview.planToken);
  return started.task;
}

async function waitForTwoDistinctLiveLeases(
  locks: WorkspaceLockStore,
  expectedWorkspaceIds: Set<string>,
  timeoutMs = ACTIVE_LEASE_TIMEOUT_MS,
): Promise<Array<{ workspaceId: string; taskId: string; fenceToken: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await locks.listActive();
    const relevant = active.filter((state) => expectedWorkspaceIds.has(state.workspaceId));
    if (relevant.length === 2 && relevant.every((state) => state.activeWriter)) {
      const workspaceIds = new Set(relevant.map((state) => state.workspaceId));
      const fences = new Set(relevant.map((state) => state.activeWriter!.fenceToken));
      if (workspaceIds.size === 2 && fences.size === 2) {
        return relevant.map((state) => ({
          workspaceId: state.workspaceId,
          taskId: state.activeWriter!.taskId,
          fenceToken: state.activeWriter!.fenceToken,
        }));
      }
    }
    await sleep(10);
  }
  fail(`did not observe two simultaneous distinct-workspace writer leases within ${timeoutMs}ms`);
}

async function assertCompletedTask(
  workspace: RegisteredWorkspace,
  taskId: string,
  replacementValue: number,
): Promise<OrchestratorTask> {
  const store = new TaskStore(workspace.canonicalRoot);
  const task = await store.load(taskId);
  if (task.status !== "completed") fail(`task ${taskId} ended in ${task.status}`);
  if (!task.lastRunCheckpoint?.available) fail(`task ${taskId} has no usable checkpoint`);
  if (task.lastValidation?.passed !== true) fail(`task ${taskId} did not pass validation`);
  if (task.lastDiffSafety?.passed !== true) fail(`task ${taskId} did not pass diff safety`);
  const demo = await readFile(path.join(workspace.canonicalRoot, "src", "demo.ts"), "utf8");
  if (demo !== `export const value = ${replacementValue};\n`) {
    fail(`task ${taskId} did not produce the exact expected demo.ts contents`);
  }
  await assertProtectedSentinels(workspace, taskId);
  return task;
}

async function assertProtectedSentinels(
  workspace: RegisteredWorkspace,
  taskId: string,
): Promise<void> {
  if (await readFile(path.join(workspace.canonicalRoot, ".env"), "utf8") !== PROTECTED_ENV) {
    fail(`task ${taskId} changed the protected .env sentinel`);
  }
  if (await readFile(path.join(workspace.canonicalRoot, "outside.txt"), "utf8") !== PROTECTED_OUTSIDE) {
    fail(`task ${taskId} changed the protected outside.txt sentinel`);
  }
}

async function rollbackAndAssertBaseline(
  workspace: RegisteredWorkspace,
  taskId: string,
): Promise<void> {
  const store = new TaskStore(workspace.canonicalRoot);
  const rolledBack = await rollbackTask(store, workspace.canonicalRoot, taskId);
  if (rolledBack.status !== "rolled_back") fail(`rollback for ${taskId} ended in ${rolledBack.status}`);
  if (await readFile(path.join(workspace.canonicalRoot, "src", "demo.ts"), "utf8") !== BASE_DEMO) {
    fail(`rollback for ${taskId} did not restore exact demo.ts baseline`);
  }
  await assertProtectedSentinels(workspace, taskId);
}

type CapturedEditor = (
  input: unknown,
  workspaceRoot: string,
  context: { agentId: string; conversationId: string; iteration: number },
) => Promise<unknown>;

type SendSignal = {
  promise: Promise<void>;
  resolve: () => void;
  started: boolean;
};

class ProofObservingRuntimeFactory implements ClineRuntimeFactory {
  private readonly sendSignals = new Map<string, SendSignal>();
  private readonly editors = new Map<string, CapturedEditor>();

  constructor(
    private readonly base: ClineRuntimeFactory,
    private readonly sendBarrier?: LiveProofSendBarrier,
  ) {}

  private signal(workspaceRoot: string): SendSignal {
    let existing = this.sendSignals.get(workspaceRoot);
    if (existing) return existing;
    let resolve!: () => void;
    const signal: SendSignal = {
      promise: new Promise<void>((done) => { resolve = done; }),
      resolve: () => resolve(),
      started: false,
    };
    this.sendSignals.set(workspaceRoot, signal);
    return signal;
  }

  markSendStarted(workspaceRoot: string): void {
    const signal = this.signal(workspaceRoot);
    if (!signal.started) {
      signal.started = true;
      signal.resolve();
    }
  }

  async waitForSendStarted(workspaceRoot: string): Promise<void> {
    await this.signal(workspaceRoot).promise;
  }

  captureEditor(workspaceRoot: string, input: any): void {
    const editor = input?.capabilities?.toolExecutors?.editor;
    if (typeof editor === "function") this.editors.set(workspaceRoot, editor as CapturedEditor);
  }

  async attemptStaleEditor(workspaceRoot: string): Promise<void> {
    const editor = this.editors.get(workspaceRoot);
    if (!editor) fail(`no lease-aware editor was captured for ${workspaceRoot}`);
    await editor(
      {
        path: path.join(workspaceRoot, "src", "demo.ts"),
        old_text: "export const value = 1;",
        new_text: "export const value = 999;",
      },
      workspaceRoot,
      { agentId: "stale-proof-writer", conversationId: "stale-proof-session", iteration: 999 },
    );
  }

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    const base = await this.base.create(request);
    const workspaceRoot = request.workspaceRoot;
    return {
      start: async (input) => {
        this.captureEditor(workspaceRoot, input);
        return await base.start(input);
      },
      send: async (input) => {
        this.markSendStarted(workspaceRoot);
        await this.sendBarrier?.enter(workspaceRoot);
        return await base.send(input);
      },
      abort: async (sessionId, reason) => await base.abort(sessionId, reason),
      subscribe: (listener, options) => base.subscribe(listener, options),
      get: typeof base.get === "function"
        ? async (sessionId) => await base.get!(sessionId)
        : undefined,
      dispose: async (reason) => await base.dispose(reason),
    };
  }
}

class ProofFaultLockStore extends WorkspaceLockStore {
  faultInjected = false;

  constructor(
    rootDir: string,
    private readonly targetWorkspaceId: string,
    private readonly targetWorkspaceRoot: string,
    private readonly observer: ProofObservingRuntimeFactory,
  ) {
    super(rootDir);
  }

  override async renew(
    claim: WorkspaceWriterClaimV1,
    leaseMs: number,
    options: WorkspaceLockOptions = {},
  ) {
    if (claim.workspaceId === this.targetWorkspaceId && !this.faultInjected) {
      await this.observer.waitForSendStarted(this.targetWorkspaceRoot);
      this.faultInjected = true;
      throw new Error("forced disposable proof lease loss after real Hub send started");
    }
    return await super.renew(claim, leaseMs, options);
  }
}

async function main(): Promise<void> {
  // Hard shell/CI latch. Chat authorization is still separately required before
  // anyone sets this value and executes the physical proof.
  assertLiveProofOptIn();

  const isolation = await createLiveProofIsolation();
  const workspaceRoots: string[] = [];
  let hubMayHaveStarted = false;
  try {
    Object.assign(process.env, isolation.environment);
    const rootA = await createDisposableProofWorkspace();
    const rootB = await createDisposableProofWorkspace();
    workspaceRoots.push(rootA, rootB);

    const registry = new WorkspaceRegistry(isolation.registryPath);
    const project = await registry.registerProject("Disposable Multi-Workspace Live Proof");
    const workspaceA = await registerProofWorkspace(registry, project.projectId, rootA, "Disposable A");
    const workspaceB = await registerProofWorkspace(registry, project.projectId, rootB, "Disposable B");
    const safetyPlans = new SafetyPlanService(registry);
    const taskA = await createApprovedProofTask(safetyPlans, workspaceA, 101);
    const taskB = await createApprovedProofTask(safetyPlans, workspaceB, 102);

    const locks = new WorkspaceLockStore(path.join(isolation.root, "coordination"));
    const sendBarrier = new LiveProofSendBarrier([rootA, rootB]);
    const runner = new ScheduledHubWriterAuthorityRunner(
      registry,
      environmentWorkerProfileResolver(),
      new ProofObservingRuntimeFactory(new SdkClineRuntimeFactory(), sendBarrier),
    );
    const scheduler = new WriterConcurrencyScheduler(
      locks,
      {
        schemaVersion: 1,
        maxActiveWriters: 2,
        maxStartsPerPass: 2,
        maxActiveWritersPerWorkspace: 1,
      },
      runner,
      { leaseMs: 30_000, heartbeatMs: 5_000 },
    );

    process.stdout.write(
      `[disposable multi-workspace proof: hub=${isolation.hubAddress}; workspaces=2; registry=isolated]\n`,
    );

    // From this point Cline may spawn the isolated detached Hub. Cleanup below must
    // confirm Cline-owned graceful shutdown before deleting any proof data roots.
    hubMayHaveStarted = true;
    const schedulePromise = scheduler.schedule([taskA.id, taskB.id]);
    const overlapPromise = waitForTwoDistinctLiveLeases(
      locks,
      new Set([workspaceA.workspaceId, workspaceB.workspaceId]),
    );
    const [schedule, overlap] = await Promise.all([schedulePromise, overlapPromise]);

    if (schedule.failures.length > 0) {
      fail(`parallel scheduler reported failures: ${JSON.stringify(schedule.failures)}`);
    }
    if (schedule.reservedTaskIds.length !== 2 || schedule.completedTaskIds.length !== 2) {
      fail(`parallel scheduler did not reserve and complete exactly two tasks: ${JSON.stringify(schedule)}`);
    }
    if (!sendBarrier.bothSendsReached) fail("independent Hub sends never overlapped");
    if ((await locks.listActive()).length !== 0) fail("parallel writer leases were not released");

    const completedA = await assertCompletedTask(workspaceA, taskA.id, 101);
    const completedB = await assertCompletedTask(workspaceB, taskB.id, 102);
    if (!completedA.clineSessionId || !completedB.clineSessionId || completedA.clineSessionId === completedB.clineSessionId) {
      fail("parallel tasks did not use distinct orchestrator-owned Hub sessions");
    }

    await rollbackAndAssertBaseline(workspaceA, taskA.id);
    await rollbackAndAssertBaseline(workspaceB, taskB.id);

    // Physical same-workspace admission proof. Both tasks have valid Safety Plans,
    // but the scheduler may reserve at most one because coordination never permits
    // two simultaneous writers for one registered workspace.
    const sameWorkspaceTask1 = await createApprovedProofTask(safetyPlans, workspaceA, 201);
    const sameWorkspaceTask2 = await createApprovedProofTask(safetyPlans, workspaceA, 202);
    const sameWorkspace = await scheduler.schedule([sameWorkspaceTask1.id, sameWorkspaceTask2.id]);
    if (sameWorkspace.reservedTaskIds.length !== 1 || sameWorkspace.completedTaskIds.length !== 1) {
      fail(`same-workspace scheduler did not admit exactly one writer: ${JSON.stringify(sameWorkspace)}`);
    }
    const deniedTaskId = [sameWorkspaceTask1.id, sameWorkspaceTask2.id]
      .find((taskId) => !sameWorkspace.reservedTaskIds.includes(taskId));
    if (!deniedTaskId) fail("same-workspace proof did not identify the denied competing task");
    const denied = await new TaskStore(workspaceA.canonicalRoot).load(deniedTaskId);
    if (
      denied.status !== "created"
      || denied.clineSessionId
      || (denied.runCount ?? 0) !== 0
      || (denied.sessionGeneration ?? 0) !== 0
    ) {
      fail("denied same-workspace competitor acquired runtime/session authority");
    }
    const admittedTaskId = sameWorkspace.reservedTaskIds[0];
    const admittedExpected = admittedTaskId === sameWorkspaceTask1.id ? 201 : 202;
    await assertCompletedTask(workspaceA, admittedTaskId, admittedExpected);
    await rollbackAndAssertBaseline(workspaceA, admittedTaskId);

    // Physical fault-isolation proof. A proof-only observer waits until the real Hub
    // send for workspace A has started. Its lock store then fails A's next heartbeat.
    // The production runner must abort A, B must continue normally, and A's captured
    // lease-aware editor must remain unusable after lease release.
    const faultTaskA = await createApprovedProofTask(safetyPlans, workspaceA, 301);
    const healthyTaskB = await createApprovedProofTask(safetyPlans, workspaceB, 302);
    const observer = new ProofObservingRuntimeFactory(new SdkClineRuntimeFactory());
    const faultLocks = new ProofFaultLockStore(
      path.join(isolation.root, "fault-coordination"),
      workspaceA.workspaceId,
      workspaceA.canonicalRoot,
      observer,
    );
    const faultRunner = new ScheduledHubWriterAuthorityRunner(
      registry,
      environmentWorkerProfileResolver(),
      observer,
    );
    const faultScheduler = new WriterConcurrencyScheduler(
      faultLocks,
      {
        schemaVersion: 1,
        maxActiveWriters: 2,
        maxStartsPerPass: 2,
        maxActiveWritersPerWorkspace: 1,
      },
      faultRunner,
      { leaseMs: 30_000, heartbeatMs: 10 },
    );
    const faultResult = await faultScheduler.schedule([faultTaskA.id, healthyTaskB.id]);
    if (!faultLocks.faultInjected) fail("physical lease-loss fault was not injected");
    if (!faultResult.failures.some((item) => item.taskId === faultTaskA.id && item.code === "worker_failed")) {
      fail(`faulted workspace did not fail closed: ${JSON.stringify(faultResult)}`);
    }
    if (!faultResult.completedTaskIds.includes(healthyTaskB.id)) {
      fail(`healthy workspace did not complete independently: ${JSON.stringify(faultResult)}`);
    }
    if (faultResult.completedTaskIds.includes(faultTaskA.id)) {
      fail("faulted workspace incorrectly reported completion after lease loss");
    }
    if ((await faultLocks.listActive()).length !== 0) fail("fault proof left writer leases active");

    const faultedA = await new TaskStore(workspaceA.canonicalRoot).load(faultTaskA.id);
    if (faultedA.status !== "aborted") {
      fail(`faulted task did not persist safe aborted state; status=${faultedA.status}`);
    }
    const healthyB = await assertCompletedTask(workspaceB, healthyTaskB.id, 302);
    if (!faultedA.clineSessionId || !healthyB.clineSessionId || faultedA.clineSessionId === healthyB.clineSessionId) {
      fail("fault/healthy tasks did not retain distinct Hub owner sessions");
    }
    await assertProtectedSentinels(workspaceA, faultTaskA.id);

    const beforeStaleAttempt = await readFile(path.join(workspaceA.canonicalRoot, "src", "demo.ts"), "utf8");
    let staleWriteBlocked = false;
    try {
      await observer.attemptStaleEditor(workspaceA.canonicalRoot);
    } catch {
      staleWriteBlocked = true;
    }
    if (!staleWriteBlocked) fail("stale lease-aware editor wrote after forced lease loss");
    const afterStaleAttempt = await readFile(path.join(workspaceA.canonicalRoot, "src", "demo.ts"), "utf8");
    if (afterStaleAttempt !== beforeStaleAttempt) {
      fail("workspace changed during stale-editor attempt after lease loss");
    }

    await rollbackAndAssertBaseline(workspaceA, faultTaskA.id);
    await rollbackAndAssertBaseline(workspaceB, healthyTaskB.id);

    process.stdout.write(`${JSON.stringify({
      proof: "disposable-multi-workspace",
      passed: true,
      isolation: {
        hubAddress: isolation.hubAddress,
        registry: "isolated",
        workspaceCount: 2,
      },
      parallel: {
        completedTaskIds: schedule.completedTaskIds,
        simultaneousLeasesObserved: overlap.length,
        overlappingHubSendsObserved: sendBarrier.bothSendsReached,
        distinctWorkspaceIds: new Set(overlap.map((item) => item.workspaceId)).size,
        distinctFenceTokens: new Set(overlap.map((item) => item.fenceToken)).size,
        distinctHubOwnerSessions: completedA.clineSessionId !== completedB.clineSessionId,
        taskA: {
          validationPassed: completedA.lastValidation?.passed === true,
          diffSafetyPassed: completedA.lastDiffSafety?.passed === true,
          checkpointAvailable: completedA.lastRunCheckpoint?.available === true,
        },
        taskB: {
          validationPassed: completedB.lastValidation?.passed === true,
          diffSafetyPassed: completedB.lastDiffSafety?.passed === true,
          checkpointAvailable: completedB.lastRunCheckpoint?.available === true,
        },
        bothRolledBack: true,
      },
      sameWorkspace: {
        admittedTaskId,
        deniedTaskId,
        deniedHadRuntimeAuthority: false,
        rolledBack: true,
      },
      leaseLossIsolation: {
        faultedTaskId: faultTaskA.id,
        healthyTaskId: healthyTaskB.id,
        faultedStatus: faultedA.status,
        healthyStatus: healthyB.status,
        staleWriteBlocked,
        healthyValidationPassed: healthyB.lastValidation?.passed === true,
        healthyDiffSafetyPassed: healthyB.lastDiffSafety?.passed === true,
        bothRolledBack: true,
      },
    }, null, 2)}\n`);
  } finally {
    if (hubMayHaveStarted) {
      // Fail closed: if the pinned Cline lifecycle cannot confirm shutdown, preserve
      // all disposable roots rather than deleting files under a possibly-live Hub.
      await stopLiveProofHubGracefully();
    }
    for (const root of workspaceRoots) {
      await rm(root, { recursive: true, force: true });
    }
    await rm(isolation.root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[live multi-workspace proof failed: ${error instanceof Error ? error.message : String(error)}]\n`,
  );
  process.exitCode = 1;
});
