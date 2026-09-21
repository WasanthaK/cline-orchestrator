import crypto from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorTask, TaskStatus } from "./types.js";

export const PROJECT_MEMORY_SCHEMA_VERSION = 1 as const;
export const PROJECT_MEMORY_UPDATE_SCHEMA_VERSION = 1 as const;
export const CODE_MAP_MAX_PATHS = 12 as const;

export const PROJECT_MEMORY_DOCUMENTS = {
  architecture: "architecture.md",
  decisions: "decisions.md",
  codeMap: "code-map.md",
  conventions: "conventions.md",
  knownIssues: "known-issues.md",
} as const;

export type ProjectMemoryDocumentName = keyof typeof PROJECT_MEMORY_DOCUMENTS;

export interface ProjectTaskPointer {
  id: string;
  status: TaskStatus;
  updatedAt: string;
}

export interface ProjectMemoryUpdateReference {
  id: string;
  document: ProjectMemoryDocumentName;
  recordedAt: string;
  taskId: string;
  rationale: string;
}

export interface ProjectMetadata {
  schemaVersion: typeof PROJECT_MEMORY_SCHEMA_VERSION;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  memorySchemaVersion: 1;
  memoryFiles: Record<ProjectMemoryDocumentName, string>;
  memoryUpdateCount?: number;
  lastMemoryUpdate?: ProjectMemoryUpdateReference;
  lastTask?: ProjectTaskPointer;
}

export interface ArchitectureMemoryUpdateInput {
  taskId: string;
  title: string;
  content: string;
  rationale: string;
  recordedAt?: string;
}

export interface ArchitectureMemoryUpdate {
  schemaVersion: typeof PROJECT_MEMORY_UPDATE_SCHEMA_VERSION;
  id: string;
  document: "architecture";
  recordedAt: string;
  taskId: string;
  title: string;
  content: string;
  rationale: string;
}

export interface DecisionMemoryUpdateInput {
  taskId: string;
  title: string;
  decision: string;
  rationale: string;
  recordedAt?: string;
}

export interface DecisionMemoryUpdate {
  schemaVersion: typeof PROJECT_MEMORY_UPDATE_SCHEMA_VERSION;
  id: string;
  document: "decisions";
  recordedAt: string;
  taskId: string;
  title: string;
  decision: string;
  rationale: string;
}

export interface CodeMapMemoryUpdateInput {
  taskId: string;
  component: string;
  paths: string[];
  responsibility: string;
  rationale: string;
  recordedAt?: string;
}

export interface CodeMapMemoryUpdate {
  schemaVersion: typeof PROJECT_MEMORY_UPDATE_SCHEMA_VERSION;
  id: string;
  document: "codeMap";
  recordedAt: string;
  taskId: string;
  component: string;
  paths: string[];
  responsibility: string;
  rationale: string;
}

const MEMORY_TEMPLATES: Record<ProjectMemoryDocumentName, string> = {
  architecture: `# Architecture\n\nDurable project architecture memory. Record stable components, boundaries, and important data/control flows only.\n`,
  decisions: `# Decisions\n\nDurable decision log. Record decisions with rationale plus date/task provenance; do not use this file as transient scratch space.\n`,
  codeMap: `# Code Map\n\nDurable map of important modules and responsibilities. Keep this selective rather than cataloguing every file.\n`,
  conventions: `# Conventions\n\nDurable implementation and project conventions that future work should preserve.\n`,
  knownIssues: `# Known Issues\n\nDurable unresolved issues, constraints, and risks that materially affect future work.\n`,
};

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

function serialize(metadata: ProjectMetadata): string {
  return JSON.stringify(metadata, null, 2) + "\n";
}

