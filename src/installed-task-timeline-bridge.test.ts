import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInstalledViewerMachineReader, INSTALLED_VIEWER_CONTRACT } from "./installed-passive-viewer.js";
import { createMachineDashboardSnapshotReader } from "./machine-dashboard-snapshot-reader.js";
import { MachineOrchestratorService } from "./machine-orchestrator.js";
import { startPassiveOperatorViewer } from "./passive-operator-viewer.js";
import { bindTaskToSafetyPlan, SafetyPlanService } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

test("M18E installed viewer reads bound task history only after login, without leaking raw evidence or mutation", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "m18e-viewer-task-"));
  const workspaceRoot = path.join(base, "workspace");
  const registry = new WorkspaceRegistry(path.join(base, "registry.json"));
  let machine: MachineOrchestratorService | undefined;
  let viewer: Awaited<ReturnType<typeof startPassiveOperatorViewer>> | undefined;
  try {
    await mkdir(workspaceRoot);
    const project = await registry.registerProject("Pilot Project");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "Pilot Workspace",
      root: workspaceRoot,
      safetyProfile: {
        policyVersion: "pilot-policy-v1",
        allowedPathPatterns: ["test/**"],
        protectedPathPatterns: ["src/**", ".git/**"],
        validationCommands: ["npm test"],
        workerProfileId: "test-profile",
        maxChangedFiles: 1,
      },
    });
    const taskId = crypto.randomUUID();
    const legacyId = crypto.randomUUID();
    const at = new Date().toISOString();
    const store = new TaskStore(workspaceRoot);
    const goal = "PRIVATE_GOAL_DO_NOT_DISCLOSE";
    const task = bindTaskToSafetyPlan({
      id: taskId, goal, workspace: workspaceRoot, status: "waiting",
      createdAt: at, updatedAt: at, validationCommands: ["npm test"],
    }, {
      projectId: project.projectId,
      workspaceId: workspace.workspaceId,
      workspaceRegistryRevision: workspace.revision,
      safetyPlanId: crypto.randomUUID(),
      policyVersion: workspace.safetyProfile.policyVersion,
      safetyProfileId: workspace.safetyProfile.profileId,
      safetyProfileRevision: workspace.safetyProfile.revision,
      allowedPathPatterns: ["test/**"],
      protectedPathPatterns: ["src/**", ".git/**"],
      workerProfileId: "test-profile",
    });
    await store.save(task);
    await store.appendEvent(taskId, "run_started", {
      status: "running",
      message: "Bearer PRIVATE_EVENT_MESSAGE and C:\\sensitive\\local",
      data: { apiKey: "PRIVATE_RAW_EVENT_DATA" },
    });
    await store.save({
      id: legacyId, goal: "PRIVATE_UNBOUND_LEGACY_GOAL", workspace: workspaceRoot,
      status: "waiting", createdAt: at, updatedAt: at,
    });

    machine = new MachineOrchestratorService(registry, new SafetyPlanService(registry), () => {
      throw new Error("Viewer must never resolve a worker");
    });
    const source = createInstalledViewerMachineReader(machine);
    assert.deepEqual(Object.keys(source).sort(), [...INSTALLED_VIEWER_CONTRACT.readOnlyMachineMethods].sort());
    assert.equal("startTask" in source, false);
    assert.equal("approveEscalation" in source, false);
    assert.equal("getTaskDiff" in source, false);
    const reader = createMachineDashboardSnapshotReader(source);
    const token = "0123456789abcdef".repeat(4);
    viewer = await startPassiveOperatorViewer(reader, {
      host: "127.0.0.1", port: 0, token, testOnlyEphemeralPort: true,
    });
    const unauthenticated = await fetch(viewer.origin + "/viewer/task/" + taskId);
    assert.equal(unauthenticated.status, 200);
    assert.match(await unauthenticated.text(), /Sign in/);

    const login = await fetch(viewer.origin + "/viewer/login", {
      method: "POST", redirect: "manual",
      headers: { Origin: viewer.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("orch_viewer="));
    const dashboard = await fetch(viewer.origin + "/viewer", { headers: { Cookie: cookie! } });
    assert.equal(dashboard.status, 200);
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, new RegExp(taskId));
    assert.doesNotMatch(dashboardHtml, /PRIVATE_GOAL|PRIVATE_UNBOUND_LEGACY_GOAL/);

    const detail = await fetch(viewer.origin + "/viewer/task/" + taskId, {
      headers: { Cookie: cookie! },
    });
    assert.equal(detail.status, 200);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /Run started/);
    assert.match(detailHtml, /Execution timeline/);
    assert.doesNotMatch(detailHtml,
      /PRIVATE_GOAL|PRIVATE_EVENT_MESSAGE|PRIVATE_RAW_EVENT_DATA|sensitive|<script|<button|<form/i);

    const unbound = await fetch(viewer.origin + "/viewer/task/" + legacyId, {
      headers: { Cookie: cookie! },
    });
    assert.equal(unbound.status, 404);
    const mutation = await fetch(viewer.origin + "/viewer/task/" + taskId, {
      method: "POST", headers: { Cookie: cookie!, Origin: viewer.origin },
    });
    assert.equal(mutation.status, 403);
  } finally {
    if (viewer) await viewer.close();
    if (machine) await machine.close();
    await rm(base, { recursive: true, force: true });
  }
});
