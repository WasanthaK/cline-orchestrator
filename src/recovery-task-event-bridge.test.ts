import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  projectDurableRecoveryEvents, readTrustedRecoveryEvents, RECOVERY_EVENT_LIMITS,
} from "./recovery-task-event-bridge.js";
import type { OrchestratorTask, TaskEvent, TaskEventType } from "./types.js";

const taskId = "70d6c44a-2c25-46c5-91b4-d1f3eacb359c";
const capturedAt = "2026-10-16T07:40:00.000Z";
const task = { id: taskId, status: "running" as const, runCount: 3 };
const E = (type: TaskEventType, at: number, id=crypto.randomUUID()): TaskEvent => ({
  id, taskId, type, timestamp: new Date(Date.parse("2026-10-16T07:00:00.000Z") + at * 1000).toISOString(),
  message: "Bearer fake-secret; C:\\Users\\Private\\code; private prompt",
  data: { prompt: "sensitive prompt", token: "sk-secret-123" },
});

test("M19R2B deduplicates repeated context pressure and resolves only with recorded handoff", () => {
  const events = [E("context_rotating", 1), E("context_rotating", 2),
    E("run_started", 3), E("context_handoff_created", 4)];
  const report = projectDurableRecoveryEvents(task, events, capturedAt);
  assert.equal(report.availability, "available");
  assert.equal(report.totalEvents, 4);
  assert.equal(report.totalIncidents, 1);
  assert.equal(report.incidents[0]?.occurrences, 2);
  assert.equal(report.incidents[0]?.state, "resolved");
  assert.equal(report.incidents[0]?.signal, "context_pressure");
  assert.equal(report.incidents[0]?.triage.skipExecutionPermitted, false);
  assert.equal(report.incidents[0]?.triage.state, "insufficient_evidence");
  assert.deepEqual(report, projectDurableRecoveryEvents(task, events, capturedAt));
  assert.doesNotMatch(JSON.stringify(report), /fake-secret|Private|sk-secret|sensitive|prompt|Bearer/i);
});

test("M19R2B watchdog stall is not resolved by token counts, retry, or new run", () => {
  const events = [E("stalled", 1), E("retrying", 2), E("run_started", 3), E("stalled", 4)];
  const first = projectDurableRecoveryEvents(task, events, capturedAt);
  assert.equal(first.incidents[0]?.state, "open");
  assert.equal(first.incidents[0]?.occurrences, 2);
  assert.equal(first.incidents[0]?.triage.advice, "change_strategy_review");
  assert.equal(first.noProgressFingerprintVerified, false);
  assert.equal(first.toolCompletionEvidenceAvailable, false);
  const second = projectDurableRecoveryEvents(task, [...events, E("session_recovered", 5),
    E("stalled", 6)], capturedAt);
  assert.equal(second.totalIncidents, 2);
  assert.equal(second.incidents[0]?.state, "open");
  assert.equal(second.incidents[1]?.state, "resolved");
  assert.notEqual(second.incidents[0]?.incidentId, second.incidents[1]?.incidentId);
});

test("M19R2B approvals stay human-required; only explicit approval/rejection resolves", () => {
  const pending = [E("human_escalation_requested", 1), E("human_escalation_requested", 2)];
  const report = projectDurableRecoveryEvents({ ...task, status: "waiting_for_human" }, pending, capturedAt);
  assert.equal(report.incidents[0]?.triage.advice, "escalate_to_human");
  assert.equal(report.incidents[0]?.triage.state, "needs_human");
  assert.equal(report.incidents[0]?.state, "open");
  const rejected = projectDurableRecoveryEvents(task, [...pending, E("human_escalation_rejected", 3)], capturedAt);
  assert.equal(rejected.incidents[0]?.state, "resolved");
});

test("M19R2B validation requires independent passed event; failing calls never mean success", () => {
  const events = [E("validation_failed", 1), E("validation_repairing", 2),
    E("validation_failed", 3), E("diff_safety_passed", 4)];
  const report = projectDurableRecoveryEvents(task, events, capturedAt);
  assert.equal(report.incidents[0]?.occurrences, 2);
  assert.equal(report.incidents[0]?.state, "open");
  assert.equal(report.validationPassedEvents, 0);
  assert.equal(report.diffSafetyPassedEvents, 1);
  assert.ok(report.lastIndependentCheckAt);
  const fixed = projectDurableRecoveryEvents(task, [...events, E("validation_passed", 5)], capturedAt);
  assert.equal(fixed.incidents[0]?.state, "resolved");
  assert.equal(fixed.validationPassedEvents, 1);
  assert.equal(fixed.incidents[0]?.triage.retryAuthorized, false);
});

test("M19R2B exact event source with sensitive fields yields bounded safe projection", async () => {
  const events = [E("stalled", 1)];
  const report = await readTrustedRecoveryEvents(taskId, {
    load: async () => task as OrchestratorTask, events: async () => events,
  }, capturedAt);
  assert.equal(report.availability, "available");
  assert.equal(report.incidents.length, 1);
  assert.equal(report.incidents[0]?.evidence, "durable_task_events");
  assert.equal(report.grantsAuthority, false);
  const failed = await readTrustedRecoveryEvents(taskId, {
    load: async () => { throw new Error("C:\\SECRET_KEY\\sensitive"); },
    events: async () => events,
  }, capturedAt);
  assert.equal(failed.reason, "read_failed");
  assert.doesNotMatch(JSON.stringify(failed), /SECRET_KEY|sensitive|\\SECRET/i);
});

test("M19R2B unknown, wrong-task, duplicate and unsorted events fail closed", () => {
  const valid = E("stalled", 5);
  const invalid = [
    [null], [{ ...valid, taskId: crypto.randomUUID() }],
    [{ ...valid, type: "arbitrary_event" }],
    [valid, valid], [valid, E("stalled", 1)],
    [{ ...valid, timestamp: "2030-10-16T07:00:00.000Z" }],
    [{ ...valid, id: "not-uuid" }],
    [{ ...valid, timestamp: "2026-13-16T07:00:00.000Z" }],
  ];
  for (const history of invalid) {
    const report = projectDurableRecoveryEvents(task, history, capturedAt);
    assert.equal(report.availability, "unavailable");
    assert.equal(report.incidents.length, 0);
  }
  assert.equal(projectDurableRecoveryEvents(task, {}, capturedAt).reason, "invalid_event_source");
  assert.equal(projectDurableRecoveryEvents(task,
    new Array(RECOVERY_EVENT_LIMITS.maxSourceEvents + 1).fill(valid), capturedAt).reason, "history_over_limit");
  assert.equal(projectDurableRecoveryEvents({ ...task, id: "C:\\users\\private" }, [], capturedAt).reason, "invalid_task");
});

test("M19R2B many episodes truncate displayed incidents without converting to zero", () => {
  const events: TaskEvent[] = [];
  for (let i = 0; i < 50; i++) {
    events.push(E("stalled", i * 2), E("session_recovered", i * 2 + 1));
  }
  const report = projectDurableRecoveryEvents(task, events, capturedAt);
  assert.equal(report.totalIncidents, 50);
  assert.equal(report.incidents.length, 40);
  assert.equal(report.truncated, true);
  assert.ok(report.incidents.every(i => i.state === "resolved"));
});
