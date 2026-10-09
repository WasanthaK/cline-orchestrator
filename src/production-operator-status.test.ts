import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_OPERATOR_STATUS_CONTRACT,
  ProductionOperatorStatusError,
  buildProductionOperatorStatus,
} from "./production-operator-status.js";
import type { OperationalAlertV1 } from "./operational-alert-classification.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";
import type { ResourceBackpressureSummaryV1 } from "./resource-backpressure.js";

function readiness(overrides: Partial<ProductionReadinessSummaryV1> = {}): ProductionReadinessSummaryV1 {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-08T09:00:00.000Z",
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

function backpressure(overrides: Partial<ResourceBackpressureSummaryV1> = {}): ResourceBackpressureSummaryV1 {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-08T09:00:00.000Z",
    saturated: false,
    nearCapacity: false,
    healthyCount: 7,
    nearCapacityCount: 0,
    saturatedCount: 0,
    unavailableCount: 0,
    budgets: [],
    authority: "resource_backpressure_observation_only",
    readOnly: true,
    pausesTask: false,
    abortsTask: false,
    retriesTask: false,
    mutatesQueue: false,
    mutatesRuntimeState: false,
    performsNetworkMutation: false,
    grantsAuthority: false,
    ...overrides,
  };
}

function alert(
  classification: OperationalAlertV1["classification"],
  code: string,
): OperationalAlertV1 {
  return {
    schemaVersion: 1,
    source: "event",
    classification,
    code,
    observedAt: "2026-10-08T09:00:00.000Z",
    taskId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    operatorAttentionRequired: classification !== "informational",
    failClosed: classification === "blocking",
    authority: "operational_alert_classification_only",
    pausesTask: false,
    abortsTask: false,
    retriesTask: false,
    repairsTask: false,
    mutatesRuntimeState: false,
    mutatesTaskState: false,
    grantsAuthority: false,
  };
}

test("M16G contract is passive/read-only and exposes no actions or raw content", () => {
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.readOnly, true);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.rawEventsExposed, false);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.promptsExposed, false);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.pathsExposed, false);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.credentialsExposed, false);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.actionsExposed, false);
  assert.equal(PRODUCTION_OPERATOR_STATUS_CONTRACT.grantsAuthority, false);
});

test("M16G healthy sanitized evidence produces healthy passive status", () => {
  const status = buildProductionOperatorStatus({
    readiness: readiness(),
    backpressure: backpressure(),
    alerts: [alert("informational", "runtime_completed")],
  }, { now: () => new Date("2026-10-08T09:01:00.000Z") });

  assert.equal(status.health, "healthy");
  assert.equal(status.readOnly, true);
  assert.deepEqual(status.actions, []);
  assert.equal(status.grantsAuthority, false);
});

test("M16G blocking readiness/backpressure are visible as critical bounded notices", () => {
  const status = buildProductionOperatorStatus({
    readiness: readiness({
      ready: false,
      reliabilityReady: false,
      unavailableCount: 1,
    }),
    backpressure: backpressure({
      saturated: true,
      saturatedCount: 1,
    }),
    alerts: [],
  });

  assert.equal(status.health, "critical");
  assert.equal(status.notices[0]?.severity, "critical");
  assert.equal(status.notices.some((item) => item.source === "readiness"), true);
  assert.equal(status.notices.some((item) => item.source === "backpressure"), true);
});

test("M16G observability blindness reports unknown even when other evidence is otherwise healthy", () => {
  const status = buildProductionOperatorStatus({
    readiness: readiness({
      ready: false,
      observabilityReady: false,
      unavailableCount: 1,
    }),
    backpressure: backpressure(),
    alerts: [],
  });
  assert.equal(status.health, "unknown");
});

test("M16G exposes only alert identity/code fields and drops underlying issue payloads", () => {
  const status = buildProductionOperatorStatus({
    readiness: readiness(),
    backpressure: backpressure(),
    alerts: [alert("urgent", "runtime_failed")],
  });

  const serialized = JSON.stringify(status);
  assert.match(serialized, /runtime_failed/);
  assert.doesNotMatch(serialized, /prompt|credential|token|workspacePath|stackTrace/i);
  assert.equal(status.notices[0]?.taskId, "11111111-1111-4111-8111-111111111111");
});

test("M16G bounds alert/notices deterministically", () => {
  const alerts = Array.from({ length: 8 }, (_, index) => ({
    ...alert("warning", `warning_${index}`),
    observedAt: `2026-10-08T09:00:0${index}.000Z`,
  }));

  const status = buildProductionOperatorStatus({
    readiness: readiness(),
    backpressure: backpressure(),
    alerts,
  }, { maxAlerts: 3, maxNotices: 2 });

  assert.equal(status.notices.length, 2);
  assert.equal(status.truncation.alerts, true);
  assert.equal(status.truncation.notices, true);
});

test("M16G rejects authority-widened upstream evidence", () => {
  assert.throws(
    () => buildProductionOperatorStatus({
      readiness: readiness(),
      backpressure: {
        ...backpressure(),
        grantsAuthority: true,
      } as any,
      alerts: [],
    }),
    (error: unknown) =>
      error instanceof ProductionOperatorStatusError
      && error.code === "input_invalid",
  );
});
