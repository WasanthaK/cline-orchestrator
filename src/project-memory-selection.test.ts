import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildContextHandoffPrompt,
  createContextHandoff,
} from "./context-handoff.js";
import { ProjectMemoryStore } from "./project-memory.js";
import {
  PROJECT_MEMORY_SELECTION_MAX_ENTRIES,
  PROJECT_MEMORY_SELECTION_MAX_EXCERPT_CHARS,
  PROJECT_MEMORY_SELECTION_MAX_PER_DOCUMENT,
  selectProjectMemory,
} from "./project-memory-selection.js";
import type { OrchestratorTask } from "./types.js";

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-memory-selection-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("selective retrieval returns relevant auditable entries and excludes unrelated memory", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const architecture = await store.appendArchitectureUpdate({
      taskId: "task-context",
      title: "Context recovery boundary",
      content: "Context rotation recovery must continue from durable handoff state and project memory provenance.",
      rationale: "Keep context recovery independent from hidden model history.",
      recordedAt: "2026-09-21T12:30:00.000Z",
    });
    const convention = await store.appendConventionUpdate({
      taskId: "task-safety",
      title: "Recovery context stays bounded",
      scope: "context rotation",
      convention: "Only bounded durable context should be supplied during session recovery.",
      rationale: "Prevent prompt growth during repeated context rotation.",
      recordedAt: "2026-09-21T12:31:00.000Z",
    });
    const unrelated = await store.appendDecisionUpdate({
      taskId: "task-billing",
      title: "Billing export format",
      decision: "Use CSV for the monthly finance export.",
      rationale: "Finance requested spreadsheet compatibility.",
      recordedAt: "2026-09-21T12:32:00.000Z",
    });

    const selection = await selectProjectMemory(dir, {
      query: "continue context rotation recovery using durable handoff memory",
    });

    assert.equal(selection.schemaVersion, 1);
    assert.ok(selection.queryTerms.includes("context"));
    assert.ok(selection.queryTerms.includes("rotation"));
    assert.ok(selection.totalCandidates >= 3);
    assert.ok(selection.entries.some((entry) => entry.id === architecture.id));
    assert.ok(selection.entries.some((entry) => entry.id === convention.id));
    assert.ok(!selection.entries.some((entry) => entry.id === unrelated.id));
    for (const entry of selection.entries) {
      assert.ok(entry.score > 0);
      assert.ok(entry.id);
      assert.ok(entry.taskId);
      assert.ok(entry.recordedAt);
      assert.ok(entry.rationale);
      assert.match(entry.relativePath, /^\.orchestrator\/memory\//);
    }
  });
});

test("retrieval is bounded globally, per document, and per excerpt", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    for (let index = 0; index < 3; index += 1) {
      await store.appendArchitectureUpdate({
        taskId: `task-architecture-${index}`,
        title: `Retrieval architecture ${index}`,
        content: `selective retrieval memory ${"x".repeat(2_200)} architecture ${index}`,
        rationale: "Exercise selective retrieval bounding.",
        recordedAt: `2026-09-21T12:4${index}:00.000Z`,
      });
      await store.appendDecisionUpdate({
        taskId: `task-decision-${index}`,
        title: `Retrieval decision ${index}`,
        decision: `Selective retrieval memory decision ${index}`,
        rationale: "Exercise selective retrieval bounding.",
        recordedAt: `2026-09-21T12:5${index}:00.000Z`,
      });
      await store.appendConventionUpdate({
        taskId: `task-convention-${index}`,
        title: `Retrieval convention ${index}`,
        scope: "memory retrieval",
        convention: `Selective retrieval memory convention ${index}`,
        rationale: "Exercise selective retrieval bounding.",
        recordedAt: `2026-09-21T13:0${index}:00.000Z`,
      });
    }

    const selection = await selectProjectMemory(dir, {
      query: "selective retrieval memory",
      maxEntries: PROJECT_MEMORY_SELECTION_MAX_ENTRIES,
    });

    assert.ok(selection.entries.length <= PROJECT_MEMORY_SELECTION_MAX_ENTRIES);
    const counts = new Map<string, number>();
    for (const entry of selection.entries) {
      counts.set(entry.document, (counts.get(entry.document) ?? 0) + 1);
      assert.ok((counts.get(entry.document) ?? 0) <= PROJECT_MEMORY_SELECTION_MAX_PER_DOCUMENT);
      assert.ok(entry.excerpt.length <= PROJECT_MEMORY_SELECTION_MAX_EXCERPT_CHARS + 40);
    }
    assert.ok(selection.entries.some((entry) => entry.excerptTruncated));

    await assert.rejects(
      selectProjectMemory(dir, {
        query: "memory",
        maxEntries: PROJECT_MEMORY_SELECTION_MAX_ENTRIES + 1,
      }),
      /maxEntries must be an integer between 1 and 6/,
    );
  });
});

