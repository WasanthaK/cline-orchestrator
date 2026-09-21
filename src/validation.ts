import { spawn } from "node:child_process";
import type { ValidationCommandResult, ValidationRun } from "./types.js";

export interface ValidationOptions {
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
}

function appendLimited(
  current: string,
  chunk: Buffer | string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (current.length >= maxChars) return { value: current, truncated: true };
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = Math.max(0, maxChars - current.length);
  if (text.length <= remaining) return { value: current + text, truncated: false };
  return { value: current + text.slice(0, remaining), truncated: true };
}

export async function runValidationCommand(
  workspace: string,
  command: string,
  options: ValidationOptions,
): Promise<ValidationCommandResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let stdout = "";
  let stderr = "";
  let outputTruncated = false;
  let timedOut = false;
  let aborted = false;

  return await new Promise<ValidationCommandResult>((resolve) => {
    let settled = false;
    const child = spawn(command, {
      cwd: workspace,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (exitCode?: number, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      const completedAt = new Date().toISOString();
      resolve({
        command,
        startedAt,
        completedAt,
        durationMs: Date.now() - startedMs,
        exitCode,
        signal,
        timedOut,
        aborted,
        stdout,
        stderr,
        ...(outputTruncated ? { outputTruncated: true } : {}),
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const next = appendLimited(stdout, chunk, options.maxOutputChars);
      stdout = next.value;
      outputTruncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = appendLimited(stderr, chunk, options.maxOutputChars);
      stderr = next.value;
      outputTruncated ||= next.truncated;
    });

    child.once("error", (error) => {
      const next = appendLimited(stderr, error.message, options.maxOutputChars);
      stderr = next.value;
      outputTruncated ||= next.truncated;
      finish();
    });
    child.once("close", (code, signal) => {
      finish(code ?? undefined, signal ?? undefined);
    });

    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, options.timeoutMs));
  });
}

export async function runValidationCommands(
  workspace: string,
  commands: string[],
  options: ValidationOptions,
): Promise<ValidationRun> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results: ValidationCommandResult[] = [];

  for (const command of commands) {
    if (options.signal?.aborted) break;
    const result = await runValidationCommand(workspace, command, options);
    results.push(result);
    if (
      result.aborted ||
      result.timedOut ||
      result.exitCode !== 0
    ) {
      break;
    }
  }

  const passed =
    results.length === commands.length &&
    results.every((result) => !result.aborted && !result.timedOut && result.exitCode === 0);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    passed,
    commandsRequested: commands.length,
    commandsRun: results.length,
    results,
  };
}
