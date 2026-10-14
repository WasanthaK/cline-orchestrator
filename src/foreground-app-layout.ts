import path from "node:path";
import {
  planInstall,
  planUninstall,
  type InstallManifestV1,
  type InstallPlanV1,
} from "./installer-packaging.js";

/**
 * M19A: verified ownership plan for a future user-installed foreground app.
 * Purely structural. Never consults the filesystem, executes an installer,
 * starts a model/daemon, or grants UI task authority.
 */
export const FOREGROUND_APP_LAYOUT_CONTRACT = Object.freeze({
  platform: "windows" as const,
  operatingMode: "foreground_only" as const,
  requiresBundledNodeRuntime: true as const,
  requiresExplicitInstallConsent: true as const,
  requiresServerSideSetupConfirmation: true as const,
  registersService: false as const,
  startsModel: false as const,
  launchesTask: false as const,
  exposesBrowserMutation: false as const,
  mutatesFilesystem: false as const,
  grantsAuthority: false as const,
});

export class ForegroundAppLayoutError extends Error {
  readonly code = "layout_invalid";
  constructor() {
    super("Foreground application layout is invalid");
    this.name = "ForegroundAppLayoutError";
  }
}

export interface ForegroundAppInstallRequest {
  platform: "windows";
  version: string;
  /** A trusted installer must separately verify this root is user-writable. */
  productRoot: string;
  /** Operator-owned state must be outside the product directory. */
  stateRoot: string;
}

export interface ForegroundAppLayoutPlan {
  schemaVersion: 1;
  platform: "windows";
  version: string;
  productRoot: string;
  stateRoot: string;
  install: InstallPlanV1;
  uninstall: InstallPlanV1;
  foregroundOnly: true;
  bundledRuntimeRequired: true;
  noServiceRegistration: true;
  userStatePreserved: true;
  mustVerifyFilesystemOwnershipAtExecution: true;
  authority: "foreground_app_layout_observation_only";
  mutatesFilesystem: false;
  grantsAuthority: false;
}

function checkedWindowsRoot(input: unknown): string {
  if (typeof input !== "string" || input.length < 4 || input.length > 1024
    || /[\x00-\x1f<>|"*?]/.test(input)
    || !/^[A-Za-z]:[\\/]/.test(input)
    || input.split(/[\\/]+/).some(segment => segment === "." || segment === "..")) {
    throw new ForegroundAppLayoutError();
  }
  const normalized = path.win32.normalize(input);
  if (normalized === path.win32.parse(normalized).root) {
    throw new ForegroundAppLayoutError();
  }
  return normalized;
}

function sameOrInside(a: string, b: string): boolean {
  const delta = path.win32.relative(b.toLowerCase(), a.toLowerCase());
  return !delta || (delta !== ".." && !delta.startsWith("..\\") && !path.win32.isAbsolute(delta));
}

function manifest(version: string): InstallManifestV1 {
  return {
    schemaVersion: 1,
    platform: "windows",
    version,
    authority: "install_manifest_plan_only",
    grantsAuthority: false,
    entries: [
      { path: "launcher/ClineOrchestrator.exe", kind: "file", ownership: "product_owned" },
      { path: "runtime/node.exe", kind: "file", ownership: "product_owned" },
      { path: "app/node_modules", kind: "directory", ownership: "product_owned" },
      { path: "app/node_modules/cline-orchestrator/dist/product-cli.js", kind: "file", ownership: "product_owned" },
      { path: "app/node_modules/cline-orchestrator/package.json", kind: "file", ownership: "product_owned" },
      { path: "app/product-manifest.json", kind: "file", ownership: "product_owned" },
      { path: "operator-data/config", kind: "directory", ownership: "user_owned_config" },
      { path: "operator-data/workspaces", kind: "directory", ownership: "user_owned_workspace_registry" },
      { path: "operator-data/secrets", kind: "directory", ownership: "user_owned_secrets" },
      { path: "operator-data/tasks", kind: "directory", ownership: "user_owned_task_state" },
    ],
  };
}

export function planForegroundAppLayout(request: ForegroundAppInstallRequest): ForegroundAppLayoutPlan {
  if (!request || request.platform !== "windows") throw new ForegroundAppLayoutError();
  const productRoot = checkedWindowsRoot(request.productRoot);
  const stateRoot = checkedWindowsRoot(request.stateRoot);
  if (sameOrInside(productRoot, stateRoot) || sameOrInside(stateRoot, productRoot)) {
    throw new ForegroundAppLayoutError();
  }
  const candidate = manifest(request.version);
  try {
    const install = planInstall(candidate);
    const uninstall = planUninstall(candidate);
    if (install.serviceRegistrations.length || uninstall.serviceRegistrations.length
      || install.productOwnedPaths.some(p => p.startsWith("operator-data/"))
      || uninstall.preservedUserOwnedPaths.some(p => !p.startsWith("operator-data/"))) {
      throw new ForegroundAppLayoutError();
    }
    return Object.freeze({
      schemaVersion: 1,
      platform: "windows",
      version: request.version,
      productRoot,
      stateRoot,
      install,
      uninstall,
      foregroundOnly: true,
      bundledRuntimeRequired: true,
      noServiceRegistration: true,
      userStatePreserved: true,
      mustVerifyFilesystemOwnershipAtExecution: true,
      authority: "foreground_app_layout_observation_only",
      mutatesFilesystem: false,
      grantsAuthority: false,
    });
  } catch {
    throw new ForegroundAppLayoutError();
  }
}