test("task identity can select its own durable provenance without broad memory dumping", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const own = await store.appendKnownIssueUpdate({
      taskId: "current-task",
      title: "Unrelated wording but same task provenance",
      status: "open",
      impact: "This should remain attributable to the current task.",
      description: "No keyword overlap is required when task provenance matches exactly.",
      rationale: "Task-local durable memory should remain discoverable.",
      recordedAt: "2026-09-21T13:10:00.000Z",
    });
    await store.appendDecisionUpdate({
      taskId: "other-task",
      title: "Totally separate finance topic",
      decision: "Archive invoices quarterly.",
      rationale: "Separate domain.",
      recordedAt: "2026-09-21T13:11:00.000Z",
    });

    const selection = await selectProjectMemory(dir, {
      query: "context continuation",
      taskId: "current-task",
    });

    assert.ok(selection.entries.some((entry) => entry.id === own.id));
    assert.ok(selection.entries.length < selection.totalCandidates);
  });
});

test("context handoff receives only selected bounded memory and omits irrelevant sentinels", async () => {
  await withWorkspace(async (dir) => {
    const store = new ProjectMemoryStore(dir);
    const relevant = await store.appendArchitectureUpdate({
      taskId: "prior-context-work",
      title: "Context handoff memory retrieval",
      content: "Recovery handoffs should retrieve only relevant bounded project memory entries.",
      rationale: "Keep replacement-session context focused.",
      recordedAt: "2026-09-21T13:20:00.000Z",
    });
    await store.appendKnownIssueUpdate({
      taskId: "unrelated-domain",
      title: "Unrelated billing issue",
      status: "open",
      impact: "IRRELEVANT_MEMORY_SENTINEL must never appear in the context-recovery prompt.",
      description: "Finance reconciliation is unrelated to context handoff retrieval.",
      rationale: "Exercise exclusion of irrelevant memory.",
      recordedAt: "2026-09-21T13:21:00.000Z",
    });

    const now = "2026-09-21T13:22:00.000Z";
    const task: OrchestratorTask = {
      id: "handoff-selection-task",
      goal: "Improve context handoff recovery with selective project memory retrieval",
      workspace: dir,
      status: "running",
      createdAt: now,
      updatedAt: now,
      acceptanceCriteria: ["Supply relevant bounded memory during context recovery"],
      expectedChangedPaths: ["src/context-handoff.ts", "src/project-memory-selection.ts"],
      runCount: 1,
      sessionGeneration: 1,
    };

    const created = await createContextHandoff(dir, task, {
      reason: "context_threshold",
      pendingAction: "Continue selective project memory retrieval for context handoffs",
      sourceSessionId: "session-old",
      targetGeneration: 2,
    });

    const selection = created.artifact.durableMemory?.selection;
    assert.ok(selection);
    assert.ok(selection.entries.some((entry) => entry.id === relevant.id));
    assert.ok(selection.entries.length <= PROJECT_MEMORY_SELECTION_MAX_ENTRIES);
    assert.doesNotMatch(JSON.stringify(selection), /IRRELEVANT_MEMORY_SENTINEL/);

    const prompt = buildContextHandoffPrompt(created.artifact, created.reference);
    assert.match(prompt, /Context handoff memory retrieval/);
    assert.doesNotMatch(prompt, /IRRELEVANT_MEMORY_SENTINEL/);
  });
});
