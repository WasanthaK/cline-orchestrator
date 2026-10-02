import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProjectMemory } from "./project-memory-audit.js";
import { ProjectMemoryStore } from "./project-memory.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-memory-audit-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("project memory audit verifies every explicit update path end-to-end", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const architecture = await store.appendArchitectureUpdate({
      taskId: "audit-task-architecture",
      title: "Runtime boundary",
      content: "The orchestrator owns durable runtime state.",
      rationale: "Record an auditable architecture update.",
      recordedAt: "2026-09-21T14:00:00.000Z",
    });
    const decision = await store.appendDecisionUpdate({
      taskId: "audit-task-decision",
      title: "Use append-only project memory",
      decision: "Project-memory updates append instead of replacing prior history.",
      rationale: "Preserve durable decision history.",
      recordedAt: "2026-09-21T14:01:00.000Z",
    });
    const codeMap = await store.appendCodeMapUpdate({
      taskId: "audit-task-code-map",
      component: "Project memory store",
      paths: ["src/project-memory.ts"],
      responsibility: "Persist explicit project-memory updates and metadata references.",
      rationale: "Make the important module auditable.",
      recordedAt: "2026-09-21T14:02:00.000Z",
    });
    const convention = await store.appendConventionUpdate({
      taskId: "audit-task-convention",
      title: "Preserve provenance",
      scope: "project memory",
      convention: "Every orchestrator-authored memory update carries task/date/rationale provenance.",
      rationale: "Future work must keep the audit chain intact.",
      recordedAt: "2026-09-21T14:03:00.000Z",
    });
    const knownIssue = await store.appendKnownIssueUpdate({
      taskId: "audit-task-known-issue",
      title: "Audit drift",
      status: "open",
      impact: "Manual edits could make metadata and durable provenance disagree.",
      description: "The audit verifier must detect metadata/provenance drift.",
      rationale: "Record the remaining audit risk explicitly.",
      recordedAt: "2026-09-21T14:04:00.000Z",
    });

    const report = await auditProjectMemory(dir);

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.passed, true);
    assert.equal(report.expectedUpdateCount, 5);
    assert.equal(report.discoveredUpdateCount, 5);
    assert.deepEqual(report.issues, []);

    const expected = new Map([
      [architecture.id, "architecture"],
      [decision.id, "decisions"],
      [codeMap.id, "codeMap"],
      [convention.id, "conventions"],
      [knownIssue.id, "knownIssues"],
    ]);
    for (const entry of report.entries) {
      assert.equal(entry.document, expected.get(entry.id));
      assert.ok(entry.taskId.startsWith("audit-task-"));
      assert.ok(entry.rationale.length > 0);
      assert.ok(!Number.isNaN(Date.parse(entry.recordedAt)));
      assert.match(entry.relativePath, /^\.orchestrator\/memory\//);
      expected.delete(entry.id);
    }
    assert.equal(expected.size, 0);
  });
});

test("project memory audit detects duplicate durable provenance and metadata count drift", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.appendArchitectureUpdate({
      taskId: "duplicate-audit-task",
      title: "Single durable update",
      content: "This update should appear exactly once.",
      rationale: "Exercise duplicate provenance detection.",
      recordedAt: "2026-09-21T14:10:00.000Z",
    });

    const architecturePath = path.join(dir, ".orchestrator", "memory", "architecture.md");
    const content = await readFile(architecturePath, "utf8");
    const marker = content.match(/<!-- orchestrator-memory-update .*? -->/)?.[0];
    assert.ok(marker);
    await appendFile(architecturePath, `\n${marker}\n## Duplicate injected copy\n`, "utf8");

    const report = await auditProjectMemory(dir);

    assert.equal(report.passed, false);
    assert.equal(report.expectedUpdateCount, 1);
    assert.equal(report.discoveredUpdateCount, 2);
    assert.ok(report.issues.some((issue) => issue.code === "duplicate_update_id"));
    assert.ok(report.issues.some((issue) => issue.code === "metadata_count_mismatch"));
  });
});

test("project memory audit detects last-update metadata drift", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const update = await store.appendConventionUpdate({
      taskId: "metadata-drift-task",
      title: "Keep metadata aligned",
      scope: "project memory audit",
      convention: "Project metadata must point to the exact latest durable update reference.",
      rationale: "Exercise latest-reference audit verification.",
      recordedAt: "2026-09-21T14:20:00.000Z",
    });

    const projectPath = path.join(dir, ".orchestrator", "project.json");
    const metadata = JSON.parse(await readFile(projectPath, "utf8"));
    metadata.lastMemoryUpdate = {
      ...metadata.lastMemoryUpdate,
      id: update.id,
      rationale: "tampered rationale",
    };
    await writeFile(projectPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");

    const report = await auditProjectMemory(dir);

    assert.equal(report.passed, false);
    assert.equal(report.discoveredUpdateCount, 1);
    assert.ok(report.issues.some((issue) => issue.code === "last_update_mismatch"));
  });
});
