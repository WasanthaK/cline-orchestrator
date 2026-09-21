import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitRollbackCheckpoint, WorkspaceFingerprint } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

export interface CheckpointLimits {
  maxUntrackedFiles: number;
  maxUntrackedBytes: number;
}

interface UntrackedBackupEntry {
  path: string;
  type: "file" | "symlink";
  size: number;
  mode: number;
  linkTarget?: string;
}

interface UntrackedManifest {
  entries: UntrackedBackupEntry[];
  totalBytes: number;
}

function normalized(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isOrchestratorPath(value: string): boolean {
  const candidate = normalized(value);
  return candidate === ".orchestrator" || candidate.startsWith(".orchestrator/");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Checkpoint path escapes workspace: ${relativePath}`);
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

async function optionalGitRef(cwd: string, ref: string): Promise<string | undefined> {
  try {
    const value = (await runGit(cwd, ["rev-parse", "--verify", "--quiet", ref])).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function repositoryRoot(workspace: string): Promise<string> {
  const root = (await runGit(workspace, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error(`${workspace} is not a git repository`);
  if (!samePath(root, workspace)) {
    throw new Error(
      `Rollback checkpoints require the orchestrator workspace to be the Git repository root (${root})`,
    );
  }
  return root;
}

async function currentBranch(cwd: string): Promise<string | undefined> {
  try {
    return (await runGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function listUntracked(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return output
    .split("\0")
    .filter(Boolean)
    .map(normalized)
    .filter((item) => !isOrchestratorPath(item))
    .sort((a, b) => a.localeCompare(b));
}

async function hashGitOutput(cwd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    let stderr = "";
    const child = spawn("git", ["-C", cwd, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk.toString("utf8").slice(0, 65536 - stderr.length);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(hash.digest("hex"));
      else reject(new Error(`git ${args[0]} exited with ${code}: ${stderr.trim()}`));
    });
  });
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

async function untrackedDigest(
  root: string,
  limits: CheckpointLimits,
): Promise<{ hash: string; files: number; bytes: number }> {
  const paths = await listUntracked(root);
  if (paths.length > limits.maxUntrackedFiles) {
    throw new Error(
      `Untracked file count ${paths.length} exceeds checkpoint limit ${limits.maxUntrackedFiles}`,
    );
  }

  let totalBytes = 0;
  const hash = createHash("sha256");
  for (const relativePath of paths) {
    const absolutePath = resolveWorkspacePath(root, relativePath);
    const info = await lstat(absolutePath);
    if (info.isDirectory()) {
      throw new Error(`Untracked directory or nested repository is not rollback-safe: ${relativePath}`);
    }

    let contentHash: string;
    let type: string;
    if (info.isSymbolicLink()) {
      type = "symlink";
      const target = await readlink(absolutePath);
      contentHash = createHash("sha256").update(target).digest("hex");
      totalBytes += Buffer.byteLength(target);
    } else if (info.isFile()) {
      type = "file";
      totalBytes += info.size;
      contentHash = await hashFile(absolutePath);
    } else {
      throw new Error(`Unsupported untracked filesystem entry: ${relativePath}`);
    }

    if (totalBytes > limits.maxUntrackedBytes) {
      throw new Error(
        `Untracked data ${totalBytes} bytes exceeds checkpoint limit ${limits.maxUntrackedBytes}`,
      );
    }
    hash.update(`${relativePath}\0${type}\0${info.mode}\0${info.size}\0${contentHash}\0`);
  }

  return { hash: hash.digest("hex"), files: paths.length, bytes: totalBytes };
}

export async function captureWorkspaceFingerprint(
  workspace: string,
  limits: CheckpointLimits,
): Promise<WorkspaceFingerprint> {
  const capturedAt = new Date().toISOString();
  try {
    const root = await repositoryRoot(workspace);
    const head = (await runGit(root, ["rev-parse", "--verify", "HEAD"])).trim();
    const branch = await currentBranch(root);
    const pathspec = [".", ":(exclude).orchestrator", ":(exclude).orchestrator/**"];
    const [stagedHash, unstagedHash, untracked] = await Promise.all([
      hashGitOutput(root, [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        ...pathspec,
      ]),
      hashGitOutput(root, [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        ...pathspec,
      ]),
      untrackedDigest(root, limits),
    ]);

    const digest = createHash("sha256")
      .update(`${head}\0${branch ?? ""}\0${stagedHash}\0${unstagedHash}\0${untracked.hash}`)
      .digest("hex");

    return {
      capturedAt,
      available: true,
      digest,
      root,
      branch,
      head,
      stagedHash,
      unstagedHash,
      untrackedHash: untracked.hash,
      untrackedFiles: untracked.files,
      untrackedBytes: untracked.bytes,
    };
  } catch (error) {
    return {
      capturedAt,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function trackedOrchestratorState(root: string): Promise<string[]> {
  return (await runGit(root, ["ls-files", "-z", "--", ".orchestrator"]))
    .split("\0")
    .filter(Boolean);
}

async function backupUntracked(
  root: string,
  backupDir: string,
  limits: CheckpointLimits,
): Promise<UntrackedManifest> {
  const paths = await listUntracked(root);
  if (paths.length > limits.maxUntrackedFiles) {
    throw new Error(
      `Untracked file count ${paths.length} exceeds checkpoint limit ${limits.maxUntrackedFiles}`,
    );
  }

  const entries: UntrackedBackupEntry[] = [];
  let totalBytes = 0;
  for (const relativePath of paths) {
    const source = resolveWorkspacePath(root, relativePath);
    const info = await lstat(source);
    if (info.isDirectory()) {
      throw new Error(`Untracked directory or nested repository is not rollback-safe: ${relativePath}`);
    }

    if (info.isSymbolicLink()) {
      const linkTarget = await readlink(source);
      totalBytes += Buffer.byteLength(linkTarget);
      entries.push({
        path: relativePath,
        type: "symlink",
        size: info.size,
        mode: info.mode,
        linkTarget,
      });
    } else if (info.isFile()) {
      totalBytes += info.size;
      if (totalBytes > limits.maxUntrackedBytes) {
        throw new Error(
          `Untracked data ${totalBytes} bytes exceeds checkpoint limit ${limits.maxUntrackedBytes}`,
        );
      }
      const destination = resolveWorkspacePath(path.join(backupDir, "files"), relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      entries.push({
        path: relativePath,
        type: "file",
        size: info.size,
        mode: info.mode,
      });
    } else {
      throw new Error(`Unsupported untracked filesystem entry: ${relativePath}`);
    }
  }

  if (totalBytes > limits.maxUntrackedBytes) {
    throw new Error(
      `Untracked data ${totalBytes} bytes exceeds checkpoint limit ${limits.maxUntrackedBytes}`,
    );
  }
  return { entries, totalBytes };
}

export async function createGitRollbackCheckpoint(
  workspace: string,
  taskId: string,
  runCount: number,
  limits: CheckpointLimits,
): Promise<GitRollbackCheckpoint> {
  const createdAt = new Date().toISOString();
  let privateRef: string | undefined;
  let backupDir: string | undefined;
  try {
    const root = await repositoryRoot(workspace);
    const trackedState = await trackedOrchestratorState(root);
    if (trackedState.length > 0) {
      throw new Error(
        ".orchestrator contains tracked files; rollback is disabled to avoid rewinding orchestrator state",
      );
    }

    const head = (await runGit(root, ["rev-parse", "--verify", "HEAD"])).trim();
    const branch = await currentBranch(root);
    const beforeFingerprint = await captureWorkspaceFingerprint(root, limits);
    if (!beforeFingerprint.available) {
      throw new Error(beforeFingerprint.error ?? "Could not fingerprint workspace before run");
    }

    backupDir = path.join(root, ".orchestrator", "checkpoints", taskId, String(runCount));
    await rm(backupDir, { recursive: true, force: true });
    await mkdir(backupDir, { recursive: true });
    const manifest = await backupUntracked(root, backupDir, limits);
    const manifestPath = path.join(backupDir, "untracked-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    const stashRef = (
      await runGit(root, [
        "stash",
        "create",
        `orchestrator checkpoint task=${taskId} run=${runCount}`,
      ])
    ).trim() || undefined;
    if (stashRef) {
      privateRef = `refs/orchestrator/checkpoints/${taskId}/${runCount}`;
      await runGit(root, ["update-ref", privateRef, stashRef]);
    }

    return {
      createdAt,
      available: true,
      taskId,
      runCount,
      root,
      branch,
      head,
      stashRef,
      privateRef,
      backupDir,
      manifestPath,
      untrackedFiles: manifest.entries.length,
      untrackedBytes: manifest.totalBytes,
      beforeFingerprint,
    };
  } catch (error) {
    if (privateRef) {
      await execFile("git", ["-C", workspace, "update-ref", "-d", privateRef], {
        windowsHide: true,
      }).catch(() => undefined);
    }
    if (backupDir) await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    return {
      createdAt,
      available: false,
      taskId,
      runCount,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function finalizeGitRollbackCheckpoint(
  workspace: string,
  checkpoint: GitRollbackCheckpoint,
  limits: CheckpointLimits,
): Promise<GitRollbackCheckpoint> {
  if (!checkpoint.available) return checkpoint;
  const afterFingerprint = await captureWorkspaceFingerprint(workspace, limits);
  if (!afterFingerprint.available) {
    return {
      ...checkpoint,
      available: false,
      afterFingerprint,
      error: afterFingerprint.error ?? "Could not fingerprint terminal workspace state",
    };
  }
  return { ...checkpoint, afterFingerprint };
}

async function removeNonIgnoredUntracked(root: string): Promise<void> {
  const paths = await listUntracked(root);
  for (const relativePath of paths.sort((a, b) => b.length - a.length)) {
    await rm(resolveWorkspacePath(root, relativePath), { recursive: true, force: true });
  }
}

async function restoreUntrackedBackup(checkpoint: GitRollbackCheckpoint): Promise<void> {
  if (!checkpoint.root || !checkpoint.manifestPath || !checkpoint.backupDir) return;
  const manifest = JSON.parse(await readFile(checkpoint.manifestPath, "utf8")) as UntrackedManifest;
  for (const entry of manifest.entries) {
    if (isOrchestratorPath(entry.path)) {
      throw new Error(`Refusing to restore orchestrator state from checkpoint: ${entry.path}`);
    }
    const destination = resolveWorkspacePath(checkpoint.root, entry.path);
    await mkdir(path.dirname(destination), { recursive: true });
    if (entry.type === "file") {
      const source = resolveWorkspacePath(path.join(checkpoint.backupDir, "files"), entry.path);
      await copyFile(source, destination);
      await chmod(destination, entry.mode & 0o777).catch(() => undefined);
    } else {
      await symlink(entry.linkTarget ?? "", destination);
    }
  }
}

interface RescueTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

async function beginRescueTransaction(root: string): Promise<RescueTransaction> {
  const originalHead = (await runGit(root, ["rev-parse", "--verify", "HEAD"])).trim();
  const previousStashRef = await optionalGitRef(root, "refs/stash");
  const id = randomUUID();
  const privateRef = `refs/orchestrator/restore-transactions/${id}`;
  const pathspec = [".", ":(exclude).orchestrator", ":(exclude).orchestrator/**"];

  await runGit(root, [
    "stash",
    "push",
    "--include-untracked",
    "--message",
    `orchestrator restore transaction ${id}`,
    "--",
    ...pathspec,
  ]);

  const capturedRef = await optionalGitRef(root, "refs/stash");
  const hasSnapshot = capturedRef !== undefined && capturedRef !== previousStashRef;
  if (hasSnapshot) {
    try {
      await runGit(root, ["update-ref", privateRef, capturedRef]);
      await runGit(root, ["stash", "drop", "stash@{0}"]);
    } catch (captureError) {
      try {
        await runGit(root, ["reset", "--hard", originalHead]);
        await removeNonIgnoredUntracked(root);
        await runGit(root, ["stash", "apply", "--index", capturedRef]);
      } catch (rollbackError) {
        throw new AggregateError(
          [captureError, rollbackError],
          "Rollback rescue snapshot and recovery both failed",
        );
      }
      throw captureError;
    }
  }

  let completed = false;
  return {
    async commit() {
      if (completed) return;
      completed = true;
      if (hasSnapshot) {
        await runGit(root, ["update-ref", "-d", privateRef]).catch(() => undefined);
      }
    },
    async rollback() {
      if (completed) return;
      await runGit(root, ["reset", "--hard", originalHead]);
      await removeNonIgnoredUntracked(root);
      if (hasSnapshot) {
        await runGit(root, ["stash", "apply", "--index", privateRef]);
        await runGit(root, ["update-ref", "-d", privateRef]);
      }
      completed = true;
    },
  };
}

export async function restoreGitRollbackCheckpoint(
  workspace: string,
  checkpoint: GitRollbackCheckpoint,
  limits: CheckpointLimits,
): Promise<GitRollbackCheckpoint> {
  if (!checkpoint.available) {
    throw new Error(checkpoint.error ?? "Rollback checkpoint is unavailable");
  }
  if (!checkpoint.root || !checkpoint.head) {
    throw new Error("Rollback checkpoint is missing repository identity");
  }
  if (!checkpoint.beforeFingerprint?.available || !checkpoint.beforeFingerprint.digest) {
    throw new Error("Rollback checkpoint is missing its pre-run fingerprint");
  }
  if (!checkpoint.afterFingerprint?.available || !checkpoint.afterFingerprint.digest) {
    throw new Error("Rollback checkpoint is missing its terminal fingerprint");
  }

  const root = await repositoryRoot(workspace);
  if (!samePath(root, checkpoint.root)) {
    throw new Error(`Rollback checkpoint belongs to a different repository: ${checkpoint.root}`);
  }

  const current = await captureWorkspaceFingerprint(root, limits);
  if (!current.available || current.digest !== checkpoint.afterFingerprint.digest) {
    throw new Error(
      "Workspace changed after the task reached its terminal state; rollback refused to protect newer work",
    );
  }
  if (current.head !== checkpoint.head) {
    throw new Error(
      `Current HEAD ${current.head ?? "unknown"} differs from checkpoint HEAD ${checkpoint.head}; rollback refused`,
    );
  }

  const rescue = await beginRescueTransaction(root);
  try {
    await runGit(root, ["reset", "--hard", checkpoint.head]);
    await removeNonIgnoredUntracked(root);
    if (checkpoint.stashRef) {
      const ref = checkpoint.privateRef ?? checkpoint.stashRef;
      await runGit(root, ["stash", "apply", "--index", ref]);
    }
    await restoreUntrackedBackup(checkpoint);

    const restored = await captureWorkspaceFingerprint(root, limits);
    if (!restored.available || restored.digest !== checkpoint.beforeFingerprint.digest) {
      throw new Error("Rollback verification failed: restored workspace does not match the pre-run fingerprint");
    }

    await rescue.commit();
    return { ...checkpoint, restoredAt: new Date().toISOString() };
  } catch (error) {
    try {
      await rescue.rollback();
      const recovered = await captureWorkspaceFingerprint(root, limits);
      if (!recovered.available || recovered.digest !== checkpoint.afterFingerprint.digest) {
        throw new Error("Rescue rollback completed but the terminal workspace fingerprint was not restored");
      }
    } catch (rescueError) {
      throw new AggregateError([error, rescueError], "Checkpoint restore and rescue rollback both failed");
    }
    throw error;
  }
}
