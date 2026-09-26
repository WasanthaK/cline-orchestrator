import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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
  preserveLiveProofFailure,
  removeDisposableProofRoot,
  stopLiveProofHubGracefully,
} from "./live-proof-isolation.js";
import { environmentWorkerProfileResolver } from "./mcp-main.js";
import { rollbackTask } from "./rollback.js";
import { SafetyPlanService } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
import { ScheduledHubRestartReconciler } from "./scheduled-hub-recovery.js";
import { ScheduledHubWriterAuthorityRunner } from "./scheduled-hub-writer-runner.js";
import { TaskStore } from "./state.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { WriterConcurrencyScheduler } from "./writer-concurrency-scheduler.js";

const READY = "__ORCH_SCHEDULED_OWNER_READY__";
const CHILD_ROLE = "ORCH_SCHEDULED_PROOF_CHILD";
const CHILD_REGISTRY = "ORCH_SCHEDULED_PROOF_REGISTRY";
const CHILD_WORKSPACE = "ORCH_SCHEDULED_PROOF_WORKSPACE";
const CHILD_TASK = "ORCH_SCHEDULED_PROOF_TASK";
const CHILD_LOCKS = "ORCH_SCHEDULED_PROOF_LOCKS";
const BASE_DEMO = "export const value = 1;\n";
const LEASE_MS = 3_000;

function fail(message: string): never {
  throw new Error(`Scheduled restart proof refused: ${message}`);
}

function scheduler(
  locks: WorkspaceLockStore,
  runner: ScheduledHubWriterAuthorityRunner,
): WriterConcurrencyScheduler {
  return new WriterConcurrencyScheduler(
    locks,
    { schemaVersion: 1, maxActiveWriters: 1, maxStartsPerPass: 1, maxActiveWritersPerWorkspace: 1 },
    runner,
    { leaseMs: LEASE_MS, heartbeatMs: 500 },
  );
}

// The first owner creates a real isolated Hub session, then pauses immediately
// before sending model work. Killing only this child simulates a gateway crash
// while the approved task and fenced lease are still durable.
class HoldingRuntimeFactory implements ClineRuntimeFactory {
  constructor(private readonly base: ClineRuntimeFactory, private readonly taskId: string) {}

  async create(request: ClineRuntimeCreateRequest): Promise<ClineRuntime> {
    const runtime = await this.base.create(request);
    return {
      start: async (input) => await runtime.start(input),
      send: async () => {
        process.stdout.write(`${READY}${this.taskId}\n`);
        await new Promise<never>(() => undefined);
      },
      abort: async (sessionId, reason) => await runtime.abort(sessionId, reason),
      subscribe: (listener, options) => runtime.subscribe(listener, options),
      get: runtime.get ? async (sessionId) => await runtime.get!(sessionId) : undefined,
      dispose: async (reason) => await runtime.dispose(reason),
    };
  }
}

async function childMain(): Promise<void> {
  const registryPath = process.env[CHILD_REGISTRY];
  const workspaceId = process.env[CHILD_WORKSPACE];
  const taskId = process.env[CHILD_TASK];
  const locksPath = process.env[CHILD_LOCKS];
  if (!registryPath || !workspaceId || !taskId || !locksPath) fail("child inputs are incomplete");

  const registry = new WorkspaceRegistry(registryPath);
  const workspace = await registry.resolveVerifiedWorkspace(workspaceId);
  assertDisposableWorkspaceRoot(workspace.canonicalRoot);
  const task = await new TaskStore(workspace.canonicalRoot).load(taskId);
  if (task.status !== "created" || task.workspaceId !== workspaceId) {
    fail("child task is not a fresh approved disposable task");
  }

  const runner = new ScheduledHubWriterAuthorityRunner(
    registry,
    environmentWorkerProfileResolver(),
    new HoldingRuntimeFactory(new SdkClineRuntimeFactory(), taskId),
  );
  await scheduler(new WorkspaceLockStore(locksPath), runner).schedule([taskId]);
  fail("first owner unexpectedly finished instead of remaining interrupted");
}

