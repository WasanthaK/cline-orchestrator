import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, stat } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProductConfig } from "./product-config.js";
import { runManagedTaskCli, ManagedRunError, MANAGED_RUN_CONTRACT, type ManagedTaskReview } from "./managed-task-cli.js";
import type { PublicTaskView } from "./machine-orchestrator.js";
import type { SafetyPreview } from "./safety-plan.js";
import { TaskStore } from "./state.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const config = resolveProductConfig({ schemaVersion: 1, provider: {
  providerId: "ollama-openai", modelId: "local-model", baseUrl: "http://127.0.0.1:8080/v1",
}, runtime: { autoApproveCommands: false, autoApproveEdits: false } });

async function pilot(body: (input: { registry: WorkspaceRegistry; workspaceId: string;
  root: string }) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), "managed-cli-"));
  const root = path.join(base, "workspace");
  await mkdir(root);
  const registry = new WorkspaceRegistry(path.join(base, "state", "registry.json"));
  try {
    const project = await registry.registerProject("Pilot project");
    const workspace = await registry.registerWorkspace({
      projectId: project.projectId, displayName: "Disposable Workspace", root,
      safetyProfile: {
        policyVersion: "safety-v1", workerProfileId: "local-worker",
        allowedPathPatterns: ["test/**"], protectedPathPatterns: ["src/**"],
        validationCommands: ["npm test"], maxChangedFiles: 1,
      },
    });
    await body({ registry, workspaceId: workspace.workspaceId, root });
  } finally { await rm(base, { recursive: true, force: true }); }
}

function fakeMachine(workspaceId: string) {
  let previewCount = 0, startedCount = 0, getCount = 0;
  const taskId = crypto.randomUUID();
  const at = new Date().toISOString();
  const preview: SafetyPreview = {
    workspaceId, projectId: crypto.randomUUID(), workspaceDisplayName: "Disposable Workspace",
    workspaceRevision: 1, goal: "Add a test", branch: "main",
    head: "abc123", dirty: false, dirtyFingerprint: "PRIVATE_FINGERPRINT",
    requestedScope: [], allowedPathPatterns: ["test/**"], protectedPathPatterns: ["src/**"],
    validationCommands: ["npm test"], policyVersion: "safety-v1",
    workerProfileId: "local-worker", planToken: "PRIVATE_SINGLE_USE_TOKEN", expiresAt: at,
  };
  const task = (status: PublicTaskView["status"]) => ({
    taskId, workspaceId, status,
  } as PublicTaskView);
  const service = {
    async previewTask(request: { workspaceId: string; goal: string }) {
      previewCount++; assert.equal(request.workspaceId, workspaceId);
      return { ...preview, goal: request.goal };
    },
    async startTask(token: string) {
      startedCount++;
      assert.equal(token, "PRIVATE_SINGLE_USE_TOKEN");
      return task("waiting");
    },
    async getTask(id: string) {
      assert.equal(id, taskId);
      getCount++;
      return task("completed");
    },
  };
  return { service, counts: () => ({ previewCount, startedCount, getCount }), taskId };
}

const modelReady = async () => ({
  checkedAt: new Date().toISOString(), ok: true, supported: true,
  providerId: "openai-compatible", modelId: "local-model", code: "ok" as const, message: "Ready",
});

