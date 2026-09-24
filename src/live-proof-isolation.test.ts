import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertDisposableWorkspaceRoot,
  createLiveProofIsolation,
} from "./live-proof-isolation.js";

test("live proof isolation uses a private Cline root, data dir, registry, and non-default Hub", async () => {
  const isolation = await createLiveProofIsolation();
  try {
    assert.equal(isolation.environment.CLINE_DIR, isolation.clineDir);
    assert.equal(isolation.environment.CLINE_DATA_DIR, isolation.clineDataDir);
    assert.equal(isolation.environment.CLINE_HUB_ADDRESS, isolation.hubAddress);
    assert.equal(isolation.environment.CLINE_SESSION_BACKEND_MODE, "hub");
    assert.notEqual(isolation.hubAddress, "127.0.0.1:25463");
    assert.match(isolation.hubAddress, /^127\.0\.0\.1:\d+$/);
    assert.equal(path.dirname(isolation.registryPath), isolation.root);
    assert.equal(path.dirname(isolation.clineDir), isolation.root);
    assert.equal(path.dirname(isolation.clineDataDir), isolation.clineDir);
  } finally {
    await rm(isolation.root, { recursive: true, force: true });
  }
});

test("disposable workspace guard accepts only orchestrator-live-proof-* roots", () => {
  const accepted = assertDisposableWorkspaceRoot(
    path.join(path.parse(process.cwd()).root, "tmp", "orchestrator-live-proof-02"),
  );
  assert.equal(path.basename(accepted).toLowerCase(), "orchestrator-live-proof-02");

  assert.throws(
    () => assertDisposableWorkspaceRoot(path.join(path.parse(process.cwd()).root, "tmp", "cline-orchestrator")),
    /disposable orchestrator-live-proof/i,
  );
});
