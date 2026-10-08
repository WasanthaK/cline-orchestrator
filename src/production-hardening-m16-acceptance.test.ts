import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ProductionReadinessEvaluator,
  type ProductionReadinessControlId,
  type ProductionReadinessProbe,
} from "./production-readiness.js";
import {
  sanitizeOperationalEvent,
  type OperationalEventV1,
} from "./operational-event.js";
import {
  FileOperationalHealthHistoryStore,
  OperationalHealthHistoryError,
} from "./operational-health-history.js";
import {
  classifyOperationalEventAlert,
  classifyReadinessAlert,
  type OperationalAlertV1,
} from "./operational-alert-classification.js";
import {
  ResourceBackpressureEvaluator,
  type ResourceBudgetId,
  type ResourceBudgetProbe,
} from "./resource-backpressure.js";
import { buildProductionOperatorStatus } from "./production-operator-status.js";

const NOW = new Date("2026-10-08T10:00:00.000Z");
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const readinessControls: ProductionReadinessControlId[] = [
  "security.remote_session_replay_protection",
  "security.remote_session_rate_limiting",
  "security.sanitized_audit",
  "security.local_operator_boundary",
  "reliability.durable_task_state",
  "reliability.checkpoint_state",
  "reliability.restart_recovery",
  "reliability.writer_fencing",
  "observability.sentinel_incidents",
  "observability.operator_visualization",
  "observability.run_metrics",
];

const resourceBudgets: ResourceBudgetId[] = [
  "remote.concurrent_sessions",
  "remote.request_rate",
  "remote.replay_entries",
  "transport.request_bytes",
  "scheduler.queued_writers",
  "history.operational_records",
  "recovery.scan_items",
];

function readinessProbe(controlId: ProductionReadinessControlId): ProductionReadinessProbe {
  return {
    async observe() {
      return {
        schemaVersion: 1,
        controlId,
        observedAt: "2026-10-08T09:59:30.000Z",
        ok: true,
        authority: "production_readiness_probe_observation",
        grantsAuthority: false,
      };
    },
  };
}

function readinessProbes() {
  return new Map(
    readinessControls.map((controlId) => [controlId, readinessProbe(controlId)]),
  );
}

function budgetProbe(
  budgetId: ResourceBudgetId,
  used = 2,
  limit = 10,
): ResourceBudgetProbe {
  return {
    async observe() {
      return {
        schemaVersion: 1,
        budgetId,
        observedAt: "2026-10-08T09:59:30.000Z",
        used,
        limit,
        authority: "resource_budget_observation",
        grantsAuthority: false,
      };
    },
  };
}

function budgetProbes() {
  return new Map(
    resourceBudgets.map((budgetId) => [budgetId, budgetProbe(budgetId)]),
  );
}

function operationalEvent(
  code: OperationalEventV1["code"],
  issueCode: string,
): OperationalEventV1 {
  return sanitizeOperationalEvent({
    schemaVersion: 1,
    code,
    severity: code === "runtime_stalled" ? "warning" : "critical",
    occurredAt: "2026-10-08T10:00:00.000Z",
    taskId: TASK_ID,
    workspaceId: WORKSPACE_ID,
    issueCode,
    outcomeCode: "failed_closed",
  });
}

test("M16H acceptance: healthy production hardening stack stays passive and authority-free", async () => {
  const readiness = await new ProductionReadinessEvaluator(
    readinessProbes(),
    { now: () => NOW },
  ).evaluate();
  const backpressure = await new ResourceBackpressureEvaluator(
    budgetProbes(),
    { now: () => NOW },
  ).evaluate();

  const status = buildProductionOperatorStatus({
    readiness,
    backpressure,
    alerts: [classifyReadinessAlert(readiness)],
  }, { now: () => NOW });

  assert.equal(readiness.ready, true);
  assert.equal(backpressure.saturated, false);
  assert.equal(status.health, "healthy");
  assert.equal(status.readOnly, true);
  assert.deepEqual(status.actions, []);
  assert.equal(status.mutatesTaskState, false);
  assert.equal(status.mutatesRuntimeState, false);
  assert.equal(status.performsNetworkMutation, false);
  assert.equal(status.grantsAuthority, false);
});

test("M16H acceptance: required security-control loss is sanitized, blocking and operator-visible", async () => {
  const probes = readinessProbes();
  probes.set("security.sanitized_audit", {
    async observe() {
      throw new Error("SECRET_TOKEN=/workspace/private/audit.log");
    },
  });

  const readiness = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();
  const alert = classifyReadinessAlert(readiness);
  const backpressure = await new ResourceBackpressureEvaluator(
    budgetProbes(),
    { now: () => NOW },
  ).evaluate();
  const status = buildProductionOperatorStatus({
    readiness,
    backpressure,
    alerts: [alert],
  }, { now: () => NOW });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.securityReady, false);
  assert.equal(alert.classification, "blocking");
  assert.equal(alert.failClosed, true);
  assert.equal(status.health, "critical");
  assert.equal(status.notices.some((item) => item.code === "required_control_unavailable"), true);
  const serialized = JSON.stringify({ readiness, alert, status });
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
  assert.doesNotMatch(serialized, /workspace\/private/);
  assert.equal(status.grantsAuthority, false);
});