async function waitForChildReady(child: ChildProcess, taskId: string): Promise<void> {
  if (!child.stdout || !child.stderr) fail("owner child lacks piped output");
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("isolated owner did not start within 120 seconds"))), 120_000);
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => process.stderr.write(chunk));
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      output += chunk;
      if (output.includes(`${READY}${taskId}\n`)) finish(resolve);
      if (output.length > 128_000) output = output.slice(-4_096);
    });
    child.once("exit", (code, signal) => finish(() => reject(new Error(
      `isolated owner exited before ready (code=${code}; signal=${signal ?? "none"})`,
    ))));
    child.once("error", (error) => finish(() => reject(error)));
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.kill("SIGKILL")) fail("could not terminate the proof-owned gateway child");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(15_000).then(() => fail("proof-owned gateway child did not exit")),
  ]);
}

async function waitForLeaseExpiry(locks: WorkspaceLockStore, workspaceId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await locks.listActive()).some((state) => state.workspaceId === workspaceId)) return;
    await sleep(100);
  }
  fail("old fenced lease remained live after the proof gateway stopped");
}

async function parentMain(): Promise<void> {
  const isolation = await createLiveProofIsolation();
  const roots: string[] = [];
  let child: ChildProcess | undefined;
  let hubMayHaveStarted = false;
  let proofError: unknown;
  try {
    Object.assign(process.env, isolation.environment);
    const root = await createDisposableProofWorkspace();
    roots.push(root);
    const registry = new WorkspaceRegistry(isolation.registryPath);
    const project = await registry.registerProject("Disposable Scheduled Restart Proof");
    const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Disposable Scheduled Restart",
      root,
      safetyProfile: {
        policyVersion: "scheduled-restart-proof-v1",
        allowedPathPatterns: ["src/demo.ts"],
        protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
        validationCommands: ["git diff --check"],
        workerProfileId,
        maxChangedFiles: 1,
      },
    });
    assertDisposableWorkspaceRoot(workspace.canonicalRoot);
    const goal = "Read src/demo.ts. Replace the exact line 'export const value = 1;' with 'export const value = 401;'. Do not modify any other file. Re-read src/demo.ts and report completion.";
    const safetyPlans = new SafetyPlanService(registry);
    const preview = await safetyPlans.preview({
      workspaceId: workspace.workspaceId,
      goal,
      requestedScope: ["src/demo.ts"],
    });
    const { task } = await startApprovedTask(safetyPlans, preview.planToken);
    const store = new TaskStore(root);
    const locksPath = path.join(isolation.root, "scheduled-coordination");
    const locks = new WorkspaceLockStore(locksPath);

    const scriptPath = fileURLToPath(import.meta.url);
    child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...isolation.environment,
        [CHILD_ROLE]: "owner",
        [CHILD_REGISTRY]: isolation.registryPath,
        [CHILD_WORKSPACE]: workspace.workspaceId,
        [CHILD_TASK]: task.id,
        [CHILD_LOCKS]: locksPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    hubMayHaveStarted = true;
    await waitForChildReady(child, task.id);

    const interrupted = await store.load(task.id);
    const active = (await locks.listActive()).find((state) => state.workspaceId === workspace.workspaceId);
    if (
      interrupted.status !== "running" || !interrupted.clineSessionId
      || !interrupted.lastRunCheckpoint?.available || !active?.activeWriter
    ) fail("first owner did not persist a running task, Hub session, checkpoint and live fence");
    const oldClaim = {
      schemaVersion: 1 as const,
      workspaceId: active.workspaceId,
      stateRevision: active.revision,
      leaseId: active.activeWriter.leaseId,
      fenceToken: active.activeWriter.fenceToken,
      taskId: active.activeWriter.taskId,
      ownerInstanceId: active.activeWriter.ownerInstanceId,
      expiresAt: active.activeWriter.expiresAt,
      authority: "coordination_only" as const,
    };
    const oldSessionId = interrupted.clineSessionId;
    const oldCheckpoint = interrupted.lastRunCheckpoint.createdAt;

    await stopChild(child);
    await waitForLeaseExpiry(locks, workspace.workspaceId);
    let staleFenceRejected = false;
    try { await locks.validate(oldClaim); } catch { staleFenceRejected = true; }
    if (!staleFenceRejected) fail("expired gateway fence remained valid");

    const replacement = new ScheduledHubWriterAuthorityRunner(
      registry,
      environmentWorkerProfileResolver(),
      new SdkClineRuntimeFactory(),
    );
    const reconciler = new ScheduledHubRestartReconciler(
      registry,
      locks,
      replacement,
      scheduler(locks, replacement),
    );
    const recovered = await reconciler.recoverInterruptedTasks();
    if (
      recovered.scanned !== 1 || recovered.prepared !== 1
      || recovered.deferredLiveLease !== 0 || recovered.failedClosed !== 0
      || recovered.schedule?.completedTaskIds[0] !== task.id
      || recovered.schedule.failures.length !== 0
    ) fail(`replacement scheduled owner did not complete safely: ${JSON.stringify(recovered)}`);

    const completed = await store.load(task.id);
    if (
      completed.status !== "completed"
      || completed.clineSessionId === oldSessionId
      || (completed.runCount ?? 0) < 2
      || (completed.sessionGeneration ?? 0) < 2
      || (completed.recoveryCount ?? 0) < 1
      || completed.lastRunCheckpoint?.createdAt !== oldCheckpoint
      || completed.lastValidation?.passed !== true
      || completed.lastDiffSafety?.passed !== true
      || await readFile(path.join(root, "src", "demo.ts"), "utf8") !== "export const value = 401;\n"
    ) fail("replacement owner lacked completion, fresh session, preserved checkpoint or safety evidence");
    if ((await locks.listActive()).length !== 0) fail("replacement lease was not released");
    if (await readFile(path.join(root, ".env"), "utf8") !== "PROOF_SECRET=isolated-test-value\n") fail("protected sentinel changed");
    if (await readFile(path.join(root, "outside.txt"), "utf8") !== "protected baseline\n") fail("outside sentinel changed");

    const events = await store.events(task.id);
    if (!events.some((event) => event.type === "resume_queued" && event.message?.includes("replacement Hub owner session"))) {
      fail("replacement owner handoff was not recorded");
    }
    if (!events.some((event) => event.type === "session_recovered")) fail("replacement Hub session recovery was not recorded");

    const rolledBack = await rollbackTask(store, root, task.id);
    if (rolledBack.status !== "rolled_back" || await readFile(path.join(root, "src", "demo.ts"), "utf8") !== BASE_DEMO) {
      fail("recovered task did not roll back to the exact initial baseline");
    }

    process.stdout.write(`${JSON.stringify({
      proof: "disposable-scheduled-gateway-restart",
      passed: true,
      taskId: task.id,
      oldFenceRejected: staleFenceRejected,
      freshOwnerSession: completed.clineSessionId !== oldSessionId,
      preservedCheckpoint: completed.lastRunCheckpoint?.createdAt === oldCheckpoint,
      validationPassed: completed.lastValidation?.passed === true,
      diffSafetyPassed: completed.lastDiffSafety?.passed === true,
      rolledBack: true,
    }, null, 2)}\n`);
  } catch (error) {
    proofError = error;
    throw error;
  } finally {
    try {
      if (child) await stopChild(child);
      if (hubMayHaveStarted) await stopLiveProofHubGracefully();
      for (const root of roots) await removeDisposableProofRoot(root);
      await removeDisposableProofRoot(isolation.root);
    } catch (cleanupError) {
      preserveLiveProofFailure(proofError, cleanupError);
    }
  }
}

async function main(): Promise<void> {
  assertLiveProofOptIn();
  if (process.env[CHILD_ROLE] === "owner") await childMain();
  else await parentMain();
}

void main().catch((error) => {
  process.stderr.write(`[live scheduled restart proof failed: ${error instanceof Error ? error.message : String(error)}]\n`);
  process.exitCode = 1;
});
