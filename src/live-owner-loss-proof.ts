import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { captureGitSnapshot } from "./git-state.js";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  stopLiveProofHubGracefully,
} from "./live-proof-isolation.js";
import { RestartAwareMachineOrchestratorService } from "./machine-recovery.js";
import { environmentWorkerProfileResolver } from "./mcp-main.js";
import { SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";

const READY_PREFIX = "__ORCH_OWNER_READY__";
const CHILD_ROLE = "ORCH_LIVE_PROOF_CHILD_ROLE";
const CHILD_WORKSPACE_ID = "ORCH_LIVE_PROOF_WORKSPACE_ID";
const CHILD_GOAL = "ORCH_LIVE_PROOF_GOAL";
const CHILD_REGISTRY_PATH = "ORCH_LIVE_PROOF_REGISTRY_PATH";
const ACTIVE_STATUSES = new Set<OrchestratorTask["status"]>([
  "waiting",
  "running",
  "stalled",
  "validating",
  "repairing",
]);
const TERMINAL_STATUSES = new Set<OrchestratorTask["status"]>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

function fail(message: string): never {
  throw new Error(`Live owner-loss proof refused: ${message}`);
}

function assertDisposableProofWorkspace(workspace: RegisteredWorkspace): void {
  assertDisposableWorkspaceRoot(workspace.canonicalRoot);

  const allowed = new Set(workspace.safetyProfile.allowedPathPatterns);
  if (allowed.size !== 1 || !allowed.has("src/demo.ts")) {
    fail("workspace safety profile must authorize only src/demo.ts for this proof");
  }

  const protectedPatterns = new Set(workspace.safetyProfile.protectedPathPatterns);
  for (const required of [".env*", "outside.txt", ".git/**"]) {
    if (!protectedPatterns.has(required)) {
      fail(`workspace safety profile is missing required protected pattern ${required}`);
    }
  }

  if (
    workspace.safetyProfile.validationCommands.length !== 1
    || workspace.safetyProfile.validationCommands[0] !== "git diff --check"
  ) {
    fail("workspace safety profile must use only git diff --check validation");
  }

  if (workspace.safetyProfile.maxChangedFiles !== 1) {
    fail("workspace safety profile must limit the proof to one changed file");
  }
}

async function assertNoActiveTasks(store: TaskStore): Promise<void> {
  const active = (await store.list()).filter((task) => ACTIVE_STATUSES.has(task.status));
  if (active.length > 0) {
    fail(`workspace already has active task(s): ${active.map((task) => `${task.id}:${task.status}`).join(", ")}`);
  }
}

async function waitForOwnerReady(
  store: TaskStore,
  taskId: string,
  timeoutMs = 120_000,
): Promise<OrchestratorTask> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await store.load(taskId);
    if (
      task.status === "running"
      && task.clineSessionId
      && task.lastRunCheckpoint?.available
      && (task.runCount ?? 0) >= 1
      && (task.sessionGeneration ?? 0) >= 1
    ) {
      return task;
    }
    if (TERMINAL_STATUSES.has(task.status)) {
      const details = [
        `status=${task.status}`,
        task.finishReason ? `finishReason=${task.finishReason}` : undefined,
        task.error ? `error=${task.error}` : undefined,
        `runCount=${task.runCount ?? 0}`,
        `sessionGeneration=${task.sessionGeneration ?? 0}`,
        `hasHubSession=${Boolean(task.clineSessionId)}`,
        `checkpointAvailable=${task.lastRunCheckpoint?.available === true}`,
      ].filter(Boolean).join("; ");
      fail(`first owner reached terminal state before it could be interrupted (${details})`);
    }
    await sleep(10);
  }
  fail(`first owner did not reach active Hub execution within ${timeoutMs}ms`);
}

async function waitForTerminal(
  service: RestartAwareMachineOrchestratorService,
  taskId: string,
  timeoutMs = 360_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await service.getTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return task;
    await sleep(250);
  }
  fail(`replacement owner did not reach a terminal task state within ${timeoutMs}ms`);
}

