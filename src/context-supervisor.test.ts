import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextSupervisor,
  defaultContextRotateAtTokens,
} from "./context-supervisor.js";

test("default threshold stays below both context and max-input limits", () => {
  assert.equal(defaultContextRotateAtTokens(196_608, 180_000), 150_000);
  assert.equal(defaultContextRotateAtTokens(32_768, 30_000), 25_500);
});

test("separate sub-threshold turns do not accumulate into a rotation", () => {
  const supervisor = new ContextSupervisor(150_000);

  assert.equal(supervisor.observeTurnInput(80_000), false);
  assert.equal(supervisor.consumeAfterIteration(1), undefined);
  assert.equal(supervisor.observeTurnInput(80_000), false);
  assert.equal(supervisor.consumeAfterIteration(1), undefined);
});

test("a single large turn rotates only when another tool-driven iteration is required", () => {
  const supervisor = new ContextSupervisor(150_000);

  assert.equal(supervisor.observeTurnInput(151_234), true);
  assert.deepEqual(supervisor.consumeAfterIteration(2), {
    inputTokens: 151_234,
    threshold: 150_000,
  });
});

test("a final no-tool turn does not rotate even when it crosses the threshold", () => {
  const supervisor = new ContextSupervisor(150_000);

  assert.equal(supervisor.observeTurnInput(170_000), true);
  assert.equal(supervisor.consumeAfterIteration(0), undefined);
});

test("threshold zero disables context rotation", () => {
  const supervisor = new ContextSupervisor(0);

  assert.equal(supervisor.observeTurnInput(999_999), false);
  assert.equal(supervisor.consumeAfterIteration(5), undefined);
});
