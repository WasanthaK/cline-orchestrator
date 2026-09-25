import assert from "node:assert/strict";
import test from "node:test";
import { LiveProofSendBarrier } from "./live-proof-send-barrier.js";

test("independent sends must both arrive before either is released", async () => {
  const barrier = new LiveProofSendBarrier(["workspace-a", "workspace-b"], 1_000);
  let firstReleased = false;
  const first = barrier.enter("workspace-a").then(() => { firstReleased = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(firstReleased, false);
  assert.equal(barrier.bothSendsReached, false);

  await barrier.enter("workspace-b");
  await first;
  assert.equal(firstReleased, true);
  assert.equal(barrier.bothSendsReached, true);
});

test("missing or unregistered send fails rather than claiming concurrent execution", async () => {
  const barrier = new LiveProofSendBarrier(["workspace-a", "workspace-b"], 10);
  await assert.rejects(() => barrier.enter("other"), /unregistered workspace/i);
  await assert.rejects(() => barrier.enter("workspace-a"), /did not overlap/i);
  assert.equal(barrier.bothSendsReached, false);
});
