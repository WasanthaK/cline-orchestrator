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

  const seen = new Set<string>();
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
      || seen.has(entry.path)
    ) {
      throw new InstallerPackagingError("install manifest entry is invalid", "path_invalid");
    }
    seen.add(entry.path);

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
