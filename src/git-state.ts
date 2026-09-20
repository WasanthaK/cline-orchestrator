import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_STATUS_LINES = 200;
const ORCHESTRATOR_EXCLUDE = ":(exclude).orchestrator";

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

function countStatus(statusLines: string[]) {
  let stagedFiles = 0;
  let unstagedFiles = 0;
  let untrackedFiles = 0;

  for (const line of statusLines) {
    if (line.startsWith("??")) {
      untrackedFiles += 1;
      continue;
    }

    const indexCode = line[0] ?? " ";
    const worktreeCode = line[1] ?? " ";
    if (indexCode !== " ") stagedFiles += 1;
    if (worktreeCode !== " ") unstagedFiles += 1;
  }

  return { stagedFiles, unstagedFiles, untrackedFiles };
}

export async function captureGitSnapshot(workspace: string): Promise<GitSnapshot> {
  const capturedAt = new Date().toISOString();

  try {
    const root = await git(workspace, ["rev-parse", "--show-toplevel"]);
    const head = await git(workspace, ["rev-parse", "HEAD"]);
    const branch = await git(workspace, ["branch", "--show-current"]);
    const status = await git(workspace, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ORCHESTRATOR_EXCLUDE,
    ]);
    const diffShortStat = await git(workspace, [
      "diff",
      "--shortstat",
      "--",
      ".",
      ORCHESTRATOR_EXCLUDE,
    ]);
    const stagedDiffShortStat = await git(workspace, [
      "diff",
      "--cached",
      "--shortstat",
      "--",
      ".",
      ORCHESTRATOR_EXCLUDE,
    ]);

    const allStatusLines = status ? status.split(/\r?\n/).filter(Boolean) : [];
    const counts = countStatus(allStatusLines);

    return {
      capturedAt,
      available: true,
      root,
      branch: branch || undefined,
      head,
      detached: branch.length === 0,
      dirty: allStatusLines.length > 0,
      changedFiles: allStatusLines.length,
      ...counts,
      statusLines: allStatusLines.slice(0, MAX_STATUS_LINES),
      statusTruncated: allStatusLines.length > MAX_STATUS_LINES,
      diffShortStat: diffShortStat || undefined,
      stagedDiffShortStat: stagedDiffShortStat || undefined,
    };
  } catch (error) {
    return {
      capturedAt,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
