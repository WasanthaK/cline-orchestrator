import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_MEMORY_DOCUMENTS,
  ProjectMemoryStore,
  type ProjectMemoryDocumentName,
  type ProjectMemoryUpdateReference,
} from "./project-memory.js";

export const PROJECT_MEMORY_AUDIT_SCHEMA_VERSION = 1 as const;

const PROVENANCE_PREFIX = "<!-- orchestrator-memory-update ";
const PROVENANCE_SUFFIX = " -->";

export type ProjectMemoryAuditIssueCode =
  | "malformed_provenance"
  | "document_mismatch"
  | "invalid_timestamp"
  | "duplicate_update_id"
  | "metadata_count_mismatch"
  | "last_update_missing"
  | "last_update_mismatch";

export interface ProjectMemoryAuditIssue {
  code: ProjectMemoryAuditIssueCode;
  message: string;
  document?: ProjectMemoryDocumentName;
  updateId?: string;
}

export interface ProjectMemoryAuditEntry extends ProjectMemoryUpdateReference {
  relativePath: string;
}

export interface ProjectMemoryAuditReport {
  schemaVersion: typeof PROJECT_MEMORY_AUDIT_SCHEMA_VERSION;
  auditedAt: string;
  projectId: string;
  passed: boolean;
  expectedUpdateCount: number;
  discoveredUpdateCount: number;
  entries: ProjectMemoryAuditEntry[];
  issues: ProjectMemoryAuditIssue[];
}

function memoryPath(rootDir: string, document: ProjectMemoryDocumentName): string {
  return path.join(rootDir, ".orchestrator", "memory", PROJECT_MEMORY_DOCUMENTS[document]);
}

function parseDocument(
  content: string,
  document: ProjectMemoryDocumentName,
  relativePath: string,
): { entries: ProjectMemoryAuditEntry[]; issues: ProjectMemoryAuditIssue[] } {
  const entries: ProjectMemoryAuditEntry[] = [];
  const issues: ProjectMemoryAuditIssue[] = [];
  let cursor = 0;

  while (true) {
    const markerStart = content.indexOf(PROVENANCE_PREFIX, cursor);
    if (markerStart < 0) break;
    const jsonStart = markerStart + PROVENANCE_PREFIX.length;
    const markerEnd = content.indexOf(PROVENANCE_SUFFIX, jsonStart);
    if (markerEnd < 0) {
      issues.push({
        code: "malformed_provenance",
        document,
        message: `Unterminated project-memory provenance marker in ${relativePath}`,
      });
      break;
    }

    const raw = content.slice(jsonStart, markerEnd);
    try {
      const value = JSON.parse(raw) as Partial<ProjectMemoryUpdateReference>;
      if (
        typeof value.id !== "string" ||
        !value.id ||
        typeof value.document !== "string" ||
        typeof value.recordedAt !== "string" ||
        typeof value.taskId !== "string" ||
        !value.taskId ||
        typeof value.rationale !== "string" ||
        !value.rationale
      ) {
        issues.push({
          code: "malformed_provenance",
          document,
          message: `Project-memory provenance marker is missing required fields in ${relativePath}`,
        });
      } else if (value.document !== document) {
        issues.push({
          code: "document_mismatch",
          document,
          updateId: value.id,
          message: `Update ${value.id} declares document ${value.document} but is stored in ${document}`,
        });
      } else if (Number.isNaN(Date.parse(value.recordedAt))) {
        issues.push({
          code: "invalid_timestamp",
          document,
          updateId: value.id,
          message: `Update ${value.id} has invalid recordedAt ${value.recordedAt}`,
        });
      } else {
        entries.push({
          id: value.id,
          document,
          recordedAt: value.recordedAt,
          taskId: value.taskId,
          rationale: value.rationale,
          relativePath,
        });
      }
    } catch {
      issues.push({
        code: "malformed_provenance",
        document,
        message: `Project-memory provenance marker contains invalid JSON in ${relativePath}`,
      });
    }

    cursor = markerEnd + PROVENANCE_SUFFIX.length;
  }

  return { entries, issues };
}

function sameReference(entry: ProjectMemoryAuditEntry, reference: ProjectMemoryUpdateReference): boolean {
  return (
    entry.id === reference.id &&
    entry.document === reference.document &&
    entry.recordedAt === reference.recordedAt &&
    entry.taskId === reference.taskId &&
    entry.rationale === reference.rationale
  );
}

export async function auditProjectMemory(rootDir: string): Promise<ProjectMemoryAuditReport> {
  const metadata = await new ProjectMemoryStore(rootDir).ensure();
  const entries: ProjectMemoryAuditEntry[] = [];
  const issues: ProjectMemoryAuditIssue[] = [];

  for (const document of Object.keys(PROJECT_MEMORY_DOCUMENTS) as ProjectMemoryDocumentName[]) {
    const relativePath = metadata.memoryFiles[document];
    const parsed = parseDocument(
      await readFile(memoryPath(rootDir, document), "utf8"),
      document,
      relativePath,
    );
    entries.push(...parsed.entries);
    issues.push(...parsed.issues);
  }

  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      issues.push({
        code: "duplicate_update_id",
        document: entry.document,
        updateId: entry.id,
        message: `Project-memory update ID ${entry.id} appears more than once`,
      });
    }
    ids.add(entry.id);
  }

  const expectedUpdateCount = metadata.memoryUpdateCount ?? 0;
  if (expectedUpdateCount !== entries.length) {
    issues.push({
      code: "metadata_count_mismatch",
      message: `Project metadata records ${expectedUpdateCount} memory updates but ${entries.length} valid updates were discovered`,
    });
  }

  if (metadata.lastMemoryUpdate) {
    const matching = entries.find((entry) => entry.id === metadata.lastMemoryUpdate?.id);
    if (!matching) {
      issues.push({
        code: "last_update_missing",
        updateId: metadata.lastMemoryUpdate.id,
        message: `Project metadata lastMemoryUpdate ${metadata.lastMemoryUpdate.id} was not found in durable memory`,
      });
    } else if (!sameReference(matching, metadata.lastMemoryUpdate)) {
      issues.push({
        code: "last_update_mismatch",
        document: matching.document,
        updateId: matching.id,
        message: `Project metadata lastMemoryUpdate does not match durable provenance for ${matching.id}`,
      });
    }
  } else if (entries.length > 0) {
    issues.push({
      code: "last_update_missing",
      message: "Durable memory contains updates but project metadata has no lastMemoryUpdate reference",
    });
  }

  return {
    schemaVersion: PROJECT_MEMORY_AUDIT_SCHEMA_VERSION,
    auditedAt: new Date().toISOString(),
    projectId: metadata.projectId,
    passed: issues.length === 0,
    expectedUpdateCount,
    discoveredUpdateCount: entries.length,
    entries,
    issues,
  };
}
