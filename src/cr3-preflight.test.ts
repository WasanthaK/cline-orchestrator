import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCr3Preflight, isLoopbackUrl } from "./cr3-preflight.js";

function readyInput() {
  return {
    nodeMajor: 22,
    branch: "phase-1/bootstrap",
    head: "a".repeat(40),
    gitDirty: false,
    expectedCoreVersion: "0.0.83",
    installedCoreVersion: "0.0.83",
    expectedSdkVersion: "0.0.83",
    installedSdkVersion: "0.0.83",
    hubShutdownSurfaceAvailable: true,
    providerId: "openai-compatible",
    providerBaseUrl: "http://127.0.0.1:11434/v1",
    providerIsLoopback: true,
    providerReachable: true,
    clineExtensionCandidates: ["saoudrizwan.claude-dev-3.0.0"],
    defaultClineHubReachable: true,
  };
}

test("CR3 preflight is ready only when hard local prerequisites pass", () => {
  const report = evaluateCr3Preflight(readyInput());
  assert.equal(report.overall, "ready");
  assert.equal(report.readOnly, true);
  assert.equal(report.checks.some((item) => item.status === "fail"), false);
});

test("CR3 preflight blocks dirty checkout, wrong branch, version drift, unavailable provider, and missing safe Hub shutdown", () => {
  for (const mutate of [
    (input: ReturnType<typeof readyInput>) => { input.gitDirty = true; },
    (input: ReturnType<typeof readyInput>) => { input.branch = "main"; },
    (input: ReturnType<typeof readyInput>) => { input.installedCoreVersion = "0.0.82"; },
    (input: ReturnType<typeof readyInput>) => { input.providerReachable = false; },
    (input: ReturnType<typeof readyInput>) => { input.providerIsLoopback = false; },
    (input: ReturnType<typeof readyInput>) => { input.hubShutdownSurfaceAvailable = false; },
  ]) {
    const input = readyInput();
    mutate(input);
    const report = evaluateCr3Preflight(input);
    assert.equal(report.overall, "blocked");
    assert.ok(report.checks.some((item) => item.status === "fail"));
  }
});

test("missing VS Code Cline extension or inactive default Hub are warnings, not proof blockers", () => {
  const input = readyInput();
  input.clineExtensionCandidates = [];
  input.defaultClineHubReachable = false;
  const report = evaluateCr3Preflight(input);
  assert.equal(report.overall, "ready");
  assert.equal(report.checks.find((item) => item.id === "vscode_cline")?.status, "warn");
  assert.equal(report.checks.find((item) => item.id === "default_hub")?.status, "warn");
});

test("loopback URL detection refuses non-local provider endpoints", () => {
  for (const local of [
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://[::1]:11434/v1",
  ]) assert.equal(isLoopbackUrl(local), true, local);

  for (const remote of [
    "https://api.openai.com/v1",
    "http://192.168.1.10:11434/v1",
    "not-a-url",
    "",
  ]) assert.equal(isLoopbackUrl(remote), false, remote);
});