async function ownerChild(): Promise<void> {
  const workspaceId = process.env[CHILD_WORKSPACE_ID]?.trim();
  const goal = process.env[CHILD_GOAL]?.trim();
  const registryPath = process.env[CHILD_REGISTRY_PATH]?.trim();
  if (!workspaceId || !goal || !registryPath) {
    fail("owner child is missing isolated registry, workspace, or goal input");
  }

  const registry = new WorkspaceRegistry(registryPath);
  const workspace = await registry.resolveVerifiedWorkspace(workspaceId);
  assertDisposableProofWorkspace(workspace);
  const store = new TaskStore(workspace.canonicalRoot);
  await assertNoActiveTasks(store);

  const safetyPlans = new SafetyPlanService(registry);
  const service = new RestartAwareMachineOrchestratorService(
    registry,
    safetyPlans,
    environmentWorkerProfileResolver(),
  );

  const preview = await service.previewTask({
    workspaceId,
    goal,
    requestedScope: ["src/demo.ts"],
  });
  const started = await service.startTask(preview.planToken);
  const active = await waitForOwnerReady(store, started.taskId);

  process.stdout.write(
    `${READY_PREFIX}${JSON.stringify({
      taskId: active.id,
      status: active.status,
      runCount: active.runCount ?? 0,
      sessionGeneration: active.sessionGeneration ?? 0,
      checkpointAvailable: active.lastRunCheckpoint?.available === true,
    })}\n`,
  );

  await new Promise<never>(() => undefined);
}

