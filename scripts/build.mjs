import { rm, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await rm(output, { recursive: true, force: true });
const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const build = spawnSync(process.execPath, [compiler, "-p", path.join(root, "tsconfig.build.json")],
  { cwd: root, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

// Fail if an excluded test/proof was pulled back into the runtime graph by an import.
const files = await readdir(output, { recursive: true });
for (const entry of files) {
  const name = path.basename(entry);
  if (name.endsWith(".test.js") || name.startsWith("live-") || name === "cr3-preflight.js") {
    throw new Error("Runtime build contains a development test or proof entrypoint");
  }
}
