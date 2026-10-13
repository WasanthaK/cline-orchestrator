import crypto from "node:crypto";
import path from "node:path";
import { lstat, stat } from "node:fs/promises";
import { FirstRunSetupService, type FirstRunSetupOptions, type FirstRunSetupResultV1 } from "./first-run-setup.js";
import { readProductConfigFile } from "./product-config-source.js";
import { WorkspaceRegistry, type RegisterWorkspaceInput } from "./workspace-registry.js";

export type RegistrationSetupAction = "register_project" | "register_workspace";

export class RegistrationSetupError extends Error {
  constructor(public readonly code: "input_invalid" | "registry_invalid" | "registration_invalid" | "state_changed") {
    super({
      input_invalid: "Registration input is invalid; supply only the explicit project or workspace fields",
      registry_invalid: "Workspace registry could not be safely reviewed",
      registration_invalid: "Registration cannot proceed; check the project, root and Safety profile",
      state_changed: "Registration state changed after review; start a new confirmation",
    }[code]);
    this.name = "RegistrationSetupError";
  }
}

export interface RegistrationSetupReview {
  action: RegistrationSetupAction;
  registryPath: string;
  registration: Record<string, unknown>;
  canonicalRoot?: string;
  confirmationText: string;
  expiresAt: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096
    && !/[\x00-\x1f\x7f]/.test(value);
}

function validateInput(action: RegistrationSetupAction, input: unknown): Record<string, unknown> {
  const invalid = () => { throw new RegistrationSetupError("input_invalid"); };
  if (!object(input)) return invalid();
  if (!text(input.displayName) || input.displayName.length > 120) return invalid();
  if (action === "register_project") {
    if (Object.keys(input).some(key => key !== "displayName")) return invalid();
    return { displayName: input.displayName.trim() };
  }
  if (action !== "register_workspace" || Object.keys(input).some(key =>
    !["displayName", "projectId", "root", "safetyProfile"].includes(key))) return invalid();
  if (!text(input.projectId) || !text(input.root) || !object(input.safetyProfile)) return invalid();
  const profile = input.safetyProfile;
  if (Object.keys(profile).some(key => !["policyVersion", "workerProfileId", "maxChangedFiles",
    "allowedPathPatterns", "protectedPathPatterns", "validationCommands"].includes(key))) return invalid();
  if (!text(profile.policyVersion) || !text(profile.workerProfileId)
    || !Number.isSafeInteger(profile.maxChangedFiles) || (profile.maxChangedFiles as number) < 0) return invalid();
  for (const key of ["allowedPathPatterns", "protectedPathPatterns", "validationCommands"]) {
    const items = profile[key];
    if (!Array.isArray(items) || items.length > 128 || items.some(item => !text(item))) return invalid();
  }
  // Every Safety field is explicit; no permissive profile or command defaults.
  return { ...structuredClone(input), displayName: input.displayName.trim(), root: path.resolve(input.root) };
}

async function registrySnapshot(registry: WorkspaceRegistry): Promise<string> {
  try {
    let info;
    try { info = await lstat(registry.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
    const content = await readProductConfigFile(registry.path);
    return `${info.dev}:${info.ino}:` + crypto.createHash("sha256").update(content).digest("hex");
  } catch { throw new RegistrationSetupError("registry_invalid"); }
}

async function prepare(registry: WorkspaceRegistry, action: RegistrationSetupAction, input: Record<string, unknown>) {
  try {
    // Also validate the registry document for project-only previews.
    await registry.listProjects();
    if (action === "register_project") return undefined;
    const canonicalRoot = await registry.previewWorkspaceRegistration(input as unknown as RegisterWorkspaceInput);
    const info = await stat(canonicalRoot);
    return { canonicalRoot, dev: info.dev, ino: info.ino };
  } catch { throw new RegistrationSetupError("registration_invalid"); }
}

// Serialize this adapter's in-process mutations; other registry writers retain their existing behavior.
const activeRegistries = new Set<string>();

export async function runRegistrationSetup(
  action: RegistrationSetupAction,
  input: unknown,
  confirm: (review: RegistrationSetupReview) => Promise<boolean>,
  registry = new WorkspaceRegistry(),
  options: FirstRunSetupOptions = {},
): Promise<{ registered: boolean; projectId?: string; workspaceId?: string;
  result?: FirstRunSetupResultV1; grantsAuthority: false }> {
  const registration = validateInput(action, input);
  const registryPath = path.resolve(registry.path);
  const snapshot = await registrySnapshot(registry);
  const root = await prepare(registry, action, registration);
  if (await registrySnapshot(registry) !== snapshot) throw new RegistrationSetupError("state_changed");
  let projectId: string | undefined;
  let workspaceId: string | undefined;
  const executeRegistration = async (payload: Record<string, unknown>) => {
    if (activeRegistries.has(registryPath)) throw new RegistrationSetupError("state_changed");
    activeRegistries.add(registryPath);
    try {
      if (await registrySnapshot(registry) !== snapshot) throw new RegistrationSetupError("state_changed");
      const selected = validateInput(action, payload.registration);
      const currentRoot = await prepare(registry, action, selected);
      if (JSON.stringify(currentRoot) !== JSON.stringify(root)
        || await registrySnapshot(registry) !== snapshot) throw new RegistrationSetupError("state_changed");
      if (action === "register_project") {
        projectId = (await registry.registerProject(selected.displayName as string)).projectId;
      } else {
        const workspace = await registry.registerWorkspace(selected as unknown as RegisterWorkspaceInput);
        projectId = workspace.projectId;
        workspaceId = workspace.workspaceId;
      }
    } finally { activeRegistries.delete(registryPath); }
  };
  const unsupported = async () => { throw new RegistrationSetupError("input_invalid"); };
  const service = new FirstRunSetupService({
    writeConfig: unsupported,
    registerProject: action === "register_project" ? executeRegistration : unsupported,
    registerWorkspace: action === "register_workspace" ? executeRegistration : unsupported,
    startLoopbackDaemon: unsupported,
  }, options);
  const preview = await service.preview({ schemaVersion: 1, action,
    payload: { registryPath, registration, snapshot, ...(root ? { root } : {}) } });
  const accepted = await confirm({ action, registryPath, registration: structuredClone(registration),
    ...(root ? { canonicalRoot: root.canonicalRoot } : {}),
    confirmationText: preview.confirmationText, expiresAt: preview.expiresAt });
  if (accepted !== true) return { registered: false, grantsAuthority: false };
  const result = await service.execute({ action, payloadDigest: preview.payloadDigest,
    confirmationToken: preview.confirmationToken, confirmed: true });
  return { registered: true, projectId, workspaceId, result, grantsAuthority: false };
}
