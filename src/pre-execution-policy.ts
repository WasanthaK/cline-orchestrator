import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { DurableSafetyBinding } from "./safety-plan.js";

export type ActionDescriptor =
  | { kind: "read"; paths: string[] }
  | { kind: "search"; workspaceRoot?: string; queries: string[] }
  | { kind: "edit"; paths: string[]; operation: "create" | "modify" }
  | { kind: "patch"; paths: string[]; operations: string[] }
  | { kind: "command"; commands: string[] }
  | { kind: "network"; urls: string[] }
  | { kind: "unknown"; toolName: string; reason?: string };

export type PolicyDecisionKind = "ALLOW" | "DENY" | "ESCALATE_AND_STOP";

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  reason: string;
  action: ActionDescriptor;
  path?: string;
  pattern?: string;
}

export interface PreExecutionPolicyContext {
  workspaceRoot: string;
  binding: DurableSafetyBinding;
  secretPathPatterns?: string[];
}

const DEFAULT_SECRET_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*credentials*",
  "**/*token*cache*",
  ".git/**",
  "**/.git/**",
];

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function globToRegExp(patternValue: string): RegExp {
  const pattern = normalizeRelative(patternValue);
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  expression += "$";
  return new RegExp(expression, process.platform === "win32" ? "i" : "");
}

function matchingPattern(candidate: string, patterns: string[]): string | undefined {
  const normalized = normalizeRelative(candidate);
  return patterns.find((patternValue) => {
    const pattern = normalizeRelative(patternValue);
    if (globToRegExp(pattern).test(normalized)) return true;
    if (!/[?*]/.test(pattern)) return normalized === pattern || normalized.startsWith(`${pattern}/`);
    return false;
  });
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function existingAncestor(candidate: string, root: string): Promise<string> {
  let current = candidate;
  while (isInside(root, current)) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Path has no existing ancestor inside the registered workspace");
}

async function containsSymlinkComponent(root: string, candidate: string): Promise<boolean> {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw error;
    }
  }
  return false;
}

export interface ResolvedPolicyPath {
  absolutePath: string;
  relativePath: string;
}

export async function resolvePolicyPath(
  workspaceRoot: string,
  requestedPath: string,
  options: { write: boolean },
): Promise<ResolvedPolicyPath> {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.includes("\0")) {
    throw new Error("Path must be a non-empty string without NUL bytes");
  }

  const canonicalRoot = await realpath(workspaceRoot);
  const input = requestedPath.trim();
  const lexicalCandidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(canonicalRoot, input);
  if (!isInside(canonicalRoot, lexicalCandidate)) throw new Error("Path escapes the registered workspace");

  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(lexicalCandidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    const ancestor = await existingAncestor(lexicalCandidate, canonicalRoot);
    const canonicalAncestor = await realpath(ancestor);
    if (!isInside(canonicalRoot, canonicalAncestor)) throw new Error("Path ancestor resolves outside the registered workspace");
    resolvedCandidate = path.resolve(canonicalAncestor, path.relative(ancestor, lexicalCandidate));
  }

  if (!isInside(canonicalRoot, resolvedCandidate)) throw new Error("Path resolves outside the registered workspace");
  if (options.write && await containsSymlinkComponent(canonicalRoot, lexicalCandidate)) {
    throw new Error("Write path contains a symlink or reparse-point component");
  }

  return {
    absolutePath: resolvedCandidate,
    relativePath: normalizeRelative(path.relative(canonicalRoot, resolvedCandidate)),
  };
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  if (value.some((item) => typeof item !== "string" || !item.trim())) return undefined;
  return value.map((item) => (item as string).trim());
}

function firstStringArray(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const result = stringArray(record[key]);
    if (result) return result;
  }
  return undefined;
}

