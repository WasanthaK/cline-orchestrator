import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_MEMORY_DOCUMENTS,
  ProjectMemoryStore,
  type ProjectMemoryDocumentName,
  type ProjectMemoryUpdateReference,
} from "./project-memory.js";

export const PROJECT_MEMORY_SELECTION_SCHEMA_VERSION = 1 as const;
export const PROJECT_MEMORY_SELECTION_MAX_ENTRIES = 6 as const;
export const PROJECT_MEMORY_SELECTION_MAX_PER_DOCUMENT = 2 as const;
export const PROJECT_MEMORY_SELECTION_MAX_EXCERPT_CHARS = 1_800 as const;
export const PROJECT_MEMORY_SELECTION_MAX_QUERY_TERMS = 32 as const;
export const PROJECT_MEMORY_SELECTION_MIN_TERM_MATCHES = 2 as const;

const PROVENANCE_PREFIX = "<!-- orchestrator-memory-update ";
const PROVENANCE_SUFFIX = " -->";
const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "been", "before", "being", "between",
  "could", "current", "does", "doing", "durable", "each", "for", "from", "have", "into",
  "memory", "more", "most", "only", "other", "over", "project", "same", "should", "some",
  "src", "such", "task", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "under", "using", "very", "what", "when", "where",
  "which", "while", "with", "would", "your", "continue",
]);

export interface ProjectMemorySelectionInput {
  query: string;
  taskId?: string;
  maxEntries?: number;
  preferredDocuments?: ProjectMemoryDocumentName[];
}

export interface ProjectMemorySelectedEntry {
  id: string;
  document: ProjectMemoryDocumentName;
  recordedAt: string;
  taskId: string;
  rationale: string;
  score: number;
  relativePath: string;
  excerpt: string;
  excerptTruncated: boolean;
}

export interface ProjectMemorySelection {
  schemaVersion: typeof PROJECT_MEMORY_SELECTION_SCHEMA_VERSION;
  selectedAt: string;
  queryTerms: string[];
  totalCandidates: number;
  matchedCandidates: number;
  maxEntries: number;
  maxPerDocument: number;
  entries: ProjectMemorySelectedEntry[];
}

interface ParsedMemoryEntry {
  provenance: ProjectMemoryUpdateReference;
  body: string;
}

function boundedExcerpt(value: string): { value: string; truncated: boolean } {
  const normalized = value.trim();
  if (normalized.length <= PROJECT_MEMORY_SELECTION_MAX_EXCERPT_CHARS) {
    return { value: normalized, truncated: false };
  }
  return {
    value: `${normalized.slice(0, PROJECT_MEMORY_SELECTION_MAX_EXCERPT_CHARS)}\n...[truncated by orchestrator]`,
    truncated: true,
  };
}

function tokenize(value: string): string[] {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
  return [...new Set(terms)].slice(0, PROJECT_MEMORY_SELECTION_MAX_QUERY_TERMS);
}

function validatedMaxEntries(value: number | undefined): number {
  if (value === undefined) return PROJECT_MEMORY_SELECTION_MAX_ENTRIES;
  if (!Number.isInteger(value) || value < 1 || value > PROJECT_MEMORY_SELECTION_MAX_ENTRIES) {
    throw new Error(
      `maxEntries must be an integer between 1 and ${PROJECT_MEMORY_SELECTION_MAX_ENTRIES}`,
    );
  }
  return value;
}

