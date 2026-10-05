import crypto, { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  removeDisposableProofRoot,
  stopLiveProofHubGracefully,
} from "./live-proof-isolation.js";
import { collectCr3Preflight } from "./cr3-preflight.js";
import { captureGitSnapshot } from "./git-state.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";
import { SafetyPlanService } from "./safety-plan.js";
import { startApprovedTask } from "./safe-task-start.js";
import { TaskStore } from "./state.js";
import { createTaskCompletionPacket } from "./task-completion-packet.js";
import { environmentWorkerProfileResolver } from "./mcp-main.js";
import { SdkClineRuntimeFactory } from "./cline-runtime.js";
import {
  leaseAwareWriterAuthorityFromTask,
  type LeaseAwareWriterAuthorityV1,
} from "./lease-aware-hub-safety-runtime.js";
import { WorkspaceLockStore } from "./workspace-lock-store.js";
import { WriterConcurrencyScheduler } from "./writer-concurrency-scheduler.js";
import { DistributedRegistrationStore } from "./distributed-registration-store.js";
import { DistributedPlacementStore } from "./distributed-placement-store.js";
import { DistributedMachineTransportGateway } from "./distributed-machine-transport.js";
import { DistributedCandidateRouter } from "./distributed-candidate-router.js";
import { PostgresDistributedFenceBackend } from "./distributed-fencing-postgres.js";
import {
  DistributedFenceAuthority,
  type DistributedFenceClaimV1,
} from "./distributed-fencing.js";
import {
  createDistributedExecutionDispatch,
  DistributedExecutionAdmissionGateway,
  FileDistributedDispatchReplayStore,
  type DistributedExecutionDispatchV1,
} from "./distributed-execution-admission.js";
import {
  createDistributedDeliveryAdmissionAcknowledgement,
  createDistributedDeliveryStateRecord,
  FileDistributedDeliveryStateStore,
} from "./distributed-delivery-reconciliation.js";
import {
  classifyDistributedTakeoverRecovery,
} from "./distributed-takeover-recovery.js";
import {
  createDistributedRecoveryProposal,
} from "./distributed-recovery-proposal.js";
import {
  DistributedRecoveryPreexecutionCoordinator,
} from "./distributed-recovery-preexecution.js";
import {
  DistributedRecoveryReacquisitionPreparationCoordinator,
} from "./distributed-recovery-reacquisition-preparation.js";
import {
  DistributedRecoveryDispatchCreationCoordinator,
} from "./distributed-recovery-dispatch-creation.js";
import {
  DistributedRecoveryAdmissionBridge,
} from "./distributed-recovery-admission-bridge.js";
import {
  DistributedRecoveryTargetHandoffCoordinator,
} from "./distributed-recovery-target-handoff.js";
import {
  DistributedRecoveryRuntimeStartCoordinator,
} from "./distributed-recovery-runtime-start.js";
import {
  DistributedTargetRuntimeHandoffCoordinator,
  RegisteredWorkspaceTargetTaskLoader,
} from "./distributed-target-runtime-handoff.js";
import { DistributedTargetRuntimeStarter } from "./distributed-target-runtime-start.js";
import type {
  DistributedWriterCandidateAssignmentV1,
} from "./distributed-control-contract.js";

const execFile = promisify(execFileCallback);
const SESSION_TTL_MS = 5 * 60_000;
const CANDIDATE_TTL_MS = 2 * 60_000;
const FENCE_TTL_MS = 60_000;
const DISPATCH_TTL_MS = 30_000;

type ProofStage = "prepare" | "recover";

interface RecoveryProofManifestV1 {
  schemaVersion: 1;
  workspaceRoot: string;
  isolationRoot: string;
  registryPath: string;
  isolationEnvironment: Record<string, string>;
  proofStateRoot: string;
  taskId: string;
  workspaceId: string;
  registrationId: string;
  registrationRevision: number;
  proofComment: string;
  envSha256: string;
  outsideSha256: string;
  deliveryId: string;
  oldAssignment: DistributedWriterCandidateAssignmentV1;
  oldFence: DistributedFenceClaimV1;
  oldDispatch: DistributedExecutionDispatchV1;
}

