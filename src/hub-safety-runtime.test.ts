import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertFirstPilotWorkerSurface,
  createHubSafetySessionContributions,
  HubSafetyConfigurationError,
} from "./hub-safety-runtime.js";
import { SafeExecutorError } from "./safe-executors.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, WorkerConfig } from "./types.js";

function worker(providerId = "openai-compatible"): WorkerConfig {
  return {
    providerId,
    modelId: "test-model",
    apiKey: "test",
    baseUrl: "http://127.0.0.1:1/v1",
    contextWindow: 1000,
    maxInputTokens: 900,
    maxTokensPerTurn: 100,
    reasoningEffort: "none",
    timeoutMs: 0,
    preflightTimeoutMs: 1000,
    validationTimeoutMs: 1000,
    maxValidationOutputChars: 2000,
    maxValidationRepairs: 0,
    checkpointMaxUntrackedFiles: 100,
    checkpointMaxUntrackedBytes: 1024 * 1024,
    contextRotateAtTokens: 800,
    maxContextRotations: 2,
    maxIterations: 0,
    stallTimeoutMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    autoApproveCommands: false,
    autoApproveEdits: false,
  };
}

function approvedTask(workspace: string): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "hub-safety-task",
    goal: "Safely edit the approved source scope",
    workspace,
    status: "created",
    createdAt: now,
    updatedAt: now,
    projectId: "project-1",
    workspaceId: "workspace-1",
    workspaceRegistryRevision: 1,
    safetyPlanId: "plan-1",
    safetyPolicyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 1,
    approvedAllowedPathPatterns: ["src/**"],
    approvedProtectedPathPatterns: ["src/protected/**"],
    workerProfileId: "pilot-safe",
  };
}

async function setupWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-hub-safety-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
  await writeFile(path.join(root, "docs", "outside.txt"), "outside\n", "utf8");
  return root;
}

function hookContext(toolName: string, input: unknown) {
  return {
    tool: { name: toolName },
    toolCall: { toolName },
    input,
  };
}

test("Hub safety contributions expose only owner-targeted pilot executors and disable unsafe surfaces", async () => {
  const root = await setupWorkspace();
  const task = approvedTask(root);
  await new TaskStore(root).save(task);
  const safety = createHubSafetySessionContributions(task, root, worker());

  assert.deepEqual(Object.keys(safety.capabilities.toolExecutors ?? {}).sort(), [
    "applyPatch",
    "editor",
    "readFile",
    "search",
  ]);
  assert.equal(safety.toolPolicies.run_commands.enabled, false);
  assert.equal(safety.toolPolicies.fetch_web_content.enabled, false);
  assert.equal(safety.toolPolicies.skills.enabled, false);
  assert.equal(safety.toolPolicies.ask_question.enabled, false);
  assert.equal(safety.configOverrides.disableMcpSettingsTools, true);
  assert.equal(safety.configOverrides.enableSpawnAgent, false);
  assert.equal(safety.configOverrides.enableAgentTeams, false);
  assert.deepEqual(safety.localRuntime.configExtensions, []);
});

test("Hub beforeTool understands SDK read_files payloads and fails shell/network closed", async () => {
  const root = await setupWorkspace();
  const task = approvedTask(root);
  await new TaskStore(root).save(task);
  const safety = createHubSafetySessionContributions(task, root, worker());
  const beforeTool = safety.localRuntime.hooks.beforeTool;

  assert.equal(
    await beforeTool(hookContext("read_files", { files: [{ path: path.join(root, "src", "a.txt") }] })),
    undefined,
  );
  assert.equal(
    (await beforeTool(hookContext("run_commands", { commands: ["npm test"] })))?.skip,
    true,
  );
  assert.equal(
    (await beforeTool(hookContext("fetch_web_content", { requests: [{ url: "https://example.com", prompt: "x" }] })))?.skip,
    true,
  );
});

test("Hub patch preview checks every affected path and persists out-of-scope escalation before execution", async () => {
  const root = await setupWorkspace();
  const task = approvedTask(root);
  const store = new TaskStore(root);
  await store.save(task);
  const safety = createHubSafetySessionContributions(task, root, worker());
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/a.txt",
    "@@",
    "-a",
    "+b",
    "*** Update File: docs/outside.txt",
    "@@",
    "-outside",
    "+changed",
    "*** End Patch",
  ].join("\n");

  const result = await safety.localRuntime.hooks.beforeTool(
    hookContext("apply_patch", { input: patch }),
  );
  assert.equal(result?.stop, true);

  const persisted = await store.load(task.id);
  assert.equal(persisted.status, "waiting_for_human");
  assert.equal(persisted.pendingEscalation?.status, "pending");
  assert.equal(persisted.pendingEscalation?.actionKind, "patch");
});

test("Hub editor executor rechecks approved scope immediately before filesystem mutation", async () => {
  const root = await setupWorkspace();
  const task = approvedTask(root);
  const store = new TaskStore(root);
  await store.save(task);
  const safety = createHubSafetySessionContributions(task, root, worker());
  const editor = safety.capabilities.toolExecutors?.editor;
  assert.ok(editor);

  await assert.rejects(
    () => editor!(
      { path: path.join(root, "docs", "outside.txt"), old_text: "outside", new_text: "changed" } as any,
      root,
      { agentId: "a", conversationId: "c", iteration: 1 } as any,
    ),
    (error: unknown) => error instanceof SafeExecutorError && error.decision === "ESCALATE_AND_STOP",
  );

  const persisted = await store.load(task.id);
  assert.equal(persisted.status, "waiting_for_human");
});

test("first Hub write pilot rejects provider surfaces that have not been proven interceptable", () => {
  assert.doesNotThrow(() => assertFirstPilotWorkerSurface(worker("ollama")));
  assert.doesNotThrow(() => assertFirstPilotWorkerSurface(worker("openai-compatible")));
  assert.throws(
    () => assertFirstPilotWorkerSurface(worker("anthropic")),
    HubSafetyConfigurationError,
  );
});
