import type { CheckpointLimits } from "./git-checkpoint.js";

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DEFAULT_CHECKPOINT_MAX_UNTRACKED_FILES = 10000;
export const DEFAULT_CHECKPOINT_MAX_UNTRACKED_BYTES = 256 * 1024 * 1024;

export function checkpointLimitsFromEnvironment(): CheckpointLimits {
  return {
    maxUntrackedFiles: Math.max(
      0,
      readInt("ORCH_CHECKPOINT_MAX_UNTRACKED_FILES", DEFAULT_CHECKPOINT_MAX_UNTRACKED_FILES),
    ),
    maxUntrackedBytes: Math.max(
      0,
      readInt("ORCH_CHECKPOINT_MAX_UNTRACKED_BYTES", DEFAULT_CHECKPOINT_MAX_UNTRACKED_BYTES),
    ),
  };
}
