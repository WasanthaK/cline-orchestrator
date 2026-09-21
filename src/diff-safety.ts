import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiffSafetyPolicy } from "./diff-safety-config.js";
import type {
  DiffChangedPath,
  DiffPathStatus,
  DiffSafetyIssue,
  DiffSafetyResult,
  GitRollbackCheckpoint,
} from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

interface BaselineUntrackedEntry {
  path: string;
  type: "file" | "symlink";
  size: number;
  mode: number;
  linkTarget?: string;
}

interface BaselineUntrackedManifest {
  entries: BaselineUntrackedEntry[];
}

function normalized(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isOrchestratorPath(value: string): boolean {
  const candidate = normalized(value);
  return candidate === ".orchestrator" || candidate.startsWith(".orchestrator/");
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Diff path escapes workspace: ${relativePath}`);
  }
  return absolute;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    windowsHide: true,
    maxBuffer: MAX_GIT_BUFFER,
    encoding: "utf8",
  });
  return result.stdout;
}

function globToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalized(pattern);
  let value = "^";
  for (let i = 0; i < normalizedPattern.length; i += 1) {
    const char = normalizedPattern[i];
    const next = normalizedPattern[i + 1];
    if (char === "*" && next === "*") {
      value += ".*";
      i += 1;
    } else if (char === "*") {
      value += "[^/]*";
    } else if (char === "?") {
      value += "[^/]";
    } else {
      value += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  value += "$";
  return new RegExp(value, process.platform === "win32" ? "i" : "");
}

function matchesAny(pathValue: string, patterns: string[]): string | undefined {
  const candidate = normalized(pathValue);
  return patterns.find((pattern) => globToRegExp(pattern).test(candidate));
}

function statusFromCode(code: string): DiffPathStatus {
  switch (code[0]) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "T": return "type_changed";
    case "U": return "unmerged";
    default: return "unknown";
  }
}

function parseNameStatus(output: string): DiffChangedPath[] {
  const parts = output.split("\0").filter(Boolean);
  const changed: DiffChangedPath[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    const status = statusFromCode(code);
    if (status === "renamed" || status === "copied") {
      const previousPath = normalized(parts[i++] ?? "");
      const pathValue = normalized(parts[i++] ?? "");
      if (!pathValue || isOrchestratorPath(pathValue)) continue;
      changed.push({ path: pathValue, previousPath, status, source: "tracked" });
      continue;
    }
    const pathValue = normalized(parts[i++] ?? "");
    if (!pathValue || isOrchestratorPath(pathValue)) continue;
    changed.push({ path: pathValue, status, source: "tracked" });
  }
  return changed;
}

function parseNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [added, removed] = line.split("\t");
    if (added !== "-") additions += Number.parseInt(added, 10) || 0;
    if (removed !== "-") deletions += Number.parseInt(removed, 10) || 0;
  }
  return { additions, deletions };
}

async function currentBranch(root: string): Promise<string | undefined> {
  try {
    return (await runGit(root, ["symbolic-ref", "--short", "-q", "HEAD"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function currentUntracked(root: string): Promise<string[]> {
  return (await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
    .map(normalized)
    .filter((value) => !isOrchestratorPath(value));
}

async function hashFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function baselineUntrackedChanges(
  root: string,
  checkpoint: GitRollbackCheckpoint,
  currentPaths: string[],
): Promise<DiffChangedPath[]> {
  if (!checkpoint.manifestPath || !checkpoint.backupDir) {
    return currentPaths.map((pathValue) => ({ path: pathValue, status: "added", source: "untracked" }));
  }

  const manifest = JSON.parse(await readFile(checkpoint.manifestPath, "utf8")) as BaselineUntrackedManifest;
  const baseline = new Map((manifest.entries ?? []).map((entry) => [normalized(entry.path), entry]));
  const current = new Set(currentPaths);
  const changed: DiffChangedPath[] = [];

  for (const pathValue of currentPaths) {
    const entry = baseline.get(pathValue);
    if (!entry) {
      changed.push({ path: pathValue, status: "added", source: "untracked" });
      continue;
    }

    const currentPath = resolveWorkspacePath(root, pathValue);
    const info = await lstat(currentPath);
    let modified = false;
    if (entry.type === "symlink") {
      modified = !info.isSymbolicLink() || (await readlink(currentPath)) !== (entry.linkTarget ?? "");
    } else if (!info.isFile()) {
      modified = true;
    } else {
      const backupPath = resolveWorkspacePath(path.join(checkpoint.backupDir, "files"), pathValue);
      modified = info.size !== entry.size || (await hashFile(currentPath)) !== (await hashFile(backupPath));
    }
    if (modified) changed.push({ path: pathValue, status: "modified", source: "untracked" });
  }

  for (const pathValue of baseline.keys()) {
    if (!current.has(pathValue)) {
      changed.push({ path: pathValue, status: "deleted", source: "untracked" });
    }
  }

  return changed;
}

function issue(code: DiffSafetyIssue["code"], message: string, pathValue?: string, pattern?: string): DiffSafetyIssue {
  return { code, message, ...(pathValue ? { path: pathValue } : {}), ...(pattern ? { pattern } : {}) };
}

export async function evaluateDiffSafety(
  workspace: string,
  checkpoint: GitRollbackCheckpoint | undefined,
  policy: DiffSafetyPolicy,
  expectedChangedPaths?: string[],
): Promise<DiffSafetyResult> {
  const checkedAt = new Date().toISOString();
  const warnings: DiffSafetyIssue[] = [];
  const failures: DiffSafetyIssue[] = [];
  const empty = { changedFiles: 0, trackedFiles: 0, untrackedFiles: 0, trackedAdditions: 0, trackedDeletions: 0 };

  if (!checkpoint?.available || !checkpoint.root || !checkpoint.head) {
    failures.push(issue("checkpoint_unavailable", checkpoint?.error ?? "Rollback checkpoint is unavailable"));
    return { checkedAt, passed: false, checkpointCreatedAt: checkpoint?.createdAt, finalDiffSummary: "Diff safety unavailable because the pre-run checkpoint is unavailable.", summary: empty, changedPaths: [], warnings, failures };
  }

  try {
    const root = (await runGit(workspace, ["rev-parse", "--show-toplevel"])).trim();
    const sameRoot = process.platform === "win32"
      ? path.resolve(root).toLowerCase() === path.resolve(checkpoint.root).toLowerCase()
      : path.resolve(root) === path.resolve(checkpoint.root);
    if (!sameRoot) failures.push(issue("repository_mismatch", `Current repository ${root} differs from checkpoint repository ${checkpoint.root}`));

    const currentHead = (await runGit(root, ["rev-parse", "--verify", "HEAD"])).trim();
    const branch = await currentBranch(root);
    if ((checkpoint.branch ?? undefined) !== (branch ?? undefined)) failures.push(issue("branch_moved", `Branch changed from ${checkpoint.branch ?? "(detached)"} to ${branch ?? "(detached)"}`));
    if (currentHead !== checkpoint.head) failures.push(issue("head_moved", `HEAD changed from ${checkpoint.head} to ${currentHead}`));

    const baselineRef = checkpoint.stashRef ?? checkpoint.head;
    const pathspec = [".", ":(exclude).orchestrator", ":(exclude).orchestrator/**"];
    const [nameStatus, numstat, currentUntrackedPaths] = await Promise.all([
      runGit(root, ["diff", "--name-status", "-z", baselineRef, "--", ...pathspec]),
      runGit(root, ["diff", "--numstat", baselineRef, "--", ...pathspec]),
      currentUntracked(root),
    ]);

    const tracked = parseNameStatus(nameStatus);
    const untracked = await baselineUntrackedChanges(root, checkpoint, currentUntrackedPaths);
    const changedPaths = [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path));
    const stats = parseNumstat(numstat);
    const summary = { changedFiles: changedPaths.length, trackedFiles: tracked.length, untrackedFiles: untracked.length, trackedAdditions: stats.additions, trackedDeletions: stats.deletions };

    if (policy.maxChangedFiles > 0 && changedPaths.length > policy.maxChangedFiles) failures.push(issue("excessive_diff", `Diff changes ${changedPaths.length} paths, exceeding limit ${policy.maxChangedFiles}`));

    const expected = expectedChangedPaths?.length ? expectedChangedPaths : undefined;
    if (!expected) warnings.push(issue("scope_unconfigured", "No expectedChangedPaths were configured; unexpected-path enforcement was skipped."));

    for (const changed of changedPaths) {
      const candidates = [changed.path, ...(changed.previousPath ? [changed.previousPath] : [])];
      for (const candidate of candidates) {
        const protectedPattern = matchesAny(candidate, policy.protectedPatterns);
        if (protectedPattern) failures.push(issue("protected_path", `Protected path changed: ${candidate}`, candidate, protectedPattern));
        const warningPattern = matchesAny(candidate, policy.warningPatterns);
        if (warningPattern) warnings.push(issue("deployment_sensitive_path", `Deployment-sensitive path changed: ${candidate}`, candidate, warningPattern));
        if (expected && !matchesAny(candidate, expected)) failures.push(issue("unexpected_path", `Changed path is outside the configured task scope: ${candidate}`, candidate));
      }
    }

    const finalDiffSummary = `${changedPaths.length} changed path(s): ${tracked.length} tracked, ${untracked.length} untracked baseline delta; tracked +${stats.additions}/-${stats.deletions}; warnings=${warnings.length}; failures=${failures.length}`;
    return { checkedAt, passed: failures.length === 0, checkpointCreatedAt: checkpoint.createdAt, baselineRef, baselineBranch: checkpoint.branch, baselineHead: checkpoint.head, currentBranch: branch, currentHead, finalDiffSummary, summary, changedPaths, warnings, failures };
  } catch (error) {
    failures.push(issue("diff_unavailable", error instanceof Error ? error.message : String(error)));
    return { checkedAt, passed: false, checkpointCreatedAt: checkpoint.createdAt, baselineBranch: checkpoint.branch, baselineHead: checkpoint.head, finalDiffSummary: "Diff safety evaluation failed before a final diff summary could be produced.", summary: empty, changedPaths: [], warnings, failures };
  }
}
