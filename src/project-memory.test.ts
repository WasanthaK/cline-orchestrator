import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PROJECT_MEMORY_DOCUMENTS,
  ProjectMemoryStore,
} from "./project-memory.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-memory-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(workspace: string, id = "memory-task"): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id,
    goal: "Bootstrap durable project memory",
    workspace,
    status: "waiting",
    createdAt: now,
    updatedAt: now,
  };
}

test("project memory bootstrap creates stable metadata and the five durable memory documents", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const first = await store.ensure();

    assert.equal(first.schemaVersion, 1);
    assert.equal(first.memorySchemaVersion, 1);
    assert.equal(first.workspaceRoot, path.resolve(dir));
    assert.ok(first.projectId);
    assert.deepEqual(Object.keys(first.memoryFiles).sort(), Object.keys(PROJECT_MEMORY_DOCUMENTS).sort());

    const projectJson = JSON.parse(
      await readFile(path.join(dir, ".orchestrator", "project.json"), "utf8"),
    );
    assert.equal(projectJson.projectId, first.projectId);

    for (const [name, filename] of Object.entries(PROJECT_MEMORY_DOCUMENTS)) {
      const expectedRelative = `.orchestrator/memory/${filename}`;
      assert.equal(first.memoryFiles[name as keyof typeof first.memoryFiles], expectedRelative);
      const content = await readFile(path.join(dir, ".orchestrator", "memory", filename), "utf8");
      assert.match(content, /^# /);
    }

    const architecturePath = path.join(dir, ".orchestrator", "memory", "architecture.md");
    await writeFile(architecturePath, "# Architecture\n\nHuman-authored durable note.\n", "utf8");
    const second = await store.ensure();

    assert.equal(second.projectId, first.projectId);
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(
      await readFile(architecturePath, "utf8"),
      "# Architecture\n\nHuman-authored durable note.\n",
    );
  });
});

test("project metadata task updates preserve project identity and survive a fresh store instance", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const initial = await store.ensure();
    const value = task(dir, "task-123");
    value.status = "running";
    value.updatedAt = "2026-09-21T08:45:00.000Z";

    const updated = await store.recordTask(value);
    assert.equal(updated.projectId, initial.projectId);
    assert.equal(updated.createdAt, initial.createdAt);
    assert.deepEqual(updated.lastTask, {
      id: "task-123",
      status: "running",
      updatedAt: "2026-09-21T08:45:00.000Z",
    });

    const reloaded = await new ProjectMemoryStore(dir).load();
    assert.deepEqual(reloaded, updated);
  });
});

test("TaskStore save automatically bootstraps project memory and records the latest task pointer", async () => {
  await withWorkspace(async (dir) => {
    const taskStore = new TaskStore(dir);
    const value = task(dir, "taskstore-bootstrap");
    await taskStore.save(value);

    const metadata = await new ProjectMemoryStore(dir).load();
    assert.equal(metadata.lastTask?.id, value.id);
    assert.equal(metadata.lastTask?.status, "waiting");
    assert.equal(metadata.lastTask?.updatedAt, value.updatedAt);

    for (const filename of Object.values(PROJECT_MEMORY_DOCUMENTS)) {
      assert.ok(await readFile(path.join(dir, ".orchestrator", "memory", filename), "utf8"));
    }
  });
});

test("architecture memory updates are append-only and carry explicit task/date/rationale provenance", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.ensure();
    const architecturePath = path.join(dir, ".orchestrator", "memory", "architecture.md");
    await writeFile(architecturePath, "# Architecture\n\nHuman-authored durable note.\n", "utf8");

    const update = await store.appendArchitectureUpdate({
      taskId: "task-architecture-1",
      title: "Orchestration boundaries",
      content: "The orchestrator owns durable state while Cline remains the implementation worker.",
      rationale: "Preserve the stable responsibility boundary for future sessions.",
      recordedAt: "2026-09-21T09:00:00.000Z",
    });

    assert.equal(update.schemaVersion, 1);
    assert.equal(update.document, "architecture");
    assert.equal(update.taskId, "task-architecture-1");
    assert.equal(update.recordedAt, "2026-09-21T09:00:00.000Z");
    assert.ok(update.id);

    const content = await readFile(architecturePath, "utf8");
    assert.match(content, /^# Architecture\n\nHuman-authored durable note\./);
    assert.match(content, /<!-- orchestrator-memory-update \{/);
    assert.match(content, /## Orchestration boundaries/);
    assert.match(content, /Task: `task-architecture-1`/);
    assert.match(content, /Recorded at: 2026-09-21T09:00:00\.000Z/);
    assert.match(content, /Rationale: Preserve the stable responsibility boundary for future sessions\./);
    assert.match(content, /The orchestrator owns durable state while Cline remains the implementation worker\./);
    assert.match(content, new RegExp(update.id));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 1);
    assert.deepEqual(metadata.lastMemoryUpdate, {
      id: update.id,
      document: "architecture",
      recordedAt: "2026-09-21T09:00:00.000Z",
      taskId: "task-architecture-1",
      rationale: "Preserve the stable responsibility boundary for future sessions.",
    });
  });
});

test("multiple architecture updates remain ordered and independently auditable", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const first = await store.appendArchitectureUpdate({
      taskId: "task-a",
      title: "Durable state",
      content: "Project continuity lives under .orchestrator.",
      rationale: "Record the persistence boundary.",
      recordedAt: "2026-09-21T09:01:00.000Z",
    });
    const second = await store.appendArchitectureUpdate({
      taskId: "task-b",
      title: "Worker boundary",
      content: "Cline executes bounded implementation work.",
      rationale: "Record the worker responsibility.",
      recordedAt: "2026-09-21T09:02:00.000Z",
    });

    assert.notEqual(first.id, second.id);
    const content = await readFile(
      path.join(dir, ".orchestrator", "memory", "architecture.md"),
      "utf8",
    );
    assert.ok(content.indexOf(first.id) < content.indexOf(second.id));
    assert.ok(content.indexOf("## Durable state") < content.indexOf("## Worker boundary"));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 2);
    assert.equal(metadata.lastMemoryUpdate?.id, second.id);
    assert.equal(metadata.lastMemoryUpdate?.taskId, "task-b");
  });
});

test("architecture update primitive rejects missing provenance or content", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await assert.rejects(
      store.appendArchitectureUpdate({
        taskId: "",
        title: "Architecture",
        content: "content",
        rationale: "reason",
      }),
      /taskId is required/,
    );
    await assert.rejects(
      store.appendArchitectureUpdate({
        taskId: "task-1",
        title: "Architecture",
        content: " ",
        rationale: "reason",
      }),
      /content is required/,
    );
    await assert.rejects(
      store.appendArchitectureUpdate({
        taskId: "task-1",
        title: "Architecture",
        content: "content",
        rationale: "reason",
        recordedAt: "not-a-date",
      }),
      /recordedAt is not a valid timestamp/,
    );
  });
});

test("unsupported project metadata schema is rejected instead of silently rewritten", async () => {
  await withWorkspace(async (dir) => {
    const orchestratorDir = path.join(dir, ".orchestrator");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(orchestratorDir, { recursive: true }));
    await writeFile(
      path.join(orchestratorDir, "project.json"),
      JSON.stringify({ schemaVersion: 99, projectId: "future" }) + "\n",
      "utf8",
    );

    await assert.rejects(
      new ProjectMemoryStore(dir).ensure(),
      /Unsupported or missing project metadata schema/,
    );
  });
});