function waitForChildReady(child: ChildProcess, timeoutMs = 120_000): Promise<{
  taskId: string;
  status: string;
  runCount: number;
  sessionGeneration: number;
  checkpointAvailable: boolean;
}> {
  return new Promise((resolve, reject) => {
    if (!child.stdout || !child.stderr) {
      reject(new Error("owner child was not created with piped stdout/stderr"));
      return;
    }

    const stdout = child.stdout;
    const stderr = child.stderr;
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`owner child did not report ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => process.stderr.write(chunk));
    stdout.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      buffer += chunk;
      const marker = buffer.indexOf(READY_PREFIX);
      if (marker < 0) return;
      const start = marker + READY_PREFIX.length;
      const end = buffer.indexOf("\n", start);
      if (end < 0) return;
      const raw = buffer.slice(start, end);
      finish(() => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    child.once("exit", (code, signal) => {
      finish(() => reject(new Error(`owner child exited before ready (code=${code}; signal=${signal ?? "none"})`)));
    });
    child.once("error", (error) => finish(() => reject(error)));
  });
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(timeoutMs).then(() => {
      throw new Error(`owner child did not terminate within ${timeoutMs}ms`);
    }),
  ]);
}

async function registerIsolatedProofWorkspace(
  registry: WorkspaceRegistry,
  workspaceRoot: string,
): Promise<RegisteredWorkspace> {
  const project = await registry.registerProject("Isolated Owner-Loss Proof");
  const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
  return await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "Isolated Owner-Loss Proof Workspace",
    root: workspaceRoot,
    safetyProfile: {
      policyVersion: "owner-loss-proof-v1",
      allowedPathPatterns: ["src/demo.ts"],
      protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
      validationCommands: ["git diff --check"],
      workerProfileId,
      maxChangedFiles: 1,
    },
  });
}

async function parentMain(): Promise<void> {
  const workspaceRoot = await createDisposableProofWorkspace();
  const git = await captureGitSnapshot(workspaceRoot);
  if (!git.available) {
    fail(`generated disposable workspace is not a usable Git repository: ${git.error ?? "unknown Git error"}`);
  }
  if (git.dirty) {
    fail(`generated disposable workspace must be clean before proof; changedFiles=${git.changedFiles ?? 0}`);
  }

  const isolation = await createLiveProofIsolation();
  Object.assign(process.env, isolation.environment);

  const registry = new WorkspaceRegistry(isolation.registryPath);
  const workspace = await registerIsolatedProofWorkspace(registry, workspaceRoot);
  assertDisposableProofWorkspace(workspace);
  const store = new TaskStore(workspace.canonicalRoot);
  await assertNoActiveTasks(store);

  const demoPath = path.join(workspace.canonicalRoot, "src", "demo.ts");
  const beforeDemo = await readFile(demoPath, "utf8");
  const proofMarker = `owner-loss-proof-${Date.now().toString(36)}`;
  const goal = [
    "Inspect src/demo.ts.",
    `Then ensure src/demo.ts contains exactly one comment line: // ${proofMarker}`,
    "Do not modify any other file.",
    "Re-read src/demo.ts after the edit and report completion.",
  ].join(" ");

  process.stdout.write(
    `[isolated live proof: workspace=${workspace.canonicalRoot}; clineRoot=${isolation.clineDir}; hub=${isolation.hubAddress}; registry=isolated]\n`,
  );

  const scriptPath = fileURLToPath(import.meta.url);
  let hubMayHaveStarted = false;
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...isolation.environment,
      [CHILD_ROLE]: "owner",
      [CHILD_WORKSPACE_ID]: workspace.workspaceId,
      [CHILD_GOAL]: goal,
      [CHILD_REGISTRY_PATH]: isolation.registryPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  hubMayHaveStarted = true;

  let recoveryService: RestartAwareMachineOrchestratorService | undefined;
  let taskId: string | undefined;
  try {
    const ready = await waitForChildReady(child);
    taskId = ready.taskId;
    if (
      ready.status !== "running"
      || ready.runCount < 1
      || ready.sessionGeneration < 1
      || !ready.checkpointAvailable
    ) {
      fail("owner child reported ready without a running task, Hub generation, and usable checkpoint");
    }

    if (!child.kill("SIGKILL")) {
      throw new Error("failed to terminate the proof owner child process");
    }
    await waitForChildExit(child);

    const interrupted = await store.load(taskId);
    if (
      interrupted.status !== "running"
      || !interrupted.clineSessionId
      || !interrupted.lastRunCheckpoint?.available
    ) {
      fail(`task was not durably interrupted in running state (status=${interrupted.status})`);
    }

    const safetyPlans = new SafetyPlanService(registry);
    recoveryService = new RestartAwareMachineOrchestratorService(
      registry,
      safetyPlans,
      environmentWorkerProfileResolver(),
    );
    const recovery = await recoveryService.recoverInterruptedTasks();
    if (recovery.scanned !== 1 || recovery.queued !== 1 || recovery.failedClosed !== 0) {
      fail(`unexpected restart reconciliation summary ${JSON.stringify(recovery)}`);
    }

    const recovered = await waitForTerminal(recoveryService, taskId);
    if (recovered.status !== "completed") {
      fail(`replacement owner ended with ${recovered.status}: ${recovered.error ?? recovered.finishReason ?? "no detail"}`);
    }
    if (recovered.runCount < 2 || recovered.sessionGeneration < 2 || recovered.recoveryCount < 1) {
      fail("replacement owner completed without incrementing run/session/recovery evidence");
    }
    if (recovered.validation.configuredCommands > 0 && recovered.validation.lastPassed !== true) {
      fail("replacement owner completed without passing configured validation");
    }
    if (recovered.diffSafety?.passed !== true) {
      fail("replacement owner completed without passing checkpoint-relative diff safety");
    }

    const events = await store.events(taskId);
    if (!events.some((event) => event.type === "context_handoff_created")) {
      fail("durable recovery did not create a context handoff");
    }
    if (!events.some((event) => event.type === "session_recovered")) {
      fail("durable recovery did not record replacement-session recovery");
    }
    if (!events.some((event) => event.type === "resume_queued" && event.message?.includes("replacement Hub owner session"))) {
      fail("restart reconciliation did not record replacement-owner queuing evidence");
    }

    const checkpointId = recovered.checkpoint?.checkpointId;
    if (!checkpointId || recovered.checkpoint?.available !== true) {
      fail("completed recovered task has no usable rollback checkpoint");
    }
    const rolledBack = await recoveryService.rollbackTask(taskId, checkpointId);
    if (rolledBack.status !== "rolled_back") {
      fail(`proof rollback ended in unexpected state ${rolledBack.status}`);
    }

    const afterDemo = await readFile(demoPath, "utf8");
    if (afterDemo !== beforeDemo) {
      fail("rollback did not restore src/demo.ts to its exact pre-proof contents");
    }

    process.stdout.write(
      `\n${JSON.stringify({
        proof: "owner-loss-restart",
        passed: true,
        taskId,
        isolation: {
          workspaceRoot: workspace.canonicalRoot,
          clineRoot: isolation.clineDir,
          hubAddress: isolation.hubAddress,
          registry: "isolated",
        },
        firstOwner: {
          status: ready.status,
          runCount: ready.runCount,
          sessionGeneration: ready.sessionGeneration,
          checkpointAvailable: ready.checkpointAvailable,
        },
        replacementOwner: {
          status: recovered.status,
          runCount: recovered.runCount,
          sessionGeneration: recovered.sessionGeneration,
          recoveryCount: recovered.recoveryCount,
          validationPassed: recovered.validation.lastPassed ?? null,
          diffSafetyPassed: recovered.diffSafety?.passed ?? null,
        },
        rollback: {
          status: rolledBack.status,
          restoredPreProofContents: true,
        },
      }, null, 2)}\n`,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForChildExit(child).catch(() => undefined);
    }
    await recoveryService?.close().catch(() => undefined);
    if (hubMayHaveStarted) {
      await stopLiveProofHubGracefully();
    }
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(isolation.root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assertLiveProofOptIn();
  if (process.env[CHILD_ROLE] === "owner") {
    await ownerChild();
    return;
  }
  await parentMain();
}

void main().catch((error) => {
  process.stderr.write(
    `[live owner-loss proof failed: ${error instanceof Error ? error.message : String(error)}]\n`,
  );
  process.exitCode = 1;
});
