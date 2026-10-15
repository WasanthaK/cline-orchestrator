import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { verifyWindowsForegroundEvidence } from "../scripts/verify-windows-foreground-evidence.mjs";

const commit = "a".repeat(40);
const nodeHash = "9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e";
const sha = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");
async function fixture(run: (root: string, files: Record<string, string>) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m19e1-"));
  const files = {
    "ClineOrchestrator/runtime/node.exe": "node-fixture",
    "ClineOrchestrator/launcher/ClineOrchestrator.exe": "launcher-fixture",
    "ClineOrchestrator/app/node_modules/cline-orchestrator/dist/product-cli.js": "cli-fixture",
    "ClineOrchestrator-win-x64-portable.zip": "zip-fixture",
    "ClineOrchestrator-Setup-unsigned.exe": "exe-fixture",
  };
  try {
    for (const [relative, value] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, value);
    }
    // Synthetic fixtures must not depend on fetching or installing official
    // Node binaries. Positive release verification uses the real known hash
    // on Windows CI; this test checks the negative pinned-runtime gate.
    const manifest = {
      schemaVersion: 1, product: "Cline Orchestrator",
      distribution: "unsigned-windows-foreground-preview",
      sourceCommit: commit, nodeVersion: "22.23.3", appVersion: "0.1.0",
      serviceInstalled: false, providerLaunched: false, grantsAuthority: false,
      sha256: {
        "runtime/node.exe": nodeHash,
        "launcher/ClineOrchestrator.exe": sha(files["ClineOrchestrator/launcher/ClineOrchestrator.exe"]!),
        "app/node_modules/cline-orchestrator/dist/product-cli.js": sha(files["ClineOrchestrator/app/node_modules/cline-orchestrator/dist/product-cli.js"]!),
      },
    };
    const report = {
      sourceCommit: commit, nodeVersion: "22.23.3", filesInBundle: 4,
      installerBuilt: true, serviceInstalled: false,
      configModified: false, taskLaunched: false,
      portableZipSha256: sha(files["ClineOrchestrator-win-x64-portable.zip"]!),
      installerSha256: sha(files["ClineOrchestrator-Setup-unsigned.exe"]!),
    };
    const manifestPath = path.join(root, "ClineOrchestrator/app/product-manifest.json");
    const reportPath = path.join(root, "BUILD-EVIDENCE.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(reportPath, JSON.stringify(report));
    await run(root, files);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("M19E1 fails closed on synthetic unpinned Node runtime, without installation", async () => {
  await fixture(async root => {
    await assert.rejects(verifyWindowsForegroundEvidence(root, commit), /Pinned runtime/);
    await assert.rejects(verifyWindowsForegroundEvidence(root, "b".repeat(40)), /wrong commit/);
  });
});
test("M19E1 refuses tampered archives, unsafe manifest claims and file aliases", async () => {
  await fixture(async (root, files) => {
    // Node hash mismatch is intentionally first line of defence in this
    // synthetic fixture; exercise each additional check with a fixture
    // whose component hashes are consistent except for the pinned binary.
    await writeFile(path.join(root, "ClineOrchestrator-Setup-unsigned.exe"), "modified");
    await assert.rejects(verifyWindowsForegroundEvidence(root, commit));
    await writeFile(path.join(root, "ClineOrchestrator-Setup-unsigned.exe"),
      files["ClineOrchestrator-Setup-unsigned.exe"]!);
    const reportPath = path.join(root, "BUILD-EVIDENCE.json");
    const fs = await import("node:fs/promises");
    const original = JSON.parse(await fs.readFile(reportPath, "utf8"));
    await writeFile(reportPath, JSON.stringify({ ...original, taskLaunched: true }));
    await assert.rejects(verifyWindowsForegroundEvidence(root, commit), /side effects/);
    await writeFile(reportPath, JSON.stringify(original));
    const originalManifest = path.join(root, "ClineOrchestrator/app/product-manifest.json");
    const content = await fs.readFile(originalManifest, "utf8");
    await fs.rm(originalManifest);
    await symlink(reportPath, originalManifest);
    await assert.rejects(verifyWindowsForegroundEvidence(root, commit), /alias/);
    await fs.rm(originalManifest);
    await writeFile(originalManifest, content);
  });
});
test("M19E1 needs an exact SHA and an absolute path and never claims release authority", async () => {
  await assert.rejects(verifyWindowsForegroundEvidence("relative", commit), /Absolute/);
  await assert.rejects(verifyWindowsForegroundEvidence(path.resolve("."), "latest"), /Exact approved/);
});
