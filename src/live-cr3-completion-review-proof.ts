import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { collectCr3Preflight } from "./cr3-preflight.js";
import { captureGitSnapshot } from "./git-state.js";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  preserveLiveProofFailure,
  removeDisposableProofRoot,
  stopLiveProofHubGracefully,
} from "./live-proof-isolation.js";
import { RestartAwareMachineOrchestratorService } from "./machine-recovery.js";
import { environmentWorkerProfileResolver } from "./mcp-main.js";
import { SafetyPlanService } from "./safety-plan.js";
import {
  SupervisorCompletionReviewService,
  SupervisorCompletionReviewStore,
} from "./supervisor-completion-review.js";
import type {
  SupervisorReviewerModel,
  SupervisorReviewerModelRequest,
} from "./supervisor-reviewer.js";
import { createSupervisorTask } from "./supervisor-task.js";
import { getTaskCompletionPacket, type TaskCompletionPacketV1 } from "./task-completion-packet.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceRegistry, type RegisteredWorkspace } from "./workspace-registry.js";

const TERMINAL_STATUSES = new Set<OrchestratorTask["status"]>([
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
]);

export const CR3_PROOF_REVIEWER_KIND = "deterministic_local_proof" as const;

function fail(message: string): never {
  throw new Error(`CR3 completion-review proof refused: ${message}`);
}

export function assertCr3ReviewerPrompt(prompt: string): void {
  for (const required of [
    "# Cline Completion Packet Context v1",
    "<cline_completion_packet_data>",
    '"trust": "untrusted_worker_claims"',
    '"independentEvidence"',
    "Independently captured orchestrator evidence is authoritative",
    "Pass is advisory only",
  ]) {
    if (!prompt.includes(required)) {
      fail(`reviewer prompt is missing required completion-review boundary: ${required}`);
    }
  }
}

/**
 * CR3 deliberately uses a deterministic reviewer so the physical proof can force
 * exactly one bounded correction without granting an external model any new local
 * authority. This proves the CR2 admission/handoff path, not remote ChatGPT
 * transport or model quality.
 */
export class Cr3DeterministicReviewer implements SupervisorReviewerModel {
  private reviewCountValue = 0;

  constructor(private readonly repairInstruction: string) {}

  get reviewCount(): number {
    return this.reviewCountValue;
  }

  async review(request: SupervisorReviewerModelRequest): Promise<unknown> {
    assertCr3ReviewerPrompt(request.prompt);
    this.reviewCountValue += 1;

    if (this.reviewCountValue === 1) {
      return {
        schemaVersion: 1,
        supervisorTaskId: request.supervisorTaskId,
        taskId: request.taskId,
        decision: "repair",
        summary: "CR3 deterministic reviewer requests one bounded in-scope correction to prove the trusted repair handoff.",
        repairInstruction: this.repairInstruction,
        completionAuthority: "advisory_only",
      };
    }

    if (this.reviewCountValue === 2) {
      return {
        schemaVersion: 1,
        supervisorTaskId: request.supervisorTaskId,
        taskId: request.taskId,
        decision: "pass",
        summary: "CR3 deterministic reviewer observed independently passing validation, diff safety, and checkpoint evidence after the bounded repair.",
        completionAuthority: "advisory_only",
      };
    }

    fail("deterministic reviewer was invoked more than twice");
  }
}

function assertPacketReady(packet: TaskCompletionPacketV1, phase: string): void {
  if (packet.status !== "completed" || packet.reviewState !== "ready_for_supervisor_review") {
    fail(`${phase} completion packet is not a completed reviewable task`);
  }
  if (
    !packet.completionSignal.terminal
    || !packet.completionSignal.workerReportAvailable
    || packet.workerCompletion?.source !== "cline_result"
    || packet.workerCompletion?.trust !== "untrusted_worker_claims"
    || !packet.workerCompletion.report.trim()
  ) {
    fail(`${phase} completion packet did not preserve the natural Cline completion report as untrusted worker testimony`);
  }
  if (
    packet.independentEvidence.validation.available !== true
    || packet.independentEvidence.validation.passed !== true
  ) {
    fail(`${phase} completion packet is missing passing orchestrator validation evidence`);
  }
  if (
    packet.independentEvidence.diffSafety.available !== true
    || packet.independentEvidence.diffSafety.passed !== true
    || packet.independentEvidence.diffSafety.changedFiles !== 1
  ) {
    fail(`${phase} completion packet is missing one-file passing diff-safety evidence`);
  }
  if (!packet.independentEvidence.checkpoint.available || packet.independentEvidence.checkpoint.restored) {
    fail(`${phase} completion packet does not have a usable rollback checkpoint`);
  }
}

async function waitForTerminal(
  service: RestartAwareMachineOrchestratorService,
  taskId: string,
  phase: string,
  timeoutMs = 360_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await service.getTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return task;
    await sleep(250);
  }
  fail(`${phase} Cline run did not reach a terminal state within ${timeoutMs}ms`);
}

