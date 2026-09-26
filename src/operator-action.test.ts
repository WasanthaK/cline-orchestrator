import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { MachineGatewayError, MachineOrchestratorService } from "./machine-orchestrator.js";
import { OperatorActionError, OperatorActionService } from "./operator-action.js";
import { startApprovedTask } from "./safe-task-start.js";
import { SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const execFile = promisify(execFileCallback);

async function withPendingEscalation(fn: (context: {
  actions: OperatorActionService;
  service: MachineOrchestratorService;
  registry: WorkspaceRegistry;
  store: TaskStore;
  taskId: string;
  workspaceId: string;
  escalationId: string;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-operator-action-"));
  let service: MachineOrchestratorService | undefined;
  try {
    const git = (...args: string[]) => execFile("git", ["-C", root, ...args], { windowsHide: true });
    await git("init");
    await git("config", "user.name", "Operator Action Test");
    await git("config", "user.email", "operator@example.invalid");
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "demo.ts"), "export const value = 1;\n");
    await git("add", ".");
    await git("commit", "-m", "baseline");

    const registry = new WorkspaceRegistry(path.join(root, "registry.json"));
    const project = await registry.registerProject("Operator Test");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Disposable Operator Test",
      root,
      safetyProfile: {
        policyVersion: "policy-v1",
        allowedPathPatterns: ["src/**"],
        protectedPathPatterns: [".env*"],
        validationCommands: [],
        workerProfileId: "test",
        maxChangedFiles: 1,
      },
    });
    const plans = new SafetyPlanService(registry);
    const preview = await plans.preview({
      workspaceId: workspace.workspaceId,
      goal: "Test pending decision",
      requestedScope: ["src/demo.ts"],
    });
    const { task } = await startApprovedTask(plans, preview.planToken);
    const escalationId = crypto.randomUUID();
    task.status = "waiting_for_human";
    task.pendingEscalation = {
      escalationId,
      taskId: task.id,
      requestedAt: new Date().toISOString(),
      reason: "An attempted edit exceeds scope",
      actionKind: "edit",
      actionFingerprint: "fingerprint",
      safetyPolicyVersion: task.safetyPolicyVersion!,
      status: "pending",
      reversible: true,
    };
    const store = new TaskStore(root);
    await store.save(task);
    service = new MachineOrchestratorService(registry, plans, () => {
      throw new Error("operator action must not create a worker");
    });
    const actions = new OperatorActionService(service);
    await fn({ actions, service, registry, store, taskId: task.id, workspaceId: workspace.workspaceId, escalationId });
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("operator rejects only a confirmed pending escalation through the machine service and audits it", async () => {
  await withPendingEscalation(async ({ actions, service, taskId, workspaceId, escalationId }) => {
    const preview = await actions.previewEscalationRejection(taskId);
    assert.equal(preview.workspaceId, workspaceId);
    assert.equal(preview.escalationId, escalationId);
    assert.equal(JSON.stringify(preview).includes("src/demo.ts"), false);
    await assert.rejects(
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: false as true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );

    const submissions = await Promise.allSettled([
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
    ]);
    assert.equal(submissions.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal((await service.getTask(taskId)).status, "aborted");
    assert.equal((await service.getTask(taskId)).pendingEscalation?.status, "rejected");
    assert.equal((await service.getTaskEvents(taskId)).filter((item) => item.type === "human_escalation_rejected").length, 1);
    await assert.rejects(actions.previewEscalationRejection(taskId), OperatorActionError);
  });
});

test("stale task and profile changes fail closed and burn the preview token", async () => {
  await withPendingEscalation(async ({ actions, service, registry, store, taskId, workspaceId, escalationId }) => {
    const preview = await actions.previewEscalationRejection(taskId);
    const changed = await store.load(taskId);
    changed.pendingEscalation!.status = "approved";
    await store.save(changed);
    await assert.rejects(
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "stale_action",
    );
    await assert.rejects(
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );

    changed.pendingEscalation!.status = "pending";
    await store.save(changed);
    changed.status = "created";
    await store.save(changed);
    await assert.rejects(
      service.rejectEscalation(taskId, escalationId),
      (error: unknown) => error instanceof MachineGatewayError && error.code === "invalid_task_state",
    );
    changed.status = "waiting_for_human";
    await store.save(changed);
    const fresh = await actions.previewEscalationRejection(taskId);
    await registry.updateSafetyProfile(workspaceId, {
      policyVersion: "policy-v2",
      allowedPathPatterns: ["src/**"],
      protectedPathPatterns: [".env*"],
      validationCommands: [],
      workerProfileId: "test",
      maxChangedFiles: 1,
    });
    await assert.rejects(
      actions.rejectEscalation({ taskId, confirmationToken: fresh.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof MachineGatewayError && error.code === "task_binding_stale",
    );
    assert.equal((await store.load(taskId)).pendingEscalation?.status, "pending");
    assert.equal((await store.events(taskId)).some((event) => event.type === "human_escalation_rejected"), false);
  });
});

test("opposing service decisions cannot both commit or emit audit events", async () => {
  await withPendingEscalation(async ({ service, store, taskId, escalationId }) => {
    const results = await Promise.allSettled([
      service.approveEscalation(taskId, escalationId),
      service.rejectEscalation(taskId, escalationId),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const task = await store.load(taskId);
    assert.equal(task.status, "aborted");
    const decisions = (await store.events(taskId)).filter((event) =>
      event.type === "human_escalation_approved" || event.type === "human_escalation_rejected");
    assert.equal(decisions.length, 1);
    assert.equal(task.pendingEscalation?.status, decisions[0]?.type === "human_escalation_approved" ? "approved" : "rejected");
  });
});

test("expired and wrong-task confirmations cannot invoke a decision", async () => {
  await withPendingEscalation(async ({ service, taskId }) => {
    let now = Date.parse("2026-09-26T00:00:00.000Z");
    const actions = new OperatorActionService(service, () => now);
    const preview = await actions.previewEscalationRejection(taskId);
    await assert.rejects(
      actions.rejectEscalation({ taskId: crypto.randomUUID(), confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "invalid_action",
    );
    now += 60_000;
    await assert.rejects(
      actions.rejectEscalation({ taskId, confirmationToken: preview.confirmationToken, confirmed: true }),
      (error: unknown) => error instanceof OperatorActionError && error.code === "expired_action",
    );
    assert.equal((await service.getTask(taskId)).status, "waiting_for_human");
  });
});