export function normalizeToolAction(toolName: string, input: unknown): ActionDescriptor {
  const name = toolName.trim();
  const record = asRecord(input);
  if (!name || !record) return { kind: "unknown", toolName: name || "(missing)", reason: "Malformed tool input" };

  if (["read_file", "read_files", "readFile"].includes(name)) {
    const paths = firstStringArray(record, ["paths", "path", "filePath", "filePaths"]);
    return paths?.length ? { kind: "read", paths } : { kind: "unknown", toolName: name, reason: "Missing read path" };
  }
  if (["search_codebase", "search", "searchFiles"].includes(name)) {
    const queries = firstStringArray(record, ["queries", "query", "pattern", "searchTerm"]);
    const workspaceRoot = typeof record.workspaceRoot === "string" ? record.workspaceRoot : undefined;
    return queries?.length ? { kind: "search", workspaceRoot, queries } : { kind: "unknown", toolName: name, reason: "Missing search query" };
  }
  if (["editor", "write_file", "writeFile"].includes(name)) {
    const paths = firstStringArray(record, ["paths", "path", "filePath", "filePaths"]);
    const operation = record.operation === "create" ? "create" : "modify";
    return paths?.length ? { kind: "edit", paths, operation } : { kind: "unknown", toolName: name, reason: "Missing edit path" };
  }
  if (["apply_patch", "applyPatch"].includes(name)) {
    const paths = firstStringArray(record, ["paths", "affectedPaths", "filePaths"]);
    const operations = firstStringArray(record, ["operations", "operation"]) ?? ["modify"];
    return paths?.length ? { kind: "patch", paths, operations } : { kind: "unknown", toolName: name, reason: "Patch paths must be previewed before policy evaluation" };
  }
  if (["run_commands", "run_command", "executeCommand"].includes(name)) {
    const commands = firstStringArray(record, ["commands", "command"]) ?? [];
    return { kind: "command", commands };
  }
  if (["fetch_web_content", "fetch", "network"].includes(name)) {
    const urls = firstStringArray(record, ["urls", "url"]) ?? [];
    return { kind: "network", urls };
  }
  return { kind: "unknown", toolName: name };
}

function allow(action: ActionDescriptor, reason: string): PolicyDecision {
  return { decision: "ALLOW", reason, action };
}

function deny(action: ActionDescriptor, reason: string, pathValue?: string, pattern?: string): PolicyDecision {
  return { decision: "DENY", reason, action, path: pathValue, pattern };
}

function escalate(action: ActionDescriptor, reason: string, pathValue?: string): PolicyDecision {
  return { decision: "ESCALATE_AND_STOP", reason, action, path: pathValue };
}

async function evaluatePaths(
  action: ActionDescriptor & ({ kind: "read" } | { kind: "edit" } | { kind: "patch" }),
  context: PreExecutionPolicyContext,
): Promise<PolicyDecision> {
  const write = action.kind !== "read";
  const secretPatterns = [...DEFAULT_SECRET_PATTERNS, ...(context.secretPathPatterns ?? [])];
  for (const requestedPath of action.paths) {
    let resolved: ResolvedPolicyPath;
    try {
      resolved = await resolvePolicyPath(context.workspaceRoot, requestedPath, { write });
    } catch (error) {
      return deny(action, error instanceof Error ? error.message : "Path validation failed", requestedPath);
    }

    const secret = matchingPattern(resolved.relativePath, secretPatterns);
    if (secret) return deny(action, "Access to secret or credential paths is denied", resolved.relativePath, secret);
    const protectedPattern = matchingPattern(resolved.relativePath, context.binding.protectedPathPatterns);
    if (protectedPattern) return deny(action, "Access to protected paths is denied", resolved.relativePath, protectedPattern);

    if (write && !matchingPattern(resolved.relativePath, context.binding.allowedPathPatterns)) {
      return escalate(action, "Requested write is outside the approved Safety Plan scope", resolved.relativePath);
    }
  }
  return allow(action, write ? "Write is inside the approved workspace scope" : "Read is contained and non-sensitive");
}

export async function evaluatePreExecutionPolicy(
  action: ActionDescriptor,
  context: PreExecutionPolicyContext,
): Promise<PolicyDecision> {
  try {
    switch (action.kind) {
      case "read":
      case "edit":
      case "patch":
        if (action.paths.length === 0) return deny(action, "Tool action did not identify any paths");
        return await evaluatePaths(action, context);
      case "search": {
        if (action.queries.length === 0) return deny(action, "Search action did not identify a query");
        if (action.workspaceRoot) {
          const canonicalRoot = await realpath(context.workspaceRoot);
          const requestedRoot = await realpath(action.workspaceRoot);
          if (canonicalRoot !== requestedRoot) return deny(action, "Search root does not match the registered workspace");
        }
        return allow(action, "Search is constrained to the registered workspace");
      }
      case "command":
        return deny(action, "Arbitrary model shell commands are disabled in the first write-capable pilot");
      case "network":
        return deny(action, "Ungoverned model network access is disabled in the first write-capable pilot");
      case "unknown":
        return deny(action, action.reason ?? `Unsupported or unknown tool '${action.toolName}'`);
    }
  } catch (error) {
    return deny(action, `Policy evaluation failed closed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
