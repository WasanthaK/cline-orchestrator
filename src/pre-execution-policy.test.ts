import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DurableSafetyBinding } from "./safety-plan.js";
import { evaluatePreExecutionPolicy, normalizeToolAction } from "./pre-execution-policy.js";

function binding(): DurableSafetyBinding {
  return {
    projectId: "project-1",
    workspaceId: "workspace-1",
    workspaceRegistryRevision: 1,
    safetyPlanId: "plan-1",
    policyVersion: "policy-1",
    safetyProfileId: "profile-1",
    safetyProfileRevision: 1,
    allowedPathPatterns: ["src/**", "README.md"],
    protectedPathPatterns: ["src/protected/**", "package-lock.json"],
    workerProfileId: "pilot-safe",
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-policy-"));
  await mkdir(path.join(root, "src", "protected"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "src", "ok.ts"), "export const ok = true;\n");
  await writeFile(path.join(root, "src", "protected", "blocked.ts"), "secret\n");
  await writeFile(path.join(root, ".env"), "TOKEN=secret\n");
  await writeFile(path.join(root, "README.md"), "hello\n");
  return root;
}

test("normalizes supported tools and fails malformed tools closed", () => {
  assert.deepEqual(normalizeToolAction("read_files", { paths: ["src/ok.ts"] }), { kind: "read", paths: ["src/ok.ts"] });
  assert.equal(normalizeToolAction("run_commands", { command: "npm test" }).kind, "command");
  assert.equal(normalizeToolAction("fetch_web_content", { url: "https://example.com" }).kind, "network");
  assert.equal(normalizeToolAction("editor", {}).kind, "unknown");
  assert.equal(normalizeToolAction("mystery", {}).kind, "unknown");
});

test("allows contained non-secret reads and approved writes", async () => {
  const root = await workspace();
  const context = { workspaceRoot: root, binding: binding() };
  assert.equal((await evaluatePreExecutionPolicy({ kind: "read", paths: ["src/ok.ts"] }, context)).decision, "ALLOW");
  assert.equal((await evaluatePreExecutionPolicy({ kind: "edit", paths: ["src/new.ts"], operation: "create" }, context)).decision, "ALLOW");
});

test("denies secrets and protected paths before allow-scope matching", async () => {
  const root = await workspace();
  const context = { workspaceRoot: root, binding: binding() };
  const secret = await evaluatePreExecutionPolicy({ kind: "read", paths: [".env"] }, context);
  assert.equal(secret.decision, "DENY");
  assert.match(secret.reason, /secret|credential/i);
  const protectedResult = await evaluatePreExecutionPolicy({ kind: "edit", paths: ["src/protected/blocked.ts"], operation: "modify" }, context);
  assert.equal(protectedResult.decision, "DENY");
  assert.match(protectedResult.reason, /protected/i);
});

test("out-of-scope writes escalate instead of silently broadening authority", async () => {
  const root = await workspace();
  const result = await evaluatePreExecutionPolicy(
    { kind: "edit", paths: ["docs/outside.md"], operation: "modify" },
    { workspaceRoot: root, binding: binding() },
  );
  assert.equal(result.decision, "ESCALATE_AND_STOP");
  assert.match(result.reason, /outside the approved Safety Plan scope/i);
});

test("denies lexical traversal and resolved symlink write escapes", async () => {
  const root = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "orch-policy-outside-"));
  await writeFile(path.join(outside, "outside.txt"), "outside\n");
  const traversal = await evaluatePreExecutionPolicy(
    { kind: "edit", paths: ["../outside.txt"], operation: "modify" },
    { workspaceRoot: root, binding: binding() },
  );
  assert.equal(traversal.decision, "DENY");

  await symlink(outside, path.join(root, "src", "linked"), "dir");
  const symlinkResult = await evaluatePreExecutionPolicy(
    { kind: "edit", paths: ["src/linked/new.txt"], operation: "create" },
    { workspaceRoot: root, binding: binding() },
  );
  assert.equal(symlinkResult.decision, "DENY");
  assert.match(symlinkResult.reason, /outside|symlink|reparse/i);
});

test("first-pilot policy disables shell, network and unknown tools", async () => {
  const root = await workspace();
  const context = { workspaceRoot: root, binding: binding() };
  assert.equal((await evaluatePreExecutionPolicy({ kind: "command", commands: ["npm test"] }, context)).decision, "DENY");
  assert.equal((await evaluatePreExecutionPolicy({ kind: "network", urls: ["https://example.com"] }, context)).decision, "DENY");
  assert.equal((await evaluatePreExecutionPolicy({ kind: "unknown", toolName: "plugin_tool" }, context)).decision, "DENY");
});
