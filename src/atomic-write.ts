import crypto from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

const WINDOWS_ATOMIC_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200] as const;
const WINDOWS_ATOMIC_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export type AtomicWriteOptions = {
  platform?: NodeJS.Platform;
  renameFile?: typeof rename;
  sleep?: (delayMs: number) => Promise<void>;
};

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Replaces one UTF-8 file through a same-directory temporary file plus rename.
 * On Windows only, transient destination contention gets a bounded retry. The
 * destination is never deleted to force replacement, so failure remains atomic
 * and fail-closed.
 */
export async function atomicWriteUtf8(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const platform = options.platform ?? process.platform;
  const renameFile = options.renameFile ?? rename;
  const sleep = options.sleep ?? defaultSleep;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(tempPath, targetPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        const delayMs = WINDOWS_ATOMIC_RENAME_RETRY_DELAYS_MS[attempt];
        if (
          platform !== "win32"
          || !code
          || !WINDOWS_ATOMIC_RENAME_RETRY_CODES.has(code)
          || delayMs === undefined
        ) {
          throw error;
        }
        await sleep(delayMs);
      }
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
