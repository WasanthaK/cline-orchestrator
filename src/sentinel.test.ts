import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OrchestratorSentinel,
  SentinelError,
} from "./sentinel.js";
import { TaskStore } from "./state.js";
import type { OrchestratorTask } from "./types.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_A = "22222222-2222-4222-8222-222222222222";
const TASK_B = "33333333-3333-4333-8333-333333333333";

function task(root: string, id: string, overrides: Record<string, unknown> = {}): OrchestratorTask {
  return {
    id,
    goal: "sentinel test task",
    workspace: root,
    status: "created",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  } as OrchestratorTask;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-sentinel-"));
  const store = new TaskStore(root);
  await store.save(task(root, TASK_A));
  await store.save(task(root, TASK_B));
  let counter = 0;
  const sentinel = new OrchestratorSentinel(root, WORKSPACE_ID, {
    now: () => new Date("2026-09-25T02:00:00.000Z"),
    idFactory: () => {
      counter += 1;
      return `77777777-7777-4777-8${String(counter).padStart(3, "0")}-777777777777`;
    },
  });
  return { root, store, sentinel };
}

test("sentinel ingests durable failure events once and repeated scans do not inflate occurrences", async () => {
  const { root, store, sentinel } = await fixture();
  try {
    await store.appendEvent(TASK_A, "validation_failed", {
      status: "validation_failed",
      message: "Validation failed after 1/1 commands",
    });

    let incidents = await sentinel.ingestTask(TASK_A);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.kind, "validation_failure");
    assert.equal(incidents[0]?.occurrenceCount, 1);
    assert.deepEqual(incidents[0]?.taskIds, [TASK_A]);

    incidents = await sentinel.ingestTask(TASK_A);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.occurrenceCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("equivalent incidents deduplicate across tasks while retaining affected task and event references", async () => {
  const { root, store, sentinel } = await fixture();
  try {
    await store.appendEvent(TASK_A, "validation_failed", {
      status: "validation_failed",
      message: "Validation failed after 1/1 commands",
    });
    await store.appendEvent(TASK_B, "validation_failed", {
      status: "validation_failed",
      message: "Validation failed after 2/2 commands",
    });

    await sentinel.ingestTask(TASK_A);
    const incidents = await sentinel.ingestTask(TASK_B);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.kind, "validation_failure");
    assert.equal(incidents[0]?.occurrenceCount, 2);
    assert.deepEqual(new Set(incidents[0]?.taskIds), new Set([TASK_A, TASK_B]));
    assert.equal(incidents[0]?.eventIds.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sentinel journal redacts credentials, URLs, paths and raw UUIDs from incident summaries", async () => {
  const { root, store, sentinel } = await fixture();
  try {
    const failed = await store.load(TASK_A);
    failed.status = "failed";
    failed.finishReason = "provider_preflight_failed";
    failed.error = "api_key=super-secret https://example.invalid/private C:\\Users\\User\\secret.txt";
    await store.save(failed);

    const incidents = await sentinel.ingestTask(TASK_A);
    const incident = incidents.find((item) => item.kind === "provider_failure");
    assert.ok(incident);
    assert.equal(incident?.failClosed, true);

    const raw = await readFile(
      path.join(root, ".orchestrator", "sentinel", "observations.jsonl"),
      "utf8",
    );
    assert.equal(raw.includes("super-secret"), false);
    assert.equal(raw.includes("example.invalid"), false);
    assert.equal(raw.includes("C:\\Users\\User"), false);
    assert.ok(raw.includes("[REDACTED]") || raw.includes("[URL]") || raw.includes("[PATH]"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sentinel resolves incidents only from a real later allowed durable task event", async () => {
  const { root, store, sentinel } = await fixture();
  try {
    await store.appendEvent(TASK_A, "validation_failed", {
      status: "validation_failed",
      message: "Validation failed",
    });
    const incidents = await sentinel.ingestTask(TASK_A);
    const incident = incidents[0]!;

    const unrelated = await store.appendEvent(TASK_A, "git_snapshot", {
      status: "validation_failed",
      message: "Git snapshot",
    });
    await assert.rejects(
      sentinel.resolveIncident(incident.fingerprint, TASK_A, unrelated.id),
      (error: unknown) =>
        error instanceof SentinelError && error.code === "resolution_evidence_invalid",
    );

    const passed = await store.appendEvent(TASK_A, "validation_passed", {
      status: "completed",
      message: "Validation passed",
    });
    const resolved = await sentinel.resolveIncident(incident.fingerprint, TASK_A, passed.id);
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.humanActionRequired, false);
    assert.equal(resolved.resolutionEvidenceEventId, passed.id);
    assert.equal(resolved.occurrenceCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sentinel surfaces fail-closed diff safety and human escalation incidents without granting recovery authority", async () => {
  const { root, store, sentinel } = await fixture();
  try {
    await store.appendEvent(TASK_A, "diff_safety_failed", {
      status: "failed",
      message: "Diff safety refused an out-of-scope edit",
    });
    await store.appendEvent(TASK_A, "human_escalation_requested", {
      status: "waiting_for_human",
      message: "Human approval required",
    });

    const incidents = await sentinel.ingestTask(TASK_A);
    const diff = incidents.find((item) => item.kind === "diff_safety_failure");
    const escalation = incidents.find((item) => item.kind === "human_escalation");
    assert.equal(diff?.severity, "critical");
    assert.equal(diff?.failClosed, true);
    assert.equal(diff?.humanActionRequired, true);
    assert.equal(escalation?.humanActionRequired, true);

    assert.deepEqual(
      Object.getOwnPropertyNames(Object.getPrototypeOf(sentinel)).sort(),
      ["constructor", "ingestTask", "listIncidents", "resolveIncident"].sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
