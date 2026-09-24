import assert from "node:assert/strict";
import { mkdtemp, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RuntimeWorkspaceMismatchError,
  SdkClineRuntimeFactory,
  verifyRuntimeSessionWorkspace,
  type ClineRuntime,
} from "./cline-runtime.js";

class FakeRuntime implements ClineRuntime {
  constructor(private readonly session?: Record<string, unknown>) {}
  async start() { return { sessionId: "session-1" }; }
  async send() { return { finishReason: "completed" }; }
  async abort() {}
  subscribe() { return () => undefined; }
  async get() { return this.session; }
  async dispose() {}
}

test("SDK runtime factory keeps local mode local and passes Cline-managed Hub auth only in memory", async () => {
  const calls: Record<string, unknown>[] = [];
  let prepareCalls = 0;
  const resolvedWorkspaces: string[] = [];
  const creator = async (options: Record<string, unknown>) => {
    calls.push(options);
    return new FakeRuntime();
  };
  const factory = new SdkClineRuntimeFactory(
    creator,
    async () => {
      prepareCalls += 1;
    },
    async (workspaceRoot) => {
      resolvedWorkspaces.push(workspaceRoot);
      return {
        url: "ws://127.0.0.1:43123/hub",
        authToken: "ephemeral-proof-token",
      };
    },
  );

  await factory.create({ mode: "local", workspaceRoot: "/tmp/workspace" });
  assert.equal(prepareCalls, 0);
  assert.deepEqual(resolvedWorkspaces, []);

  await factory.create({ mode: "hub", workspaceRoot: "/tmp/workspace" });
  assert.equal(prepareCalls, 1);
  assert.deepEqual(resolvedWorkspaces, ["/tmp/workspace"]);

  assert.deepEqual(calls[0], {
    clientName: "cline-orchestrator",
    backendMode: "local",
  });
  assert.deepEqual(calls[1], {
    clientName: "cline-orchestrator",
    backendMode: "hub",
    hub: {
      endpoint: "ws://127.0.0.1:43123/hub",
      authToken: "ephemeral-proof-token",
      strategy: "require-hub",
      clientType: "cline-orchestrator",
      displayName: "Cline Orchestrator",
      workspaceRoot: "/tmp/workspace",
      cwd: "/tmp/workspace",
    },
  });
});

test("SDK Hub runtime factory fails closed when Cline resolution lacks endpoint credentials", async () => {
  let creatorCalls = 0;
  const factory = new SdkClineRuntimeFactory(
    async () => {
      creatorCalls += 1;
      return new FakeRuntime();
    },
    async () => undefined,
    async () => ({
      url: "ws://127.0.0.1:43123/hub",
      authToken: "",
    }),
  );

  await assert.rejects(
    () => factory.create({ mode: "hub", workspaceRoot: "/tmp/workspace" }),
    /authenticated endpoint/,
  );
  assert.equal(creatorCalls, 0);
});

test("Hub resume workspace verification accepts canonical aliases and rejects a different root", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "orch-runtime-workspace-"));
  const aliasParent = await mkdtemp(path.join(os.tmpdir(), "orch-runtime-alias-"));
  const alias = path.join(aliasParent, "workspace-link");
  await symlink(workspace, alias, "dir");

  const canonical = await realpath(workspace);
  await verifyRuntimeSessionWorkspace(
    new FakeRuntime({ workspaceRoot: alias }),
    "session-ok",
    canonical,
  );

  const other = await mkdtemp(path.join(os.tmpdir(), "orch-runtime-other-"));
  await assert.rejects(
    () => verifyRuntimeSessionWorkspace(
      new FakeRuntime({ workspaceRoot: other }),
      "session-wrong",
      canonical,
    ),
    (error: unknown) => error instanceof RuntimeWorkspaceMismatchError && error.code === "runtime_workspace_mismatch",
  );
});

test("Hub resume workspace verification fails closed when session lookup capability is unavailable", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "orch-runtime-missing-get-"));
  const runtime = new FakeRuntime();
  runtime.get = undefined as any;
  await assert.rejects(
    () => verifyRuntimeSessionWorkspace(runtime, "session-1", workspace),
    RuntimeWorkspaceMismatchError,
  );
});
