import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { inspectNativeSetupReadiness, NATIVE_SETUP_READINESS_CONTRACT } from "./native-setup-readiness.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { routeProductCli } from "./product-cli.js";

const provider = {
  providerId: "openai-compatible", modelId: "local-model",
  baseUrl: "http://127.0.0.1:8080/v1",
};
const valid = async (base: string) => {
  const p = path.join(base, "ClineOrchestrator");
  await mkdir(p, { recursive: true });
  await writeFile(path.join(p, "config.json"), JSON.stringify({
    schemaVersion: 1, provider,
    daemon: { host: "127.0.0.1" },
    runtime: { autoApproveEdits: false, autoApproveCommands: false },
  }));
};
const stub = (async (resource: string | Request | URL) => {
  assert.equal(String(resource), "http://127.0.0.1:8080/v1/models");
  return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 });
}) as typeof fetch;
async function fixture(fn: (base: string, registry: WorkspaceRegistry) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), "m19c3-"));
  const registry = new WorkspaceRegistry(path.join(base, "registry", "workspace-registry.json"));
  try { await fn(base, registry); }
  finally { await rm(base, { force: true, recursive: true }); }
}

test("M19C3 fresh installation yields four explicit setup steps and zero task authority", async () => {
  await fixture(async (base, registry) => {
    const before = await inspectNativeSetupReadiness(base, registry, stub);
    assert.equal(before.status, "needs_setup");
    assert.deepEqual(before.steps.map(s => s.state), ["needed","needed","needed","needed"]);
    assert.equal(before.projectCount, 0);
    assert.equal(before.workspaceCount, 0);
    assert.equal(before.setupCompleteIsTaskAuthority, false);
    assert.equal(NATIVE_SETUP_READINESS_CONTRACT.startsTask, false);
  });
});

test("M19C3 valid provider, local model, project, workspace and Safety show setup complete", async () => {
  await fixture(async (base, registry) => {
    await valid(base);
    const project = await registry.registerProject("Test project");
    const root = path.join(base, "workspace");
    await mkdir(root);
    await registry.registerWorkspace({
      projectId: project.projectId, displayName: "Test workspace", root,
      safetyProfile: {
        policyVersion: "v1", workerProfileId: "local-model",
        maxChangedFiles: 1, allowedPathPatterns: ["test/**"],
        protectedPathPatterns: ["src/**"], validationCommands: ["npm test"],
      },
    });
    const state = await inspectNativeSetupReadiness(base, registry, stub);
    assert.equal(state.status, "setup_complete");
    assert.deepEqual(state.steps.map(s => s.state), ["ready","ready","ready","ready"]);
    assert.equal(state.projectCount, 1);
    assert.equal(state.workspaceCount, 1);
    assert.equal(state.grantsAuthority, false);
    const json = JSON.stringify(state);
    assert.doesNotMatch(json, /local-model|http:|workspace-registry|test\/\*\*|secret|disposable-workspace/i);
  });
});

test("M19C3 invalid configuration and broken registry are never green and do not mutate files", async () => {
  await fixture(async (base, registry) => {
    await valid(base);
    const conf = path.join(base, "ClineOrchestrator", "config.json");
    await writeFile(conf, JSON.stringify({
      schemaVersion: 1, provider: { ...provider, baseUrl: "https://remote.example.com/v1" },
      runtime: { autoApproveCommands: true },
    }));
    await mkdir(path.dirname(registry.path), { recursive: true });
    await writeFile(registry.path, "PRIVATE_CORRUPT_REGISTRY");
    const original = await readFile(conf, "utf8");
    const state = await inspectNativeSetupReadiness(base, registry, (async () => {
      throw new Error("Remote network request must not be made");
    }) as typeof fetch);
    assert.equal(state.status, "attention");
    assert.equal(state.steps.find(x => x.id === "settings")?.state, "attention");
    assert.equal(state.steps.find(x => x.id === "project")?.state, "attention");
    assert.equal(await readFile(registry.path, "utf8"), "PRIVATE_CORRUPT_REGISTRY");
    assert.equal(await readFile(conf, "utf8"), original);
    assert.doesNotMatch(JSON.stringify(state), /remote.example|PRIVATE_CORRUPT|http/i);
  });
});

test("M19C3 is route-isolated and does not accept target path or config override", () => {
  assert.deepEqual(routeProductCli(["readiness-desktop"]), { kind: "desktop_readiness" });
  for (const args of [["readiness-desktop","extra"],
    ["--config","private.json","readiness-desktop"]]) {
    assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
  }
});
