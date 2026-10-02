import crypto from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface WorkspaceSafetyProfile {
  profileId: string;
  revision: number;
  policyVersion: string;
  allowedPathPatterns: string[];
  protectedPathPatterns: string[];
  validationCommands: string[];
  workerProfileId: string;
  maxChangedFiles: number;
}

export interface RegisteredProject {
  projectId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredWorkspace {
  workspaceId: string;
  projectId: string;
  displayName: string;
  canonicalRoot: string;
  safetyProfile: WorkspaceSafetyProfile;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

interface RegistryDocument {
  schemaVersion: 1;
  projects: RegisteredProject[];
  workspaces: RegisteredWorkspace[];
}

export interface RegisterWorkspaceInput {
  projectId: string;
  displayName: string;
  root: string;
  safetyProfile: Omit<WorkspaceSafetyProfile, "profileId" | "revision"> & {
    profileId?: string;
  };
}

export interface WorkspaceDiscoveryRecord {
  workspaceId: string;
  projectId: string;
  displayName: string;
  rootAlias: string;
  revision: number;
  safetyProfileId: string;
  safetyProfileRevision: number;
  policyVersion: string;
}

export class WorkspaceRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "registry_invalid"
      | "project_not_found"
      | "workspace_not_found"
      | "unsafe_root"
      | "duplicate_root",
  ) {
    super(message);
    this.name = "WorkspaceRegistryError";
  }
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new WorkspaceRegistryError(`${field} must not be empty`, "registry_invalid");
  return trimmed;
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isFilesystemRoot(value: string): boolean {
  return normalizeForCompare(value) === normalizeForCompare(path.parse(value).root);
}

function systemSensitiveRoots(): string[] {
  if (process.platform === "win32") {
    return [
      process.env.SystemRoot,
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
    ].filter((item): item is string => Boolean(item));
  }

  if (process.platform === "darwin") {
    return ["/System", "/Library", "/Applications", "/private/etc", "/private/var"];
  }

  return ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"];
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalizeRoot(root: string): Promise<string> {
  const requested = path.resolve(nonEmpty(root, "workspace root"));
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch (error) {
    throw new WorkspaceRegistryError(
      `Workspace root cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
      "unsafe_root",
    );
  }

  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new WorkspaceRegistryError("Workspace root must be a directory", "unsafe_root");
  }
  if (isFilesystemRoot(canonical)) {
    throw new WorkspaceRegistryError("Filesystem roots cannot be registered as workspaces", "unsafe_root");
  }

  for (const sensitive of systemSensitiveRoots()) {
    const resolvedSensitive = path.resolve(sensitive);
    if (isSameOrInside(canonical, resolvedSensitive)) {
      throw new WorkspaceRegistryError(
        `System-sensitive root cannot be registered: ${resolvedSensitive}`,
        "unsafe_root",
      );
    }
  }

  return canonical;
}

function cloneProfile(profile: WorkspaceSafetyProfile): WorkspaceSafetyProfile {
  return {
    ...profile,
    allowedPathPatterns: [...profile.allowedPathPatterns],
    protectedPathPatterns: [...profile.protectedPathPatterns],
    validationCommands: [...profile.validationCommands],
  };
}

function cloneWorkspace(workspace: RegisteredWorkspace): RegisteredWorkspace {
  return { ...workspace, safetyProfile: cloneProfile(workspace.safetyProfile) };
}

function validateProfile(profile: RegisterWorkspaceInput["safetyProfile"]): void {
  nonEmpty(profile.policyVersion, "policyVersion");
  nonEmpty(profile.workerProfileId, "workerProfileId");
  if (!Number.isInteger(profile.maxChangedFiles) || profile.maxChangedFiles < 0) {
    throw new WorkspaceRegistryError("maxChangedFiles must be a non-negative integer", "registry_invalid");
  }
  for (const [name, items] of [
    ["allowedPathPatterns", profile.allowedPathPatterns],
    ["protectedPathPatterns", profile.protectedPathPatterns],
    ["validationCommands", profile.validationCommands],
  ] as const) {
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !item.trim())) {
      throw new WorkspaceRegistryError(`${name} must contain non-empty strings`, "registry_invalid");
    }
  }
}

export function defaultWorkspaceRegistryPath(): string {
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
    : process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "cline-orchestrator", "workspace-registry.json");
}

export class WorkspaceRegistry {
  constructor(private readonly filePath = defaultWorkspaceRegistryPath()) {}

  get path(): string {
    return this.filePath;
  }

  private async load(): Promise<RegistryDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<RegistryDocument>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects) || !Array.isArray(parsed.workspaces)) {
        throw new WorkspaceRegistryError("Unsupported or invalid workspace registry schema", "registry_invalid");
      }
      return parsed as RegistryDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: 1, projects: [], workspaces: [] };
      }
      if (error instanceof WorkspaceRegistryError) throw error;
      throw new WorkspaceRegistryError(
        `Workspace registry cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        "registry_invalid",
      );
    }
  }

  private async save(document: RegistryDocument): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(document, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async registerProject(displayName: string): Promise<RegisteredProject> {
    const document = await this.load();
    const now = new Date().toISOString();
    const project: RegisteredProject = {
      projectId: crypto.randomUUID(),
      displayName: nonEmpty(displayName, "project displayName"),
      createdAt: now,
      updatedAt: now,
    };
    document.projects.push(project);
    await this.save(document);
    return { ...project };
  }

  async registerWorkspace(input: RegisterWorkspaceInput): Promise<RegisteredWorkspace> {
    validateProfile(input.safetyProfile);
    const document = await this.load();
    if (!document.projects.some((project) => project.projectId === input.projectId)) {
      throw new WorkspaceRegistryError(`Project '${input.projectId}' is not registered`, "project_not_found");
    }

    const canonicalRoot = await canonicalizeRoot(input.root);
    const duplicate = document.workspaces.find(
      (workspace) => normalizeForCompare(workspace.canonicalRoot) === normalizeForCompare(canonicalRoot),
    );
    if (duplicate) {
      throw new WorkspaceRegistryError(
        `Workspace root is already registered as '${duplicate.workspaceId}'`,
        "duplicate_root",
      );
    }

    const now = new Date().toISOString();
    const workspace: RegisteredWorkspace = {
      workspaceId: crypto.randomUUID(),
      projectId: input.projectId,
      displayName: nonEmpty(input.displayName, "workspace displayName"),
      canonicalRoot,
      safetyProfile: {
        ...input.safetyProfile,
        profileId: input.safetyProfile.profileId ?? crypto.randomUUID(),
        revision: 1,
        allowedPathPatterns: [...input.safetyProfile.allowedPathPatterns],
        protectedPathPatterns: [...input.safetyProfile.protectedPathPatterns],
        validationCommands: [...input.safetyProfile.validationCommands],
      },
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    document.workspaces.push(workspace);
    await this.save(document);
    return cloneWorkspace(workspace);
  }

  async getWorkspace(workspaceId: string): Promise<RegisteredWorkspace> {
    const document = await this.load();
    const workspace = document.workspaces.find((item) => item.workspaceId === workspaceId);
    if (!workspace) {
      throw new WorkspaceRegistryError(`Workspace '${workspaceId}' is not registered`, "workspace_not_found");
    }
    return cloneWorkspace(workspace);
  }

  async resolveVerifiedWorkspace(workspaceId: string): Promise<RegisteredWorkspace> {
    const workspace = await this.getWorkspace(workspaceId);
    const currentCanonicalRoot = await canonicalizeRoot(workspace.canonicalRoot);
    if (normalizeForCompare(currentCanonicalRoot) !== normalizeForCompare(workspace.canonicalRoot)) {
      throw new WorkspaceRegistryError("Registered workspace canonical root no longer matches", "unsafe_root");
    }
    return workspace;
  }

  async listProjects(): Promise<RegisteredProject[]> {
    return (await this.load()).projects.map((project) => ({ ...project }));
  }

  async listWorkspaces(): Promise<WorkspaceDiscoveryRecord[]> {
    return (await this.load()).workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      displayName: workspace.displayName,
      rootAlias: path.basename(workspace.canonicalRoot),
      revision: workspace.revision,
      safetyProfileId: workspace.safetyProfile.profileId,
      safetyProfileRevision: workspace.safetyProfile.revision,
      policyVersion: workspace.safetyProfile.policyVersion,
    }));
  }

  async updateSafetyProfile(
    workspaceId: string,
    update: Omit<WorkspaceSafetyProfile, "profileId" | "revision">,
  ): Promise<RegisteredWorkspace> {
    validateProfile(update);
    const document = await this.load();
    const index = document.workspaces.findIndex((item) => item.workspaceId === workspaceId);
    if (index < 0) {
      throw new WorkspaceRegistryError(`Workspace '${workspaceId}' is not registered`, "workspace_not_found");
    }
    const previous = document.workspaces[index]!;
    const now = new Date().toISOString();
    const next: RegisteredWorkspace = {
      ...previous,
      updatedAt: now,
      revision: previous.revision + 1,
      safetyProfile: {
        ...update,
        profileId: previous.safetyProfile.profileId,
        revision: previous.safetyProfile.revision + 1,
        allowedPathPatterns: [...update.allowedPathPatterns],
        protectedPathPatterns: [...update.protectedPathPatterns],
        validationCommands: [...update.validationCommands],
      },
    };
    document.workspaces[index] = next;
    await this.save(document);
    return cloneWorkspace(next);
  }
}
