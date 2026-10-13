import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE_BACKPRESSURE_CONTRACT,
  ResourceBackpressureEvaluator,
  type ResourceBudgetId,
  type ResourceBudgetProbe,
} from "./resource-backpressure.js";

const NOW = new Date("2026-10-08T08:30:00.000Z");

const budgets: ResourceBudgetId[] = [
  "remote.concurrent_sessions",
  "remote.request_rate",
  "remote.replay_entries",
  "transport.request_bytes",
  "scheduler.queued_writers",
  "history.operational_records",
  "recovery.scan_items",
];

function probe(
  budgetId: ResourceBudgetId,
  used = 2,
  limit = 10,
): ResourceBudgetProbe {
  return {
    async observe() {
      return {
        schemaVersion: 1,
        budgetId,
        observedAt: "2026-10-08T08:29:30.000Z",
        used,
        limit,
        authority: "resource_budget_observation",
        grantsAuthority: false,
      };
    },
  };
}

function healthy() {
  return new Map(budgets.map((budgetId) => [budgetId, probe(budgetId)]));
}

test("M16F contract is read-only and cannot schedule/retry/mutate", () => {
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.readOnly, true);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.hardLimitFailClosed, true);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.nearCapacityWarnOnly, true);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.pausesTask, false);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.abortsTask, false);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.retriesTask, false);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.mutatesQueue, false);
  assert.equal(RESOURCE_BACKPRESSURE_CONTRACT.grantsAuthority, false);
});

test("M16F healthy budgets report no saturation", async () => {
  const summary = await new ResourceBackpressureEvaluator(
    healthy(),
    { now: () => NOW },
  ).evaluate();

  assert.equal(summary.saturated, false);
  assert.equal(summary.nearCapacity, false);
  assert.equal(summary.healthyCount, budgets.length);
  assert.equal(summary.saturatedCount, 0);
  assert.equal(summary.unavailableCount, 0);
  assert.equal(summary.grantsAuthority, false);
});

test("M16F near-capacity budget warns without becoming saturated", async () => {
  const probes = healthy();
  probes.set("scheduler.queued_writers", probe("scheduler.queued_writers", 8, 10));

  const summary = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW, nearCapacityRatio: 0.8 },
  ).evaluate();

  assert.equal(summary.saturated, false);
  assert.equal(summary.nearCapacity, true);
  assert.equal(summary.nearCapacityCount, 1);
  const queue = summary.budgets.find((item) => item.budgetId === "scheduler.queued_writers");
  assert.equal(queue?.status, "near_capacity");
  assert.equal(queue?.issueCode, "budget_near_capacity");
  assert.equal(queue?.utilizationPercent, 80);
});

test("M16F hard limit saturation fails closed in summary without task mutation", async () => {
  const probes = healthy();
  probes.set("remote.concurrent_sessions", probe("remote.concurrent_sessions", 10, 10));

  const summary = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(summary.saturated, true);
  assert.equal(summary.saturatedCount, 1);
  assert.equal(summary.pausesTask, false);
  assert.equal(summary.abortsTask, false);
  assert.equal(summary.retriesTask, false);
  assert.equal(summary.mutatesQueue, false);
  assert.equal(summary.grantsAuthority, false);
});

test("M16F over-limit observation remains saturated and preserves bounded numeric evidence", async () => {
  const probes = healthy();
  probes.set("transport.request_bytes", probe("transport.request_bytes", 2048, 1024));

  const summary = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  const transport = summary.budgets.find((item) => item.budgetId === "transport.request_bytes");
  assert.equal(transport?.status, "saturated");
  assert.equal(transport?.used, 2048);
  assert.equal(transport?.limit, 1024);
  assert.equal(transport?.utilizationPercent, 200);
});

test("M16F missing or malformed resource probe fails closed as unavailable", async () => {
  const probes = healthy();
  probes.delete("remote.replay_entries");
  probes.set("recovery.scan_items", {
    async observe() {
      return {
        schemaVersion: 1,
        budgetId: "recovery.scan_items",
        observedAt: "2026-10-08T08:29:30.000Z",
        used: -1,
        limit: 100,
        authority: "resource_budget_observation",
        grantsAuthority: false,
      };
    },
  });

  const summary = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(summary.saturated, true);
  assert.equal(summary.unavailableCount, 2);
  assert.equal(summary.grantsAuthority, false);
});

test("M16F probe exceptions are sanitized to unavailable with no exception text", async () => {
  const probes = healthy();
  probes.set("history.operational_records", {
    async observe() {
      throw new Error("SECRET_TOKEN=/workspace/private");
    },
  });

  const summary = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
  assert.doesNotMatch(serialized, /workspace\/private/);
  assert.match(serialized, /probe_unavailable/);
  assert.equal(summary.saturated, true);
});
