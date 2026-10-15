import assert from "node:assert/strict";
import test from "node:test";
import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import type { NativeSetupReadinessV1 } from "./native-setup-readiness.js";
import { projectNativeOperations, NATIVE_OPERATIONS_CONTRACT } from "./native-operations.js";
import { routeProductCli } from "./product-cli.js";

const setup: NativeSetupReadinessV1 = {
  schemaVersion: 1, command: "readiness-desktop", status: "needs_setup",
  checkedAt: "2026-10-15T00:00:00.000Z",
  steps: [
    { id: "model", state: "needed" }, { id: "settings", state: "needed" },
    { id: "project", state: "needed" }, { id: "workspace", state: "needed" },
  ],
  projectCount: 0, workspaceCount: 0, setupCompleteIsTaskAuthority: false,
  readOnly: true, grantsAuthority: false,
};
function view(taskRows: Array<{status: string; waitingForHuman?: boolean}>,
  notices: Array<{available: boolean; stale?: boolean; truncated?: boolean; errorCode?: string}> = [],
): OperatorVisualizationV1 {
  return {
    readOnly: true, actions: [], taskBoard: taskRows,
    sourceNotices: notices.map(item => ({
      source: "tasks", available: item.available,
      stale: item.stale ?? false, truncated: item.truncated ?? false,
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    })),
  } as unknown as OperatorVisualizationV1;
}

test("M19D1 reports unavailable history as unknown rather than zero", () => {
  const observation = projectNativeOperations(setup);
  assert.equal(observation.history.state, "unavailable");
  assert.equal(observation.history.counts.sampled, null);
  assert.equal(observation.additionalSources, "not_connected");
  assert.equal(observation.readOnly, true);
  assert.equal(observation.grantsAuthority, false);
  assert.equal(NATIVE_OPERATIONS_CONTRACT.startsTask, false);
});

test("M19D1 derives only current bounded task counts and never exposes identifiers or goals", () => {
  const result = projectNativeOperations(setup, view([
    { status: "completed" }, { status: "running" },
    { status: "waiting_for_human", waitingForHuman: true },
    { status: "failed" },
  ]));
  assert.deepEqual(result.history.counts, {
    sampled: 4, active: 1, needsAttention: 2, completed: 1,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /taskId|goal|canonicalRoot|apiKey|secret|providerId|modelId/);
  assert.equal(result.history.scope, "bounded_current_sample");
});

test("M19D1 never promotes failed or truncated task sources to healthy counters", () => {
  for (const metadata of [
    { available: false },
    { available: true, stale: true },
    { available: true, truncated: true },
    { available: true, errorCode: "task_listing_completeness_unknown" },
  ]) {
    const result = projectNativeOperations(setup, view([{ status: "completed" }], [metadata]));
    assert.notEqual(result.history.state, "available");
    assert.equal(result.history.counts.completed, null);
  }
  // A saturated page cannot prove listing completeness, even if the
  // upstream snapshot omitted its expected truncation/source notice.
  for (const saturatedSize of [100, 101]) {
    const saturated = projectNativeOperations(setup,
      view(new Array(saturatedSize).fill({ status: "completed" })));
    assert.equal(saturated.history.state, "unavailable");
    assert.equal(saturated.history.counts.sampled, null);
  }
  const validSample = projectNativeOperations(setup,
    view(new Array(99).fill({ status: "completed" })));
  assert.equal(validSample.history.state, "available");
  assert.equal(validSample.history.counts.completed, 99);
  assert.throws(() => projectNativeOperations({ ...setup, grantsAuthority: true } as unknown as NativeSetupReadinessV1));
});

test("M19D1 native CLI command rejects extra parameters and config overrides", () => {
  assert.deepEqual(routeProductCli(["operations-desktop"]), { kind: "desktop_operations" });
  for (const args of [
    ["operations-desktop", "extra"], ["--config", "private.json", "operations-desktop"],
  ]) assert.throws(() => routeProductCli(args), { code: "usage_invalid" });
});