function validateMetadata(value: unknown, filePath: string): ProjectMetadata {
  const metadata = value as Partial<ProjectMetadata> | undefined;
  if (!metadata || metadata.schemaVersion !== PROJECT_MEMORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported or missing project metadata schema in ${filePath}`);
  }
  if (typeof metadata.projectId !== "string" || !metadata.projectId) {
    throw new Error(`Project metadata is missing projectId in ${filePath}`);
  }
  if (typeof metadata.createdAt !== "string" || typeof metadata.updatedAt !== "string") {
    throw new Error(`Project metadata timestamps are invalid in ${filePath}`);
  }
  if (typeof metadata.workspaceRoot !== "string" || !metadata.workspaceRoot) {
    throw new Error(`Project metadata is missing workspaceRoot in ${filePath}`);
  }
  if (metadata.memorySchemaVersion !== 1 || !metadata.memoryFiles) {
    throw new Error(`Project memory metadata is invalid in ${filePath}`);
  }
  return metadata as ProjectMetadata;
}

function requiredText(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function singleLine(label: string, value: string): string {
  return requiredText(label, value).replace(/\s+/g, " ");
}

function validateRecordedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(`recordedAt is not a valid timestamp: ${value}`);
  return value;
}

function selectivePaths(paths: string[]): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths must contain at least one important path");
  }
  if (paths.length > CODE_MAP_MAX_PATHS) {
    throw new Error(`paths must contain at most ${CODE_MAP_MAX_PATHS} entries`);
  }
  const normalized = paths.map((value, index) => singleLine(`paths[${index}]`, value));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("paths must not contain duplicates");
  }
  return normalized;
}

function formatArchitectureUpdate(update: ArchitectureMemoryUpdate): string {
  const provenance = JSON.stringify({
    schemaVersion: update.schemaVersion,
    id: update.id,
    document: update.document,
    recordedAt: update.recordedAt,
    taskId: update.taskId,
    rationale: update.rationale,
  });

  return [
    "",
    `<!-- orchestrator-memory-update ${provenance} -->`,
    `## ${update.title}`,
    "",
    `- Update ID: \`${update.id}\``,
    `- Recorded at: ${update.recordedAt}`,
    `- Task: \`${update.taskId}\``,
    `- Rationale: ${update.rationale}`,
    "",
    update.content,
    "",
  ].join("\n");
}

function formatDecisionUpdate(update: DecisionMemoryUpdate): string {
  const provenance = JSON.stringify({
    schemaVersion: update.schemaVersion,
    id: update.id,
    document: update.document,
    recordedAt: update.recordedAt,
    taskId: update.taskId,
    rationale: update.rationale,
  });

  return [
    "",
    `<!-- orchestrator-memory-update ${provenance} -->`,
    `## ${update.title}`,
    "",
    `- Update ID: \`${update.id}\``,
    `- Recorded at: ${update.recordedAt}`,
    `- Task: \`${update.taskId}\``,
    `- Rationale: ${update.rationale}`,
    "",
    "### Decision",
    "",
    update.decision,
    "",
  ].join("\n");
}

function formatCodeMapUpdate(update: CodeMapMemoryUpdate): string {
  const provenance = JSON.stringify({
    schemaVersion: update.schemaVersion,
    id: update.id,
    document: update.document,
    recordedAt: update.recordedAt,
    taskId: update.taskId,
    component: update.component,
    paths: update.paths,
    rationale: update.rationale,
  });

  return [
    "",
    `<!-- orchestrator-memory-update ${provenance} -->`,
    `## ${update.component}`,
    "",
    `- Update ID: \`${update.id}\``,
    `- Recorded at: ${update.recordedAt}`,
    `- Task: \`${update.taskId}\``,
    `- Rationale: ${update.rationale}`,
    "",
    "### Important paths",
    "",
    ...update.paths.map((value) => `- \`${value}\``),
    "",
    "### Responsibility",
    "",
    update.responsibility,
    "",
  ].join("\n");
}

export class ProjectMemoryStore {
  constructor(private readonly rootDir: string) {}

  private orchestratorDir(): string {
    return path.join(this.rootDir, ".orchestrator");
  }

  private memoryDir(): string {
    return path.join(this.orchestratorDir(), "memory");
  }

  private projectPath(): string {
    return path.join(this.orchestratorDir(), "project.json");
  }

  private memoryPath(name: ProjectMemoryDocumentName): string {
    return path.join(this.memoryDir(), PROJECT_MEMORY_DOCUMENTS[name]);
  }

  private relativeMemoryFiles(): Record<ProjectMemoryDocumentName, string> {
    return Object.fromEntries(
      Object.entries(PROJECT_MEMORY_DOCUMENTS).map(([name, filename]) => [
        name,
        path.posix.join(".orchestrator", "memory", filename),
      ]),
    ) as Record<ProjectMemoryDocumentName, string>;
  }