test("M16H acceptance: resource saturation is bounded/operator-visible and cannot mutate scheduler/runtime", async () => {
  const probes = budgetProbes();
  probes.set(
    "scheduler.queued_writers",
    budgetProbe("scheduler.queued_writers", 10, 10),
  );

  const readiness = await new ProductionReadinessEvaluator(
    readinessProbes(),
    { now: () => NOW },
  ).evaluate();
  const backpressure = await new ResourceBackpressureEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();
  const status = buildProductionOperatorStatus({
    readiness,
    backpressure,
    alerts: [],
  }, { now: () => NOW });

  assert.equal(backpressure.saturated, true);
  assert.equal(backpressure.saturatedCount, 1);
  assert.equal(backpressure.pausesTask, false);
  assert.equal(backpressure.abortsTask, false);
  assert.equal(backpressure.retriesTask, false);
  assert.equal(backpressure.mutatesQueue, false);
  assert.equal(backpressure.mutatesRuntimeState, false);
  assert.equal(status.health, "critical");
  assert.equal(status.notices.some((item) => item.code === "resource_saturated"), true);
  assert.equal(status.grantsAuthority, false);
});

for (const [code, issueCode] of [
  ["writer_lease_lost", "lease_not_current"],
  ["writer_fence_rejected", "fence_not_current"],
  ["audit_sink_unavailable", "audit_sink_unavailable"],
  ["delivery_recovery_ambiguous", "remote_outcome_ambiguous"],
] as const) {
  test(`M16H acceptance: ${code} remains blocking, sanitized and non-authoritative`, () => {
    const event = operationalEvent(code, issueCode);
    const alert = classifyOperationalEventAlert(event);

    assert.equal(alert.classification, "blocking");
    assert.equal(alert.operatorAttentionRequired, true);
    assert.equal(alert.failClosed, true);
    assert.equal(alert.pausesTask, false);
    assert.equal(alert.abortsTask, false);
    assert.equal(alert.retriesTask, false);
    assert.equal(alert.repairsTask, false);
    assert.equal(alert.grantsAuthority, false);

    const serialized = JSON.stringify({ event, alert });
    assert.doesNotMatch(serialized, /prompt|password|credential|Bearer|workspacePath|stackTrace/i);
  });
}

test("M16H acceptance: sanitized operational history survives reconstruction and corrupt history fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16h-history-"));
  let id = 0;
  try {
    const readiness = await new ProductionReadinessEvaluator(
      readinessProbes(),
      { now: () => NOW },
    ).evaluate();
    const event = operationalEvent("runtime_stalled", "watchdog_stalled");

    const store = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 4,
      now: () => NOW,
      idFactory: () => `33333333-3333-4333-8333-${String(++id).padStart(12, "0")}`,
    });
    await store.appendReadiness(readiness);
    await store.appendEvent(event);

    const reconstructed = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 4,
      now: () => new Date("2026-10-08T10:01:00.000Z"),
    });
    const history = await reconstructed.load();
    assert.equal(history.records.length, 2);
    assert.equal(history.grantsAuthority, false);

    const raw = await readFile(path.join(root, "operational-health", "history.json"), "utf8");
    assert.doesNotMatch(raw, /controls/);
    assert.doesNotMatch(raw, /prompt|credential|password|Bearer/i);

    await writeFile(
      path.join(root, "operational-health", "history.json"),
      "{\"schemaVersion\":1,",
      "utf8",
    );
    await assert.rejects(
      () => reconstructed.load(),
      (error: unknown) =>
        error instanceof OperationalHealthHistoryError
        && error.code === "history_corrupt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M16H acceptance: observability blindness becomes unknown/fail-closed without exposing probe exception", async () => {
  const probes = readinessProbes();
  probes.set("observability.run_metrics", {
    async observe() {
      throw new Error("metrics failed at /private/path with token ghp_abcdefghijklmnop");
    },
  });

  const readiness = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();
  const alert = classifyReadinessAlert(readiness);
  const backpressure = await new ResourceBackpressureEvaluator(
    budgetProbes(),
    { now: () => NOW },
  ).evaluate();
  const status = buildProductionOperatorStatus({
    readiness,
    backpressure,
    alerts: [alert],
  }, { now: () => NOW });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.observabilityReady, false);
  assert.equal(alert.classification, "blocking");
  assert.equal(status.health, "unknown");
  assert.equal(status.readOnly, true);
  assert.deepEqual(status.actions, []);
  const serialized = JSON.stringify({ readiness, alert, status });
  assert.doesNotMatch(serialized, /private\/path/);
  assert.doesNotMatch(serialized, /ghp_/);
  assert.equal(status.grantsAuthority, false);
});

test("M16H acceptance: passive operator view is bounded under alert pressure", async () => {
  const readiness = await new ProductionReadinessEvaluator(
    readinessProbes(),
    { now: () => NOW },
  ).evaluate();
  const backpressure = await new ResourceBackpressureEvaluator(
    budgetProbes(),
    { now: () => NOW },
  ).evaluate();

  const alerts: OperationalAlertV1[] = Array.from({ length: 12 }, (_, index) => {
    const event = operationalEvent(
      index % 2 === 0 ? "runtime_stalled" : "remote_rate_limited",
      `bounded_${index}`,
    );
    return {
      ...classifyOperationalEventAlert(event),
      observedAt: `2026-10-08T10:00:${String(index).padStart(2, "0")}.000Z`,
    };
  });

  const status = buildProductionOperatorStatus({
    readiness,
    backpressure,
    alerts,
  }, {
    now: () => NOW,
    maxAlerts: 4,
    maxNotices: 3,
  });

  assert.equal(status.notices.length, 3);
  assert.equal(status.truncation.alerts, true);
  assert.equal(status.truncation.notices, true);
  assert.equal(status.actions.length, 0);
  assert.equal(status.grantsAuthority, false);
});