function fail(message: string): never {
  throw new Error(`M12Z-I recovery proof refused: ${message}`);
}

function requiredAbsoluteDirectory(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !path.isAbsolute(value) || path.normalize(value) !== value) {
    fail(`${name} must be an absolute canonical local path`);
  }
  return value;
}

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function proofStage(): ProofStage {
  const value = process.env.ORCH_M12Z_I_STAGE?.trim();
  if (value !== "prepare" && value !== "recover") {
    fail("ORCH_M12Z_I_STAGE must be prepare or recover");
  }
  return value;
}

function proofRoot(): string {
  const runnerTemp = requiredAbsoluteDirectory("RUNNER_TEMP");
  const runId = requiredValue("GITHUB_RUN_ID");
  return path.join(runnerTemp, `m12z-recovery-proof-${runId}`);
}

function manifestPath(): string {
  return path.join(proofRoot(), "manifest.json");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trimEnd();
}

async function registerProofWorkspace(
  registry: WorkspaceRegistry,
  workspaceRoot: string,
): Promise<RegisteredWorkspace> {
  const project = await registry.registerProject("M12Z Recovery Physical Proof");
  const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
  return await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "M12Z Disposable Recovery Workspace",
    root: workspaceRoot,
    safetyProfile: {
      policyVersion: "m12z-recovery-proof-v1",
      allowedPathPatterns: ["src/demo.ts"],
      protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
      validationCommands: [],
      workerProfileId,
      maxChangedFiles: 1,
    },
  });
}

async function revalidateAuthority(
  registry: WorkspaceRegistry,
  store: TaskStore,
  taskId: string,
  ownerInstanceId: string,
): Promise<LeaseAwareWriterAuthorityV1> {
  const task = await store.load(taskId);
  const workspaceId = task.workspaceId;
  if (!workspaceId) fail("durable task is missing workspaceId");
  const workspace = await registry.resolveVerifiedWorkspace(workspaceId);
  if (
    task.projectId !== workspace.projectId
    || task.workspaceRegistryRevision !== workspace.revision
    || task.safetyProfileId !== workspace.safetyProfile.profileId
    || task.safetyProfileRevision !== workspace.safetyProfile.revision
    || task.safetyPolicyVersion !== workspace.safetyProfile.policyVersion
    || task.workerProfileId !== workspace.safetyProfile.workerProfileId
    || JSON.stringify(task.approvedAllowedPathPatterns ?? []) !== JSON.stringify(workspace.safetyProfile.allowedPathPatterns)
    || JSON.stringify(task.approvedProtectedPathPatterns ?? []) !== JSON.stringify(workspace.safetyProfile.protectedPathPatterns)
  ) {
    fail("durable task/Safety Plan/workspace binding is no longer current");
  }
  return leaseAwareWriterAuthorityFromTask(task, ownerInstanceId);
}

async function loadRegistration(m12xStateRoot: string): Promise<{
  registrations: DistributedRegistrationStore;
  registrationId: string;
  revision: number;
  machineId: string;
}> {
  const registrations = new DistributedRegistrationStore(m12xStateRoot);
  const active = (await registrations.list()).filter((item) => !item.revokedAt);
  if (active.length !== 1) fail("M12X state must contain exactly one active machine registration");
  const registration = active[0]!;
  if (
    !registration.allowedCapabilities.includes("accept_writer_candidates")
    || !registration.allowedCapabilities.includes("report_status")
  ) {
    fail("M12X registration lacks required recovery proof capabilities");
  }
  return {
    registrations,
    registrationId: registration.registrationId,
    revision: registration.revision,
    machineId: registration.machineId,
  };
}

