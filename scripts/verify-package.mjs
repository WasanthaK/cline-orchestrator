import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this verification through npm run verify:package");
const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (result.error) throw result.error;
assert.equal(result.status, 0, "npm pack inspection failed");
const [pack] = JSON.parse(result.stdout);
const paths = new Set(pack.files.map(file => file.path));
for (const required of ["package.json", "README.md", "docs/PRODUCT-DISTRIBUTION.md",
  "dist/product-cli.js", "dist/index.js", "dist/mcp-main.js"]) {
  assert.ok(paths.has(required), `Package is missing ${required}`);
}
for (const entry of paths) {
  const allowed = ["package.json", "README.md", "docs/PRODUCT-DISTRIBUTION.md"].includes(entry)
    || /^licen[cs]e(?:\.[^/]*)?$/i.test(entry)
    || /^dist\/(?:[^/]+\/)*[^/]+\.js$/.test(entry);
  assert.ok(allowed, `Unexpected package entry: ${entry}`);
  const name = path.posix.basename(entry);
  assert.ok(!name.endsWith(".test.js") && !name.startsWith("live-") && name !== "cr3-preflight.js",
    "Package contains a test/proof program");
}
assert.ok((await readFile(path.join(root, "dist/product-cli.js"), "utf8")).startsWith("#!/usr/bin/env node\n"),
  "Compiled product binary must retain its Node shebang");
console.log(JSON.stringify({ distribution: "private-local-npm-tarball", filename: pack.filename,
  entryCount: paths.size, unpackedSize: pack.unpackedSize, integrity: pack.integrity,
  contentAllowlistPassed: true, publishesPackage: false }, null, 2));
