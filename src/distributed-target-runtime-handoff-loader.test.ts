import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RegisteredWorkspaceTargetTaskLoader,
} from "./distributed-target-runtime-handoff.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

test("M12H loads a target-local approved task while preserving narrower Safety Plan scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-m12h-loader-"));
  const workspaceRoot = path.join(root, "workspace");
  const registryPath = path.join(root, "registry.json");
  await mkdir(workspaceRoot, { recursive: true });

  try {
    const registry = new WorkspaceRegistry(registryPath);
    const project = await registry.registerProject("M12H proof");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId,
      displayName: "target workspace",
      root: workspaceRoot,
      safetyProfile: {
        policyVersion: "policy-v1",
        allowedPathPatterns: ["src/**"],
        protectedPathPatterns: [".env", ".git/**"],
        validationCommands: ["npm test"],
        workerProfileId: "worker-v1",
        maxChangedFiles: 10,
      },
    });

    const task: OrchestratorTask = {
      id: crypto.randomUUID(),
      goal: "Modify only one feature directory",
      workspace: workspace.canonicalRoot,
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: workspace.projectId,
      workspaceId: workspace.workspaceId,
      workspaceRegistryRevision: workspace.revision,
      safetyPlanId: crypto.randomUUID(),
      safetyPolicyVersion: workspace.safetyProfile.policyVersion,
      safetyProfileId: workspace.safetyProfile.profileId,
      safetyProfileRevision: workspace.safetyProfile.revision,
      approvedAllowedPathPatterns: ["src/feature/**"],
      approvedProtectedPathPatterns: [...workspace.safetyProfile.protectedPathPatterns],
      workerProfileId: workspace.safetyProfile.workerProfileId,
      validationCommands: [...workspace.safetyProfile.validationCommands],
    } as OrchestratorTask;
    await new TaskStore(workspace.canonicalRoot).save(task);

    const loaded = await new RegisteredWorkspaceTargetTaskLoader(registry).loadCurrent(
      task.id,
      workspace.workspaceId,
    );
    assert.equal(loaded.id, task.id);
    assert.deepEqual(
      (loaded as OrchestratorTask & { approvedAllowedPathPatterns?: string[] }).approvedAllowedPathPatterns,
      ["src/feature/**"],
    );
    assert.equal(loaded.workspace, workspace.canonicalRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
