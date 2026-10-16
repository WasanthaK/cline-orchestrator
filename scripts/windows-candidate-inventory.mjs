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
// Keep failure messages bounded. Source details can contain user paths or
// package metadata and must not leak into public CI logs.
let validationStage = "startup";

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
async function canonicalInstalledDependencies(root, lock) {
  assert.ok(lock && typeof lock === "object" && lock.lockfileVersion >= 2
    && lock.packages && typeof lock.packages === "object"
    && !Array.isArray(lock.packages), "Unsupported installed lockfile");
  const packages = [];
  for (const [location, data] of Object.entries(lock.packages)) {
    if (!location || !location.includes("node_modules/") || !data?.version) continue;
    const nodeLocation = location.lastIndexOf("node_modules/");
    const name = location.slice(nodeLocation + "node_modules/".length);
    assert.ok(/^(@[^/]+\/)?[^/]+$/.test(name), "Invalid installed package name");
    assert.ok(typeof data.version === "string" && data.version.length < 128,
      "Invalid installed package version");
    if (name === "cline-orchestrator") continue; // application itself
    let bytes;
    try {
      bytes = await readFile(await regularFile(root,
        BUNDLE + "/app/" + location + "/package.json"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT" && (data.optional === true || data.dev === true))
        continue; // npm omits platform-optional and development packages
      throw new Error("Missing installed runtime package");
    }
    const installed = JSON.parse(bytes);
    assert.equal(installed.name, name, "Installed runtime package name mismatch");
    assert.equal(installed.version, data.version, "Installed runtime package version mismatch");
    packages.push({ name, version: data.version, location,
      dependencies: data.dependencies ?? {}, integrity: data.integrity });
    assert.ok(packages.length <= MAX_FILES, "Installed dependency count exceeds limit");
  }
  assert.ok(packages.length > 0, "Installed runtime dependency tree is missing");
  return packages;
}

function packageRef(pkg) {
  return "installed:" + pkg.location;
}
function packagePurl(pkg) {
  const name = pkg.name.startsWith("@") ? "%40" + pkg.name.slice(1) : pkg.name;
  return "pkg:npm/" + name + "@" + pkg.version;
}
function resolveDependency(packageLocation, dependency, byLocation) {
  // Follow npm's nested node_modules lookup order; never invent missing
  // edges. Optional dependencies can be absent on a given platform.
  let parent = packageLocation;
  while (parent) {
    const candidate = parent + "/node_modules/" + dependency;
    if (byLocation.has(candidate)) return packageRef(byLocation.get(candidate));
    const previous = parent.lastIndexOf("/node_modules/");
    if (previous < 0) break;
    parent = parent.slice(0, previous);
  }
  const root = byLocation.get("node_modules/" + dependency);
  return root ? packageRef(root) : null;
}

export async function generateWindowsCandidateSbom(root, sourceCommit) {
  assert.ok(typeof root === "string" && path.isAbsolute(root), "Absolute candidate path required");
  validRevision(sourceCommit);
  validationStage = "sbom-generation-source";
  const evidence = JSON.parse(await readFile(await regularFile(root, "BUILD-EVIDENCE.json"), "utf8"));
  const manifest = JSON.parse(await readFile(await regularFile(root,
    BUNDLE + "/app/product-manifest.json"), "utf8"));
  assert.equal(evidence.sourceCommit, sourceCommit, "Build evidence commit mismatch");
  assert.equal(manifest.sourceCommit, sourceCommit, "Embedded source commit mismatch");
  assert.equal(manifest.grantsAuthority, false);
  validationStage = "sbom-generation-installed-lock";
  const lock = JSON.parse(await readFile(await regularFile(root, BUNDLE + "/" + LOCK), "utf8"));
  const packages = await canonicalInstalledDependencies(root, lock);
  const byLocation = new Map(packages.map(pkg => [pkg.location, pkg]));
  const components = packages.map(pkg => ({
    type: "library", "bom-ref": packageRef(pkg),
    name: pkg.name, version: pkg.version, purl: packagePurl(pkg),
  })).sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const rootRef = "pkg:npm/cline-orchestrator@0.1.0";
  const dependencyRows = packages.map(pkg => ({
    ref: packageRef(pkg),
    dependsOn: [...new Set(Object.keys(pkg.dependencies).map(name =>
      resolveDependency(pkg.location, name, byLocation)).filter(Boolean))].sort(),
  }));
  // The installed application manifest, rather than the source checkout's
  // dev dependency graph, determines the direct runtime dependencies.
  const installedRoot = JSON.parse(await readFile(await regularFile(root,
    BUNDLE + "/app/node_modules/cline-orchestrator/package.json"), "utf8"));
  const rootEdges = [...new Set(Object.keys(installedRoot.dependencies ?? {})
    .map(name => {
      const direct = byLocation.get("node_modules/" + name);
      return direct ? packageRef(direct) : null;
    }).filter(Boolean))].sort();
  dependencyRows.push({ ref: rootRef, dependsOn: rootEdges });
  dependencyRows.sort((a, b) => a.ref.localeCompare(b.ref));
  const sbom = {
    bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
    metadata: { component: {
      type: "application", name: "cline-orchestrator", version: "0.1.0",
      purl: rootRef, "bom-ref": rootRef,
    } },
    components, dependencies: dependencyRows,
  };
  validationStage = "sbom-generation-write";
  await writeFile(path.join(root, BOM), JSON.stringify(sbom, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  return Object.freeze({ schemaVersion: 1, sourceCommit,
    installedDependenciesRepresented: components.length, standard: "CycloneDX",
    installationPerformed: false, grantsAuthority: false, releasesSoftware: false });
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
  validationStage = "build-evidence";
  const evidence = JSON.parse(await readFile(await regularFile(root, "BUILD-EVIDENCE.json"), "utf8"));
  validationStage = "embedded-manifest";
  const embedded = JSON.parse(await readFile(await regularFile(root,
    BUNDLE + "/app/product-manifest.json"), "utf8"));
  assert.equal(evidence.sourceCommit, sourceCommit, "Build evidence commit mismatch");
  assert.equal(embedded.sourceCommit, sourceCommit, "Embedded source commit mismatch");
  assert.equal(evidence.installerBuilt, true, "Unsigned installer not built");
  assert.equal(embedded.grantsAuthority, false);
  assert.equal(embedded.serviceInstalled, false);
  validationStage = "installed-lockfile";
  const installed = JSON.parse(await readFile(await regularFile(root, BUNDLE + "/" + LOCK), "utf8"));
  validationStage = "installed-dependency-list";
  const packages = await canonicalInstalledDependencies(root, installed);
  validationStage = "sbom-file";
  const sbomFile = await regularFile(root, BOM);
  const sbom = await readFile(sbomFile, "utf8");
  validationStage = "sbom-content";
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
  validationStage = "bundle-inventory";
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
    if (process.argv.length !== 5 || !["sbom", "create", "verify"].includes(process.argv[2]))
      throw new Error("Invalid candidate command");
    const [_, __, mode, root, commit] = process.argv;
    const result = mode === "sbom"
      ? await generateWindowsCandidateSbom(root, commit)
      : mode === "create"
      ? await createWindowsCandidateInventory(root, commit)
      : await verifyWindowsCandidateInventory(root, commit);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reasons = [
      "Unsupported installed lockfile", "Installed runtime dependency tree is missing",
      "Missing installed runtime package", "Installed runtime package name mismatch",
      "Installed runtime package version mismatch",
      "Invalid installed package name", "Invalid installed package version",
      "SBOM missing or oversized", "Expected CycloneDX SBOM",
      "Unsupported CycloneDX version", "SBOM lacks component/dependency graph",
      "Source product identity missing from SBOM", "Invalid component data",
      "SBOM missing installed runtime dependency components",
      "Unsafe Windows candidate path component", "Windows case-aliased package entry",
      "Non-regular, linked or aliased product file",
    ];
    const reason = reasons.find(text => message.includes(text)) ?? "unclassified";
    process.stderr.write("Windows candidate inventory rejected [" + validationStage + "/" + reason + "]. No release authorized.\n");
    process.exitCode = 1;
  }
}
