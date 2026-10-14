export type InstallPlatform = "windows" | "linux";

export type InstallOwnership =
  | "product_owned"
  | "user_owned_config"
  | "user_owned_workspace_registry"
  | "user_owned_secrets"
  | "user_owned_task_state";

export interface InstallManifestEntryV1 {
  path: string;
  ownership: InstallOwnership;
  kind: "file" | "directory" | "service_registration";
}

export interface InstallManifestV1 {
  schemaVersion: 1;
  platform: InstallPlatform;
  version: string;
  entries: InstallManifestEntryV1[];
  authority: "install_manifest_plan_only";
  grantsAuthority: false;
}

export interface InstallPlanV1 {
  schemaVersion: 1;
  platform: InstallPlatform;
  action: "install" | "uninstall";
  productOwnedPaths: string[];
  preservedUserOwnedPaths: string[];
  serviceRegistrations: string[];
  destructiveUserDataDeletionRequested: false;
  explicitExecutionRequired: true;
  authority: "install_plan_observation_only";
  mutatesFilesystem: false;
  mutatesServiceManager: false;
  grantsAuthority: false;
}

export const INSTALLER_PACKAGING_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  authority: "installer_packaging_plan_only" as const,
  explicitExecutionRequired: true as const,
  preservesUserDataByDefault: true as const,
  destructiveUserDataDeletionByDefault: false as const,
  reversibleWherePossible: true as const,
  mutatesFilesystem: false as const,
  mutatesServiceManager: false as const,
  grantsAuthority: false as const,
});

export class InstallerPackagingError extends Error {
  constructor(
    message: string,
    public readonly code: "manifest_invalid" | "path_invalid",
  ) {
    super(message);
    this.name = "InstallerPackagingError";
  }
}

const SAFE_PATH_CHARS = /^[A-Za-z0-9._ @()\\/\\-]+$/;
const SAFE_VERSION = /^[0-9A-Za-z._+-]{1,64}$/;

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\0")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\\\")) return false;
  if (!SAFE_PATH_CHARS.test(value)) return false;
  const segments = value.split(/[\\\\/]+/);
  return segments.every((segment) => segment !== ".." && segment.length > 0);
}

function assertManifest(manifest: InstallManifestV1): void {
  if (
    manifest.schemaVersion !== 1
    || !["windows", "linux"].includes(manifest.platform)
    || !SAFE_VERSION.test(manifest.version)
    || !Array.isArray(manifest.entries)
    || manifest.authority !== "install_manifest_plan_only"
    || manifest.grantsAuthority !== false
  ) {
    throw new InstallerPackagingError("install manifest is invalid", "manifest_invalid");
  }

  // Normalize path identity without consulting the filesystem. Windows
  // package paths are case-insensitive; Linux paths are case-sensitive.
  // Both accept separator spellings but must reject ambiguous aliases.
  const segmentsOf = (value: string): string[] => value.replace(/\\/g, "/").split("/");
  const identityOf = (value: string): string =>
    manifest.platform === "windows" ? value.replace(/\\/g, "/").toLowerCase() : value.replace(/\\/g, "/");
  const seen = new Set<string>();
  const entries: { path: string; kind: InstallManifestEntryV1["kind"]; ownership: InstallOwnership }[] = [];
  for (const entry of manifest.entries) {
    if (
      !isSafeRelativePath(entry.path)
      || ![
        "product_owned",
        "user_owned_config",
        "user_owned_workspace_registry",
        "user_owned_secrets",
        "user_owned_task_state",
      ].includes(entry.ownership)
      || !["file", "directory", "service_registration"].includes(entry.kind)
      || segmentsOf(entry.path).some((segment) => segment === "." || segment.endsWith(" ") || segment.endsWith("."))
      || seen.has(identityOf(entry.path))
    ) {
      throw new InstallerPackagingError("install manifest entry is invalid", "path_invalid");
    }
    const id = identityOf(entry.path);
    // An installer must not own a parent directory of operator data (or
    // claim any directory below operator-owned paths). Reject all conflicting
    // ownership ancestors before making any non-executing plan.
    for (const prior of entries) {
      const overlapping = id.startsWith(prior.path + "/") || prior.path.startsWith(id + "/");
      if (overlapping && (entry.ownership !== prior.ownership || prior.kind !== "directory" && id.startsWith(prior.path + "/") || entry.kind !== "directory" && prior.path.startsWith(id + "/"))) {
        throw new InstallerPackagingError("install manifest has overlapping or conflicting ownership", "path_invalid");
      }
    }
    seen.add(id);
    entries.push({ path: id, kind: entry.kind, ownership: entry.ownership });

    if (
      entry.kind === "service_registration"
      && entry.ownership !== "product_owned"
    ) {
      throw new InstallerPackagingError(
        "service registrations must be product-owned",
        "manifest_invalid",
      );
    }
  }
}

function classify(manifest: InstallManifestV1) {
  const productOwnedPaths: string[] = [];
  const preservedUserOwnedPaths: string[] = [];
  const serviceRegistrations: string[] = [];

  for (const entry of manifest.entries) {
    if (entry.kind === "service_registration") {
      serviceRegistrations.push(entry.path);
      continue;
    }
    if (entry.ownership === "product_owned") {
      productOwnedPaths.push(entry.path);
    } else {
      preservedUserOwnedPaths.push(entry.path);
    }
  }

  return {
    productOwnedPaths: productOwnedPaths.sort(),
    preservedUserOwnedPaths: preservedUserOwnedPaths.sort(),
    serviceRegistrations: serviceRegistrations.sort(),
  };
}

export function planInstall(manifestInput: InstallManifestV1): InstallPlanV1 {
  const manifest = structuredClone(manifestInput);
  assertManifest(manifest);
  const classified = classify(manifest);
  return Object.freeze({
    schemaVersion: 1,
    platform: manifest.platform,
    action: "install",
    ...classified,
    destructiveUserDataDeletionRequested: false,
    explicitExecutionRequired: true,
    authority: "install_plan_observation_only",
    mutatesFilesystem: false,
    mutatesServiceManager: false,
    grantsAuthority: false,
  });
}

export function planUninstall(manifestInput: InstallManifestV1): InstallPlanV1 {
  const manifest = structuredClone(manifestInput);
  assertManifest(manifest);
  const classified = classify(manifest);
  return Object.freeze({
    schemaVersion: 1,
    platform: manifest.platform,
    action: "uninstall",
    ...classified,
    destructiveUserDataDeletionRequested: false,
    explicitExecutionRequired: true,
    authority: "install_plan_observation_only",
    mutatesFilesystem: false,
    mutatesServiceManager: false,
    grantsAuthority: false,
  });
}
