import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileOperationalHealthHistoryStore,
  OperationalHealthHistoryError,
} from "./operational-health-history.js";
import {
  OperationalEventError,
  SecretSafeOperationalEventService,
  sanitizeOperationalEvent,
} from "./operational-event.js";
import {
  ProductionReadinessEvaluator,
  type ProductionReadinessControlId,
  type ProductionReadinessProbe,
} from "./production-readiness.js";
import {
  classifyOperationalEventAlert,
  classifyReadinessAlert,
} from "./operational-alert-classification.js";

const NOW = new Date("2026-10-08T08:00:00.000Z");
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const controls: ProductionReadinessControlId[] = [
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

function healthyProbe(controlId: ProductionReadinessControlId): ProductionReadinessProbe {
  return {
    async observe() {
      return {
        schemaVersion: 1,
        controlId,
        observedAt: "2026-10-08T07:59:30.000Z",
        ok: true,
        authority: "production_readiness_probe_observation",
        grantsAuthority: false,
      };
    },
  };
}

function healthyProbes() {
  return new Map(controls.map((controlId) => [controlId, healthyProbe(controlId)]));
}

function event(
  code:
    | "writer_lease_lost"
    | "writer_fence_rejected"
    | "runtime_failed"
    | "audit_sink_unavailable",
  issueCode: string,
) {
  return sanitizeOperationalEvent({
    schemaVersion: 1,
    code,
    severity: code === "runtime_failed" ? "error" : "critical",
    occurredAt: "2026-10-08T08:00:00.000Z",
    taskId: TASK_ID,
    workspaceId: WORKSPACE_ID,
    issueCode,
    outcomeCode: "failed_closed",
  });
}

test("M16E fault injection: crash/restart preserves sanitized operational evidence without authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16e-restart-"));
  let id = 0;
  try {
    const store = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 10,
      now: () => NOW,
      idFactory: () => `33333333-3333-4333-8333-${String(++id).padStart(12, "0")}`,
    });
    await store.appendEvent(event("runtime_failed", "provider_unavailable"));

    const reconstructed = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 10,
      now: () => new Date("2026-10-08T08:01:00.000Z"),
    });
    const history = await reconstructed.load();

    assert.equal(history.records.length, 1);
    const record = history.records[0];
    assert.equal(record.kind, "event");
    if (record.kind === "event") {
      assert.equal(record.event.code, "runtime_failed");
      assert.equal(record.event.grantsAuthority, false);
    }
    assert.equal(history.grantsAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M16E fault injection: torn/corrupt operational state fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16e-corrupt-"));
  try {
    const dir = path.join(root, "operational-health");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "history.json"), "{\"schemaVersion\":1,", "utf8");

    await assert.rejects(
      () => new FileOperationalHealthHistoryStore(root).load(),
      (error: unknown) =>
        error instanceof OperationalHealthHistoryError
        && error.code === "history_corrupt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [code, issueCode] of [
  ["writer_lease_lost", "lease_not_current"],
  ["writer_fence_rejected", "fence_not_current"],
] as const) {
  test(`M16E fault injection: ${code} is blocking/fail-closed and grants no recovery authority`, () => {
    const alert = classifyOperationalEventAlert(event(code, issueCode));
    assert.equal(alert.classification, "blocking");
    assert.equal(alert.operatorAttentionRequired, true);
    assert.equal(alert.failClosed, true);
    assert.equal(alert.pausesTask, false);
    assert.equal(alert.abortsTask, false);
    assert.equal(alert.retriesTask, false);
    assert.equal(alert.repairsTask, false);
    assert.equal(alert.grantsAuthority, false);
  });
}

test("M16E fault injection: audit sink failure is sanitized and readiness becomes blocking", async () => {
  const service = new SecretSafeOperationalEventService({
    async append() {
      throw new Error("SECRET_TOKEN=/workspace/private");
    },
  });

  await assert.rejects(
    () => service.emit({
      schemaVersion: 1,
      code: "audit_sink_unavailable",
      severity: "critical",
      occurredAt: "2026-10-08T08:00:00.000Z",
      issueCode: "audit_sink_unavailable",
      outcomeCode: "failed_closed",
    }),
    (error: unknown) =>
      error instanceof OperationalEventError
      && error.code === "sink_failed"
      && !error.message.includes("SECRET_TOKEN"),
  );

  const probes = healthyProbes();
  probes.delete("security.sanitized_audit");
  const readiness = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();
  const alert = classifyReadinessAlert(readiness);

  assert.equal(readiness.ready, false);
  assert.equal(alert.classification, "blocking");
  assert.equal(alert.failClosed, true);
  assert.equal(alert.grantsAuthority, false);
});

test("M16E fault injection: provider/runtime unavailability surfaces urgent evidence without autonomous repair", () => {
  const alert = classifyOperationalEventAlert(
    event("runtime_failed", "provider_unavailable"),
  );

  assert.equal(alert.classification, "urgent");
  assert.equal(alert.operatorAttentionRequired, true);
  assert.equal(alert.failClosed, false);
  assert.equal(alert.retriesTask, false);
  assert.equal(alert.repairsTask, false);
  assert.equal(alert.mutatesRuntimeState, false);
  assert.equal(alert.grantsAuthority, false);
});

test("M16E fault injection: observability blindness makes production readiness fail closed", async () => {
  const probes = healthyProbes();
  probes.set("observability.run_metrics", {
    async observe() {
      throw new Error("metrics backend unavailable with /private/path");
    },
  });

  const readiness = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();
  const alert = classifyReadinessAlert(readiness);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.observabilityReady, false);
  assert.equal(readiness.unavailableCount, 1);
  assert.equal(alert.classification, "blocking");
  assert.equal(alert.failClosed, true);
  const serialized = JSON.stringify({ readiness, alert });
  assert.doesNotMatch(serialized, /private\/path/);
  assert.equal(alert.grantsAuthority, false);
});
