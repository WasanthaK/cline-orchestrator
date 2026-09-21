import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "./state.js";
import type { OrchestratorTask, ValidationRun } from "./types.js";

async function withStore<T>(fn: (store: TaskStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-state-"));
  try {
    return await fn(new TaskStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: "validation-gate-test",
    goal: "Test validation gate",
    workspace: "/tmp/workspace",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    validationCommands: ["npm test"],
  };
}

function validation(passed: boolean): ValidationRun {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    passed,
    commandsRequested: 1,
    commandsRun: 1,
    results: [
      {
        command: "npm test",
        startedAt: now,
        completedAt: now,
        durationMs: 1,
        exitCode: passed ? 0 : 1,
        timedOut: false,
        aborted: false,
        stdout: "",
        stderr: passed ? "" : "failed",
      },
    ],
  };
}

test("Cline completed is atomically converted to validating until validation passes", async () => {
  await withStore(async (store) => {
    const value = task();
    await store.save(value);

    value.status = "completed";
    value.finishReason = "completed";
    await store.save(value);

    assert.equal(value.status, "validating");
    assert.equal(value.validationRunCount, 1);
    assert.equal((await store.load(value.id)).status, "validating");

    let eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("validation_started"));
    assert.equal(eventTypes.includes("completed"), false);

    value.lastValidation = validation(true);
    value.status = "completed";
    await store.save(value);

    assert.equal((await store.load(value.id)).status, "completed");
    eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("validation_passed"));
    assert.ok(eventTypes.includes("completed"));
  });
});

test("failed validation persists as validation_failed instead of generic completed", async () => {
  await withStore(async (store) => {
    const value = task();
    value.id = "validation-failure-test";
    await store.save(value);

    value.status = "completed";
    value.finishReason = "completed";
    await store.save(value);
    assert.equal(value.status, "validating");

    value.lastValidation = validation(false);
    value.status = "validation_failed";
    value.finishReason = "validation_failed";
    value.error = "Validation command failed";
    await store.save(value);

    const persisted = await store.load(value.id);
    assert.equal(persisted.status, "validation_failed");
    const eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("validation_failed"));
    assert.equal(eventTypes.includes("completed"), false);
  });
});

test("failed validation with repair budget remains nonterminal and records repair lifecycle", async () => {
  await withStore(async (store) => {
    const value = task();
    value.id = "validation-repair-test";
    await store.save(value);

    value.status = "completed";
    value.finishReason = "completed";
    await store.save(value);
    assert.equal(value.status, "validating");

    value.lastValidation = validation(false);
    value.validationRepairCount = 1;
    value.status = "repairing";
    value.finishReason = undefined;
    value.error = "Validation command failed";
    await store.save(value);

    const persisted = await store.load(value.id);
    assert.equal(persisted.status, "repairing");
    const eventTypes = (await store.events(value.id)).map((event) => event.type);
    assert.ok(eventTypes.includes("validation_failed"));
    assert.ok(eventTypes.includes("validation_repairing"));
    assert.equal(eventTypes.includes("completed"), false);
  });
});
