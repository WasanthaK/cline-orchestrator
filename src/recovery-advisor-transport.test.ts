import assert from "node:assert/strict";
import test from "node:test";
import { OneShotRecoveryAdvisor, type AdvisorTransportConfigV1 } from "./recovery-advisor-transport.js";

const cfg: AdvisorTransportConfigV1 = {
  schemaVersion: 1,
  enabled: true,
  endpoint: "https://api.openai.com/v1/responses",
  model: "test-model",
  timeoutMs: 3000,
  maxOutputTokens: 128,
  maxCallsPerHour: 2,
  maxEstimatedCentsPerHour: 10,
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
};
const incident = (id: string) => ({
  schemaVersion: 1, incidentId: id.repeat(64),
  taskStatus: "stalled", signal: "watchdog_stall",
  attempts: 2, consent: true, evidenceOnly: true,
});
const auth = {
  authorizeOnce: async () => true,
  resolveCredential: async () => "x".repeat(40),
};
const goodResponse = () => new Response(JSON.stringify({
  status: "completed", output: [{
    type: "message", role: "assistant", content: [{
      type: "output_text", text: JSON.stringify({
        schemaVersion: 1, decision: "inspect_evidence", confidence: "medium",
      }),
    }],
  }],
  usage: { input_tokens: 100, output_tokens: 30 },
}));
test("M19R3B requires explicitly trusted consent and permission before network", async () => {
  let calls = 0;
  const transport = new OneShotRecoveryAdvisor(cfg, (async () => {
    calls++; return goodResponse();
  }) as typeof fetch);
  assert.equal((await transport.consult({ ...incident("a"), consent: false }, auth)).reason, "invalid_request");
  assert.equal((await transport.consult(incident("a"), {
    ...auth, authorizeOnce: async () => false,
  })).reason, "permission_denied");
  assert.equal(calls, 0);
});
test("M19R3B only transmits approved fields with structured no-tool response", async () => {
  let calls = 0;
  const transport = new OneShotRecoveryAdvisor(cfg, (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(JSON.parse(body.input[1].content), incident("a"));
    return goodResponse();
  }) as typeof fetch);
  const result = await transport.consult(incident("a"), auth);
  assert.equal(calls, 1);
  assert.equal(result.status, "review_required");
  assert.equal(result.advice?.decision, "inspect_evidence");
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.grantsAuthority, false);
  assert.equal((await transport.consult(incident("a"), auth)).reason, "budget_exceeded");
});
test("M19R3B quota is bounded and never retries automatically", async () => {
  let requests = 0;
  const transport = new OneShotRecoveryAdvisor(cfg, (async () => {
    requests++; return goodResponse();
  }) as typeof fetch, () => 1000);
  assert.equal((await transport.consult(incident("a"), auth)).status, "review_required");
  assert.equal((await transport.consult(incident("b"), auth)).status, "review_required");
  assert.equal((await transport.consult(incident("c"), auth)).reason, "budget_exceeded");
  assert.equal(requests, 2);
});
test("M19R3B wrong destination and malformed responses fail closed", async () => {
  const badConfig = new OneShotRecoveryAdvisor({ ...cfg, endpoint: "invalid" as never });
  assert.equal((await badConfig.consult(incident("a"), auth)).reason, "invalid_config");
  for (const response of [
    new Response("{}"),
    new Response("x".repeat(20_000)),
    new Response("upstream private body", { status: 500 }),
  ]) {
    const transport = new OneShotRecoveryAdvisor(cfg, (async () => response) as typeof fetch);
    const outcome = await transport.consult(incident("a"), auth);
    assert.equal(outcome.status, "unavailable");
    assert.equal(outcome.grantsAuthority, false);
    assert.doesNotMatch(JSON.stringify(outcome), /private body/);
  }
});
