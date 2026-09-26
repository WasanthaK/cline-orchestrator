import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertDisposableWorkspaceRoot,
  assertLiveProofOptIn,
  createDisposableProofWorkspace,
  createLiveProofIsolation,
  hasLiveProofHubShutdownSurface,
  LIVE_PROOF_OPT_IN_ENV,
  LIVE_PROOF_OPT_IN_VALUE,
  preserveLiveProofFailure,
  removeDisposableProofRoot,
} from "./live-proof-isolation.js";

const execFile = promisify(execFileCallback);

test("live proof isolation uses a private Cline root, data dir, registry, and pinned non-default Hub port", async () => {
  const isolation = await createLiveProofIsolation();
  try {
    assert.equal(isolation.environment.CLINE_DIR, isolation.clineDir);
    assert.equal(isolation.environment.CLINE_DATA_DIR, isolation.clineDataDir);
    assert.equal(isolation.environment.CLINE_HUB_PORT, String(isolation.hubPort));
    assert.equal(isolation.environment.CLINE_HUB_ADDRESS, isolation.hubAddress);
    assert.equal(isolation.environment.CLINE_SESSION_BACKEND_MODE, "hub");
    assert.notEqual(isolation.hubPort, 25463);
    assert.equal(isolation.hubAddress, `127.0.0.1:${isolation.hubPort}`);
    assert.match(isolation.hubAddress, /^127\.0\.0\.1:\d+$/);
    assert.equal(path.dirname(isolation.registryPath), isolation.root);
    assert.equal(path.dirname(isolation.clineDir), isolation.root);
    assert.equal(path.dirname(isolation.clineDataDir), isolation.clineDir);
  } finally {
    await rm(isolation.root, { recursive: true, force: true });
  }
});

test("physical proof opt-in fails closed unless the exact disposable-only value is present", () => {
  assert.throws(
    () => assertLiveProofOptIn({}),
    /physical live proof is disabled/i,
  );
  assert.throws(
    () => assertLiveProofOptIn({ [LIVE_PROOF_OPT_IN_ENV]: "yes" }),
    /physical live proof is disabled/i,
  );
  assert.doesNotThrow(() => assertLiveProofOptIn({
    [LIVE_PROOF_OPT_IN_ENV]: LIVE_PROOF_OPT_IN_VALUE,
  }));
});

test("pinned Cline Hub package exposes graceful local-Hub shutdown for isolated proof cleanup", () => {
  assert.equal(hasLiveProofHubShutdownSurface(), true);
});

test("disposable workspace builder creates a clean independent Git baseline", async () => {
  const root = await createDisposableProofWorkspace();
  try {
    assert.match(path.basename(root).toLowerCase(), /^orchestrator-live-proof-/);
    assert.equal(await readFile(path.join(root, "src", "demo.ts"), "utf8"), "export const value = 1;\n");
    assert.equal(await readFile(path.join(root, "outside.txt"), "utf8"), "protected baseline\n");
    const status = await execFile("git", ["-C", root, "status", "--porcelain=v1"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(status.stdout, "");
    const autocrlf = await execFile("git", ["-C", root, "config", "--local", "--get", "core.autocrlf"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(autocrlf.stdout.trim(), "false");
  } finally {
    await rm(root, { recursive: true, force: true });
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

test("cleanup retains the proof failure when removal also fails", () => {
  const proofError = new Error("scheduler failed");
  const cleanupError = new Error("EBUSY");
  assert.throws(
    () => preserveLiveProofFailure(proofError, cleanupError),
    (error: unknown) => error instanceof AggregateError
      && error.errors[0] === proofError
      && error.errors[1] === cleanupError
      && /scheduler failed.*EBUSY/.test(error.message),
  );
  assert.throws(() => preserveLiveProofFailure(undefined, cleanupError), (error) => error === cleanupError);
});

test("proof cleanup removes generated roots and refuses unrelated directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrator-live-proof-"));
  const unrelated = await mkdtemp(path.join(os.tmpdir(), "unrelated-proof-"));
  try {
    await assert.rejects(removeDisposableProofRoot(unrelated), /non-disposable proof root/);
    assert.equal((await stat(unrelated)).isDirectory(), true);
    await removeDisposableProofRoot(root);
    await assert.rejects(stat(root), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(unrelated, { recursive: true, force: true });
  }
});
