import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectMemoryStore } from "./project-memory.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-known-issues-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("known-issue updates preserve existing content and carry status, impact, and provenance", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.ensure();
    const issuesPath = path.join(dir, ".orchestrator", "memory", "known-issues.md");
    await writeFile(issuesPath, "# Known Issues\n\nHuman-authored unresolved risk.\n", "utf8");

    const update = await store.appendKnownIssueUpdate({
      taskId: "task-known-issue-1",
      title: "Shared Ollama runtime must remain protected",
      status: "open",
      impact: "Automated runtime mutation could disrupt active development sessions and invalidate test evidence.",
      description: "Self-hosted tests must not stop, unload, restart, or switch models in the shared Ollama environment without explicit authorization.",
      rationale: "Future sessions need this operational constraint to remain visible until an isolated runtime is available.",
      recordedAt: "2026-09-21T11:30:00.000Z",
    });

    assert.equal(update.schemaVersion, 1);
    assert.equal(update.document, "knownIssues");
    assert.equal(update.title, "Shared Ollama runtime must remain protected");
    assert.equal(update.status, "open");
    assert.equal(update.taskId, "task-known-issue-1");
    assert.equal(update.recordedAt, "2026-09-21T11:30:00.000Z");
    assert.ok(update.id);

    const content = await readFile(issuesPath, "utf8");
    assert.match(content, /^# Known Issues\n\nHuman-authored unresolved risk\./);
    assert.match(content, /<!-- orchestrator-memory-update \{/);
    assert.match(content, /"document":"knownIssues"/);
    assert.match(content, /"status":"open"/);
    assert.match(content, /## Shared Ollama runtime must remain protected/);
    assert.match(content, /Task: `task-known-issue-1`/);
    assert.match(content, /Recorded at: 2026-09-21T11:30:00\.000Z/);
    assert.match(content, /Status: open/);
    assert.match(content, /### Impact/);
    assert.match(content, /Automated runtime mutation could disrupt active development sessions/);
    assert.match(content, /### Description/);
    assert.match(content, /Self-hosted tests must not stop, unload, restart, or switch models/);
    assert.match(content, /Rationale: Future sessions need this operational constraint/);
    assert.match(content, new RegExp(update.id));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 1);
    assert.deepEqual(metadata.lastMemoryUpdate, {
      id: update.id,
      document: "knownIssues",
      recordedAt: "2026-09-21T11:30:00.000Z",
      taskId: "task-known-issue-1",
      rationale: "Future sessions need this operational constraint to remain visible until an isolated runtime is available.",
    });
  });
});

test("known-issue status is explicit and supports append-only lifecycle updates", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const first = await store.appendKnownIssueUpdate({
      taskId: "task-risk-open",
      title: "Handoff retention policy",
      status: "open",
      impact: "Durable per-generation handoffs can grow without a retention policy.",
      description: "Retention and compaction remain intentionally deferred while project-memory behavior is completed.",
      rationale: "Track the unresolved storage-policy risk.",
      recordedAt: "2026-09-21T11:31:00.000Z",
    });
    const second = await store.appendKnownIssueUpdate({
      taskId: "task-risk-mitigated",
      title: "Handoff retention policy",
      status: "mitigated",
      impact: "Growth remains bounded operationally while formal compaction is still pending.",
      description: "Operational limits now reduce accumulation risk, but a durable compaction policy is still required.",
      rationale: "Record changed issue state without deleting the original history.",
      recordedAt: "2026-09-21T11:32:00.000Z",
    });

    const content = await readFile(
      path.join(dir, ".orchestrator", "memory", "known-issues.md"),
      "utf8",
    );
    assert.ok(content.indexOf(first.id) < content.indexOf(second.id));
    assert.ok(content.indexOf("Status: open") < content.indexOf("Status: mitigated"));

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 2);
    assert.equal(metadata.lastMemoryUpdate?.id, second.id);
    assert.equal(metadata.lastMemoryUpdate?.document, "knownIssues");
  });
});

test("known-issue update primitive rejects invalid status, missing fields, or invalid timestamp", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const base = {
      taskId: "task-known-issue",
      title: "Known issue",
      status: "open" as const,
      impact: "Future work could be affected.",
      description: "A durable issue description.",
      rationale: "Keep the risk visible.",
    };

    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, taskId: "" }),
      /taskId is required/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, title: " " }),
      /title is required/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, status: "unknown" as never }),
      /status must be one of: open, mitigated, resolved, accepted/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, impact: " " }),
      /impact is required/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, description: " " }),
      /description is required/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, rationale: " " }),
      /rationale is required/,
    );
    await assert.rejects(
      store.appendKnownIssueUpdate({ ...base, recordedAt: "not-a-date" }),
      /recordedAt is not a valid timestamp/,
    );
  });
});

test("project memory audit count stays coherent when known issues follow conventions", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    await store.appendConventionUpdate({
      taskId: "task-convention",
      title: "Protect shared runtime",
      scope: "runtime safety",
      convention: "Do not mutate the shared Ollama runtime without explicit authorization.",
      rationale: "Preserve stable development sessions.",
      recordedAt: "2026-09-21T11:33:00.000Z",
    });
    const issue = await store.appendKnownIssueUpdate({
      taskId: "task-known-issue",
      title: "Shared runtime isolation unavailable",
      status: "open",
      impact: "Destructive self-hosted E2E coverage remains deferred.",
      description: "An isolated runtime test window is not yet part of normal automated development.",
      rationale: "Keep the remaining runtime-testing constraint visible.",
      recordedAt: "2026-09-21T11:34:00.000Z",
    });

    const metadata = await store.load();
    assert.equal(metadata.memoryUpdateCount, 2);
    assert.equal(metadata.lastMemoryUpdate?.id, issue.id);
    assert.equal(metadata.lastMemoryUpdate?.document, "knownIssues");
    assert.equal(metadata.lastMemoryUpdate?.taskId, "task-known-issue");
  });
});
