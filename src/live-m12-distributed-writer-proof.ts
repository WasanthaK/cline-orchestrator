import crypto, { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  preserveLiveProofFailure,
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
import { FileDistributedMachineAuthenticationBindingStore } from "./distributed-machine-auth-binding-store.js";
import { DistributedMachineTransportGateway } from "./distributed-machine-transport.js";
import { DistributedMachineAuthenticationBootstrap } from "./distributed-machine-auth-bootstrap.js";
import { DistributedCandidateRouter } from "./distributed-candidate-router.js";
import { PostgresDistributedFenceBackend } from "./distributed-fencing-postgres.js";
import { DistributedFenceAuthority } from "./distributed-fencing.js";
import {
  createDistributedExecutionDispatch,
  DistributedExecutionAdmissionGateway,
  FileDistributedDispatchReplayStore,
} from "./distributed-execution-admission.js";
import { createDistributedWriterFenceGuard } from "./distributed-write-fence-guard.js";
import { DistributedTargetRuntimeHandoffCoordinator } from "./distributed-target-runtime-handoff.js";
import { DistributedTargetRuntimeStarter } from "./distributed-target-runtime-start.js";
import {
  DistributedExecutionPullDeliveryController,
  DistributedTargetExecutionDeliveryReceiver,
} from "./distributed-execution-delivery.js";
import {
  DistributedControllerPendingWorkSelector,
  ReferenceControllerPendingWorkQueue,
  createDistributedControllerPendingWorkItem,
} from "./distributed-controller-pending-work.js";
import {
  FileDistributedDeliveryAdmissionAcknowledgementOutbox,
  FileDistributedDeliveryStateStore,
} from "./distributed-delivery-reconciliation.js";
import {
  createUnboundDistributedSharedHttpsServer,
} from "./distributed-shared-unbound-https.js";
import {
  DistributedListenerActivationController,
  DistributedListenerActivationPermitIssuer,
  createDistributedListenerBindingConfig,
  loadDistributedLocalTlsIdentity,
} from "./distributed-deployment-listener.js";
import { DistributedNetworkMachineAuthClient } from "./distributed-network-machine-auth-client.js";
import { DistributedSecureTargetPullClient } from "./distributed-secure-target-pull-client.js";
import { DistributedDeliveryAckClient } from "./distributed-delivery-ack-transport.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";

const execFile = promisify(execFileCallback);
const CONTROLLER_ORIGIN = "https://localhost:8443";
const CONTROLLER_HOST = "127.0.0.1";
const CONTROLLER_PORT = 8443;
const SESSION_TTL_MS = 5 * 60_000;
const CANDIDATE_TTL_MS = 2 * 60_000;
const FENCE_TTL_MS = 60_000;
const DISPATCH_TTL_MS = 30_000;

function fail(message: string): never {
  throw new Error(`M12 distributed writer proof refused: ${message}`);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trimEnd();
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

async function registerProofWorkspace(
  registry: WorkspaceRegistry,
  workspaceRoot: string,
): Promise<RegisteredWorkspace> {
  const project = await registry.registerProject("M12 Distributed Writer Proof");
  const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "M12 Disposable Distributed Writer Workspace",
    root: workspaceRoot,
    safetyProfile: {
      policyVersion: "m12-distributed-writer-proof-v1",
      allowedPathPatterns: ["src/demo.ts"],
      protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
      validationCommands: [],
      workerProfileId,
      maxChangedFiles: 1,
    },
  });
  assertDisposableWorkspaceRoot(workspace.canonicalRoot);
  if (
    workspace.safetyProfile.allowedPathPatterns.length !== 1
    || workspace.safetyProfile.allowedPathPatterns[0] !== "src/demo.ts"
    || workspace.safetyProfile.maxChangedFiles !== 1
  ) {
    fail("proof Safety Plan widened beyond src/demo.ts");
  }
  return workspace;
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

function profileFromCertificate(certificatePem: string | Buffer): DistributedSecureTransportProfileV1 {
  const certificate = new X509Certificate(certificatePem);
  const exported = certificate.publicKey.export({ format: "der", type: "spki" });
  const spki = Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
  const pin = `sha256/${createHash("sha256").update(spki).digest("base64")}`;
  return {
    schemaVersion: 1,
    profileId: crypto.randomUUID(),
    controllerOrigin: CONTROLLER_ORIGIN,
    serverSpkiSha256Pins: [pin],
    connectTimeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    serverAuthentication: "system_ca_plus_spki_sha256_pin",
    authority: "transport_configuration_only",
    networkIoEnabled: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
  };
}

async function closeServer(server: import("node:https").Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function main(): Promise<void> {
  assertLiveProofOptIn();

  const preflight = await collectCr3Preflight();
  if (preflight.overall !== "ready") {
    fail("Cline/provider live-proof preflight is not ready");
  }

  const m12xRoot = requiredAbsoluteDirectory("ORCH_M12X_ROOT");
  const postgresUrl = requiredValue("M12F_POSTGRES_URL");
  const m12xStateRoot = path.join(m12xRoot, "state");
  const tlsKeyPath = path.join(m12xRoot, "tls", "controller-localhost.key.pem");
  const tlsCertPath = path.join(m12xRoot, "tls", "controller-localhost.cert.pem");
  const signerKeyPath = path.join(m12xRoot, "identity", "target-ed25519.key.pem");
  const bindingPath = path.join(
    m12xStateRoot,
    "distributed-control",
    "machine-auth-bindings.json",
  );

  const workspaceRoot = await createDisposableProofWorkspace();
  const isolation = await createLiveProofIsolation();
  Object.assign(process.env, isolation.environment);
  const proofStateRoot = path.join(isolation.root, "m12-distributed-state");
  const deliveryStateDir = path.join(proofStateRoot, "delivery");
  const ackOutboxDir = path.join(proofStateRoot, "ack");
  const replayDir = path.join(proofStateRoot, "replay");
  const lockRoot = path.join(proofStateRoot, "locks");
  await Promise.all([
    mkdir(deliveryStateDir, { recursive: true }),
    mkdir(ackOutboxDir, { recursive: true }),
    mkdir(replayDir, { recursive: true }),
    mkdir(lockRoot, { recursive: true }),
  ]);

  const initialGit = await captureGitSnapshot(workspaceRoot);
  if (!initialGit.available || initialGit.dirty) {
    fail("generated disposable workspace is not a clean Git repository");
  }

  const envPath = path.join(workspaceRoot, ".env");
  const outsidePath = path.join(workspaceRoot, "outside.txt");
  const demoPath = path.join(workspaceRoot, "src", "demo.ts");
  const beforeEnv = await readFile(envPath, "utf8");
  const beforeOutside = await readFile(outsidePath, "utf8");

  const registry = new WorkspaceRegistry(isolation.registryPath);
  const workspace = await registerProofWorkspace(registry, workspaceRoot);
  const safetyPlans = new SafetyPlanService(registry);
  const marker = Date.now().toString(36);
  const proofComment = `// m12-distributed-writer-proof-${marker}`;
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
  if (task.status !== "created" || (task.runCount ?? 0) !== 0) {
    fail("approved disposable task was not persisted as fresh created state");
  }

  const registrations = new DistributedRegistrationStore(m12xStateRoot);
  const activeRegistrations = (await registrations.list()).filter((item) => !item.revokedAt);
  if (activeRegistrations.length !== 1) {
    fail("M12X state must contain exactly one active machine registration");
  }
  const registration = activeRegistrations[0]!;
  if (
    !registration.allowedCapabilities.includes("accept_writer_candidates")
    || !registration.allowedCapabilities.includes("report_status")
  ) {
    fail("M12X registration lacks required proof capabilities");
  }

  const bindings = new FileDistributedMachineAuthenticationBindingStore(bindingPath);
  const binding = await bindings.get(registration.registrationId);
  if (
    binding.machineId !== registration.machineId
    || binding.registrationRevision !== registration.revision
  ) {
    fail("M12X machine-auth binding is stale");
  }

  const signerRaw = await readFile(signerKeyPath);
  let signerPrivateKey;
  try {
    signerPrivateKey = createPrivateKey(signerRaw);
  } finally {
    signerRaw.fill(0);
  }
  const signerPublicDer = createPublicKey(signerPrivateKey).export({
    format: "der",
    type: "spki",
  });
  const signerFingerprint = `sha256/${createHash("sha256")
    .update(Buffer.isBuffer(signerPublicDer) ? signerPublicDer : Buffer.from(signerPublicDer))
    .digest("base64")}`;
  if (signerFingerprint !== binding.publicKeyFingerprint) {
    fail("local Ed25519 signer does not match the enrolled M12X binding");
  }

  const tlsIdentity = await loadDistributedLocalTlsIdentity({
    schemaVersion: 1,
    privateKeyPath: tlsKeyPath,
    certificateChainPath: tlsCertPath,
    authority: "local_deployment_configuration_only",
    grantsCredentialAuthority: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsSafetyPlanAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsReleaseAuthority: false,
  });
  const profile = profileFromCertificate(tlsIdentity.certificates[0]!);

  const placementStore = new DistributedPlacementStore(proofStateRoot, registrations);
  const placement = await placementStore.create({
    workspaceId: workspace.workspaceId,
    machineRegistrationId: registration.registrationId,
    expectedMachineRegistrationRevision: registration.revision,
  });

  const transport = new DistributedMachineTransportGateway(registrations);
  const bootstrap = new DistributedMachineAuthenticationBootstrap(
    registrations,
    bindings,
    transport,
  );
  const candidateRouter = new DistributedCandidateRouter(
    placementStore,
    registrations,
    transport,
  );

  const fenceBackend = new PostgresDistributedFenceBackend({
    poolConfig: { connectionString: postgresUrl },
  });
  await fenceBackend.initialize();
  const fenceAuthority = new DistributedFenceAuthority(fenceBackend, candidateRouter);

  const deliveryState = new FileDistributedDeliveryStateStore(
    path.join(deliveryStateDir, "distributed-delivery-state.json"),
  );
  const ackOutbox = new FileDistributedDeliveryAdmissionAcknowledgementOutbox(
    path.join(ackOutboxDir, "distributed-delivery-ack-outbox.json"),
  );
  const queue = new ReferenceControllerPendingWorkQueue();
  const deliveryController = new DistributedExecutionPullDeliveryController(transport);
  const selector = new DistributedControllerPendingWorkSelector({
    transport,
    pendingWork: queue,
    candidates: candidateRouter,
    fences: fenceAuthority,
    delivery: deliveryController,
    deliveryState,
  });

  const shared = createUnboundDistributedSharedHttpsServer({
    profile,
    selector,
    bootstrap,
    ackAuthorizer: transport,
    ackStateStore: deliveryState,
    tlsIdentityProvider: () => tlsIdentity,
  });
  const bindConfig = createDistributedListenerBindingConfig(profile, {
    bindAddress: CONTROLLER_HOST,
    port: CONTROLLER_PORT,
    exposure: "loopback",
  });
  const permits = new DistributedListenerActivationPermitIssuer();
  const activation = new DistributedListenerActivationController(permits);
  const permit = permits.issue(bindConfig, shared.preflight);
  const activationReceipt = await activation.activate({
    server: shared.server,
    bindConfig,
    preflight: shared.preflight,
    permit,
  });
  if (!activationReceipt.listening) fail("production loopback listener did not activate");

  const authClient = new DistributedNetworkMachineAuthClient();
  let issueResult;
  let hubMayHaveStarted = false;
  let proofPassed = false;
  let proofError: unknown;
  let fenceGuard: ReturnType<typeof createDistributedWriterFenceGuard> | undefined;

  try {
    issueResult = await authClient.bootstrapSession({
      profile,
      registrationId: registration.registrationId,
      capabilities: ["accept_writer_candidates", "report_status"],
      sessionTtlMs: SESSION_TTL_MS,
      signer: {
        publicKeyFingerprint: signerFingerprint,
        async sign(payload: Buffer) {
          return crypto.sign(null, payload, signerPrivateKey);
        },
      },
    });

    await transport.reportStatus(
      issueResult.token,
      crypto.randomUUID(),
      { status: "ready", acceptingWriterCandidates: true },
    );

    const ownerInstanceId = crypto.randomUUID();
    const lockStore = new WorkspaceLockStore(lockRoot);
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
          const candidate = await candidateRouter.routeCandidate({
            taskId,
            workspaceId: workspace.workspaceId,
            ttlMs: CANDIDATE_TTL_MS,
          });
          const fence = await fenceAuthority.acquire({
            assignment: candidate,
            ttlMs: FENCE_TTL_MS,
          });
          fenceGuard = createDistributedWriterFenceGuard(
            fenceAuthority,
            fence,
            candidate,
          );
          const dispatch = createDistributedExecutionDispatch({
            assignment: candidate,
            fence,
            ttlMs: DISPATCH_TTL_MS,
          });
          queue.enqueue(createDistributedControllerPendingWorkItem({
            dispatch,
            assignment: candidate,
            fence,
          }));

          const admission = new DistributedExecutionAdmissionGateway({
            targetIdentity: {
              machineId: registration.machineId,
              machineRegistrationId: registration.registrationId,
              machineRegistrationRevision: registration.revision,
            },
            registrations,
            placements: placementStore,
            candidates: candidateRouter,
            fences: fenceAuthority,
            replayStore: new FileDistributedDispatchReplayStore(replayDir),
          });
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
            tasks: {
              async loadCurrent(currentTaskId, workspaceId) {
                const current = await store.load(currentTaskId);
                if (current.workspaceId !== workspaceId) {
                  fail("target task loader observed a cross-workspace task");
                }
                return current;
              },
            },
            authorityProvider,
            lease,
            fenceAuthority,
          });
          const starter = new DistributedTargetRuntimeStarter({
            tasks: {
              async loadCurrent(currentTaskId, workspaceId) {
                const current = await store.load(currentTaskId);
                if (current.workspaceId !== workspaceId) {
                  fail("target runtime loader observed a cross-workspace task");
                }
                return current;
              },
            },
            resolveWorkerProfile: environmentWorkerProfileResolver(),
            baseRuntimeFactory: new SdkClineRuntimeFactory(),
          });
          const receiver = new DistributedTargetExecutionDeliveryReceiver({
            targetIdentity: {
              machineId: registration.machineId,
              machineRegistrationId: registration.registrationId,
              machineRegistrationRevision: registration.revision,
            },
            handoff,
            admissionAcknowledgements: ackOutbox,
            starter,
          });

          const pullClient = new DistributedSecureTargetPullClient();
          const bundle = await pullClient.pull({
            profile,
            bearerToken: issueResult!.token,
            requestId: crypto.randomUUID(),
          });
          if (!bundle) fail("authenticated pull returned no work after controller enqueue");
          if (bundle.dispatch.dispatchId !== dispatch.dispatchId) {
            fail("target received a different dispatch than controller enqueued");
          }
          const unconfirmed = await deliveryState.get(bundle.deliveryId);
          if (unconfirmed.state !== "delivered_unconfirmed") {
            fail("controller did not persist delivered_unconfirmed before bundle return");
          }

          hubMayHaveStarted = true;
          const result = await receiver.execute(bundle);
          if (result.status !== "completed") {
            fail(`distributed Cline run ended with ${result.status}: ${result.error ?? result.finishReason ?? "no detail"}`);
          }

          const ack = await ackOutbox.getByDeliveryId(bundle.deliveryId);
          const ackClient = new DistributedDeliveryAckClient();
          await ackClient.upload({
            profile,
            bearerToken: issueResult!.token,
            requestId: crypto.randomUUID(),
            acknowledgement: ack,
          });
          const reconciled = await deliveryState.get(bundle.deliveryId);
          if (reconciled.state !== "admission_acknowledged") {
            fail("controller did not reconcile durable target admission acknowledgement");
          }
        },
      },
      {
        leaseMs: 60_000,
        heartbeatMs: 20_000,
      },
    );

    const summary = await scheduler.schedule([task.id]);
    if (
      summary.reservedTaskIds.length !== 1
      || summary.reservedTaskIds[0] !== task.id
      || summary.completedTaskIds.length !== 1
      || summary.completedTaskIds[0] !== task.id
      || summary.failures.length !== 0
    ) {
      fail("writer scheduler did not complete exactly one disposable distributed writer");
    }

    const finalTask = await store.load(task.id);
    if (finalTask.status !== "completed") {
      fail(`durable task ended with ${finalTask.status}`);
    }
    const packet = createTaskCompletionPacket(
      finalTask,
      {
        taskId: finalTask.id,
        projectId: finalTask.projectId!,
        workspaceId: finalTask.workspaceId!,
      },
      { workspaceRoot },
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
      fail("completion packet lacks trusted one-file diff/checkpoint evidence");
    }

    await execFile("git", ["-C", workspaceRoot, "diff", "--check"], {
      windowsHide: true,
    });
    const finalDemo = await readFile(demoPath, "utf8");
    const afterEnv = await readFile(envPath, "utf8");
    const afterOutside = await readFile(outsidePath, "utf8");
    if (finalDemo.split(/\r?\n/).filter((line) => line === proofComment).length !== 1) {
      fail("src/demo.ts does not contain exactly one approved proof marker");
    }
    if (afterEnv !== beforeEnv || afterOutside !== beforeOutside) {
      fail("a protected proof file changed");
    }
    const changed = (await git(workspaceRoot, "status", "--porcelain"))
      .split(/\r?\n/)
      .filter(Boolean);
    if (changed.length !== 1 || !changed[0]!.endsWith("src/demo.ts")) {
      fail("workspace contains changes outside the single approved proof file");
    }

    if (fenceGuard) {
      await fenceAuthority.revoke(fenceGuard.currentClaim());
      fenceGuard = undefined;
    }
    transport.revokeSession(issueResult.token);

    const proofResult = {
      schemaVersion: 1,
      proof: "m12-first-real-distributed-writer",
      passed: true,
      transport: {
        origin: CONTROLLER_ORIGIN,
        bind: `${CONTROLLER_HOST}:${CONTROLLER_PORT}`,
        tlsAndSpkiVerifiedByClients: true,
        authenticatedMachineIdentity: true,
      },
      authority: {
        safetyPlanBoundTask: true,
        localWriterLease: "scheduler_owned",
        distributedFence: "postgresql",
        controllerSelectedWork: true,
        durableReplayAdmission: true,
      },
      execution: {
        realClineWriterStarted: true,
        taskStatus: finalTask.status,
        changedFiles: packet.independentEvidence.diffSafety.changedFiles,
        diffSafetyPassed: packet.independentEvidence.diffSafety.passed,
        independentGitDiffCheckPassed: true,
        workerReportTrust: packet.workerCompletion?.trust,
      },
      reconciliation: {
        targetAckPersistedBeforeRuntimeStart: true,
        controllerState: "admission_acknowledged",
        workRetryUsed: false,
        workRequeueUsed: false,
      },
      safety: {
        approvedWriteScope: ["src/demo.ts"],
        protectedFilesUntouched: true,
        commitCreated: false,
        pushUsed: false,
        mergeUsed: false,
        deployUsed: false,
        publicNetworkExposureUsed: false,
      },
      cleanup: {
        distributedFenceRevoked: true,
        localWriterLeaseReleasedByScheduler: true,
      },
    };

    await closeServer(shared.server);
    await fenceBackend.close();
    if (hubMayHaveStarted) {
      await stopLiveProofHubGracefully();
      hubMayHaveStarted = false;
    }
    await removeDisposableProofRoot(workspaceRoot);
    await removeDisposableProofRoot(isolation.root);
    proofPassed = true;
    process.stdout.write(`\n__ORCH_M12_DISTRIBUTED_WRITER_PROOF__${JSON.stringify(proofResult)}\n`);
  } catch (error) {
    proofError = error;
    throw error;
  } finally {
    if (!proofPassed) {
      try {
        if (fenceGuard) {
          await fenceAuthority.revoke(fenceGuard.currentClaim()).catch(() => undefined);
          fenceGuard = undefined;
        }
        if (issueResult?.token) {
          try { transport.revokeSession(issueResult.token); } catch { /* ignore cleanup race */ }
        }
        await closeServer(shared.server).catch(() => undefined);
        await fenceBackend.close().catch(() => undefined);
        if (hubMayHaveStarted) await stopLiveProofHubGracefully();
        process.stderr.write("[M12 distributed writer proof failure artifacts preserved in disposable roots]\n");
      } catch (cleanupError) {
        preserveLiveProofFailure(proofError, cleanupError);
      }
    }
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[M12 distributed writer proof failed: ${error instanceof Error ? error.message : String(error)}]\n`,
  );
  process.exitCode = 1;
});
