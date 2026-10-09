import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_RUN_ASSESSMENT_CONTRACT,
  FirstRunAssessmentError,
  assessFirstRun,
  type FirstRunAssessmentInputV1,
} from "./first-run-assessment.js";
import type { ProductionReadinessSummaryV1 } from "./production-readiness.js";

function readiness(ready = true): ProductionReadinessSummaryV1 {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-08T10:30:00.000Z",
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

function input(overrides: Partial<FirstRunAssessmentInputV1> = {}): FirstRunAssessmentInputV1 {
  return {
    runtime: {
      schemaVersion: 1,
      nodeVersion: "v22.23.3",
      platform: "win32",
      architecture: "x64",
      authority: "first_run_runtime_observation",
      grantsAuthority: false,
    },
    provider: {
      schemaVersion: 1,
      configured: true,
      providerId: "openai-compatible",
      modelId: "qwen38-27b-192k",
      endpointClass: "loopback",
      preflightSupported: true,
      preflightOk: true,
      authority: "first_run_provider_observation",
      grantsAuthority: false,
    },
    workspace: {
      schemaVersion: 1,
      registered: true,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      rootAlias: "cline-orchestrator",
      safetyProfileConfigured: true,
      validationCommandsConfigured: true,
      authority: "first_run_workspace_observation",
      grantsAuthority: false,
    },
    daemon: {
      schemaVersion: 1,
      hostClass: "loopback",
      port: 4317,
      running: true,
      authority: "first_run_daemon_observation",
      grantsAuthority: false,
    },
    readiness: readiness(true),
    ...overrides,
  };
}

test("M17A contract is assessment-only and cannot mutate setup/runtime/network state", () => {
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.readOnly, true);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.writesConfig, false);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.registersWorkspace, false);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.startsService, false);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.opensListener, false);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.performsNetworkMutation, false);
  assert.equal(FIRST_RUN_ASSESSMENT_CONTRACT.grantsAuthority, false);
});

test("M17A fully configured local-first environment is ready", () => {
  const result = assessFirstRun(input(), {
    now: () => new Date("2026-10-08T10:31:00.000Z"),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.nodeCompatible, true);
  assert.equal(result.providerReady, true);
  assert.equal(result.workspaceReady, true);
  assert.equal(result.daemonSafe, true);
  assert.equal(result.productionReady, true);
  assert.deepEqual(result.setupSteps, []);
  assert.equal(result.grantsAuthority, false);
});

test("M17A unconfigured first run produces bounded setup plan without performing it", () => {
  const value = input({
    provider: {
      ...input().provider,
      configured: false,
      providerId: undefined,
      modelId: undefined,
      preflightOk: undefined,
    },
    workspace: {
      ...input().workspace,
      registered: false,
      workspaceId: undefined,
      projectId: undefined,
      rootAlias: undefined,
      safetyProfileConfigured: false,
      validationCommandsConfigured: false,
    },
    daemon: {
      ...input().daemon,
      running: false,
    },
    readiness: undefined,
  });

  const result = assessFirstRun(value);
  assert.equal(result.status, "needs_setup");
  assert.deepEqual(
    result.setupSteps.map((step) => step.code),
    ["configure_provider", "register_workspace", "start_daemon"],
  );
  assert.equal(result.writesConfig, false);
  assert.equal(result.registersWorkspace, false);
  assert.equal(result.startsService, false);
});

test("M17A public daemon bind is blocking and recommends loopback", () => {
  const result = assessFirstRun(input({
    daemon: {
      ...input().daemon,
      hostClass: "public",
      running: true,
    },
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.daemonSafe, false);
  assert.equal(result.setupSteps.some((step) => step.code === "use_loopback_daemon"), true);
  assert.equal(result.opensListener, false);
});

test("M17A old Node runtime is blocking", () => {
  const result = assessFirstRun(input({
    runtime: {
      ...input().runtime,
      nodeVersion: "20.18.0",
    },
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.nodeCompatible, false);
  assert.equal(result.setupSteps[0]?.code, "upgrade_node");
});

test("M17A provider misconfiguration is reported without endpoint or credential leakage", () => {
  const result = assessFirstRun(input({
    provider: {
      ...input().provider,
      preflightOk: false,
    },
  }));

  assert.equal(result.status, "needs_setup");
  assert.equal(result.providerReady, false);
  assert.equal(result.setupSteps.some((step) => step.code === "verify_provider"), true);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /api[_-]?key|authorization|Bearer|https?:\/\//i);
});

test("M17A production readiness degradation stays read-only and setup-oriented", () => {
  const result = assessFirstRun(input({ readiness: readiness(false) }));
  assert.equal(result.status, "needs_setup");
  assert.equal(result.productionReady, false);
  assert.equal(result.setupSteps.some((step) => step.code === "resolve_production_readiness"), true);
  assert.equal(result.grantsAuthority, false);
});

test("M17A rejects authority-widened readiness evidence", () => {
  assert.throws(
    () => assessFirstRun(input({
      readiness: {
        ...readiness(),
        grantsReleaseAuthority: true,
      } as any,
    })),
    (error: unknown) =>
      error instanceof FirstRunAssessmentError
      && error.code === "input_invalid",
  );
});
