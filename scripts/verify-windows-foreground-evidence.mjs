#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * M19E1 — verify an unsigned, disposable Windows foreground candidate before
 * any operator-machine installation, release, or promotion.
 * No external calls, writes, process launches, model or service actions.
 */
const EXPECTED_NODE_SHA256 = "9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const guardedPaths = {
  "runtime/node.exe": EXPECTED_NODE_SHA256,
  "launcher/ClineOrchestrator.exe": null,
  "app/node_modules/cline-orchestrator/dist/product-cli.js": null,
};

async function file(root, relative) {
  const segments = relative.split("/");
  assert.ok(segments.length && segments.every(x =>
    x !== "" && x !== "." && x !== ".." && /^[A-Za-z0-9._ @()+-]+$/.test(x)), "Unsafe candidate path");
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    assert.equal(stat.isSymbolicLink(), false, "Candidate alias forbidden");
  }
  const st = await lstat(current);
  assert.equal(st.isFile(), true, "Expected regular candidate file");
  return readFile(current);
}
const sha = data => createHash("sha256").update(data).digest("hex");
async function json(root, relative) {
  const bytes = await file(root, relative);
  assert.ok(bytes.length > 0 && bytes.length < 131_072, "Evidence document too large");
  return JSON.parse(bytes.toString("utf8"));
}
async function countBundleFiles(root, relative = "ClineOrchestrator") {
  const dir = path.join(root, relative);
  const stat = await lstat(dir);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Package directory must not be an alias");
  let count = 0;
  for (const item of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), "Symlink in candidate payload");
    if (item.isDirectory()) count += await countBundleFiles(root, path.join(relative, item.name));
    else {
      assert.equal(item.isFile(), true, "Only regular files may be packaged");
      count += 1;
    }
  }
  return count;
}

export async function verifyWindowsForegroundEvidence(root, expectedCommit) {
  assert.ok(typeof root === "string" && path.isAbsolute(root), "Absolute candidate directory required");
  assert.match(expectedCommit ?? "", GIT_SHA, "Exact approved Git commit required");
  const report = await json(root, "BUILD-EVIDENCE.json");
  const manifest = await json(root, "ClineOrchestrator/app/product-manifest.json");

  assert.equal(report.sourceCommit, expectedCommit, "Build evidence points to wrong commit");
  assert.equal(manifest.sourceCommit, expectedCommit, "Embedded manifest points to wrong commit");
  assert.equal(report.nodeVersion, "22.23.3");
  assert.equal(manifest.nodeVersion, report.nodeVersion);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "Cline Orchestrator");
  assert.equal(manifest.appVersion, "0.1.0");
  assert.equal(manifest.distribution, "unsigned-windows-foreground-preview");
  assert.equal(report.installerBuilt, true);
  for (const [key, expected] of [
    ["serviceInstalled", false],
    ["configModified", false],
    ["taskLaunched", false],
  ]) assert.equal(report[key], expected, "Build evidence unexpectedly grants side effects");
  assert.equal(manifest.serviceInstalled, false);
  assert.equal(manifest.providerLaunched, false);
  assert.equal(manifest.grantsAuthority, false);

  assert.equal(typeof manifest.sha256, "object");
  assert.ok(!Array.isArray(manifest.sha256));
  assert.deepEqual(Object.keys(manifest.sha256).sort(), Object.keys(guardedPaths).sort());
  for (const [relative, field] of [
    ["ClineOrchestrator-win-x64-portable.zip", "portableZipSha256"],
    ["ClineOrchestrator-Setup-unsigned.exe", "installerSha256"],
  ]) {
    assert.match(report[field] ?? "", SHA256, "Missing archive digest");
    assert.equal(sha(await file(root, relative)), report[field], "Archive/installer digest mismatch");
  }
  for (const [relative, known] of Object.entries(guardedPaths)) {
    const declared = manifest.sha256[relative];
    assert.match(declared ?? "", SHA256, "Missing SHA-256 for " + relative);
    if (known !== null) assert.equal(declared, known, "Pinned runtime must match official SHA-256");
    assert.equal(sha(await file(root, "ClineOrchestrator/" + relative)), declared,
      "Candidate component differs from embedded manifest");
  }
  assert.ok(Number.isSafeInteger(report.filesInBundle) && report.filesInBundle > 3
    && report.filesInBundle < 50_000, "Invalid payload count");
  assert.equal(await countBundleFiles(root), report.filesInBundle,
    "Payload inventory has drifted since packaging");

  // The output is intentionally safe for public CI: no paths, binary data,
  // credential references, raw task identities or operator settings.
  return Object.freeze({
    schemaVersion: 1, candidate: "unsigned-windows-foreground-preview",
    sourceCommit: expectedCommit, componentsVerified: 3, archivesVerified: 2,
    filesCountVerified: true, installationPerformed: false,
    modelStarted: false, taskStarted: false, serviceInstalled: false,
    signed: false, releaseAuthorized: false, grantsAuthority: false,
  });
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && entry === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: verify-windows-foreground-evidence <absolute-directory> <exact-commit>");
    const evidence = await verifyWindowsForegroundEvidence(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify(evidence) + "\n");
  } catch {
    process.stderr.write("Unsigned candidate evidence verification failed; no files were changed.\n");
    process.exitCode = 1;
  }
}
