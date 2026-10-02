import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectMemoryStore } from "./project-memory.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-conventions-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("convention updates preserve existing content and carry scope plus task/date/rationale provenance", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.ensure();
    const conventionsPath = path.join(dir, ".orchestrator", "memory", "conventions.md");
    await writeFile(conventionsPath, "# Conventions\n\nHuman-authored convention.\n", "utf8");

    const update = await store.appendConventionUpdate({
      taskId: "task-conventions-1",
      title: "Keep validation commands explicit",
      scope: "validation",
      convention: "Validation commands must remain explicit task configuration and execute outside the model.",
      rationale: "Future work must not silently invent or broaden trusted execution commands.",
      recordedAt: "2026-09-21T11:00:00.000Z",
    });

    assert.equal(update.schemaVersion, 1);
    assert.equal(update.document, "conventions");
    assert.equal(update.title, "Keep validation commands explicit");
    assert.equal(update.scope, "validation");
    assert.equal(update.taskId, "task-conventions-1");
    assert.equal(update.recordedAt, "2026-09-21T11:00:00.000Z");
    assert.ok(update.id);

    const content = await readFile(conventionsPath, "utf8");
    assert.match(content, /^# Conventions\n\nHuman-authored convention\./);
    assert.match(content, /<!-- orchestrator-memory-update \{/);
    assert.match(content, /"document":"conventions"/);
    assert.match(content, /"scope":"validation"/);
    assert.match(content, /## Keep validation commands explicit/);
    assert.match(content, /Task: `task-conventions-1`/);
    assert.match(content, /Recorded at: 2026-09-21T11:00:00\.000Z/);
    assert.match(content, /Scope: validation/);
    assert.match(content, /Rationale: Future work must not silently invent or broaden trusted execution commands\./);
    assert.match(content, /### Convention/);
    assert.match(content, /Validation commands must remain explicit task configuration and execute outside the model\./);
    assert.match(content, new RegExp(update.id));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 1);
    assert.deepEqual(metadata.lastMemoryUpdate, {
      id: update.id,
      document: "conventions",
      recordedAt: "2026-09-21T11:00:00.000Z",
      taskId: "task-conventions-1",
      rationale: "Future work must not silently invent or broaden trusted execution commands.",
    });
  });
});

test("convention update primitive rejects missing convention fields or invalid timestamp", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const base = {
      taskId: "task-conventions",
      title: "Convention",
      scope: "project",
      convention: "Preserve durable project rules.",
      rationale: "Keep future work consistent.",
    };

    await assert.rejects(
      store.appendConventionUpdate({ ...base, taskId: "" }),
      /taskId is required/,
    );
    await assert.rejects(
      store.appendConventionUpdate({ ...base, title: " " }),
      /title is required/,
    );
    await assert.rejects(
      store.appendConventionUpdate({ ...base, scope: " " }),
      /scope is required/,
    );
    await assert.rejects(
      store.appendConventionUpdate({ ...base, convention: " " }),
      /convention is required/,
    );
    await assert.rejects(
      store.appendConventionUpdate({ ...base, rationale: " " }),
      /rationale is required/,
    );
    await assert.rejects(
      store.appendConventionUpdate({ ...base, recordedAt: "not-a-date" }),
      /recordedAt is not a valid timestamp/,
    );
  });
});

test("project memory audit count stays coherent when conventions follow another memory document", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.appendCodeMapUpdate({
      taskId: "task-code-map",
      component: "Project memory store",
      paths: ["src/project-memory.ts"],
      responsibility: "Persist durable project memory.",
      rationale: "Map the important persistence boundary.",
      recordedAt: "2026-09-21T11:01:00.000Z",
    });
    const convention = await store.appendConventionUpdate({
      taskId: "task-conventions",
      title: "Protect shared runtime",
      scope: "runtime safety",
      convention: "Automated tests must not mutate the shared Ollama runtime without explicit authorization.",
      rationale: "Preserve a stable shared development environment.",
      recordedAt: "2026-09-21T11:02:00.000Z",
    });

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 2);
    assert.equal(metadata.lastMemoryUpdate?.id, convention.id);
    assert.equal(metadata.lastMemoryUpdate?.document, "conventions");
    assert.equal(metadata.lastMemoryUpdate?.taskId, "task-conventions");
  });
});