async function registerProofWorkspace(
  registry: WorkspaceRegistry,
  workspaceRoot: string,
): Promise<RegisteredWorkspace> {
  const project = await registry.registerProject("CR3 Completion Review Proof");
  const workerProfileId = (process.env.ORCH_WORKER_PROFILE_ID ?? "default").trim() || "default";
  const workspace = await registry.registerWorkspace({
    projectId: project.projectId,
    displayName: "CR3 Disposable Completion Review Workspace",
    root: workspaceRoot,
    safetyProfile: {
      policyVersion: "cr3-completion-review-proof-v1",
      allowedPathPatterns: ["src/demo.ts"],
      protectedPathPatterns: [".env*", "outside.txt", ".git/**"],
      validationCommands: ["git diff --check"],
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
    fail("disposable workspace safety profile widened beyond src/demo.ts");
  }
  return workspace;
}

function countLine(text: string, line: string): number {
  return text.split(/\r?\n/).filter((item) => item === line).length;
}

async function main(): Promise<void> {
  assertLiveProofOptIn();

  const preflight = await collectCr3Preflight();
  if (preflight.overall !== "ready") {
    fail("read-only CR3 preflight is no longer ready; run npm run cr3:preflight and resolve blockers first");
  }

  const workspaceRoot = await createDisposableProofWorkspace();
  const initialGit = await captureGitSnapshot(workspaceRoot);
  if (!initialGit.available || initialGit.dirty) {
    fail("generated disposable proof workspace is not a clean Git repository");
  }

  const isolation = await createLiveProofIsolation();
  Object.assign(process.env, isolation.environment);

  const registry = new WorkspaceRegistry(isolation.registryPath);
  const workspace = await registerProofWorkspace(registry, workspaceRoot);
  const store = new TaskStore(workspace.canonicalRoot);
  const demoPath = path.join(workspace.canonicalRoot, "src", "demo.ts");
  const envPath = path.join(workspace.canonicalRoot, ".env");
  const outsidePath = path.join(workspace.canonicalRoot, "outside.txt");
  const beforeEnv = await readFile(envPath, "utf8");
  const beforeOutside = await readFile(outsidePath, "utf8");

  const marker = Date.now().toString(36);
  const initialComment = `// cr3-worker-initial-${marker}`;
  const reviewedComment = `// cr3-supervisor-reviewed-${marker}`;
  const goal = [
    "Inspect src/demo.ts.",
    `Ensure src/demo.ts contains exactly one standalone comment line: ${initialComment}`,
    "Do not modify any other file.",
    "Re-read src/demo.ts after the edit and report exactly what you changed and what you verified.",
  ].join(" ");
  const repairInstruction = [
    "This is a bounded supervisor correction inside the existing approved scope.",
    `In src/demo.ts only, replace the standalone line '${initialComment}' with exactly '${reviewedComment}'.`,
    "Do not modify any other file or change the task authority, validation command, or protected paths.",
    "Re-read src/demo.ts and report completion.",
  ].join(" ");

  const safetyPlans = new SafetyPlanService(registry);
  let service: RestartAwareMachineOrchestratorService | undefined =
    new RestartAwareMachineOrchestratorService(
      registry,
      safetyPlans,
      environmentWorkerProfileResolver(),
    );
  let hubMayHaveStarted = false;
  let proofError: unknown;
  let proofPassed = false;

  try {
    const preview = await service.previewTask({
      workspaceId: workspace.workspaceId,
      goal,
      requestedScope: ["src/demo.ts"],
    });
    const started = await service.startTask(preview.planToken);
    hubMayHaveStarted = true;

    const first = await waitForTerminal(service, started.taskId, "initial");
    if (first.status !== "completed") {
      fail(`initial Cline run ended with ${first.status}: ${first.error ?? first.finishReason ?? "no detail"}`);
    }
    if (first.runCount < 1 || first.sessionGeneration < 1) {
      fail("initial Cline run completed without durable run/session evidence");
    }

    const firstPacket = await getTaskCompletionPacket(service, started.taskId);
    assertPacketReady(firstPacket, "initial");

    const rawFirst = await store.load(started.taskId);
    const supervisor = createSupervisorTask(rawFirst);
    const reviewer = new Cr3DeterministicReviewer(repairInstruction);
    const reviewService = new SupervisorCompletionReviewService(service, reviewer);

    const firstReview = await reviewService.review(supervisor);
    if (
      firstReview.outcome !== "repair_queued"
      || firstReview.reviewerResult.decision !== "repair"
      || firstReview.reviewerResult.completionAuthority !== "advisory_only"
    ) {
      fail("first supervisor review did not admit exactly one advisory bounded repair");
    }

    const second = await waitForTerminal(service, started.taskId, "repair");
    if (second.status !== "completed") {
      fail(`bounded Cline repair ended with ${second.status}: ${second.error ?? second.finishReason ?? "no detail"}`);
    }
    if (second.runCount < 2) {
      fail("bounded reviewer correction did not create a second Cline run");
    }

    const secondPacket = await getTaskCompletionPacket(service, started.taskId);
    assertPacketReady(secondPacket, "repaired");
    if (secondPacket.independentEvidence.recovery.runCount < 2) {
      fail("second completion packet did not capture the incremented runtime run count");
    }

    const secondReview = await reviewService.review(supervisor);
    if (
      secondReview.outcome !== "pass_recorded"
      || secondReview.reviewerResult.decision !== "pass"
      || secondReview.reviewerResult.completionAuthority !== "advisory_only"
      || reviewer.reviewCount !== 2
    ) {
      fail("second supervisor review did not produce exactly one advisory pass after repair");
    }

    const finalDemo = await readFile(demoPath, "utf8");
    const afterEnv = await readFile(envPath, "utf8");
    const afterOutside = await readFile(outsidePath, "utf8");
    if (countLine(finalDemo, reviewedComment) !== 1 || finalDemo.includes(initialComment)) {
      fail("bounded reviewer correction was not reflected exactly once in src/demo.ts");
    }
    if (afterEnv !== beforeEnv || afterOutside !== beforeOutside) {
      fail("a protected proof file changed during CR3");
    }

    const journal = await new SupervisorCompletionReviewStore(workspace.canonicalRoot).list(started.taskId);
    const completionReviews = journal.filter((item) => item.kind === "completion_review");
    const repairHandoffs = journal.filter((item) => item.kind === "repair_handoff");
    if (
      completionReviews.length !== 2
      || repairHandoffs.length !== 1
      || repairHandoffs[0]?.status !== "queued"
    ) {
      fail("durable completion-review journal does not reconstruct two reviews and one queued repair handoff");
    }

    const events = await store.events(started.taskId);
    if (!events.some((event) => event.type === "resume_queued")) {
      fail("trusted repair handoff did not leave durable resume_queued evidence");
    }

    const proofResult = {
      schemaVersion: 1,
      proof: "cr3-completion-review-loop",
      passed: true,
      reviewer: CR3_PROOF_REVIEWER_KIND,
      externalChatGPTTransportProven: false,
      taskId: started.taskId,
      isolation: {
        workspace: "disposable",
        hub: "isolated_loopback_non_default",
        defaultClineHubTouched: false,
      },
      firstCompletion: {
        status: first.status,
        runCount: first.runCount,
        sessionGeneration: first.sessionGeneration,
        workerReportAvailable: firstPacket.completionSignal.workerReportAvailable,
        workerReportTrust: firstPacket.workerCompletion?.trust,
        validationPassed: firstPacket.independentEvidence.validation.passed,
        diffSafetyPassed: firstPacket.independentEvidence.diffSafety.passed,
        changedFiles: firstPacket.independentEvidence.diffSafety.changedFiles,
      },
      firstReview: {
        decision: firstReview.reviewerResult.decision,
        outcome: firstReview.outcome,
        completionAuthority: firstReview.reviewerResult.completionAuthority,
      },
      secondCompletion: {
        status: second.status,
        runCount: second.runCount,
        sessionGeneration: second.sessionGeneration,
        workerReportAvailable: secondPacket.completionSignal.workerReportAvailable,
        workerReportTrust: secondPacket.workerCompletion?.trust,
        validationPassed: secondPacket.independentEvidence.validation.passed,
        diffSafetyPassed: secondPacket.independentEvidence.diffSafety.passed,
        changedFiles: secondPacket.independentEvidence.diffSafety.changedFiles,
      },
      secondReview: {
        decision: secondReview.reviewerResult.decision,
        outcome: secondReview.outcome,
        completionAuthority: secondReview.reviewerResult.completionAuthority,
      },
      journal: {
        completionReviews: completionReviews.length,
        repairHandoffs: repairHandoffs.length,
        repairHandoffStatus: repairHandoffs[0]?.status,
      },
      safety: {
        approvedWriteScope: ["src/demo.ts"],
        protectedFilesUntouched: true,
        modelShellAllowed: false,
        modelNetworkAllowed: false,
        releaseAuthorityUsed: false,
        externalNetworkMutationUsed: false,
      },
    };

    await service.close();
    service = undefined;
    await stopLiveProofHubGracefully();
    hubMayHaveStarted = false;
    await removeDisposableProofRoot(workspaceRoot);
    await removeDisposableProofRoot(isolation.root);
    proofPassed = true;

    process.stdout.write(`\n__ORCH_CR3_PROOF__${JSON.stringify(proofResult)}\n`);
  } catch (error) {
    proofError = error;
    throw error;
  } finally {
    if (!proofPassed) {
      try {
        await service?.close().catch(() => undefined);
        if (hubMayHaveStarted) await stopLiveProofHubGracefully();
        process.stderr.write(
          `[CR3 failure artifacts preserved: workspace=${workspaceRoot}; isolation=${isolation.root}]\n`,
        );
      } catch (cleanupError) {
        preserveLiveProofFailure(proofError, cleanupError);
      }
    }
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[CR3 completion-review proof failed: ${error instanceof Error ? error.message : String(error)}]\n`,
  );
  process.exitCode = 1;
});