async function issueLiveSession(
  transport: DistributedMachineTransportGateway,
  registrationId: string,
): Promise<string> {
  const issued = await transport.issue(registrationId, {
    capabilities: ["accept_writer_candidates", "report_status"],
    ttlMs: SESSION_TTL_MS,
  });
  await transport.reportStatus(
    issued.token,
    crypto.randomUUID(),
    { status: "ready", acceptingWriterCandidates: true },
  );
  return issued.token;
}

async function writeManifest(manifest: RecoveryProofManifestV1): Promise<void> {
  await mkdir(proofRoot(), { recursive: false });
  await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function readManifest(): Promise<RecoveryProofManifestV1> {
  const raw = JSON.parse(await readFile(manifestPath(), "utf8")) as RecoveryProofManifestV1;
  if (
    raw?.schemaVersion !== 1
    || !path.isAbsolute(raw.workspaceRoot)
    || !path.isAbsolute(raw.isolationRoot)
    || !path.isAbsolute(raw.registryPath)
    || !path.isAbsolute(raw.proofStateRoot)
    || !raw.taskId
    || !raw.workspaceId
    || !raw.registrationId
    || !raw.deliveryId
  ) {
    fail("recovery proof manifest is invalid");
  }
  assertDisposableWorkspaceRoot(raw.workspaceRoot);
  return raw;
}

async function prepareStage(): Promise<void> {
  const preflight = await collectCr3Preflight();
  if (preflight.overall !== "ready") fail("Cline/provider live-proof preflight is not ready");

  const m12xRoot = requiredAbsoluteDirectory("ORCH_M12X_ROOT");
  const postgresUrl = requiredValue("M12F_POSTGRES_URL");
  const m12xStateRoot = path.join(m12xRoot, "state");

  const workspaceRoot = await createDisposableProofWorkspace();
  const isolation = await createLiveProofIsolation();
  Object.assign(process.env, isolation.environment);
  const proofStateRoot = path.join(isolation.root, "m12z-recovery-state");
  const deliveryDir = path.join(proofStateRoot, "delivery");
  const replayDir = path.join(proofStateRoot, "replay");
  await Promise.all([
    mkdir(deliveryDir, { recursive: true }),
    mkdir(replayDir, { recursive: true }),
  ]);

  const initialGit = await captureGitSnapshot(workspaceRoot);
  if (!initialGit.available || initialGit.dirty) {
    fail("generated disposable workspace is not a clean Git repository");
  }

  const registry = new WorkspaceRegistry(isolation.registryPath);
  const workspace = await registerProofWorkspace(registry, workspaceRoot);
  const safetyPlans = new SafetyPlanService(registry);
  const proofComment = `// m12z-recovery-proof-${Date.now().toString(36)}`;
  const goal = [
    "Inspect src/demo.ts.",
    `Add exactly one standalone comment line: ${proofComment}`,
    "Do not modify any other file.",
    "Re-read src/demo.ts after the edit and report exactly what you changed.",
  ].join(" ");
  const preview = await safetyPlans.preview({
    workspaceId: workspace.workspaceId,
    goal,
    requestedScope: ["src/demo.ts"],
  });
  const started = await startApprovedTask(safetyPlans, preview.planToken);
  const store = new TaskStore(started.workspaceRoot);
  const task = await store.load(started.task.id);
  if (
    task.status !== "created"
    || (task.runCount ?? 0) !== 0
    || (task.sessionGeneration ?? 0) !== 0
    || Boolean(task.clineSessionId)
  ) {
    fail("approved disposable task was not persisted as fresh created state");
  }

  const registrationState = await loadRegistration(m12xStateRoot);
  const placementStore = new DistributedPlacementStore(proofStateRoot, registrationState.registrations);
  await placementStore.create({
    workspaceId: workspace.workspaceId,
    machineRegistrationId: registrationState.registrationId,
    expectedMachineRegistrationRevision: registrationState.revision,
  });

  const transport = new DistributedMachineTransportGateway(registrationState.registrations);
  const token = await issueLiveSession(transport, registrationState.registrationId);
  const candidateRouter = new DistributedCandidateRouter(
    placementStore,
    registrationState.registrations,
    transport,
  );
  const fenceBackend = new PostgresDistributedFenceBackend({
    poolConfig: { connectionString: postgresUrl },
  });
  await fenceBackend.initialize();
  const fenceAuthority = new DistributedFenceAuthority(fenceBackend, candidateRouter);

  try {
    const assignment = await candidateRouter.routeCandidate({
      taskId: task.id,
      workspaceId: workspace.workspaceId,
      ttlMs: CANDIDATE_TTL_MS,
    });
    const fence = await fenceAuthority.acquire({
      assignment,
      ttlMs: FENCE_TTL_MS,
    });
    const dispatch = createDistributedExecutionDispatch({
      assignment,
      fence,
      ttlMs: DISPATCH_TTL_MS,
    });

    const deliveryId = crypto.randomUUID();
    const deliveryState = new FileDistributedDeliveryStateStore(
      path.join(deliveryDir, "distributed-delivery-state.json"),
    );
    await deliveryState.create(createDistributedDeliveryStateRecord({
      deliveryId,
      dispatchId: dispatch.dispatchId,
      taskId: dispatch.taskId,
      workspaceId: dispatch.workspaceId,
      machineId: dispatch.machineId,
      machineRegistrationId: dispatch.machineRegistrationId,
      machineRegistrationRevision: dispatch.machineRegistrationRevision,
    }));
    await deliveryState.advance(deliveryId, "pending", "claimed");
    await deliveryState.advance(deliveryId, "claimed", "delivered_unconfirmed");

    const admission = new DistributedExecutionAdmissionGateway({
      targetIdentity: {
        machineId: registrationState.machineId,
        machineRegistrationId: registrationState.registrationId,
        machineRegistrationRevision: registrationState.revision,
      },
      registrations: registrationState.registrations,
      placements: placementStore,
      candidates: candidateRouter,
      fences: fenceAuthority,
      replayStore: new FileDistributedDispatchReplayStore(replayDir),
    });
    const receipt = await admission.admit(dispatch, assignment, fence);
    const unconfirmed = await deliveryState.get(deliveryId);
    const ack = createDistributedDeliveryAdmissionAcknowledgement(unconfirmed, receipt);
    const acknowledged = await deliveryState.acknowledge(deliveryId, ack);
    if (acknowledged.state !== "admission_acknowledged") {
      fail("stage 1 did not persist admission_acknowledged");
    }

    const stillFresh = await store.load(task.id);
    if (
      stillFresh.status !== "created"
      || (stillFresh.runCount ?? 0) !== 0
      || (stillFresh.sessionGeneration ?? 0) !== 0
      || Boolean(stillFresh.clineSessionId)
    ) {
      fail("stage 1 accidentally created runtime history");
    }

    const manifest: RecoveryProofManifestV1 = {
      schemaVersion: 1,
      workspaceRoot,
      isolationRoot: isolation.root,
      registryPath: isolation.registryPath,
      isolationEnvironment: isolation.environment,
      proofStateRoot,
      taskId: task.id,
      workspaceId: workspace.workspaceId,
      registrationId: registrationState.registrationId,
      registrationRevision: registrationState.revision,
      proofComment,
      envSha256: sha256(await readFile(path.join(workspaceRoot, ".env"))),
      outsideSha256: sha256(await readFile(path.join(workspaceRoot, "outside.txt"))),
      deliveryId,
      oldAssignment: assignment,
      oldFence: fence,
      oldDispatch: dispatch,
    };
    await writeManifest(manifest);

    process.stdout.write(`\n__ORCH_M12Z_I_STAGE1__${JSON.stringify({
      passed: true,
      state: acknowledged.state,
      runtimeHistoryCreated: false,
      processLocalHandoffCreated: false,
      dispatchId: dispatch.dispatchId,
      fenceId: fence.fenceId,
      fenceGeneration: fence.generation,
    })}\n`);
  } finally {
    transport.revokeSession(token);
    await fenceBackend.close();
  }
}

async function recoverStage(): Promise<void> {
  const preflight = await collectCr3Preflight();
  if (preflight.overall !== "ready") fail("Cline/provider live-proof preflight is not ready");

  const manifest = await readManifest();
  Object.assign(process.env, manifest.isolationEnvironment);

  const m12xRoot = requiredAbsoluteDirectory("ORCH_M12X_ROOT");
  const postgresUrl = requiredValue("M12F_POSTGRES_URL");
  const m12xStateRoot = path.join(m12xRoot, "state");
  const replayDir = path.join(manifest.proofStateRoot, "replay");
  const deliveryState = new FileDistributedDeliveryStateStore(
    path.join(manifest.proofStateRoot, "delivery", "distributed-delivery-state.json"),
  );

  const registry = new WorkspaceRegistry(manifest.registryPath);
  const workspace = await registry.resolveVerifiedWorkspace(manifest.workspaceId);
  if (workspace.canonicalRoot !== manifest.workspaceRoot) {
    fail("stage 2 registry resolved a different workspace root");
  }
  const store = new TaskStore(manifest.workspaceRoot);
  const task = await store.load(manifest.taskId);
  if (
    task.status !== "created"
    || (task.runCount ?? 0) !== 0
    || (task.sessionGeneration ?? 0) !== 0
    || Boolean(task.clineSessionId)
  ) {
    fail("stage 2 target task is no longer fresh before recovery classification");
  }

  const registrationState = await loadRegistration(m12xStateRoot);
  if (
    registrationState.registrationId !== manifest.registrationId
    || registrationState.revision !== manifest.registrationRevision
  ) {
    fail("machine registration changed between recovery proof stages");
  }
  const placementStore = new DistributedPlacementStore(
    manifest.proofStateRoot,
    registrationState.registrations,
  );
  const transport = new DistributedMachineTransportGateway(registrationState.registrations);
  const token = await issueLiveSession(transport, registrationState.registrationId);
  const candidateRouter = new DistributedCandidateRouter(
    placementStore,
    registrationState.registrations,
    transport,
  );
  const fenceBackend = new PostgresDistributedFenceBackend({
    poolConfig: { connectionString: postgresUrl },
  });
  await fenceBackend.initialize();
  const fenceAuthority = new DistributedFenceAuthority(fenceBackend, candidateRouter);

  let heartbeat: NodeJS.Timeout | undefined;
  let heartbeatTail: Promise<void> = Promise.resolve();
  let heartbeatError: unknown;
  let hubStarted = false;
  let proofPassed = false;

  const stopHeartbeat = async () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    await heartbeatTail.catch(() => undefined);
  };

  const revokeCurrentFence = async (): Promise<boolean> => {
    const current = await fenceBackend.read(manifest.workspaceId);
    if (!current?.activeFence) return false;
    await fenceAuthority.revoke(current.activeFence);
    return true;
  };

  try {
    const oldReplayRejected = !await new FileDistributedDispatchReplayStore(replayDir)
      .consume(manifest.oldDispatch.dispatchId, manifest.oldDispatch.expiresAt);
    if (!oldReplayRejected) fail("old stage-1 dispatch replay marker did not survive process restart");

    const record = await deliveryState.get(manifest.deliveryId);
    const decision = classifyDistributedTakeoverRecovery(
      record,
      {
        taskId: task.id,
        workspaceId: manifest.workspaceId,
        status: task.status,
        runCount: task.runCount ?? 0,
        sessionGeneration: task.sessionGeneration ?? 0,
        hasClineSessionId: Boolean(task.clineSessionId),
        hasPendingEscalation: Boolean(task.pendingEscalation),
      },
      { targetAckAvailable: true },
    );
    if (
      decision.disposition !== "fresh_authority_review_required"
      || decision.reason !== "admitted_without_runtime_history"
    ) {
      fail(`unexpected restart recovery classification: ${decision.disposition}/${decision.reason}`);
    }
    const proposal = createDistributedRecoveryProposal(decision, {
      proposalId: crypto.randomUUID(),
    });

    await fenceAuthority.revoke(manifest.oldFence);
    let oldFenceRejected = false;
    try {
      await fenceAuthority.validateCurrent(manifest.oldFence, manifest.oldAssignment);
    } catch {
      oldFenceRejected = true;
    }
    if (!oldFenceRejected) fail("old distributed fence remained valid after explicit recovery revocation");

    heartbeat = setInterval(() => {
      if (heartbeatError) return;
      heartbeatTail = heartbeatTail
        .then(async () => {
          await transport.reportStatus(
            token,
            crypto.randomUUID(),
            { status: "ready", acceptingWriterCandidates: true },
          );
        })
        .catch((error) => {
          heartbeatError = error;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = undefined;
        });
    }, 10_000);
    heartbeat.unref?.();

    const ownerInstanceId = crypto.randomUUID();
    const lockStore = new WorkspaceLockStore(path.join(manifest.proofStateRoot, "locks"));
    await mkdir(path.join(manifest.proofStateRoot, "locks"), { recursive: true });
    const loader = new RegisteredWorkspaceTargetTaskLoader(registry);

    let recoveredAssignmentId: string | undefined;
    let recoveredFenceId: string | undefined;
    let recoveredFenceGeneration: number | undefined;
    let recoveredDispatchId: string | undefined;
    let runtimeStatus: string | undefined;

    const scheduler = new WriterConcurrencyScheduler(
      lockStore,
      {
        schemaVersion: 1,
        maxActiveWriters: 1,
        maxStartsPerPass: 1,
        maxActiveWritersPerWorkspace: 1,
      },
      {
        async revalidateApprovedTask(taskId) {
          const authority = await revalidateAuthority(
            registry,
            store,
            taskId,
            ownerInstanceId,
          );
          return {
            taskId: authority.taskId,
            workspaceId: authority.workspaceId,
            ownerInstanceId: authority.ownerInstanceId,
          };
        },
        async runApprovedTask(taskId, lease) {
          const preexecution = await new DistributedRecoveryPreexecutionCoordinator({
            tasks: loader,
          }).verify(proposal);

          const assignment = await candidateRouter.routeCandidate({
            taskId,
            workspaceId: manifest.workspaceId,
            ttlMs: CANDIDATE_TTL_MS,
          });
          const fence = await fenceAuthority.acquire({
            assignment,
            ttlMs: FENCE_TTL_MS,
          });
          if (assignment.assignmentId === manifest.oldAssignment.assignmentId) {
            fail("recovery reused the old candidate assignment identity");
          }
          if (fence.fenceId === manifest.oldFence.fenceId) {
            fail("recovery reused the old distributed fence identity");
          }
          if (fence.generation <= manifest.oldFence.generation) {
            fail("recovery fence generation did not advance beyond the pre-restart fence");
          }

          const prepared = await new DistributedRecoveryReacquisitionPreparationCoordinator({
            candidateValidator: candidateRouter,
            fenceAuthority,
            lease,
          }).prepare(preexecution, assignment, fence);

          const dispatch = await new DistributedRecoveryDispatchCreationCoordinator({
            candidateValidator: candidateRouter,
            fenceAuthority,
            lease,
            dispatchTtlMs: DISPATCH_TTL_MS,
          }).create(prepared, assignment, fence);
          if (dispatch.dispatchId === manifest.oldDispatch.dispatchId) {
            fail("recovery reused the old dispatch identity");
          }

          const admission = new DistributedExecutionAdmissionGateway({
            targetIdentity: {
              machineId: registrationState.machineId,
              machineRegistrationId: registrationState.registrationId,
              machineRegistrationRevision: registrationState.revision,
            },
            registrations: registrationState.registrations,
            placements: placementStore,
            candidates: candidateRouter,
            fences: fenceAuthority,
            replayStore: new FileDistributedDispatchReplayStore(replayDir),
          });
          const receipt = await new DistributedRecoveryAdmissionBridge(admission)
            .admit(prepared, dispatch, assignment, fence);

          const authorityProvider = {
            async revalidateCurrent(currentTaskId: string) {
              return await revalidateAuthority(
                registry,
                store,
                currentTaskId,
                ownerInstanceId,
              );
            },
          };
          const handoff = new DistributedTargetRuntimeHandoffCoordinator({
            admission,
            tasks: loader,
            authorityProvider,
            lease,
            fenceAuthority,
          });
          const handoffContext = await new DistributedRecoveryTargetHandoffCoordinator({
            handoff,
            lease,
          }).prepare(prepared, dispatch, assignment, fence, receipt);

          const starter = new DistributedTargetRuntimeStarter({
            tasks: loader,
            resolveWorkerProfile: environmentWorkerProfileResolver(),
            baseRuntimeFactory: new SdkClineRuntimeFactory(),
          });
          hubStarted = true;
          const result = await new DistributedRecoveryRuntimeStartCoordinator({
            starter,
          }).start(prepared, handoffContext);
          if (heartbeatError) {
            throw new Error("M12C liveness heartbeat failed during recovery runtime", {
              cause: heartbeatError,
            });
          }
          if (result.status !== "completed") {
            fail(`recovery Cline run ended with ${result.status}: ${result.error ?? result.finishReason ?? "no detail"}`);
          }

          recoveredAssignmentId = assignment.assignmentId;
          recoveredFenceId = fence.fenceId;
          recoveredFenceGeneration = fence.generation;
          recoveredDispatchId = dispatch.dispatchId;
          runtimeStatus = result.status;
        },
      },
      {
        leaseMs: 60_000,
        heartbeatMs: 20_000,
      },
    );

    const summary = await scheduler.schedule([manifest.taskId]);
    if (
      summary.reservedTaskIds.length !== 1
      || summary.completedTaskIds.length !== 1
      || summary.completedTaskIds[0] !== manifest.taskId
      || summary.failures.length !== 0
    ) {
      fail("recovery writer scheduler did not complete exactly one fresh writer");
    }

    const finalTask = await store.load(manifest.taskId);
    if (finalTask.status !== "completed") {
      fail(`durable recovery task ended with ${finalTask.status}`);
    }
    const packet = createTaskCompletionPacket(
      finalTask,
      {
        taskId: finalTask.id,
        projectId: finalTask.projectId!,
        workspaceId: finalTask.workspaceId!,
      },
      { workspaceRoot: manifest.workspaceRoot },
    );
    if (
      packet.reviewState !== "ready_for_supervisor_review"
      || !packet.completionSignal.terminal
      || packet.workerCompletion?.trust !== "untrusted_worker_claims"
      || packet.independentEvidence.diffSafety.available !== true
      || packet.independentEvidence.diffSafety.passed !== true
      || packet.independentEvidence.diffSafety.changedFiles !== 1
      || !packet.independentEvidence.checkpoint.available
    ) {
      fail("recovery completion packet lacks trusted one-file diff/checkpoint evidence");
    }

    await execFile("git", ["-C", manifest.workspaceRoot, "diff", "--check"], {
      windowsHide: true,
    });
    const demo = await readFile(path.join(manifest.workspaceRoot, "src", "demo.ts"), "utf8");
    if (demo.split(/\r?\n/).filter((line) => line === manifest.proofComment).length !== 1) {
      fail("src/demo.ts does not contain exactly one approved recovery proof marker");
    }
    if (
      sha256(await readFile(path.join(manifest.workspaceRoot, ".env"))) !== manifest.envSha256
      || sha256(await readFile(path.join(manifest.workspaceRoot, "outside.txt"))) !== manifest.outsideSha256
    ) {
      fail("a protected proof file changed during recovery");
    }
    const changed = (await git(manifest.workspaceRoot, "status", "--porcelain"))
      .split(/\r?\n/)
      .filter(Boolean);
    const userChanges = changed.filter((line) => {
      const candidate = line.slice(3).replace(/\\/g, "/");
      return candidate !== ".orchestrator" && !candidate.startsWith(".orchestrator/");
    });
    if (userChanges.length !== 1 || !userChanges[0]!.endsWith("src/demo.ts")) {
      fail("recovery workspace contains changes outside the single approved proof file");
    }

    const currentFenceRevoked = await revokeCurrentFence();
    await stopHeartbeat();
    transport.revokeSession(token);

    const proofResult = {
      schemaVersion: 1,
      proof: "m12z-fresh-authority-recovery",
      passed: true,
      restartBoundary: {
        separateNodeProcesses: true,
        stage1State: record.state,
        oldDispatchReplayMarkerSurvived: oldReplayRejected,
        oldFenceRejectedAfterRecoveryRevocation: oldFenceRejected,
        priorRuntimeHistoryPresent: false,
      },
      classification: {
        disposition: decision.disposition,
        reason: decision.reason,
        automaticTakeoverAllowed: decision.automaticTakeoverAllowed,
        automaticWorkRetryAllowed: decision.automaticWorkRetryAllowed,
        automaticWorkRequeueAllowed: decision.automaticWorkRequeueAllowed,
      },
      freshAuthority: {
        proposalCreated: true,
        candidateChanged: recoveredAssignmentId !== manifest.oldAssignment.assignmentId,
        fenceChanged: recoveredFenceId !== manifest.oldFence.fenceId,
        fenceGenerationAdvanced: (recoveredFenceGeneration ?? 0) > manifest.oldFence.generation,
        dispatchChanged: recoveredDispatchId !== manifest.oldDispatch.dispatchId,
        freshLocalWriterLease: "scheduler_owned",
        freshAdmission: true,
        targetLocalHandoffReentered: true,
      },
      execution: {
        realClineWriterStarted: true,
        taskStatus: runtimeStatus,
        changedFiles: packet.independentEvidence.diffSafety.changedFiles,
        diffSafetyPassed: packet.independentEvidence.diffSafety.passed,
        independentGitDiffCheckPassed: true,
        workerReportTrust: packet.workerCompletion?.trust,
      },
      safety: {
        approvedWriteScope: ["src/demo.ts"],
        protectedFilesUntouched: true,
        staleSessionResumeUsed: false,
        workRetryUsed: false,
        workRequeueUsed: false,
        commitCreated: false,
        pushUsed: false,
        mergeUsed: false,
        deployUsed: false,
        publicNetworkExposureUsed: false,
        networkListenerUsed: false,
      },
      cleanup: {
        distributedFenceRevoked: currentFenceRevoked,
        localWriterLeaseReleasedByScheduler: true,
      },
    };

    if (hubStarted) {
      await stopLiveProofHubGracefully();
      hubStarted = false;
    }
    await fenceBackend.close();
    await removeDisposableProofRoot(manifest.workspaceRoot);
    await removeDisposableProofRoot(manifest.isolationRoot);
    await rm(proofRoot(), { recursive: true, force: true });
    proofPassed = true;
    process.stdout.write(`\n__ORCH_M12Z_I_RECOVERY_PROOF__${JSON.stringify(proofResult)}\n`);
  } finally {
    if (!proofPassed) {
      await stopHeartbeat().catch(() => undefined);
      try { transport.revokeSession(token); } catch { /* best effort */ }
      await revokeCurrentFence().catch(() => false);
      await fenceBackend.close().catch(() => undefined);
      if (hubStarted) await stopLiveProofHubGracefully().catch(() => undefined);
      process.stderr.write("[M12Z-I recovery proof failure artifacts preserved for inspection]\n");
    }
  }
}

async function main(): Promise<void> {
  assertLiveProofOptIn();
  if (proofStage() === "prepare") {
    await prepareStage();
  } else {
    await recoverStage();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[M12Z-I recovery proof failed: ${error instanceof Error ? error.message : String(error)}]\n`,
  );
  process.exitCode = 1;
});