  private async ensureMemorySkeleton(): Promise<void> {
    await mkdir(this.memoryDir(), { recursive: true });
    for (const [name, filename] of Object.entries(PROJECT_MEMORY_DOCUMENTS) as Array<
      [ProjectMemoryDocumentName, string]
    >) {
      try {
        await writeFile(path.join(this.memoryDir(), filename), MEMORY_TEMPLATES[name], {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    }
  }

  private async recordMemoryUpdate(
    current: ProjectMetadata,
    reference: ProjectMemoryUpdateReference,
  ): Promise<void> {
    const next: ProjectMetadata = {
      ...current,
      updatedAt: new Date().toISOString(),
      memoryUpdateCount: (current.memoryUpdateCount ?? 0) + 1,
      lastMemoryUpdate: reference,
    };
    await writeFile(this.projectPath(), serialize(next), "utf8");
  }

  async load(): Promise<ProjectMetadata> {
    const filePath = this.projectPath();
    try {
      return validateMetadata(JSON.parse(await readFile(filePath, "utf8")), filePath);
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`Project metadata was not found at ${filePath}`);
      }
      throw error;
    }
  }

  async ensure(): Promise<ProjectMetadata> {
    await mkdir(this.orchestratorDir(), { recursive: true });
    await this.ensureMemorySkeleton();

    let existing: ProjectMetadata | undefined;
    try {
      existing = await this.load();
    } catch (error) {
      if (!String((error as Error)?.message ?? error).startsWith("Project metadata was not found at ")) {
        throw error;
      }
    }

    const workspaceRoot = path.resolve(this.rootDir);
    const memoryFiles = this.relativeMemoryFiles();
    if (existing) {
      const needsRefresh =
        existing.workspaceRoot !== workspaceRoot ||
        JSON.stringify(existing.memoryFiles) !== JSON.stringify(memoryFiles);
      if (!needsRefresh) return existing;

      const updated: ProjectMetadata = {
        ...existing,
        workspaceRoot,
        memorySchemaVersion: 1,
        memoryFiles,
        updatedAt: new Date().toISOString(),
      };
      await writeFile(this.projectPath(), serialize(updated), "utf8");
      return updated;
    }

    const now = new Date().toISOString();
    const created: ProjectMetadata = {
      schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
      projectId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      workspaceRoot,
      memorySchemaVersion: 1,
      memoryFiles,
    };
    await writeFile(this.projectPath(), serialize(created), "utf8");
    return created;
  }

  async recordTask(task: OrchestratorTask): Promise<ProjectMetadata> {
    const current = await this.ensure();
    const next: ProjectMetadata = {
      ...current,
      updatedAt: new Date().toISOString(),
      lastTask: {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
      },
    };
    await writeFile(this.projectPath(), serialize(next), "utf8");
    return next;
  }

  async appendArchitectureUpdate(input: ArchitectureMemoryUpdateInput): Promise<ArchitectureMemoryUpdate> {
    const current = await this.ensure();
    const recordedAt = validateRecordedAt(input.recordedAt ?? new Date().toISOString());
    const update: ArchitectureMemoryUpdate = {
      schemaVersion: PROJECT_MEMORY_UPDATE_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      document: "architecture",
      recordedAt,
      taskId: singleLine("taskId", input.taskId),
      title: singleLine("title", input.title),
      content: requiredText("content", input.content),
      rationale: singleLine("rationale", input.rationale),
    };

    await appendFile(this.memoryPath("architecture"), formatArchitectureUpdate(update), "utf8");
    await this.recordMemoryUpdate(current, {
      id: update.id,
      document: update.document,
      recordedAt: update.recordedAt,
      taskId: update.taskId,
      rationale: update.rationale,
    });
    return update;
  }

  async appendDecisionUpdate(input: DecisionMemoryUpdateInput): Promise<DecisionMemoryUpdate> {
    const current = await this.ensure();
    const recordedAt = validateRecordedAt(input.recordedAt ?? new Date().toISOString());
    const update: DecisionMemoryUpdate = {
      schemaVersion: PROJECT_MEMORY_UPDATE_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      document: "decisions",
      recordedAt,
      taskId: singleLine("taskId", input.taskId),
      title: singleLine("title", input.title),
      decision: requiredText("decision", input.decision),
      rationale: singleLine("rationale", input.rationale),
    };

    await appendFile(this.memoryPath("decisions"), formatDecisionUpdate(update), "utf8");
    await this.recordMemoryUpdate(current, {
      id: update.id,
      document: update.document,
      recordedAt: update.recordedAt,
      taskId: update.taskId,
      rationale: update.rationale,
    });
    return update;
  }

  async appendCodeMapUpdate(input: CodeMapMemoryUpdateInput): Promise<CodeMapMemoryUpdate> {
    const current = await this.ensure();
    const recordedAt = validateRecordedAt(input.recordedAt ?? new Date().toISOString());
    const update: CodeMapMemoryUpdate = {
      schemaVersion: PROJECT_MEMORY_UPDATE_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      document: "codeMap",
      recordedAt,
      taskId: singleLine("taskId", input.taskId),
      component: singleLine("component", input.component),
      paths: selectivePaths(input.paths),
      responsibility: requiredText("responsibility", input.responsibility),
      rationale: singleLine("rationale", input.rationale),
    };

    await appendFile(this.memoryPath("codeMap"), formatCodeMapUpdate(update), "utf8");
    await this.recordMemoryUpdate(current, {
      id: update.id,
      document: update.document,
      recordedAt: update.recordedAt,
      taskId: update.taskId,
      rationale: update.rationale,
    });
    return update;
  }
}
