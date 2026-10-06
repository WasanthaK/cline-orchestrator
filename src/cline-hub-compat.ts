import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_CLINE_CORE_VERSION = "0.0.83";

export class ClineHubCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClineHubCompatibilityError";
  }
}

type PathFlavor = "win32" | "posix";

function pathApi(flavor: PathFlavor): path.PlatformPath {
  return flavor === "win32" ? path.win32 : path.posix;
}

function normalizeForCompare(value: string, flavor: PathFlavor): string {
  const api = pathApi(flavor);
  const resolved = api.resolve(value);
  return flavor === "win32" ? resolved.toLowerCase() : resolved;
}

export interface ClineHubShimPlanInput {
  coreVersion: string;
  coreEntryPath: string;
  daemonEntryPath: string;
  pathFlavor?: PathFlavor;
}

export interface ClineHubShimTarget {
  expectedEntryPath: string;
  shimSource: string;
}

export interface ClineHubShimPlan {
  coreRoot: string;
  daemonEntryPath: string;
  targets: ClineHubShimTarget[];
}

/**
 * @cline/core 0.0.83 bundles hub/daemon/index.ts into two public bundles:
 * dist/index.js (used through @cline/sdk/@cline/core) and dist/hub/index.js
 * (used through @cline/core/hub). In both bundles its daemon launcher resolves
 * ./entry.js relative to import.meta.url, producing two missing paths:
 *
 *   dist/entry.js
 *   dist/hub/entry.js
 *
 * The exported daemon actually lives at dist/hub/daemon/entry.js. Keep this
 * workaround exact and fail closed. A future core version or a different
 * package layout must be reviewed rather than silently patched.
 */
export function planClineHubDaemonEntryShim(
  input: ClineHubShimPlanInput,
): ClineHubShimPlan {
  const flavor = input.pathFlavor ?? (process.platform === "win32" ? "win32" : "posix");
  const api = pathApi(flavor);

  if (input.coreVersion !== PINNED_CLINE_CORE_VERSION) {
    throw new ClineHubCompatibilityError(
      `Unsupported @cline/core version ${input.coreVersion}; expected ${PINNED_CLINE_CORE_VERSION}`,
    );
  }

  const distDir = api.dirname(input.coreEntryPath);
  const coreRoot = api.dirname(distDir);
  const expectedCoreEntry = api.join(coreRoot, "dist", "index.js");
  const expectedDaemonEntry = api.join(coreRoot, "dist", "hub", "daemon", "entry.js");

  if (
    normalizeForCompare(input.coreEntryPath, flavor) !==
    normalizeForCompare(expectedCoreEntry, flavor)
  ) {
    throw new ClineHubCompatibilityError(
      `Unexpected @cline/core entry layout: ${input.coreEntryPath}`,
    );
  }

  if (
    normalizeForCompare(input.daemonEntryPath, flavor) !==
    normalizeForCompare(expectedDaemonEntry, flavor)
  ) {
    throw new ClineHubCompatibilityError(
      `Unexpected @cline/core daemon export layout: ${input.daemonEntryPath}`,
    );
  }

  return {
    coreRoot,
    daemonEntryPath: input.daemonEntryPath,
    targets: [
      {
        expectedEntryPath: api.join(distDir, "entry.js"),
        shimSource: [
          "// cline-orchestrator compatibility shim for @cline/core 0.0.83.",
          "// The published root bundle resolves this path after bundling.",
          'import "./hub/daemon/entry.js";',
          "",
        ].join("\n"),
      },
      {
        expectedEntryPath: api.join(distDir, "hub", "entry.js"),
        shimSource: [
          "// cline-orchestrator compatibility shim for @cline/core 0.0.83.",
          "// The published @cline/core/hub bundle resolves this path after bundling.",
          'import "./daemon/entry.js";',
          "",
        ].join("\n"),
      },
    ],
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export type ClineHubCompatibilityResult = "native" | "shimmed" | "raced";

/**
 * Prepare the pinned SDK's published Hub launchers without starting, stopping,
 * or replacing any Hub process. The actual runtime discovery/locking and safe
 * retirement behavior remains owned by Cline itself.
 */
export async function ensureClineHubDaemonEntryCompatibility(): Promise<ClineHubCompatibilityResult> {
  const coreEntryPath = fileURLToPath(import.meta.resolve("@cline/core"));
  const daemonEntryPath = fileURLToPath(
    import.meta.resolve("@cline/core/hub/daemon-entry"),
  );
  const coreRoot = path.dirname(path.dirname(coreEntryPath));
  const manifestPath = path.join(coreRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version?: unknown;
  };
  const coreVersion = typeof manifest.version === "string" ? manifest.version : "";

  const plan = planClineHubDaemonEntryShim({
    coreVersion,
    coreEntryPath,
    daemonEntryPath,
  });

  let created = false;
  let raced = false;
  for (const target of plan.targets) {
    if (await exists(target.expectedEntryPath)) {
      continue;
    }

    try {
      await writeFile(target.expectedEntryPath, target.shimSource, {
        encoding: "utf8",
        flag: "wx",
      });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        raced = true;
        continue;
      }
      throw new ClineHubCompatibilityError(
        `Unable to prepare @cline/core Hub daemon compatibility entry ${target.expectedEntryPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (created) {
    return "shimmed";
  }
  return raced ? "raced" : "native";
}