function parseDocument(content: string, expectedDocument: ProjectMemoryDocumentName): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  let cursor = 0;

  while (true) {
    const markerStart = content.indexOf(PROVENANCE_PREFIX, cursor);
    if (markerStart < 0) break;
    const jsonStart = markerStart + PROVENANCE_PREFIX.length;
    const markerEnd = content.indexOf(PROVENANCE_SUFFIX, jsonStart);
    if (markerEnd < 0) break;
    const nextMarker = content.indexOf(PROVENANCE_PREFIX, markerEnd + PROVENANCE_SUFFIX.length);
    const bodyEnd = nextMarker < 0 ? content.length : nextMarker;

    try {
      const value = JSON.parse(content.slice(jsonStart, markerEnd)) as Partial<ProjectMemoryUpdateReference>;
      if (
        typeof value.id === "string" &&
        value.document === expectedDocument &&
        typeof value.recordedAt === "string" &&
        typeof value.taskId === "string" &&
        typeof value.rationale === "string"
      ) {
        entries.push({
          provenance: value as ProjectMemoryUpdateReference,
          body: content.slice(markerEnd + PROVENANCE_SUFFIX.length, bodyEnd).trim(),
        });
      }
    } catch {
      // Ignore malformed/non-orchestrator prose. Retrieval is fail-closed to valid provenance markers.
    }

    cursor = markerEnd + PROVENANCE_SUFFIX.length;
  }

  return entries;
}

function termScore(searchable: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const normalized = searchable.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (normalized.includes(term)) score += 1;
  }
  return score;
}

function documentPath(rootDir: string, document: ProjectMemoryDocumentName): string {
  return path.join(rootDir, ".orchestrator", "memory", PROJECT_MEMORY_DOCUMENTS[document]);
}

export async function selectProjectMemory(
  rootDir: string,
  input: ProjectMemorySelectionInput,
): Promise<ProjectMemorySelection> {
  const maxEntries = validatedMaxEntries(input.maxEntries);
  const queryTerms = tokenize(input.query);
  const preferred = new Set(input.preferredDocuments ?? []);
  const metadata = await new ProjectMemoryStore(rootDir).ensure();

  const candidates: ProjectMemorySelectedEntry[] = [];
  let totalCandidates = 0;

  for (const document of Object.keys(PROJECT_MEMORY_DOCUMENTS) as ProjectMemoryDocumentName[]) {
    const content = await readFile(documentPath(rootDir, document), "utf8");
    for (const parsed of parseDocument(content, document)) {
      totalCandidates += 1;
      const searchable = [
        parsed.body,
        parsed.provenance.rationale,
        parsed.provenance.taskId,
        document,
      ].join("\n");
      const termMatches = termScore(searchable, queryTerms);
      const sameTask = Boolean(input.taskId && parsed.provenance.taskId === input.taskId);
      const preferredDocument = preferred.has(document);
      if (
        termMatches < PROJECT_MEMORY_SELECTION_MIN_TERM_MATCHES &&
        !sameTask &&
        !preferredDocument
      ) {
        continue;
      }
      const score = termMatches + (sameTask ? 4 : 0) + (preferredDocument ? 1 : 0);

      const excerpt = boundedExcerpt(parsed.body);
      candidates.push({
        id: parsed.provenance.id,
        document,
        recordedAt: parsed.provenance.recordedAt,
        taskId: parsed.provenance.taskId,
        rationale: parsed.provenance.rationale,
        score,
        relativePath: metadata.memoryFiles[document],
        excerpt: excerpt.value,
        excerptTruncated: excerpt.truncated,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const dateOrder = b.recordedAt.localeCompare(a.recordedAt);
    if (dateOrder !== 0) return dateOrder;
    const documentOrder = a.document.localeCompare(b.document);
    if (documentOrder !== 0) return documentOrder;
    return a.id.localeCompare(b.id);
  });

  const perDocument = new Map<ProjectMemoryDocumentName, number>();
  const entries: ProjectMemorySelectedEntry[] = [];
  for (const candidate of candidates) {
    if (entries.length >= maxEntries) break;
    const current = perDocument.get(candidate.document) ?? 0;
    if (current >= PROJECT_MEMORY_SELECTION_MAX_PER_DOCUMENT) continue;
    entries.push(candidate);
    perDocument.set(candidate.document, current + 1);
  }

  return {
    schemaVersion: PROJECT_MEMORY_SELECTION_SCHEMA_VERSION,
    selectedAt: new Date().toISOString(),
    queryTerms,
    totalCandidates,
    matchedCandidates: candidates.length,
    maxEntries,
    maxPerDocument: PROJECT_MEMORY_SELECTION_MAX_PER_DOCUMENT,
    entries,
  };
}
