import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import {
  createWindowsCandidateInventory, verifyWindowsCandidateInventory, generateWindowsCandidateSbom,
} from "../scripts/windows-candidate-inventory.mjs";

const commit = "a".repeat(40);
const dependency = { name: "sample-runtime", version: "1.2.3" };
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19e2-"));
  try {
    const bundle = {
      "app/product-manifest.json": JSON.stringify({
        schemaVersion: 1, sourceCommit: commit,
        serviceInstalled: false, grantsAuthority: false,
      }),
      "app/package-lock.json": JSON.stringify({
        lockfileVersion: 3, packages: {
          "": { name: "app", version: "1.0.0" },
          "node_modules/cline-orchestrator": { version: "0.1.0" },
          "node_modules/sample-runtime": { version: dependency.version },
        },
      }),
      "app/node_modules/cline-orchestrator/package.json":
        JSON.stringify({ name: "cline-orchestrator", version: "0.1.0",
          dependencies: { "sample-runtime": dependency.version } }),
      "app/node_modules/sample-runtime/package.json":
        JSON.stringify({ name: dependency.name, version: dependency.version }),
      "runtime/node.exe": "mock-node-binary",
      "launcher/ClineOrchestrator.exe": "mock-launcher",
    };
    for (const [name, content] of Object.entries(bundle)) {
      const file = path.join(root, "ClineOrchestrator", name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    await writeFile(path.join(root, "BUILD-EVIDENCE.json"), JSON.stringify({
      sourceCommit: commit, installerBuilt: true, filesInBundle: Object.keys(bundle).length,
    }));
    await writeFile(path.join(root, "DEPENDENCY-SBOM.cdx.json"), JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.5",
      metadata: { component: { purl: "pkg:npm/cline-orchestrator@0.1.0" } },
      components: [{
        type: "library", name: dependency.name, version: dependency.version,
        purl: "pkg:npm/sample-runtime@1.2.3",
      }],
      dependencies: [{ ref: "cline-orchestrator@0.1.0", dependsOn: ["sample-runtime@1.2.3"] }],
    }));
    await work(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("M19E2 creates verifiable exact-commit full payload inventory with safe public receipt", async () => {
  await fixture(async root => {
    const created = await createWindowsCandidateInventory(root, commit);
    assert.equal(created.filesVerified, 6);
    assert.equal(created.installedDependenciesChecked, 1);
    assert.equal(created.sbomComponents, 1);
    assert.equal(created.signed, false);
    assert.equal(created.grantsAuthority, false);
    assert.equal(created.installationPerformed, false);
    const verified = await verifyWindowsCandidateInventory(root, commit);
    assert.deepEqual(verified, created);
    const raw = await readFile(path.join(root, "BUNDLE-INVENTORY.json"), "utf8");
    assert.deepEqual(JSON.parse(raw).files.map((x: {path: string}) => x.path).sort(), [
      "app/node_modules/cline-orchestrator/package.json",
      "app/node_modules/sample-runtime/package.json",
      "app/package-lock.json", "app/product-manifest.json",
      "launcher/ClineOrchestrator.exe", "runtime/node.exe",
    ].sort());
    assert.doesNotMatch(JSON.stringify(created), /mock-node-binary|ClineOrchestrator|sample-runtime/);
    await assert.rejects(createWindowsCandidateInventory(root, commit), { code: "EEXIST" });
  });
});

test("M19E2 fails closed when any packaged file changes, vanishes or SBOM is replaced", async () => {
  await fixture(async root => {
    await createWindowsCandidateInventory(root, commit);
    const binary = path.join(root, "ClineOrchestrator/runtime/node.exe");
    await writeFile(binary, "tampered");
    await assert.rejects(verifyWindowsCandidateInventory(root, commit), /stale or altered/);
    await writeFile(binary, "mock-node-binary");
    const sbom = path.join(root, "DEPENDENCY-SBOM.cdx.json");
    await writeFile(sbom, JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.5",
      metadata: { component: { purl: "pkg:npm/cline-orchestrator@0.1.0" } },
      components: [{ name: "other", version: "1.2.3", purl: "pkg:npm/other@1.2.3" }],
      dependencies: [],
    }));
    await assert.rejects(verifyWindowsCandidateInventory(root, commit),
      /SBOM missing installed runtime dependency components/);
  });
});

test("M19E2 refuses bad commits, source mismatch, missing runtime components or symlink aliases", async () => {
  await fixture(async root => {
    await assert.rejects(createWindowsCandidateInventory(root, "latest"), /Exact 40-character/);
    await assert.rejects(createWindowsCandidateInventory(root, "b".repeat(40)), /commit mismatch/);
    const f = path.join(root, "ClineOrchestrator/runtime/node.exe");
    await rm(f);
    await symlink(path.join(root, "BUILD-EVIDENCE.json"), f);
    await assert.rejects(createWindowsCandidateInventory(root, commit), /symbolic link|alias/i);
  });
});

test("M19E2 refuses SBOM missing the runtime tree even with plausible metadata", async () => {
  await fixture(async root => {
    await writeFile(path.join(root, "DEPENDENCY-SBOM.cdx.json"), JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.5",
      metadata: { component: { purl: "pkg:npm/cline-orchestrator@0.1.0" } },
      components: [{name: "other", version: "1.2.3", purl: "pkg:npm/other@1.2.3"}],
      dependencies: [],
    }));
    await assert.rejects(createWindowsCandidateInventory(root, commit), /SBOM missing installed/);
  });
});

test("M19E2 installed-tree CycloneDX generator rejects a fake runtime before writing", async () => {
  await fixture(async root => {
    const target = path.join(root, "DEPENDENCY-SBOM.cdx.json");
    await rm(target);
    // The parent app is present, but a locked transitive package has been
    // removed. This must fail without producing a misleading SBOM.
    await rm(path.join(root, "ClineOrchestrator/app/node_modules/sample-runtime/package.json"));
    await assert.rejects(generateWindowsCandidateSbom(root, commit), /Missing installed runtime package/);
  });
});
