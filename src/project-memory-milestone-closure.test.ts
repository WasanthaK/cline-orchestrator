import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProjectMemory } from "./project-memory-audit.js";
import { selectProjectMemory } from "./project-memory-selection.js";
import { ProjectMemoryStore } from "./project-memory.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-memory-closure-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("project memory survives reload, accepts later updates, audits cleanly, and selects stable relevant provenance", async () => {
  await withWorkspace(async (dir) => {
    const first = new ProjectMemoryStore(dir);
    const initial = await first.ensure();

    const architecture = await first.appendArchitectureUpdate({
      taskId: "context-runtime",
      title: "Context recovery boundary",
      content: "Context rotation recovery reads bounded durable handoff state instead of hidden conversation history.",
      rationale: "Preserve recovery behavior across replacement sessions.",
      recordedAt: "2026-09-21T14:00:00.000Z",
    });
    await first.appendDecisionUpdate({
      taskId: "finance-export",
      title: "Finance export format",
      decision: "Use CSV for monthly invoice export.",
      rationale: "Keep finance exports spreadsheet compatible.",
      recordedAt: "2026-09-21T14:01:00.000Z",
    });
    await first.appendCodeMapUpdate({
      taskId: "context-runtime",
      component: "Context handoff",
      paths: ["src/context-handoff.ts", "src/project-memory-selection.ts"],
      responsibility: "Build replacement-session handoffs with bounded selectively retrieved durable context.",
      rationale: "Map the modules responsible for context recovery.",
      recordedAt: "2026-09-21T14:02:00.000Z",
    });
    const convention = await first.appendConventionUpdate({
      taskId: "context-runtime",
      title: "Bound replacement context",
      scope: "context rotation and recovery",
      convention: "Replacement prompts receive only bounded relevant durable memory entries.",
      rationale: "Prevent context growth while preserving continuity.",
      recordedAt: "2026-09-21T14:03:00.000Z",
    });
    const issueOpen = await first.appendKnownIssueUpdate({
      taskId: "context-runtime",
      title: "Recovery relevance false positives",
      status: "open",
      impact: "Irrelevant durable records can waste replacement-session context.",
      description: "Generic words must not make unrelated project memory relevant to context recovery.",
      rationale: "Track the retrieval-quality risk explicitly.",
      recordedAt: "2026-09-21T14:04:00.000Z",
    });

    const reloaded = new ProjectMemoryStore(dir);
    const metadataAfterReload = await reloaded.load();
    assert.equal(metadataAfterReload.projectId, initial.projectId);
    assert.equal(metadataAfterReload.memoryUpdateCount, 5);
    assert.equal(metadataAfterReload.lastMemoryUpdate?.id, issueOpen.id);

    const issueResolved = await reloaded.appendKnownIssueUpdate({
      taskId: "context-runtime",
      title: "Recovery relevance false positives",
      status: "resolved",
      impact: "Generic orchestration terms no longer admit unrelated durable records.",
      description: "Selection requires meaningful relevance or exact task provenance and remains bounded.",
      rationale: "Record the lifecycle result after retrieval relevance was tightened.",
      recordedAt: "2026-09-21T14:05:00.000Z",
    });

    const metadataAfterUpdate = await new ProjectMemoryStore(dir).load();
    assert.equal(metadataAfterUpdate.projectId, initial.projectId);
    assert.equal(metadataAfterUpdate.memoryUpdateCount, 6);
    assert.equal(metadataAfterUpdate.lastMemoryUpdate?.id, issueResolved.id);
    assert.equal(metadataAfterUpdate.lastMemoryUpdate?.document, "knownIssues");

    const audit = await auditProjectMemory(dir);
    assert.equal(audit.passed, true);
    assert.equal(audit.expectedUpdateCount, 6);
    assert.equal(audit.discoveredUpdateCount, 6);
    assert.equal(audit.issues.length, 0);
    assert.equal(new Set(audit.entries.map((entry) => entry.id)).size, 6);

    const query = "context rotation recovery replacement handoff bounded relevant retrieval";
    const selectionOne = await selectProjectMemory(dir, { query });
    const selectionTwo = await selectProjectMemory(dir, { query });
    const idsOne = selectionOne.entries.map((entry) => entry.id);
    const idsTwo = selectionTwo.entries.map((entry) => entry.id);

    assert.deepEqual(idsTwo, idsOne);
    assert.ok(idsOne.includes(architecture.id));
    assert.ok(idsOne.includes(convention.id));
    assert.ok(idsOne.includes(issueResolved.id));
    assert.ok(selectionOne.entries.every((entry) => entry.score > 0));
    assert.ok(selectionOne.entries.every((entry) => entry.relativePath.startsWith(".orchestrator/memory/")));
    assert.ok(selectionOne.entries.length < audit.entries.length);
    assert.ok(!selectionOne.entries.some((entry) => entry.taskId === "finance-export"));
  });
});
