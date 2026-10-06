import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CODE_MAP_MAX_PATHS, ProjectMemoryStore } from "./project-memory.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-code-map-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("code-map entries are selective, append-only, and carry explicit provenance", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.ensure();
    const codeMapPath = path.join(dir, ".orchestrator", "memory", "code-map.md");
    await writeFile(codeMapPath, "# Code Map\n\nHuman-authored important component.\n", "utf8");

    const update = await store.appendCodeMapUpdate({
      taskId: "task-code-map-1",
      component: "Project memory store",
      paths: ["src/project-memory.ts", "src/state.ts"],
      responsibility: "Owns durable project metadata and the controlled memory update primitives used by task persistence.",
      rationale: "Future sessions need the important persistence boundary without cataloguing every source file.",
      recordedAt: "2026-09-21T10:30:00.000Z",
    });

    assert.equal(update.schemaVersion, 1);
    assert.equal(update.document, "codeMap");
    assert.equal(update.component, "Project memory store");
    assert.deepEqual(update.paths, ["src/project-memory.ts", "src/state.ts"]);
    assert.equal(update.taskId, "task-code-map-1");
    assert.equal(update.recordedAt, "2026-09-21T10:30:00.000Z");
    assert.ok(update.id);

    const content = await readFile(codeMapPath, "utf8");
    assert.match(content, /^# Code Map\n\nHuman-authored important component\./);
    assert.match(content, /<!-- orchestrator-memory-update \{/);
    assert.match(content, /"document":"codeMap"/);
    assert.match(content, /"component":"Project memory store"/);
    assert.match(content, /"paths":\["src\/project-memory\.ts","src\/state\.ts"\]/);
    assert.match(content, /## Project memory store/);
    assert.match(content, /Task: `task-code-map-1`/);
    assert.match(content, /Recorded at: 2026-09-21T10:30:00\.000Z/);
    assert.match(content, /### Important paths/);
    assert.match(content, /- `src\/project-memory\.ts`/);
    assert.match(content, /- `src\/state\.ts`/);
    assert.match(content, /### Responsibility/);
    assert.match(content, /Owns durable project metadata and the controlled memory update primitives/);
    assert.match(content, new RegExp(update.id));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 1);
    assert.deepEqual(metadata.lastMemoryUpdate, {
      id: update.id,
      document: "codeMap",
      recordedAt: "2026-09-21T10:30:00.000Z",
      taskId: "task-code-map-1",
      rationale: "Future sessions need the important persistence boundary without cataloguing every source file.",
    });
  });
});

test("code-map input is deliberately bounded to important representative paths", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);

    await assert.rejects(
      store.appendCodeMapUpdate({
        taskId: "task-code-map",
        component: "Empty map",
        paths: [],
        responsibility: "Should not be persisted.",
        rationale: "test",
      }),
      /paths must contain at least one important path/,
    );

    await assert.rejects(
      store.appendCodeMapUpdate({
        taskId: "task-code-map",
        component: "Over-broad map",
        paths: Array.from({ length: CODE_MAP_MAX_PATHS + 1 }, (_, index) => `src/file-${index}.ts`),
        responsibility: "Attempts to inventory too many files.",
        rationale: "test",
      }),
      new RegExp(`paths must contain at most ${CODE_MAP_MAX_PATHS} entries`),
    );

    await assert.rejects(
      store.appendCodeMapUpdate({
        taskId: "task-code-map",
        component: "Duplicate paths",
        paths: ["src/project-memory.ts", "src/project-memory.ts"],
        responsibility: "Should not duplicate representative paths.",
        rationale: "test",
      }),
      /paths must not contain duplicates/,
    );

    await assert.rejects(
      store.appendCodeMapUpdate({
        taskId: "task-code-map",
        component: "Missing responsibility",
        paths: ["src/project-memory.ts"],
        responsibility: " ",
        rationale: "test",
      }),
      /responsibility is required/,
    );

    await assert.rejects(
      store.appendCodeMapUpdate({
        taskId: "task-code-map",
        component: "Invalid date",
        paths: ["src/project-memory.ts"],
        responsibility: "Owns project memory.",
        rationale: "test",
        recordedAt: "not-a-date",
      }),
      /recordedAt is not a valid timestamp/,
    );
  });
});

test("project memory audit count stays coherent across architecture, decisions, and code map", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.appendArchitectureUpdate({
      taskId: "task-architecture",
      title: "Durable state boundary",
      content: "Project continuity belongs to durable orchestrator state.",
      rationale: "Record the architecture boundary.",
      recordedAt: "2026-09-21T10:31:00.000Z",
    });
    await store.appendDecisionUpdate({
      taskId: "task-decision",
      title: "Append-only memory",
      decision: "Project memory changes retain historical entries.",
      rationale: "Preserve audit provenance.",
      recordedAt: "2026-09-21T10:32:00.000Z",
    });
    const codeMap = await store.appendCodeMapUpdate({
      taskId: "task-code-map",
      component: "Project memory store",
      paths: ["src/project-memory.ts"],
      responsibility: "Persists project memory and audit references.",
      rationale: "Map the important persistence module.",
      recordedAt: "2026-09-21T10:33:00.000Z",
    });

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 3);
    assert.equal(metadata.lastMemoryUpdate?.id, codeMap.id);
    assert.equal(metadata.lastMemoryUpdate?.document, "codeMap");
    assert.equal(metadata.lastMemoryUpdate?.taskId, "task-code-map");
  });
});
