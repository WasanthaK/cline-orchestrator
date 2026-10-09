import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_READINESS_CONTRACT,
  ProductionReadinessEvaluator,
  type ProductionReadinessControlId,
  type ProductionReadinessProbe,
} from "./production-readiness.js";

const NOW = new Date("2026-10-08T06:00:00.000Z");

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
        observedAt: "2026-10-08T05:59:30.000Z",
        ok: true,
        authority: "production_readiness_probe_observation",
        grantsAuthority: false,
      };
    },
  };
}

function allHealthy() {
  return new Map(controls.map((controlId) => [controlId, healthyProbe(controlId)]));
}

test("M16A contract is read-only, sanitized and grants no authority", () => {
  assert.equal(PRODUCTION_READINESS_CONTRACT.readOnly, true);
  assert.equal(PRODUCTION_READINESS_CONTRACT.sanitized, true);
  assert.equal(PRODUCTION_READINESS_CONTRACT.startsListener, false);
  assert.equal(PRODUCTION_READINESS_CONTRACT.performsNetworkMutation, false);
  assert.equal(PRODUCTION_READINESS_CONTRACT.usesCredentials, false);
  assert.equal(PRODUCTION_READINESS_CONTRACT.grantsReleaseAuthority, false);
});

test("M16A reports ready only when every required production control is healthy and fresh", async () => {
  const result = await new ProductionReadinessEvaluator(
    allHealthy(),
    { now: () => NOW },
  ).evaluate();

  assert.equal(result.ready, true);
  assert.equal(result.securityReady, true);
  assert.equal(result.reliabilityReady, true);
  assert.equal(result.observabilityReady, true);
  assert.equal(result.healthyCount, controls.length);
  assert.equal(result.failedCount, 0);
  assert.equal(result.unavailableCount, 0);
  assert.equal(result.staleCount, 0);
  assert.equal(result.grantsReleaseAuthority, false);
});

test("M16A fails closed when a required security control is missing", async () => {
  const probes = allHealthy();
  probes.delete("security.sanitized_audit");

  const result = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(result.ready, false);
  assert.equal(result.securityReady, false);
  assert.equal(result.unavailableCount, 1);
  const audit = result.controls.find(
    (item) => item.controlId === "security.sanitized_audit",
  );
  assert.equal(audit?.status, "unavailable");
  assert.equal(audit?.issueCode, "probe_unavailable");
});

test("M16A treats stale reliability evidence as not production ready", async () => {
  const probes = allHealthy();
  probes.set("reliability.writer_fencing", {
    async observe() {
      return {
        schemaVersion: 1,
        controlId: "reliability.writer_fencing",
        observedAt: "2026-10-08T05:55:00.000Z",
        ok: true,
        authority: "production_readiness_probe_observation",
        grantsAuthority: false,
      };
    },
  });

  const result = await new ProductionReadinessEvaluator(
    probes,
    {
      now: () => NOW,
      maxObservationAgeMs: 60_000,
    },
  ).evaluate();

  assert.equal(result.ready, false);
  assert.equal(result.reliabilityReady, false);
  assert.equal(result.staleCount, 1);
});

test("M16A converts probe exceptions into sanitized availability codes only", async () => {
  const probes = allHealthy();
  probes.set("observability.sentinel_incidents", {
    async observe() {
      throw new Error("SECRET_TOKEN=/workspace/private/path");
    },
  });

  const result = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(result.ready, false);
  assert.equal(result.observabilityReady, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
  assert.doesNotMatch(serialized, /workspace\/private/);
  assert.match(serialized, /probe_unavailable/);
});

test("M16A rejects malformed or authority-widening probe output", async () => {
  const probes = allHealthy();
  probes.set("security.remote_session_replay_protection", {
    async observe() {
      return {
        schemaVersion: 1,
        controlId: "security.remote_session_replay_protection",
        observedAt: "2026-10-08T05:59:30.000Z",
        ok: true,
        authority: "production_readiness_probe_observation",
        grantsAuthority: true,
      } as any;
    },
  });

  const result = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(result.ready, false);
  const replay = result.controls.find(
    (item) => item.controlId === "security.remote_session_replay_protection",
  );
  assert.equal(replay?.status, "failed");
  assert.equal(replay?.issueCode, "probe_invalid");
});

test("M16A one failed observability control prevents readiness even if security/reliability are healthy", async () => {
  const probes = allHealthy();
  probes.set("observability.run_metrics", {
    async observe() {
      return {
        schemaVersion: 1,
        controlId: "observability.run_metrics",
        observedAt: "2026-10-08T05:59:30.000Z",
        ok: false,
        authority: "production_readiness_probe_observation",
        grantsAuthority: false,
      };
    },
  });

  const result = await new ProductionReadinessEvaluator(
    probes,
    { now: () => NOW },
  ).evaluate();

  assert.equal(result.securityReady, true);
  assert.equal(result.reliabilityReady, true);
  assert.equal(result.observabilityReady, false);
  assert.equal(result.ready, false);
  assert.equal(result.failedCount, 1);
});
