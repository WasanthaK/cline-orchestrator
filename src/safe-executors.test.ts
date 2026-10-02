import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DurableSafetyBinding } from "./safety-plan.js";
import { SafeExecutorError, SafeWorkspaceExecutors, createBeforeToolGate } from "./safe-executors.js";

function binding(): DurableSafetyBinding {
  return {
    projectId: "project-1",
    workspaceId: "workspace-1",
    workspaceRegistryRevision: 1,
    safetyPlanId: "plan-1",
    policyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 1,
    allowedPathPatterns: ["src/**"],
    protectedPathPatterns: ["src/protected/**"],
    workerProfileId: "pilot-safe",
  };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-safe-exec-"));
  await mkdir(path.join(root, "src", "protected"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "src", "ok.ts"), "ok\n");
  await writeFile(path.join(root, "src", "protected", "blocked.ts"), "blocked\n");
  return root;
}

test("beforeTool gate allows safe reads, skips disabled tools and stops for durable escalation", async () => {
  const root = await setup();
  const escalations: string[] = [];
  const gate = createBeforeToolGate(
    { workspaceRoot: root, binding: binding() },
    async (_action, reason) => { escalations.push(reason); },
  );

  assert.equal((await gate("read_files", { paths: ["src/ok.ts"] })).allow, true);
  const shell = await gate("run_commands", { command: "npm test" });
  assert.equal(shell.skip, true);
  assert.equal(shell.decision, "DENY");

  const outside = await gate("editor", { path: "docs/outside.md", operation: "modify" });
  assert.equal(outside.stop, true);
  assert.equal(outside.decision, "ESCALATE_AND_STOP");
  assert.equal(escalations.length, 1);
});

test("beforeTool gate fails closed if escalation cannot be persisted", async () => {
  const root = await setup();
  const gate = createBeforeToolGate(
    { workspaceRoot: root, binding: binding() },
    async () => { throw new Error("store unavailable"); },
  );
  const result = await gate("editor", { path: "docs/outside.md" });
  assert.equal(result.stop, true);
  assert.equal(result.decision, "DENY");
  assert.match(result.reason, /failed closed/i);
});

test("executor re-checks immediately before delegate and blocks unsafe edit", async () => {
  const root = await setup();
  let editorCalls = 0;
  let escalations = 0;
  const executors = new SafeWorkspaceExecutors(
    { workspaceRoot: root, binding: binding() },
    {
      async readFile() { return "ok"; },
      async search() { return []; },
      async editor() { editorCalls += 1; return "edited"; },
      previewPatch() { return []; },
      async applyPatch() { return "patched"; },
    },
    async () => { escalations += 1; },
  );

  assert.equal(await executors.editor("src/ok.ts", "modify", {}), "edited");
  await assert.rejects(
    () => executors.editor("docs/outside.md", "modify", {}),
    (error: unknown) => error instanceof SafeExecutorError && error.decision === "ESCALATE_AND_STOP",
  );
  assert.equal(editorCalls, 1);
  assert.equal(escalations, 1);
});

test("multi-file patch is all-or-nothing when any affected path is outside scope", async () => {
  const root = await setup();
  let applyCalls = 0;
  let escalations = 0;
  const executors = new SafeWorkspaceExecutors(
    { workspaceRoot: root, binding: binding() },
    {
      async readFile() { return "ok"; },
      async search() { return []; },
      async editor() { return "edited"; },
      previewPatch() {
        return [
          { path: "src/ok.ts", operation: "modify" },
          { path: "docs/outside.md", operation: "create" },
        ];
      },
      async applyPatch() { applyCalls += 1; return "patched"; },
    },
    async () => { escalations += 1; },
  );

  await assert.rejects(
    () => executors.applyPatch("patch body"),
    (error: unknown) => error instanceof SafeExecutorError && error.decision === "ESCALATE_AND_STOP",
  );
  assert.equal(applyCalls, 0);
  assert.equal(escalations, 1);
});

test("patch preview failure and empty affected-path sets fail closed", async () => {
  const root = await setup();
  const make = (previewPatch: () => never[] | Promise<never[]>) => new SafeWorkspaceExecutors(
    { workspaceRoot: root, binding: binding() },
    {
      async readFile() { return "ok"; },
      async search() { return []; },
      async editor() { return "edited"; },
      previewPatch,
      async applyPatch() { return "patched"; },
    },
  );
  await assert.rejects(() => make(() => []).applyPatch("empty"), SafeExecutorError);
  await assert.rejects(() => make(async () => { throw new Error("bad patch"); }).applyPatch("bad"), SafeExecutorError);
});
