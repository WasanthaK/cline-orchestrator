import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteUtf8 } from "./state.js";

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cline-orchestrator-atomic-write-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("atomic task write retries transient Windows rename contention", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "task.json");
    await writeFile(target, "old\n", "utf8");

    let attempts = 0;
    const delays: number[] = [];
    await atomicWriteUtf8(target, "new\n", {
      platform: "win32",
      renameFile: async (from, to) => {
        attempts += 1;
        if (attempts <= 2) throw errno("EPERM");
        await rename(from, to);
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    assert.equal(await readFile(target, "utf8"), "new\n");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [10, 25]);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("atomic task write does not retry non-Windows permission failures", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "task.json");
    await writeFile(target, "old\n", "utf8");

    let attempts = 0;
    await assert.rejects(
      atomicWriteUtf8(target, "new\n", {
        platform: "linux",
        renameFile: async () => {
          attempts += 1;
          throw errno("EPERM");
        },
        sleep: async () => {
          throw new Error("sleep must not run");
        },
      }),
      (error: unknown) => (error as NodeJS.ErrnoException)?.code === "EPERM",
    );

    assert.equal(attempts, 1);
    assert.equal(await readFile(target, "utf8"), "old\n");
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("atomic task write bounds Windows rename retries and cleans the temp file", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "task.json");
    await writeFile(target, "old\n", "utf8");

    let attempts = 0;
    const delays: number[] = [];
    await assert.rejects(
      atomicWriteUtf8(target, "new\n", {
        platform: "win32",
        renameFile: async () => {
          attempts += 1;
          throw errno("EBUSY");
        },
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      }),
      (error: unknown) => (error as NodeJS.ErrnoException)?.code === "EBUSY",
    );

    assert.equal(attempts, 6);
    assert.deepEqual(delays, [10, 25, 50, 100, 200]);
    assert.equal(await readFile(target, "utf8"), "old\n");
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  });
});
