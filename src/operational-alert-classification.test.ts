import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT,
  OperationalAlertClassificationError,
  classifyOperationalEventAlert,
  classifyReadinessAlert,
} from "./operational-alert-classification.js";
import type { OperationalEventV1 } from "./operational-event.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";

function readiness(overrides: Partial<ProductionReadinessSummaryV1> = {}): ProductionReadinessSummaryV1 {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-08T07:30:00.000Z",
    ready: true,
    healthyCount: 11,
    staleCount: 0,
    unavailableCount: 0,
    failedCount: 0,
    securityReady: true,
    reliabilityReady: true,
    observabilityReady: true,
    controls: [],
    authority: "production_readiness_observation_only",
    readOnly: true,
    sanitized: true,
    mutatesTaskState: false,
    mutatesRuntimeState: false,
    startsListener: false,
    performsNetworkMutation: false,
    usesCredentials: false,
    grantsTaskAuthority: false,
    grantsFilesystemAuthority: false,
    grantsWriterLeaseAuthority: false,
    grantsCredentialAuthority: false,
    grantsReleaseAuthority: false,
    ...overrides,
  };
}

function event(
  code: OperationalEventV1["code"],
  overrides: Partial<OperationalEventV1> = {},
): OperationalEventV1 {
  return {
    schemaVersion: 1,
    code,
    severity: "warning",
    occurredAt: "2026-10-08T07:30:00.000Z",
    taskId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    authority: "operational_event_observation_only",
    grantsAuthority: false,
    ...overrides,
  };
}

test("M16D contract classifies only and cannot pause/abort/retry/repair", () => {
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.deterministic, true);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.blockingFailClosed, true);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.pausesTask, false);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.abortsTask, false);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.retriesTask, false);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.repairsTask, false);
  assert.equal(OPERATIONAL_ALERT_CLASSIFICATION_CONTRACT.grantsAuthority, false);
});

test("M16D healthy readiness is informational", () => {
  const alert = classifyReadinessAlert(readiness());
  assert.equal(alert.classification, "informational");
  assert.equal(alert.operatorAttentionRequired, false);
  assert.equal(alert.failClosed, false);
});

test("M16D missing/failed/stale required readiness controls are blocking and fail closed", () => {
  const unavailable = classifyReadinessAlert(readiness({
    ready: false,
    healthyCount: 10,
    unavailableCount: 1,
    observabilityReady: false,
  }));
  assert.equal(unavailable.classification, "blocking");
  assert.equal(unavailable.operatorAttentionRequired, true);
  assert.equal(unavailable.failClosed, true);

  const stale = classifyReadinessAlert(readiness({
    ready: false,
    healthyCount: 10,
    staleCount: 1,
    reliabilityReady: false,
  }));
  assert.equal(stale.classification, "blocking");
  assert.equal(stale.failClosed, true);
});

for (const [code, classification, failClosed] of [
  ["runtime_started", "informational", false],
  ["runtime_stalled", "warning", false],
  ["runtime_failed", "urgent", false],
  ["writer_lease_lost", "blocking", true],
  ["writer_fence_rejected", "blocking", true],
  ["audit_sink_unavailable", "blocking", true],
  ["remote_rate_limited", "warning", false],
  ["remote_replay_rejected", "warning", false],
  ["delivery_recovery_ambiguous", "blocking", true],
] as const) {
  test(`M16D deterministically maps ${code} to ${classification}`, () => {
    const alert = classifyOperationalEventAlert(event(code));
    assert.equal(alert.classification, classification);
    assert.equal(alert.failClosed, failClosed);
    assert.equal(alert.operatorAttentionRequired, classification !== "informational");
    assert.equal(alert.pausesTask, false);
    assert.equal(alert.abortsTask, false);
    assert.equal(alert.grantsAuthority, false);
  });
}

test("M16D preserves only bounded identity fields from sanitized event", () => {
  const alert = classifyOperationalEventAlert(event("runtime_failed", {
    projectId: "33333333-3333-4333-8333-333333333333",
    issueCode: "provider_unavailable",
    outcomeCode: "failed_closed",
  }));

  assert.equal(alert.taskId, "11111111-1111-4111-8111-111111111111");
  assert.equal(alert.workspaceId, "22222222-2222-4222-8222-222222222222");
  assert.equal(alert.projectId, "33333333-3333-4333-8333-333333333333");
  assert.equal("issueCode" in alert, false);
  assert.equal("outcomeCode" in alert, false);
});

test("M16D rejects authority-widened event/readiness evidence", () => {
  assert.throws(
    () => classifyOperationalEventAlert({
      ...event("writer_lease_lost"),
      grantsAuthority: true,
    } as any),
    (error: unknown) =>
      error instanceof OperationalAlertClassificationError
      && error.code === "evidence_invalid",
  );

  assert.throws(
    () => classifyReadinessAlert({
      ...readiness(),
      grantsReleaseAuthority: true,
    } as any),
    (error: unknown) =>
      error instanceof OperationalAlertClassificationError
      && error.code === "evidence_invalid",
  );
});
