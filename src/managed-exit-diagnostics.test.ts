import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_EXIT_DIAGNOSTIC_CONTRACT,
  scheduleManagedRunExitDiagnostic,
  summarizeManagedExitResources,
} from "./managed-exit-diagnostics.js";

test("M18E exit observation is opt-in and schedules no work by default", () => {
  let scheduled = 0;
  const outcome = scheduleManagedRunExitDiagnostic({}, {
    schedule: () => { scheduled += 1; return { unref() {} }; },
  });
  assert.equal(outcome, false);
  assert.equal(scheduled, 0);
  assert.equal(MANAGED_EXIT_DIAGNOSTIC_CONTRACT.neverCallsProcessExit, true);
  assert.equal(MANAGED_EXIT_DIAGNOSTIC_CONTRACT.grantsAuthority, false);
});

test("M18E opt-in exit observation unrefs timer and reports only bounded type counts", () => {
  let callback: (() => void) | undefined;
  let delay = 0;
  let unrefCount = 0;
  const lines: string[] = [];
  const result = scheduleManagedRunExitDiagnostic(
    { ORCH_MANAGED_EXIT_DIAGNOSTICS: "1", SECRET: "sensitive-value" },
    {
      schedule: (cb, ms) => { callback = cb; delay = ms; return { unref: () => { unrefCount += 1; } }; },
      activeResources: () => ["Timeout", "TTYWrap", "Timeout", "secret=do-not-expose", "TCPWRAP"],
      write: line => { lines.push(line); },
    },
  );
  assert.equal(result, true);
  assert.equal(unrefCount, 1);
  assert.equal(delay, 2000);
  assert.equal(lines.length, 0);
  assert.ok(callback);
  callback!();
  assert.equal(lines.length, 1);
  const line = lines[0]!;
  assert.match(line, /^\[managed-run exit diagnostic\] /);
  assert.doesNotMatch(line, /do-not-expose|sensitive-value|SECRET/i);
  const summary = JSON.parse(line.slice("[managed-run exit diagnostic] ".length));
  assert.deepEqual(summary, {
    schemaVersion: 1, observation: "managed_run_post_cleanup",
    resourceTypes: [
      { type: "Other", count: 1 }, { type: "TCPWRAP", count: 1 },
      { type: "Timeout", count: 2 }, { type: "TTYWrap", count: 1 },
    ], totalObserved: 5, capped: false,
  });
});

test("M18E resource type observation stays bounded with malicious metadata", () => {
  const values = Array.from({ length: 1000 }, (_, i) => "Resource" + i);
  values.push("token=CREDENTIAL", "C:\\private\\data", "<script>");
  const result = summarizeManagedExitResources(values);
  assert.equal(result.capped, true);
  assert.equal(result.totalObserved, 1003);
  assert.ok(result.resourceTypes.length <= 25);
  assert.doesNotMatch(JSON.stringify(result), /CREDENTIAL|private|script/i);
});
