import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OPERATIONAL_HEALTH_HISTORY_CONTRACT,
  FileOperationalHealthHistoryStore,
  OperationalHealthHistoryError,
} from "./operational-health-history.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";
import type { OperationalEventV1 } from "./operational-event.js";

function readiness(ready: boolean): ProductionReadinessSummaryV1 {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-08T07:00:00.000Z",
    ready,
    healthyCount: ready ? 11 : 10,
    staleCount: ready ? 0 : 1,
    unavailableCount: 0,
    failedCount: 0,
    securityReady: true,
    reliabilityReady: ready,
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
  };
}

function event(code: OperationalEventV1["code"] = "runtime_failed"): OperationalEventV1 {
  return {
    schemaVersion: 1,
    code,
    severity: "error",
    occurredAt: "2026-10-08T07:00:00.000Z",
    issueCode: "failed_closed",
    authority: "operational_event_observation_only",
    grantsAuthority: false,
  };
}

test("M16C contract is bounded, crash-safe and authority-free", () => {
  assert.equal(OPERATIONAL_HEALTH_HISTORY_CONTRACT.boundedRetention, true);
  assert.equal(OPERATIONAL_HEALTH_HISTORY_CONTRACT.crashSafeReplace, true);
  assert.equal(OPERATIONAL_HEALTH_HISTORY_CONTRACT.failClosedOnCorruption, true);
  assert.equal(OPERATIONAL_HEALTH_HISTORY_CONTRACT.grantsAuthority, false);
});

test("M16C persists sanitized readiness and event records across reconstruction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16c-"));
  let id = 0;
  try {
    const store = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 5,
      now: () => new Date("2026-10-08T07:01:00.000Z"),
      idFactory: () => `11111111-1111-4111-8111-${String(++id).padStart(12, "0")}`,
    });

    await store.appendReadiness(readiness(true));
    await store.appendEvent(event());

    const rebuilt = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 5,
      now: () => new Date("2026-10-08T07:02:00.000Z"),
    });
    const history = await rebuilt.load();

    assert.equal(history.records.length, 2);
    assert.equal(history.records[0].kind, "readiness");
    assert.equal(history.records[1].kind, "event");
    assert.equal(history.grantsAuthority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M16C retention deterministically keeps newest records only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16c-retention-"));
  let id = 0;
  try {
    const store = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 2,
      now: () => new Date("2026-10-08T07:01:00.000Z"),
      idFactory: () => `22222222-2222-4222-8222-${String(++id).padStart(12, "0")}`,
    });

    await store.appendEvent(event("runtime_started"));
    await store.appendEvent(event("runtime_completed"));
    await store.appendEvent(event("runtime_failed"));

    const history = await store.load();
    assert.equal(history.records.length, 2);
    assert.deepEqual(
      history.records.map((record) => record.kind === "event" ? record.event.code : "readiness"),
      ["runtime_completed", "runtime_failed"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M16C fails closed on malformed/corrupt history instead of truncating silently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16c-corrupt-"));
  try {
    const dir = path.join(root, "operational-health");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "history.json"), "{ not valid json", "utf8");

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

test("M16C rejects authority-widened event records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16c-wide-"));
  try {
    const store = new FileOperationalHealthHistoryStore(root);
    await assert.rejects(
      () => store.appendEvent({
        ...event(),
        grantsAuthority: true,
      } as any),
      (error: unknown) =>
        error instanceof OperationalHealthHistoryError
        && error.code === "record_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M16C stores no readiness control details or free-form probe data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-m16c-sanitize-"));
  try {
    const store = new FileOperationalHealthHistoryStore(root, {
      maxRecords: 5,
      now: () => new Date("2026-10-08T07:01:00.000Z"),
      idFactory: () => "33333333-3333-4333-8333-333333333333",
    });
    const summary = readiness(false);
    summary.controls = [{
      schemaVersion: 1,
      controlId: "security.sanitized_audit",
      domain: "security",
      required: true,
      status: "failed",
      issueCode: "probe_failed",
      authority: "production_readiness_control_result",
      grantsAuthority: false,
    }];
    await store.appendReadiness(summary);

    const raw = await readFile(path.join(root, "operational-health", "history.json"), "utf8");
    assert.doesNotMatch(raw, /security\.sanitized_audit/);
    assert.doesNotMatch(raw, /probe_failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