test("M18E managed-run uses only approved registered Safety Plan, hides token and observes durable completion", async () => {
  await pilot(async ({ registry, workspaceId, root }) => {
    const { service, counts, taskId } = fakeMachine(workspaceId);
    let review: ManagedTaskReview | undefined;
    const endpoints: string[] = [];
    const outcome = await runManagedTaskCli({
      workspaceId, goal: "Add a test", config,
      env: { ORCH_WORKER_PROFILE_ID: "local-worker" },
    }, {
      registry, machine: service as never, preflight: modelReady, daemonPresent: async url => {
        endpoints.push(url); return false;
      },
      pause: async () => {},
      confirm: async requested => { review = requested; return true; },
    });
    assert.deepEqual(outcome, { started: true, taskId, status: "completed", grantsAuthority: false });
    assert.deepEqual(counts(), { previewCount: 1, startedCount: 1, getCount: 1 });
    assert.ok(endpoints.includes("http://127.0.0.1:4317"));
    assert.ok(endpoints.includes("http://127.0.0.1:4318"));
    assert.equal(review?.canonicalRoot, root);
    assert.deepEqual(review?.allowedPathPatterns, ["test/**"]);
    assert.deepEqual(review?.validationCommands, ["npm test"]);
    assert.equal(review?.maxChangedFiles, 1);
    assert.doesNotMatch(JSON.stringify(review), /PRIVATE_SINGLE_USE_TOKEN|PRIVATE_FINGERPRINT/);
    assert.equal(MANAGED_RUN_CONTRACT.noLegacyRunDispatch, true);
    assert.equal(MANAGED_RUN_CONTRACT.noViewerMutation, true);
    const lockPath = path.join(path.dirname(registry.path), "managed-run-locks", workspaceId + ".lock");
    await assert.rejects(stat(lockPath), { code: "ENOENT" });
  });
});

test("M18E managed-run decline and preconditions fail before creating a task", async () => {
  await pilot(async ({ registry, workspaceId, root }) => {
    const declined = fakeMachine(workspaceId);
    const args = { workspaceId, goal: "Add a test", config, env: { ORCH_WORKER_PROFILE_ID: "local-worker" } };
    const defaults = { registry, machine: declined.service as never, preflight: modelReady,
      daemonPresent: async () => false, pause: async () => {} };
    const no = await runManagedTaskCli(args, { ...defaults, confirm: async () => false });
    assert.deepEqual(no, { started: false, grantsAuthority: false });
    assert.deepEqual(declined.counts(), { previewCount: 1, startedCount: 0, getCount: 0 });

    await assert.rejects(runManagedTaskCli({ ...args, workspaceId: "../danger" },
      { ...defaults, confirm: async () => true }), { code: "input_invalid" });
    await assert.rejects(runManagedTaskCli({ ...args, env: {} },
      { ...defaults, confirm: async () => true }), { code: "profile_mismatch" });
    await assert.rejects(runManagedTaskCli(args,
      { ...defaults, daemonPresent: async () => true, confirm: async () => true }), { code: "daemon_active" });
    await assert.rejects(runManagedTaskCli(args,
      { ...defaults, preflight: async () => ({ ...(await modelReady()), ok: false }),
        confirm: async () => true }), { code: "provider_not_ready" });

    const untrusted = { ...config, provider: { ...config.provider, baseUrl: "https://public.example/v1" } };
    await assert.rejects(runManagedTaskCli({ ...args, config: untrusted },
      { ...defaults, confirm: async () => true }), { code: "provider_invalid" });

    const store = new TaskStore(root);
    const now = new Date().toISOString();
    await store.save({ id: crypto.randomUUID(), goal: "Prior task", workspace: root,
      status: "running", createdAt: now, updatedAt: now });
    await assert.rejects(runManagedTaskCli(args,
      { ...defaults, confirm: async () => true }), { code: "workspace_busy" });
    assert.deepEqual(declined.counts(), { previewCount: 1, startedCount: 0, getCount: 0 });
  });
});

test("M18E create-only lock refuses second managed CLI process and does not consume approval", async () => {
  await pilot(async ({ registry, workspaceId }) => {
    const { service, counts } = fakeMachine(workspaceId);
    const lockFile = path.join(path.dirname(registry.path), "managed-run-locks", workspaceId + ".lock");
    await mkdir(path.dirname(lockFile), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(lockFile, "operator-owned-sentinel"));
    await assert.rejects(runManagedTaskCli({
      workspaceId, goal: "Add a test", config, env: { ORCH_WORKER_PROFILE_ID: "local-worker" },
    }, {
      registry, machine: service as never, preflight: modelReady, daemonPresent: async () => false,
      confirm: async () => true,
    }), { code: "workspace_busy" });
    assert.deepEqual(counts(), { previewCount: 0, startedCount: 0, getCount: 0 });
    assert.equal(await readFile(lockFile, "utf8"), "operator-owned-sentinel");
  });
});
