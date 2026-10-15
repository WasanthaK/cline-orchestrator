#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** M19E2 — candidate-only inventory and CycloneDX SBOM cross-check. */
const SHA = /^[a-f0-9]{64}$/;
const REV = /^[a-f0-9]{40}$/;
const COMPONENT = /^[A-Za-z0-9._ @()+-]+$/;
const MAX_FILES = 50_000;
const MAX_SBOM = 16 * 1024 * 1024;
const MANIFEST = "BUNDLE-INVENTORY.json";
const BOM = "DEPENDENCY-SBOM.cdx.json";
const BUNDLE = "ClineOrchestrator";
const LOCK = "app/package-lock.json";

function validRevision(value) {
  assert.match(value ?? "", REV, "Exact 40-character candidate commit required");
}
function checkName(value) {
  assert.ok(typeof value === "string" && value !== "." && value !== ".."
    && !value.endsWith(" ") && !value.endsWith(".")
    && COMPONENT.test(value), "Unsafe Windows candidate path component");
}
async function regularFile(root, relative) {
  const parts = relative.split("/");
  assert.ok(parts.length && parts.every(Boolean), "Empty candidate path");
  let location = root;
  for (const part of parts) {
    checkName(part);
    location = path.join(location, part);
    const st = await lstat(location);
    assert.equal(st.isSymbolicLink(), false, "Candidate symlink forbidden");
  }
  const st = await lstat(location);
  assert.equal(st.isFile(), true, "Regular candidate file required");
  return location;
}
async function digest(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function walk(directory, prefix = "", entries = [], caseFold = new Set()) {
  const dir = await lstat(directory);
  assert.ok(dir.isDirectory() && !dir.isSymbolicLink(), "Candidate directory alias forbidden");
  for (const child of await readdir(directory, { withFileTypes: true })) {
    checkName(child.name);
    assert.equal(child.isSymbolicLink(), false, "Candidate symbolic link forbidden");
    const relative = prefix ? prefix + "/" + child.name : child.name;
    const identity = relative.toLowerCase();
    assert.equal(caseFold.has(identity), false, "Windows case-aliased package entry");
    caseFold.add(identity);
    const full = path.join(directory, child.name);
    if (child.isDirectory()) await walk(full, relative, entries, caseFold);
    else {
      assert.equal(child.isFile(), true, "Unexpected package node");
      const st = await lstat(full);
      assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1,
        "Non-regular, linked or aliased product file");
      entries.push({ path: relative, size: st.size, sha256: await digest(full) });
      assert.ok(entries.length <= MAX_FILES, "Candidate file count exceeds limit");
    }
  }
  return entries;
}
async function candidateFiles(root) {
  const dir = path.join(root, BUNDLE);
  const entries = await walk(dir);
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return entries;
}
function canonicalInstalledDependencies(lock) {
  assert.ok(lock && typeof lock === "object" && lock.lockfileVersion >= 2
    && lock.packages && typeof lock.packages === "object"
    && !Array.isArray(lock.packages), "Unsupported installed lockfile");
  const packages = [];
  for (const [location, data] of Object.entries(lock.packages)) {
    if (!location || !location.includes("node_modules/") || !data?.version) continue;
    // An npm nested install can contain more than one node_modules segment.
    const nodeLocation = location.lastIndexOf("node_modules/");
    const name = location.slice(nodeLocation + "node_modules/".length);
    assert.ok(/^(@[^/]+\/)?[^/]+$/.test(name), "Invalid installed package name");
    assert.ok(typeof data.version === "string" && data.version.length < 128,
      "Invalid installed package version");
    if (name === "cline-orchestrator") continue; // BOM source application root
    packages.push({ name, version: data.version });
  }
  assert.ok(packages.length > 0 && packages.length <= MAX_FILES,
    "Installed runtime dependency tree is missing");
  return packages;
}
function readBom(data, expected) {
  assert.ok(Buffer.byteLength(data) > 10 && Buffer.byteLength(data) < MAX_SBOM,
    "SBOM missing or oversized");
  const bom = JSON.parse(data);
  assert.equal(bom.bomFormat, "CycloneDX", "Expected CycloneDX SBOM");
  assert.ok(["1.5", "1.6"].includes(bom.specVersion), "Unsupported CycloneDX version");
  assert.ok(Array.isArray(bom.components) && bom.components.length > 0
    && Array.isArray(bom.dependencies), "SBOM lacks component/dependency graph");
  assert.equal(bom.metadata?.component?.purl, "pkg:npm/cline-orchestrator@0.1.0",
    "Source product identity missing from SBOM");
  const componentKeys = new Set();
  for (const item of bom.components) {
    assert.ok(item && typeof item.name === "string"
      && typeof item.version === "string" && item.name.length <= 256
      && item.version.length <= 128 && typeof item.purl === "string",
      "Invalid component data");
    const name = item.group ? item.group + "/" + item.name : item.name;
    componentKeys.add(name + "@" + item.version);
    // Some npm versions retain the @scope in item.name instead of item.group.
    componentKeys.add(item.name + "@" + item.version);
  }
  const missing = expected.filter(pkg => !componentKeys.has(pkg.name + "@" + pkg.version));
  assert.equal(missing.length, 0, "SBOM missing installed runtime dependency components");
  return { componentCount: bom.components.length, installedDependencyCount: expected.length };
}
async function inputs(root, sourceCommit) {
  assert.ok(typeof root === "string" && path.isAbsolute(root), "Absolute candidate path required");
  validRevision(sourceCommit);
  const evidence = JSON.parse(await readFile(await regularFile(root, "BUILD-EVIDENCE.json"), "utf8"));
  const embedded = JSON.parse(await readFile(await regularFile(root,
    BUNDLE + "/app/product-manifest.json"), "utf8"));
  assert.equal(evidence.sourceCommit, sourceCommit, "Build evidence commit mismatch");
  assert.equal(embedded.sourceCommit, sourceCommit, "Embedded source commit mismatch");
  assert.equal(evidence.installerBuilt, true, "Unsigned installer not built");
  assert.equal(embedded.grantsAuthority, false);
  assert.equal(embedded.serviceInstalled, false);
  const installed = JSON.parse(await readFile(await regularFile(root, BUNDLE + "/" + LOCK), "utf8"));
  const packages = canonicalInstalledDependencies(installed);
  const sbomFile = await regularFile(root, BOM);
  const sbom = await readFile(sbomFile, "utf8");
  const details = readBom(sbom, packages);
  return { packages, details, sbomFile };
}
function sanitize(sourceCommit, manifest) {
  return Object.freeze({
    schemaVersion: 1, candidate: "unsigned-windows-foreground-preview",
    sourceCommit, filesVerified: manifest.files.length,
    installedDependenciesChecked: manifest.installedDependencies,
    sbomComponents: manifest.sbomComponents,
    fullBundleInventory: true, standard: "CycloneDX",
    unsigned: true, signed: false, installationPerformed: false,
    startsModel: false, startsTask: false, releasesSoftware: false,
    grantsAuthority: false,
  });
}
export async function createWindowsCandidateInventory(root, sourceCommit) {
  const { packages, details, sbomFile } = await inputs(root, sourceCommit);
  const files = await candidateFiles(root);
  const manifest = {
    schemaVersion: 1, sourceCommit,
    bundleName: BUNDLE,
    files, installedDependencies: packages.length,
    sbomComponents: details.componentCount,
    sbomSha256: await digest(sbomFile),
    grantsAuthority: false, releaseAuthorized: false,
  };
  const destination = path.join(root, MANIFEST);
  // Never overwrite earlier signed-off inventory evidence.
  await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return sanitize(sourceCommit, manifest);
}
export async function verifyWindowsCandidateInventory(root, sourceCommit) {
  const { packages, details, sbomFile } = await inputs(root, sourceCommit);
  const raw = await readFile(await regularFile(root, MANIFEST));
  assert.ok(raw.length > 40 && raw.length < 14 * 1024 * 1024, "Inventory evidence not bounded");
  const inventory = JSON.parse(raw.toString("utf8"));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.sourceCommit, sourceCommit);
  assert.equal(inventory.bundleName, BUNDLE);
  assert.equal(inventory.grantsAuthority, false);
  assert.equal(inventory.releaseAuthorized, false);
  assert.equal(inventory.installedDependencies, packages.length);
  assert.equal(inventory.sbomComponents, details.componentCount);
  assert.match(inventory.sbomSha256 ?? "", SHA);
  assert.equal(inventory.sbomSha256, await digest(sbomFile), "SBOM digest changed");
  const actual = await candidateFiles(root);
  assert.deepEqual(inventory.files, actual, "Bundle file inventory is stale or altered");
  const evidence = JSON.parse(await readFile(await regularFile(root, "BUILD-EVIDENCE.json"), "utf8"));
  assert.equal(actual.length, evidence.filesInBundle, "Build payload file count mismatch");
  return sanitize(sourceCommit, inventory);
}
const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && entry === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 5 || !["create", "verify"].includes(process.argv[2]))
      throw new Error("Invalid candidate command");
    const [_, __, mode, root, commit] = process.argv;
    const result = mode === "create"
      ? await createWindowsCandidateInventory(root, commit)
      : await verifyWindowsCandidateInventory(root, commit);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stderr.write("Windows candidate SBOM/inventory check failed; no release was authorized.\n");
    process.exitCode = 1;
  }
}
